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
      throw new Error(`O proxy devolveu erro ${response.status}. Verifica o URL ou a chave da API no Worker.`);
    }

    const data = (await response.json()) as Omit<TrackingLookupResult, 'source'>;
    return { ...data, source: 'proxy' };
  }

  // Graceful preview mode before the Cloudflare Worker proxy is deployed
  const detected = carrierHint === 'unknown' ? detectCarrier(trackingNumber) : carrierHint;
  const eta = new Date();
  eta.setDate(eta.getDate() + 2);
  eta.setHours(15, 0, 0, 0);

  return {
    carrier: detected,
    status: 'in_transit',
    etaIso: eta.toISOString(),
    etaWindow: '09:00 – 18:00',
    lastLocation: 'Centro de triagem (modo demonstração)',
    events: [
      {
        timestamp: new Date().toISOString(),
        description: 'Encomenda adicionada em modo demonstração — liga o proxy Cloudflare nas Definições para dados reais',
        location: 'Lisboa',
      },
    ],
    source: 'local-preview',
  };
}
