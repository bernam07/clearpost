export type CarrierId =
  | 'ctt'
  | 'dpd'
  | 'inpost'
  | 'dhl'
  | 'gls'
  | 'ups'
  | 'correos'
  | 'unknown';

export type ParcelStatus =
  | 'pending'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception';

export interface NormalizedTracking {
  carrier: CarrierId;
  status: ParcelStatus;
  etaIso: string | null;
  etaWindow: string | null;
  lastLocation: string | null;
  events: Array<{
    timestamp: string;
    description: string;
    location?: string;
  }>;
}

const CARRIER_TO_17TRACK: Partial<Record<CarrierId, number>> = {
  ctt: 16041,
  dpd: 100010,
  inpost: 100226,
  dhl: 100001,
  gls: 100005,
  ups: 100002,
  correos: 100112,
};

const CODE_TO_CARRIER: Record<number, CarrierId> = {
  16041: 'ctt',
  100010: 'dpd',
  100226: 'inpost',
  100001: 'dhl',
  100005: 'gls',
  100002: 'ups',
  100112: 'correos',
};

function map17TrackStatus(stage?: string): ParcelStatus {
  switch (stage) {
    case 'Delivered':
      return 'delivered';
    case 'OutForDelivery':
      return 'out_for_delivery';
    case 'InTransit':
    case 'AvailableForPickup':
      return 'in_transit';
    case 'Exception':
    case 'DeliveryFailure':
    case 'Expired':
      return 'exception';
    case 'NotFound':
    case 'InfoReceived':
    default:
      return 'pending';
  }
}

/**
 * Calls 17TRACK v2.2 (register + gettrackinfo) with automatic carrier detection.
 * Docs: https://api.17track.net/en/doc
 */
export async function lookupWith17Track(
  apiKey: string,
  trackingNumber: string,
  carrierHint?: CarrierId,
): Promise<NormalizedTracking> {
  const headers = {
    'Content-Type': 'application/json',
    '17token': apiKey,
  };

  const payloadItem: Record<string, unknown> = { number: trackingNumber };
  const mappedCode = carrierHint ? CARRIER_TO_17TRACK[carrierHint] : undefined;
  if (mappedCode) {
    payloadItem.carrier = mappedCode;
  } else {
    payloadItem.auto_detection = true;
  }

  // 1. Ensure parcel is registered in 17TRACK (idempotent if already registered)
  await fetch('https://api.17track.net/track/v2.2/register', {
    method: 'POST',
    headers,
    body: JSON.stringify([payloadItem]),
  });

  // 2. Fetch latest tracking info
  const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
    method: 'POST',
    headers,
    body: JSON.stringify([{ number: trackingNumber }]),
  });

  if (!infoRes.ok) {
    throw new Error(`17TRACK HTTP ${infoRes.status}`);
  }

  const json = (await infoRes.json()) as {
    data?: {
      accepted?: Array<{
        carrier?: number;
        track_info?: {
          latest_status?: { status?: string };
          time_metrics?: { estimated_delivery_date?: { from?: string; to?: string } };
          latest_event?: { location?: string };
          tracking?: {
            providers?: Array<{
              events?: Array<{
                time_iso?: string;
                description?: string;
                location?: string;
              }>;
            }>;
          };
        };
      }>;
    };
  };

  const accepted = json.data?.accepted?.[0];
  const info = accepted?.track_info;
  const rawEvents = info?.tracking?.providers?.[0]?.events ?? [];

  const etaFrom = info?.time_metrics?.estimated_delivery_date?.from ?? null;
  const etaTo = info?.time_metrics?.estimated_delivery_date?.to ?? null;

  return {
    carrier: (accepted?.carrier && CODE_TO_CARRIER[accepted.carrier]) || carrierHint || 'unknown',
    status: map17TrackStatus(info?.latest_status?.status),
    etaIso: etaFrom,
    etaWindow: etaFrom && etaTo && etaFrom !== etaTo ? `${etaFrom.slice(0, 10)} – ${etaTo.slice(0, 10)}` : null,
    lastLocation: info?.latest_event?.location ?? rawEvents[0]?.location ?? null,
    events: rawEvents.slice(0, 50).map((ev) => ({
      timestamp: ev.time_iso ?? new Date().toISOString(),
      description: ev.description ?? 'Atualização de estado',
      location: ev.location || undefined,
    })),
  };
}
