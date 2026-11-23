import type { CarrierId, ParcelStatus } from '../types/parcel';

export interface CarrierMeta {
  id: CarrierId;
  name: string;
  color: string;
  hint: string;
  seventeenTrackCode?: number;
}

export const CARRIERS: Record<CarrierId, CarrierMeta> = {
  ctt: { id: 'ctt', name: 'CTT', color: '#d42027', hint: 'Portugal Post & CTT Express', seventeenTrackCode: 16041 },
  dpd: { id: 'dpd', name: 'DPD / BRT', color: '#dc0032', hint: 'DPD Europe (14) & BRT Italy (18 digits)', seventeenTrackCode: 100010 },
  inpost: { id: 'inpost', name: 'InPost', color: '#d89b00', hint: 'Parcel Lockers & Pack Points (24 digits / INP)', seventeenTrackCode: 100226 },
  dhl: { id: 'dhl', name: 'DHL', color: '#cc8a00', hint: 'DHL Express & DHL eCommerce', seventeenTrackCode: 100001 },
  gls: { id: 'gls', name: 'GLS', color: '#163c8c', hint: 'GLS Europe (11–12 digits)', seventeenTrackCode: 100005 },
  ups: { id: 'ups', name: 'UPS', color: '#6b4214', hint: 'UPS Standard & Express (1Z…)', seventeenTrackCode: 100002 },
  correos: { id: 'correos', name: 'Correos Express', color: '#0055a5', hint: 'Iberian shipments (16 digits)', seventeenTrackCode: 100112 },
  unknown: { id: 'unknown', name: 'Other carrier', color: '#5d6b7a', hint: 'Auto-detect via proxy' },
};

export const CARRIER_LIST: CarrierMeta[] = Object.values(CARRIERS);

export const SELECTABLE_CARRIERS: CarrierMeta[] = CARRIER_LIST.filter((c) => c.id !== 'unknown');

/**
 * Returns ALL carriers whose tracking number format matches the input.
 * When length > 1, the UI opens a carrier picker dialog.
 */
export function detectCarrierCandidates(rawCode: string): CarrierId[] {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (!code) return [];

  if (/^1Z[0-9A-Z]{16}$/.test(code)) return ['ups'];
  if (/^[A-Z]{2}\d{9}PT$/.test(code) || /^(DA|DB|DC|DE)\d{9,13}$/.test(code)) return ['ctt'];
  if (/^INP[0-9A-Z]{8,20}$/.test(code)) return ['inpost'];
  if (/^JJD\d{14,20}$/.test(code)) return ['dhl'];
  if (/^\d{14}[A-Z]$/.test(code)) return ['dpd'];

  if (/^\d+$/.test(code)) {
    const len = code.length;
    if (len === 10) return ['dhl', 'gls'];
    if (len === 11 || len === 12) return ['gls', 'dhl', 'ctt'];
    if (len === 13) return ['ctt', 'dpd', 'gls'];
    if (len === 14) return ['dpd', 'gls', 'inpost'];
    if (len === 16) return /^(323|633)/.test(code) ? ['correos', 'dpd'] : ['correos', 'dpd', 'dhl'];
    if (len === 18) return ['dpd', 'dhl', 'ups'];
    if (len === 20 || len === 22) return ['dhl', 'inpost', 'dpd'];
    if (len === 24) return ['inpost', 'dhl'];
  }

  return [];
}

export function detectCarrier(rawCode: string): CarrierId {
  const candidates = detectCarrierCandidates(rawCode);
  return candidates[0] ?? 'unknown';
}

export function statusLabel(status: ParcelStatus): string {
  switch (status) {
    case 'out_for_delivery':
      return 'Out for delivery';
    case 'in_transit':
      return 'In transit';
    case 'delivered':
      return 'Delivered';
    case 'exception':
      return 'Attention needed';
    case 'pending':
    default:
      return 'Registered';
  }
}

export function formatEtaHeadline(parcel: {
  status: ParcelStatus;
  etaIso: string | null;
}): string {
  if (parcel.status === 'delivered') return 'Delivered';
  if (parcel.status === 'exception') return 'Delivery exception';
  if (!parcel.etaIso) {
    return parcel.status === 'out_for_delivery' ? 'Arriving today' : 'ETA pending';
  }

  const eta = new Date(parcel.etaIso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEta = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate());
  const diffDays = Math.round((startOfEta.getTime() - startOfToday.getTime()) / 86_400_000);

  if (diffDays <= 0) return 'Arriving today';
  if (diffDays === 1) return 'Arriving tomorrow';

  const formatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(eta);

  return `Expected ${formatted}`;
}

export function officialTrackingUrl(carrier: CarrierId, trackingNumber: string): string {
  const code = encodeURIComponent(trackingNumber.trim());
  switch (carrier) {
    case 'ctt':
      return `https://appserver.ctt.pt/CustomerArea/PublicArea_Detail?ObjectCodeInput=${code}`;
    case 'dpd':
      if (/^\d{18}$/.test(trackingNumber.trim())) {
        return `https://www.mybrt.it/it/mybrt/my-parcels/search?parcelNumber=${code}`;
      }
      return `https://tracking.dpd.de/status/en_US/parcel/${code}`;
    case 'inpost':
      return `https://www.inpost.pt/seguir-o-meu-envio/?number=${code}`;
    case 'dhl':
      return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${code}`;
    case 'gls':
      return `https://gls-group.com/GROUP/en/parcel-tracking?match=${code}`;
    case 'ups':
      return `https://www.ups.com/track?tracknum=${code}`;
    case 'correos':
      return `https://www.correosexpress.com/web/correosexpress/home`;
    default:
      return `https://parcelsapp.com/en/tracking/${code}`;
  }
}

export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
