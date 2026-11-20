import type { CarrierId, ParcelStatus, TrackingEvent } from '../types/parcel';
import { detectCarrier } from './carriers';

const PROXY_STORAGE_KEY = 'clearpost.proxyUrl';

export function getProxyUrl(): string {
  try {
    const stored = localStorage.getItem(PROXY_STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  } catch {
    // ignore
  }
  const envUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
  return envUrl ? envUrl.replace(/\/+$/, '') : '';
}

export function setProxyUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      localStorage.setItem(PROXY_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(PROXY_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export interface TrackingLookupResult {
  carrier: CarrierId;
  status: ParcelStatus;
  etaIso: string | null;
  etaWindow: string | null;
  lastLocation: string | null;
  events: TrackingEvent[];
  source: 'proxy' | 'local-preview';
}

export async function fetchTrackingUpdate(
  trackingNumber: string,
  carrierHint: CarrierId,
): Promise<TrackingLookupResult> {
  const proxyUrl = getProxyUrl();

  if (proxyUrl) {
    const response = await fetch(`${proxyUrl}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingNumber: trackingNumber.trim(),
        carrier: carrierHint === 'unknown' ? undefined : carrierHint,
      }),
    });

    if (!response.ok) {
      throw new Error(`Proxy returned HTTP ${response.status}. Check your Worker URL or API key.`);
    }

    const data = (await response.json()) as Omit<TrackingLookupResult, 'source'>;
    return { ...data, source: 'proxy' };
  }

  const detected = carrierHint === 'unknown' ? detectCarrier(trackingNumber) : carrierHint;
  return {
    carrier: detected,
    status: 'pending',
    etaIso: null,
    etaWindow: null,
    lastLocation: 'Connect your Cloudflare Worker proxy in Settings for live tracking',
    events: [
      {
        timestamp: new Date().toISOString(),
        description: 'Parcel saved locally. Add your proxy URL in Settings to fetch live updates.',
      },
    ],
    source: 'local-preview',
  };
}
