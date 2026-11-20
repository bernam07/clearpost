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

// Verified against https://res.17track.net/asset/carrier/info/apicarrier.all.json
const CODE_TO_CARRIER: Record<number, CarrierId> = {
  // CTT
  16101: 'ctt',
  100114: 'ctt',
  // DPD & BRT Bartolini
  100204: 'dpd',
  101108: 'dpd',
  100007: 'dpd',
  100010: 'dpd',
  100072: 'dpd',
  100026: 'dpd',
  // InPost
  100598: 'inpost',
  100594: 'inpost',
  100043: 'inpost',
  100469: 'inpost',
  100462: 'inpost',
  // DHL
  100001: 'dhl',
  7041: 'dhl',
  7047: 'dhl',
  7048: 'dhl',
  101266: 'dhl',
  100047: 'dhl',
  100392: 'dhl',
  100430: 'dhl',
  100226: 'dhl',
  // GLS
  100005: 'gls',
  100316: 'gls',
  100646: 'gls',
  101109: 'gls',
  100189: 'gls',
  // UPS
  100002: 'ups',
  100398: 'ups',
  // Correos
  100048: 'correos',
  19181: 'correos',
};

function resolve17TrackCarrierCode(
  trackingNumber: string,
  carrierHint?: CarrierId,
): number | undefined {
  const code = trackingNumber.trim().toUpperCase();

  if (carrierHint === 'ctt') {
    return /^[A-Z]{2}\d{9}PT$/.test(code) ? 16101 : 100114;
  }
  if (carrierHint === 'dpd') {
    // 18-digit numbers are BRT Bartolini Italy (100026)
    return /^\d{18}$/.test(code) ? 100026 : undefined;
  }
  if (carrierHint === 'inpost') {
    return 100598;
  }
  if (carrierHint === 'correos') {
    return 100048;
  }
  if (carrierHint === 'ups') {
    return 100002;
  }
  // For DHL, GLS, 14-digit DPD, and unknown, let 17TRACK auto-detect the regional subcarrier
  return undefined;
}

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
    case 'Undelivered':
    case 'Alert':
    case 'Expired':
      return 'exception';
    case 'NotFound':
    case 'InfoReceived':
    default:
      return 'pending';
  }
}

interface Track17Event {
  time_iso?: string;
  description?: string;
  location?: string;
}

interface Track17AcceptedItem {
  carrier?: number;
  track_info?: {
    latest_status?: { status?: string; sub_status?: string };
    time_metrics?: { estimated_delivery_date?: { from?: string; to?: string } };
    latest_event?: Track17Event | null;
    tracking?: {
      providers?: Array<{
        events?: Track17Event[];
      }>;
    };
  };
}

/**
 * Calls 17TRACK v2.2 (register + gettrackinfo) with automatic carrier detection.
 */
export async function lookupWith17Track(
  apiKey: string,
  trackingNumber: string,
  carrierHint?: CarrierId,
): Promise<NormalizedTracking> {
  const headers = {
    'Content-Type': 'application/json',
    '17token': apiKey.trim(),
  };

  const explicitCarrier = resolve17TrackCarrierCode(trackingNumber, carrierHint);
  const registerPayload: Record<string, unknown> = { number: trackingNumber };
  if (explicitCarrier) {
    registerPayload.carrier = explicitCarrier;
  }

  // 1. Register tracking number in 17TRACK
  const regRes = await fetch('https://api.17track.net/track/v2.2/register', {
    method: 'POST',
    headers,
    body: JSON.stringify([registerPayload]),
  });

  const regJson = (await regRes.json().catch(() => null)) as {
    data?: {
      accepted?: Array<{ carrier?: number }>;
      rejected?: Array<{ error?: { code?: number; message?: string } }>;
    };
  } | null;

  const newlyRegistered = (regJson?.data?.accepted?.length ?? 0) > 0;
  const rejectCode = regJson?.data?.rejected?.[0]?.error?.code;

  // Code -18019901 means already registered; if we have an explicit carrier (like BRT 100026), ensure carrier matches
  if (!newlyRegistered && explicitCarrier && rejectCode === -18019901) {
    await fetch('https://api.17track.net/track/v2.2/changecarrier', {
      method: 'POST',
      headers,
      body: JSON.stringify([{ number: trackingNumber, carrier_new: explicitCarrier }]),
    }).catch(() => null);
  }

  if (newlyRegistered) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  const fetchInfo = async (): Promise<Track17AcceptedItem | undefined> => {
    const queryItem: Record<string, unknown> = { number: trackingNumber };
    const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers,
      body: JSON.stringify([queryItem]),
    });

    if (!infoRes.ok) {
      throw new Error(`17TRACK HTTP ${infoRes.status}`);
    }

    const json = (await infoRes.json()) as {
      data?: { accepted?: Track17AcceptedItem[] };
    };
    return json.data?.accepted?.[0];
  };

  let accepted = await fetchInfo();
  let info = accepted?.track_info;
  let rawEvents: Track17Event[] =
    info?.tracking?.providers?.flatMap((p) => p.events ?? []) ?? [];

  if (newlyRegistered && rawEvents.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 2200));
    accepted = await fetchInfo();
    info = accepted?.track_info;
    rawEvents = info?.tracking?.providers?.flatMap((p) => p.events ?? []) ?? [];
  }

  if (rawEvents.length === 0 && info?.latest_event?.description) {
    rawEvents = [info.latest_event];
  }

  const etaFrom = info?.time_metrics?.estimated_delivery_date?.from ?? null;
  const etaTo = info?.time_metrics?.estimated_delivery_date?.to ?? null;
  const resolvedCarrier =
    (accepted?.carrier && CODE_TO_CARRIER[accepted.carrier]) || carrierHint || 'unknown';
  const status = map17TrackStatus(info?.latest_status?.status);

  const events =
    rawEvents.length > 0
      ? rawEvents.slice(0, 50).map((ev) => ({
          timestamp: ev.time_iso ?? new Date().toISOString(),
          description: ev.description ?? 'Status update',
          location: ev.location || undefined,
        }))
      : [
          {
            timestamp: new Date().toISOString(),
            description:
              info?.latest_status?.status === 'NotFound'
                ? 'Registered with 17TRACK — waiting for the carrier to publish tracking events (or click "Open carrier page").'
                : 'Registered with 17TRACK — syncing initial carrier events.',
          },
        ];

  return {
    carrier: resolvedCarrier,
    status,
    etaIso: etaFrom,
    etaWindow:
      etaFrom && etaTo && etaFrom !== etaTo ? `${etaFrom.slice(0, 10)} – ${etaTo.slice(0, 10)}` : null,
    lastLocation:
      info?.latest_event?.location ??
      rawEvents[0]?.location ??
      (rawEvents.length === 0 ? 'Synced via 17TRACK (waiting for carrier scans)' : null),
    events,
  };
}
