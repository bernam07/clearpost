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
  100026: 'dpd', // BRT Italy (DPD Group)
  100226: 'inpost',
  100001: 'dhl',
  7041: 'dhl',   // DHL Parcel / eCommerce (JJD...)
  7042: 'dhl',
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
  const isBrt18 = carrierHint === 'dpd' && /^\d{18}$/.test(trackingNumber.trim());

  if (isBrt18) {
    // 18-digit DPD/BRT Italy numbers require explicit BRT Bartolini code (100026) in 17TRACK
    payloadItem.carrier = 100026;
  } else if (carrierHint && carrierHint !== 'unknown' && carrierHint !== 'dhl') {
    const mappedCode = CARRIER_TO_17TRACK[carrierHint];
    if (mappedCode) payloadItem.carrier = mappedCode;
  }

  // 1. Ensure parcel is registered in 17TRACK (idempotent if already registered)
  const regRes = await fetch('https://api.17track.net/track/v2.2/register', {
    method: 'POST',
    headers,
    body: JSON.stringify([payloadItem]),
  });
  const regJson = (await regRes.json().catch(() => null)) as {
    data?: { accepted?: Array<unknown>; rejected?: Array<{ error?: { code?: number } }> };
  } | null;
  const newlyRegistered = (regJson?.data?.accepted?.length ?? 0) > 0;

  // If 18-digit BRT was already registered earlier without carrier 100026, update its carrier
  if (isBrt18 && !newlyRegistered) {
    await fetch('https://api.17track.net/track/v2.2/changecarrier', {
      method: 'POST',
      headers,
      body: JSON.stringify([{ number: trackingNumber, carrier_new: 100026 }]),
    }).catch(() => null);
  }

  // If just registered for the first time, give 17TRACK 2.5s to pull initial events from the carrier
  if (newlyRegistered) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  // 2. Fetch latest tracking info
  const fetchInfo = async () => {
    const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers,
      body: JSON.stringify([{ number: trackingNumber }]),
    });

    if (!infoRes.ok) {
      throw new Error(`17TRACK HTTP ${infoRes.status}`);
    }

    return (await infoRes.json()) as {
      data?: {
        accepted?: Array<{
          carrier?: number;
          track_info?: {
            latest_status?: { status?: string };
            time_metrics?: { estimated_delivery_date?: { from?: string; to?: string } };
            latest_event?: { location?: string; description?: string; time_iso?: string };
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
  };

  let json = await fetchInfo();
  let accepted = json.data?.accepted?.[0];
  let info = accepted?.track_info;
  let rawEvents = info?.tracking?.providers?.[0]?.events ?? [];

  // Second quick poll if 17TRACK is still finishing the first crawl
  if (newlyRegistered && rawEvents.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    json = await fetchInfo();
    accepted = json.data?.accepted?.[0];
    info = accepted?.track_info;
    rawEvents = info?.tracking?.providers?.[0]?.events ?? [];
  }

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
