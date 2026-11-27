import type { CarrierId, NormalizedTracking, ParcelStatus } from './seventeenTrack';

function mapShip24Milestone(milestone?: string | null): ParcelStatus {
  switch (milestone) {
    case 'delivered':
      return 'delivered';
    case 'out_for_delivery':
    case 'available_for_pickup':
      return 'out_for_delivery';
    case 'in_transit':
    case 'attempt_fail':
      return 'in_transit';
    case 'exception':
      return 'exception';
    case 'info_received':
    case 'pending':
    default:
      return 'pending';
  }
}

function mapShip24Courier(courierCode?: string | null, fallback?: CarrierId): CarrierId {
  const code = (courierCode || '').toLowerCase();
  if (code.includes('ctt')) return 'ctt';
  if (code.includes('dpd')) return 'dpd';
  if (code.includes('mondial')) return 'mondial_relay';
  if (code.includes('inpost')) return 'inpost';
  if (code.includes('dhl')) return 'dhl';
  if (code.includes('gls')) return 'gls';
  if (code.includes('ups')) return 'ups';
  if (code.includes('correos')) return 'correos';
  return fallback || 'unknown';
}

/**
 * Calls Ship24 Tracking API (POST /public/v1/trackers/track)
 * Free tier accepts personal emails (Gmail/Outlook), no credit card, AI auto-detection.
 * Docs: https://docs.ship24.com/
 */
export async function lookupWithShip24(
  apiKey: string,
  trackingNumber: string,
  carrierHint?: CarrierId,
): Promise<NormalizedTracking> {
  const res = await fetch('https://api.ship24.com/public/v1/trackers/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      trackingNumber,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ship24 HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
  }

  const json = (await res.json()) as {
    data?: {
      trackings?: Array<{
        shipment?: {
          statusMilestone?: string | null;
          delivery?: {
            estimatedDeliveryDate?: string | null;
          };
        };
        events?: Array<{
          occurrenceDatetime?: string | null;
          status?: string | null;
          location?: string | null;
          courierCode?: string | null;
        }>;
      }>;
    };
  };

  const tracking = json.data?.trackings?.[0];
  const rawEvents = tracking?.events ?? [];
  const primaryCourier = rawEvents[0]?.courierCode;

  return {
    carrier: mapShip24Courier(primaryCourier, carrierHint),
    status: mapShip24Milestone(tracking?.shipment?.statusMilestone),
    etaIso: tracking?.shipment?.delivery?.estimatedDeliveryDate ?? null,
    etaWindow: null,
    lastLocation: rawEvents[0]?.location ?? null,
    events: rawEvents.slice(0, 50).map((ev) => ({
      timestamp: ev.occurrenceDatetime ?? new Date().toISOString(),
      description: ev.status ?? 'Atualização de estado',
      location: ev.location || undefined,
    })),
  };
}
