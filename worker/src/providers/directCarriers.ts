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
    throw new Error(`DPD returned HTTP ${res.status}`);
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
    throw new Error(`InPost returned HTTP ${res.status}`);
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
        'DHL-API-Key': apiKey.trim(),
      },
    },
  );

  if (!res.ok) {
    throw new Error(`DHL returned HTTP ${res.status}`);
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

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUsDateAndTime(dateStr: string, timeStr: string): string {
  // dateStr like "11/27/2026", timeStr like "9:16 PM" or "11:40 AM"
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr.trim());
  if (!dm) return new Date().toISOString();
  const month = Number(dm[1]) - 1;
  const day = Number(dm[2]);
  const year = Number(dm[3]);

  let hours = 12;
  let minutes = 0;
  const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(timeStr.trim());
  if (tm) {
    hours = Number(tm[1]);
    minutes = Number(tm[2]);
    const meridiem = tm[3]?.toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  }

  const d = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Mondial Relay direct MVC endpoint — free, instant, no API key required.
 * Requires the 8-digit shipment number and destination postal code.
 */
export async function lookupDirectMondialRelay(
  trackingNumber: string,
  postalCode: string,
): Promise<NormalizedTracking> {
  const form = new URLSearchParams({
    NumeroExpedition: trackingNumber.trim(),
    CodePostal: postalCode.trim(),
    IdChampDeRetour: 'suivie_mon_colis',
  });

  const res = await fetch(
    'https://www.mondialrelay.com/_mvc/en-US/SuiviExpedition/RechercherJsonResponsive',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      body: form.toString(),
    },
  );

  if (!res.ok) {
    throw new Error(`Mondial Relay returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    Success?: boolean;
    Message?: string;
  };

  if (!json.Success || !json.Message) {
    throw new Error('Mondial Relay did not recognize this tracking number and postal code');
  }

  const html = json.Message;

  // Count validated steps in the 5-step Mondial Relay progress timeline
  const validatedMatches = html.match(/<li\s+class="validate"/gi) ?? [];
  const stepCount = validatedMatches.length;

  let status: ParcelStatus = 'pending';
  if (stepCount >= 5) status = 'delivered';
  else if (stepCount >= 3) status = 'out_for_delivery';
  else if (stepCount >= 2) status = 'in_transit';

  // Extract chronological events grouped by <div class="infos-account">
  const events: Array<{ timestamp: string; description: string; location?: string }> = [];
  const dayBlocks = html.split('<div class="infos-account">').slice(1);

  for (const block of dayBlocks) {
    const dateMatch = /<p>\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*<\/p>/i.exec(block);
    const dateStr = dateMatch?.[1] ?? '';

    // Restrict parsing to the detail-infos section (exclude pickup-point modal text)
    const detailStart = block.indexOf('detail-infos');
    if (detailStart === -1) continue;
    const detailSection = block.slice(detailStart).split(/Horaires d'ouverture|Services available|<script/i)[0];

    // Each timestamped scan starts with <p class="center">TIME</p>
    const timeChunks = detailSection.split(/<p\s+class="center"[^>]*>/i).slice(1);
    for (const chunk of timeChunks) {
      const timeEnd = chunk.indexOf('</p>');
      if (timeEnd === -1) continue;
      const timeStr = decodeHtmlEntities(chunk.slice(0, timeEnd));
      const rest = chunk.slice(timeEnd + 4);

      const descriptions = [...rest.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')))
        .filter((line) => line.length > 0 && !/^(Horaires|Services available)/i.test(line));

      const description = descriptions[0] ?? '';
      if (!description) continue;

      const agencyMatch = /(?:agency|site)\s+([A-Za-z0-9À-ÿ' -]{2,40})/i.exec(description);
      events.push({
        timestamp: parseUsDateAndTime(dateStr, timeStr),
        description,
        location: agencyMatch?.[1]?.trim() || undefined,
      });
    }
  }

  const latestLoc =
    events.find((e) => e.location)?.location ??
    (stepCount >= 4
      ? 'Available at Point Relais'
      : stepCount >= 2
        ? 'In Mondial Relay network'
        : 'Parcel in preparation at sender');

  return {
    carrier: 'mondial_relay',
    status,
    etaIso: null,
    etaWindow: null,
    lastLocation: latestLoc,
    events: events.slice(0, 50),
  };
}

export function detectCarrierServer(code: string): CarrierId {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{2}\d{9}PT$/.test(c) || /^(DA|DB|DC|DE)\d{9,13}$/.test(c)) return 'ctt';
  if (/^\d{24}$/.test(c) || /^INP[0-9A-Z]{8,20}$/.test(c)) return 'inpost';
  if (/^\d{8}$/.test(c)) return 'mondial_relay';
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
