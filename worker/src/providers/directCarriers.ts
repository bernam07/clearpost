import type { CarrierId, NormalizedTracking, ParcelStatus } from './seventeenTrack';

function mapTextStatus(text: string): ParcelStatus {
  const s = text.toLowerCase();
  if (s.includes('deliver') || s.includes('entregue') || s.includes('collected')) return 'delivered';
  if (s.includes('out for delivery') || s.includes('distribuição') || s.includes('courier')) {
    return 'out_for_delivery';
  }
  if (s.includes('exception') || s.includes('fail') || s.includes('erro') || s.includes('devolv')) {
    return 'exception';
  }
  if (s.includes('transit') || s.includes('hub') || s.includes('depot') || s.includes('sort')) {
    return 'in_transit';
  }
  return 'pending';
}

/**
 * DPD Europe public PLC JSON endpoint — free, no API key required.
 */
export async function lookupDirectDPD(trackingNumber: string): Promise<NormalizedTracking> {
  const res = await fetch(
    `https://tracking.dpd.de/rest/plc/en_US/${encodeURIComponent(trackingNumber)}`,
    {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`DPD devolveu HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    parcellifecycleResponse?: {
      parcelLifeCycleData?: {
        scanInfo?: {
          scan?: Array<{
            date?: string;
            scanData?: { location?: string };
            scanDescription?: { content?: string[] };
          }>;
        };
        statusInfo?: Array<{
          status?: string;
          isCurrentStatus?: boolean;
          description?: { content?: string[] };
        }>;
      };
    };
  };

  const data = json.parcellifecycleResponse?.parcelLifeCycleData;
  const scans = data?.scanInfo?.scan ?? [];
  const currentStatusObj = data?.statusInfo?.find((s) => s.isCurrentStatus);

  const events = [...scans]
    .reverse()
    .map((sc) => ({
      timestamp: sc.date ?? new Date().toISOString(),
      description: sc.scanDescription?.content?.[0] ?? 'Atualização DPD',
      location: sc.scanData?.location || undefined,
    }));

  const statusText = currentStatusObj?.status ?? events[0]?.description ?? '';

  return {
    carrier: 'dpd',
    status: mapTextStatus(statusText),
    etaIso: null,
    etaWindow: null,
    lastLocation: events[0]?.location ?? null,
    events,
  };
}

/**
 * InPost public ShipX JSON endpoint — free, no API key required.
 */
export async function lookupDirectInPost(trackingNumber: string): Promise<NormalizedTracking> {
  const res = await fetch(
    `https://api-shipx-pl.easypack24.net/v1/tracking/${encodeURIComponent(trackingNumber)}`,
    { headers: { Accept: 'application/json' } },
  );

  if (!res.ok) {
    throw new Error(`InPost devolveu HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    status?: string;
    tracking_details?: Array<{
      datetime?: string;
      status?: string;
      origin_status?: string;
      agency?: string | null;
    }>;
  };

  const details = json.tracking_details ?? [];
  const events = details.map((ev) => ({
    timestamp: ev.datetime ?? new Date().toISOString(),
    description: ev.origin_status || ev.status || 'Atualização InPost',
    location: ev.agency || undefined,
  }));

  return {
    carrier: 'inpost',
    status: mapTextStatus(json.status ?? events[0]?.description ?? ''),
    etaIso: null,
    etaWindow: null,
    lastLocation: events[0]?.location ?? null,
    events,
  };
}

/**
 * DHL Unified Tracking API — free with personal Gmail at developer.dhl.com (250 req/day, no card).
 */
export async function lookupDirectDHL(
  apiKey: string,
  trackingNumber: string,
): Promise<NormalizedTracking> {
  const res = await fetch(
    `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    {
      headers: {
        Accept: 'application/json',
        'DHL-API-Key': apiKey,
      },
    },
  );

  if (!res.ok) {
    throw new Error(`DHL devolveu HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    shipments?: Array<{
      estimatedTimeOfDelivery?: string;
      status?: { statusCode?: string; description?: string; location?: { address?: { addressLocality?: string } } };
      events?: Array<{
        timestamp?: string;
        description?: string;
        location?: { address?: { addressLocality?: string } };
      }>;
    }>;
  };

  const shipment = json.shipments?.[0];
  const events = (shipment?.events ?? []).map((ev) => ({
    timestamp: ev.timestamp ?? new Date().toISOString(),
    description: ev.description ?? 'Atualização DHL',
    location: ev.location?.address?.addressLocality || undefined,
  }));

  return {
    carrier: 'dhl',
    status: mapTextStatus(shipment?.status?.statusCode ?? shipment?.status?.description ?? ''),
    etaIso: shipment?.estimatedTimeOfDelivery ?? null,
    etaWindow: null,
    lastLocation: shipment?.status?.location?.address?.addressLocality ?? events[0]?.location ?? null,
    events,
  };
}

export function detectCarrierServer(code: string): CarrierId {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{2}\d{9}PT$/.test(c) || /^(DA|DB|DC|DE)\d{9,13}$/.test(c)) return 'ctt';
  if (/^\d{24}$/.test(c) || /^INP[0-9A-Z]{8,20}$/.test(c)) return 'inpost';
  if (/^\d{14}[A-Z]?$/.test(c) || /^\d{18}$/.test(c)) return 'dpd';
  if (/^\d{10}$/.test(c) || /^JJD\d{14,20}$/.test(c)) return 'dhl';
  if (/^1Z[0-9A-Z]{16}$/.test(c)) return 'ups';
  if (/^\d{11,12}$/.test(c)) return 'gls';
  if (/^(323|633)\d{13}$/.test(c)) return 'correos';
  return 'unknown';
}

/**
 * Active auto-detection: probes free carrier APIs in parallel and returns
 * the first carrier that actually recognizes the tracking number with events.
 */
export async function probeFreeCarriers(
  trackingNumber: string,
  dhlApiKey?: string,
): Promise<NormalizedTracking | null> {
  const probes: Array<Promise<NormalizedTracking>> = [
    lookupDirectDPD(trackingNumber).then((res) => {
      if (res.events.length === 0) throw new Error('DPD empty');
      return res;
    }),
    lookupDirectInPost(trackingNumber).then((res) => {
      if (res.events.length === 0) throw new Error('InPost empty');
      return res;
    }),
  ];

  if (dhlApiKey) {
    probes.push(
      lookupDirectDHL(dhlApiKey, trackingNumber).then((res) => {
        if (res.events.length === 0) throw new Error('DHL empty');
        return res;
      }),
    );
  }

  try {
    return await Promise.any(probes);
  } catch {
    return null;
  }
}
