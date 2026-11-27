export type CarrierId =
  | 'ctt'
  | 'dpd'
  | 'brt'
  | 'inpost'
  | 'mondial_relay'
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
  // DPD
  100204: 'dpd',
  101108: 'dpd',
  100007: 'dpd',
  100010: 'dpd',
  100072: 'dpd',
  // BRT Bartolini Italy
  100026: 'brt',
  // InPost
  100598: 'inpost',
  100594: 'inpost',
  100043: 'inpost',
  100469: 'inpost',
  100462: 'inpost',
  // Mondial Relay
  100304: 'mondial_relay',
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
  if (carrierHint === 'brt') {
    return 100026;
  }
  if (carrierHint === 'dpd') {
    return 100204;
  }
  if (carrierHint === 'inpost') {
    return 100598;
  }
  if (carrierHint === 'mondial_relay') {
    return 100304;
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
 * Calls 17TRACK v2.4 (register + gettrackinfo) with automatic carrier detection
 * and `param` support (e.g. destination postal code for Mondial Relay 100304).
 */
export async function lookupWith17Track(
  apiKey: string,
  trackingNumber: string,
  carrierHint?: CarrierId,
  postalCode?: string,
): Promise<NormalizedTracking> {
  const headers = {
    'Content-Type': 'application/json',
    '17token': apiKey.trim(),
  };

  const explicitCarrier = resolve17TrackCarrierCode(trackingNumber, carrierHint);

  const callRegister = async (postalValue?: string) => {
    const payload: Record<string, unknown> = { number: trackingNumber };
    if (explicitCarrier) payload.carrier = explicitCarrier;
    if (postalValue) payload.destination_postal_code = postalValue;

    const res = await fetch('https://api.17track.net/track/v2.4/register', {
      method: 'POST',
      headers,
      body: JSON.stringify([payload]),
    });

    return (await res.json().catch(() => null)) as {
      data?: {
        accepted?: Array<{ carrier?: number }>;
        rejected?: Array<{ error?: { code?: number; message?: string } }>;
      };
    } | null;
  };

  // 1. Register tracking number in 17TRACK v2.4
  let regJson = await callRegister(postalCode);
  let newlyRegistered = (regJson?.data?.accepted?.length ?? 0) > 0;
  let rejectErr = regJson?.data?.rejected?.[0]?.error;
  let rejectCode = rejectErr?.code;

  // If rejected due to postal code format (e.g. hyphen in PT code 1000-001), retry stripped
  if (!newlyRegistered && postalCode && rejectCode !== -18019901) {
    const stripped = postalCode.replace(/[^A-Za-z0-9]/g, '');
    if (stripped && stripped !== postalCode) {
      regJson = await callRegister(stripped);
      newlyRegistered = (regJson?.data?.accepted?.length ?? 0) > 0;
      rejectErr = regJson?.data?.rejected?.[0]?.error;
      rejectCode = rejectErr?.code;
    }
  }

  // Code -18019901 means already registered; update carrier or postal code param if supplied
  let changedCarrier = false;
  if (!newlyRegistered && rejectCode === -18019901) {
    if (explicitCarrier) {
      const ccPayload: Record<string, unknown> = {
        number: trackingNumber,
        carrier_new: explicitCarrier,
      };
      if (postalCode) ccPayload.destination_postal_code = postalCode;
      const ccRes = await fetch('https://api.17track.net/track/v2.4/changecarrier', {
        method: 'POST',
        headers,
        body: JSON.stringify([ccPayload]),
      }).catch(() => null);
      const ccJson = (await ccRes?.json().catch(() => null)) as {
        data?: { accepted?: Array<unknown> };
      } | null;
      changedCarrier = (ccJson?.data?.accepted?.length ?? 0) > 0;
    }

    if (postalCode && !changedCarrier) {
      await fetch('https://api.17track.net/track/v2.4/changeinfo', {
        method: 'POST',
        headers,
        body: JSON.stringify([
          { number: trackingNumber, items: { destination_postal_code: postalCode } },
        ]),
      }).catch(() => null);
      changedCarrier = true;
    }
  }

  if (newlyRegistered || changedCarrier) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  const fetchInfo = async (): Promise<Track17AcceptedItem | undefined> => {
    const queryItem: Record<string, unknown> = { number: trackingNumber };
    if (explicitCarrier) queryItem.carrier = explicitCarrier;

    const infoRes = await fetch('https://api.17track.net/track/v2.4/gettrackinfo', {
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

  const emptyHint =
    rejectErr?.message && rejectCode !== -18019901
      ? `17TRACK: ${rejectErr.message}`
      : info?.latest_status?.status === 'NotFound'
        ? 'Registered with 17TRACK — waiting for the carrier to publish tracking events (or click "Open carrier page").'
        : 'Registered with 17TRACK — syncing initial carrier events.';

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
            description: emptyHint,
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
