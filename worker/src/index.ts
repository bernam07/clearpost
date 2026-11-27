import {
  detectCarrierServer,
  lookupDirectDHL,
  lookupDirectDPD,
  lookupDirectInPost,
  lookupDirectMondialRelay,
  probeFreeCarriers,
} from './providers/directCarriers';
import { lookupWithShip24 } from './providers/ship24';
import { lookupWith17Track, type CarrierId } from './providers/seventeenTrack';

interface Env {
  DHL_API_KEY?: string;
  SHIP24_API_KEY?: string;
  SEVENTEENTRACK_API_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

function corsHeaders(env: Env): HeadersInit {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data: unknown, env: Env, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...corsHeaders(env),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(
        {
          ok: true,
          mode: env.SHIP24_API_KEY
            ? 'ship24+direct'
            : env.SEVENTEENTRACK_API_KEY
              ? '17track+direct'
              : 'direct-free',
          directFreeCarriers: ['dpd', 'inpost', ...(env.DHL_API_KEY ? ['dhl'] : [])],
        },
        env,
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/track') {
      const body = (await request.json().catch(() => null)) as {
        trackingNumber?: string;
        carrier?: CarrierId;
        postalCode?: string;
      } | null;

      const trackingNumber = body?.trackingNumber?.trim();
      if (!trackingNumber || !/^[A-Za-z0-9_-]{4,64}$/.test(trackingNumber)) {
        return jsonResponse({ error: 'Invalid tracking number.' }, env, 400);
      }

      const postalCode = body?.postalCode?.trim();
      const safePostalCode =
        postalCode && /^[A-Za-z0-9 -]{3,16}$/.test(postalCode) ? postalCode : undefined;

      const carrier: CarrierId =
        body?.carrier && body.carrier !== 'unknown'
          ? body.carrier
          : detectCarrierServer(trackingNumber);

      try {
        // 0. Direct Mondial Relay lookup when postal code is supplied (instant, real-time, 0 quota)
        if (carrier === 'mondial_relay' && safePostalCode) {
          try {
            return jsonResponse(
              await lookupDirectMondialRelay(trackingNumber, safePostalCode),
              env,
              200,
            );
          } catch {
            // Fall through to 17TRACK if direct lookup fails
          }
        }

        // 1. If a multi-carrier aggregator key (17TRACK or Ship24) is configured, prefer it first!
        if (env.SEVENTEENTRACK_API_KEY) {
          return jsonResponse(
            await lookupWith17Track(
              env.SEVENTEENTRACK_API_KEY,
              trackingNumber,
              carrier,
              safePostalCode,
            ),
            env,
            200,
          );
        }

        if (env.SHIP24_API_KEY) {
          return jsonResponse(
            await lookupWithShip24(env.SHIP24_API_KEY, trackingNumber, carrier),
            env,
            200,
          );
        }

        // 2. Otherwise try free direct public APIs
        if (carrier === 'dpd') {
          return jsonResponse(await lookupDirectDPD(trackingNumber), env, 200);
        }

        if (carrier === 'inpost') {
          return jsonResponse(await lookupDirectInPost(trackingNumber), env, 200);
        }

        if (carrier === 'dhl' && env.DHL_API_KEY) {
          return jsonResponse(await lookupDirectDHL(env.DHL_API_KEY, trackingNumber), env, 200);
        }

        if (carrier === 'unknown') {
          const probed = await probeFreeCarriers(trackingNumber, env.DHL_API_KEY);
          if (probed) {
            return jsonResponse(probed, env, 200);
          }
        }

        // 3. Honest fallback for carriers without an open public API (e.g. CTT)
        return jsonResponse(
          {
            carrier,
            status: 'pending',
            etaIso: null,
            etaWindow: null,
            lastLocation: 'Direct lookup unavailable — use "Open carrier page"',
            events: [
              {
                timestamp: new Date().toISOString(),
                description:
                  'Parcel saved. This carrier has no free public API — open the official tracking page for full details.',
              },
            ],
          },
          env,
          200,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Carrier lookup failed';
        // Never block saving the parcel when a carrier endpoint rejects direct queries (e.g. HTTP 520/403)
        return jsonResponse(
          {
            carrier,
            status: 'pending',
            etaIso: null,
            etaWindow: null,
            lastLocation: `Direct lookup unavailable (${message})`,
            events: [
              {
                timestamp: new Date().toISOString(),
                description: `Parcel saved. Direct lookup failed (${message}) — use "Open carrier page" to view official tracking.`,
              },
            ],
          },
          env,
          200,
        );
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/widget') {
      return jsonResponse(
        {
          updatedAt: new Date().toISOString(),
          next: {
            etaHeadline: 'Arriving today · 14:00–18:00',
            label: 'Connect this endpoint to Firestore or KV for real-time widget sync',
          },
        },
        env,
      );
    }

    // 17TRACK Package Webhook receiver (v2.2 / v2.4)
    if (request.method === 'POST' && url.pathname === '/api/webhook') {
      return jsonResponse({ received: true }, env, 200);
    }

    return jsonResponse({ error: 'Not found' }, env, 404);
  },
};
