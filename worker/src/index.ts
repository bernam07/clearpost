import {
  detectCarrierServer,
  lookupDirectDHL,
  lookupDirectDPD,
  lookupDirectInPost,
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
      } | null;

      const trackingNumber = body?.trackingNumber?.trim();
      if (!trackingNumber || !/^[A-Za-z0-9_-]{4,64}$/.test(trackingNumber)) {
        return jsonResponse({ error: 'Código de tracking inválido.' }, env, 400);
      }

      const carrier: CarrierId =
        body?.carrier && body.carrier !== 'unknown'
          ? body.carrier
          : detectCarrierServer(trackingNumber);

      try {
        // 1. Free direct public APIs first (zero cost, no paid aggregator needed!)
        if (carrier === 'dpd') {
          return jsonResponse(await lookupDirectDPD(trackingNumber), env, 200);
        }

        if (carrier === 'inpost') {
          return jsonResponse(await lookupDirectInPost(trackingNumber), env, 200);
        }

        if (carrier === 'dhl' && env.DHL_API_KEY) {
          return jsonResponse(await lookupDirectDHL(env.DHL_API_KEY, trackingNumber), env, 200);
        }

        // 1b. If carrier is unknown/ambiguous, probe free carrier APIs in parallel
        if (carrier === 'unknown') {
          const probed = await probeFreeCarriers(trackingNumber, env.DHL_API_KEY);
          if (probed) {
            return jsonResponse(probed, env, 200);
          }
        }

        // 2. Optional multi-carrier aggregator if configured
        if (env.SHIP24_API_KEY) {
          return jsonResponse(
            await lookupWithShip24(env.SHIP24_API_KEY, trackingNumber, carrier),
            env,
            200,
          );
        }

        if (env.SEVENTEENTRACK_API_KEY) {
          return jsonResponse(
            await lookupWith17Track(env.SEVENTEENTRACK_API_KEY, trackingNumber, carrier),
            env,
            200,
          );
        }

        // 3. Honest fallback for carriers without an open public API (e.g. CTT)
        return jsonResponse(
          {
            carrier,
            status: 'pending',
            etaIso: null,
            etaWindow: null,
            lastLocation: 'Consulta direta indisponível — usa o botão "Abrir na transportadora"',
            events: [
              {
                timestamp: new Date().toISOString(),
                description:
                  'Encomenda guardada. Esta transportadora não tem API pública gratuita — abre o link oficial para ver o detalhe.',
              },
            ],
          },
          env,
          200,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao consultar transportadora';
        // Never block saving the parcel when a carrier endpoint rejects direct queries (e.g. HTTP 520/403)
        return jsonResponse(
          {
            carrier,
            status: 'pending',
            etaIso: null,
            etaWindow: null,
            lastLocation: `Consulta direta indisponível (${message})`,
            events: [
              {
                timestamp: new Date().toISOString(),
                description: `Encomenda guardada. A consulta direta falhou (${message}) — usa "Abrir na transportadora" para ver o estado oficial.`,
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
            etaHeadline: 'Chega hoje · 14h–18h',
            label: 'Liga este endpoint ao teu Firestore ou KV para sincronizar em tempo real',
          },
        },
        env,
      );
    }

    return jsonResponse({ error: 'Not found' }, env, 404);
  },
};
