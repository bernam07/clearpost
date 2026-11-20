import type { CarrierId, ParcelStatus } from '../types/parcel';

export interface CarrierMeta {
  id: CarrierId;
  name: string;
  color: string;
  hint: string;
  seventeenTrackCode?: number;
}

export const CARRIERS: Record<CarrierId, CarrierMeta> = {
  ctt: { id: 'ctt', name: 'CTT', color: '#d42027', hint: 'Correios de Portugal e CTT Expresso', seventeenTrackCode: 16041 },
  dpd: { id: 'dpd', name: 'DPD / BRT', color: '#dc0032', hint: 'DPD Europa (14) e BRT Itália (18 dígitos)', seventeenTrackCode: 100010 },
  inpost: { id: 'inpost', name: 'InPost', color: '#d89b00', hint: 'Ponto Pack e Cacifos (24 dígitos / INP)', seventeenTrackCode: 100226 },
  dhl: { id: 'dhl', name: 'DHL', color: '#cc8a00', hint: 'DHL Express e DHL eCommerce', seventeenTrackCode: 100001 },
  gls: { id: 'gls', name: 'GLS', color: '#163c8c', hint: 'GLS Europa (11–12 dígitos)', seventeenTrackCode: 100005 },
  ups: { id: 'ups', name: 'UPS', color: '#6b4214', hint: 'UPS Standard e Express (1Z…)', seventeenTrackCode: 100002 },
  correos: { id: 'correos', name: 'Correos Express', color: '#0055a5', hint: 'Envios ibéricos (16 dígitos)', seventeenTrackCode: 100112 },
  unknown: { id: 'unknown', name: 'Outra transportadora', color: '#5d6b7a', hint: 'Deteção automática no proxy' },
};

export const CARRIER_LIST: CarrierMeta[] = Object.values(CARRIERS);

export const SELECTABLE_CARRIERS: CarrierMeta[] = CARRIER_LIST.filter((c) => c.id !== 'unknown');

/**
 * Returns ALL carriers whose tracking number format matches the input.
 * When length > 1, the UI prompts the user with a carrier picker dialog.
 */
export function detectCarrierCandidates(rawCode: string): CarrierId[] {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (!code) return [];

  // Unambiguous alphanumeric prefixes/suffixes
  if (/^1Z[0-9A-Z]{16}$/.test(code)) return ['ups'];
  if (/^[A-Z]{2}\d{9}PT$/.test(code) || /^(DA|DB|DC|DE)\d{9,13}$/.test(code)) return ['ctt'];
  if (/^INP[0-9A-Z]{8,20}$/.test(code)) return ['inpost'];
  if (/^JJD\d{14,20}$/.test(code)) return ['dhl'];
  if (/^\d{14}[A-Z]$/.test(code)) return ['dpd'];

  // Purely numeric formats — many European carriers overlap by digit length
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

/**
 * Single best-guess carrier for inline preview before submission.
 */
export function detectCarrier(rawCode: string): CarrierId {
  const candidates = detectCarrierCandidates(rawCode);
  return candidates[0] ?? 'unknown';
}

export function statusLabel(status: ParcelStatus): string {
  switch (status) {
    case 'out_for_delivery':
      return 'Em distribuição';
    case 'in_transit':
      return 'Em trânsito';
    case 'delivered':
      return 'Entregue';
    case 'exception':
      return 'Incidência';
    case 'pending':
    default:
      return 'Registada';
  }
}

export function formatEtaHeadline(parcel: {
  status: ParcelStatus;
  etaIso: string | null;
}): string {
  if (parcel.status === 'delivered') return 'Entregue';
  if (parcel.status === 'exception') return 'Atenção necessária';
  if (!parcel.etaIso) {
    return parcel.status === 'out_for_delivery' ? 'Chega hoje' : 'Data por confirmar';
  }

  const eta = new Date(parcel.etaIso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEta = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate());
  const diffDays = Math.round((startOfEta.getTime() - startOfToday.getTime()) / 86_400_000);

  if (diffDays <= 0) return 'Chega hoje';
  if (diffDays === 1) return 'Chega amanhã';

  const formatted = new Intl.DateTimeFormat('pt-PT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(eta);

  return `Previsto ${formatted}`;
}

export function officialTrackingUrl(carrier: CarrierId, trackingNumber: string): string {
  const code = encodeURIComponent(trackingNumber.trim());
  switch (carrier) {
    case 'ctt':
      return `https://appserver.ctt.pt/CustomerArea/PublicArea_Detail?ObjectCodeInput=${code}`;
    case 'dpd':
      if (/^\d{18}$/.test(trackingNumber.trim())) {
        return `https://www.mybrt.it/en/mybrt/my-parcels/search?parcelNumber=${code}`;
      }
      return `https://tracking.dpd.de/status/pt_PT/parcel/${code}`;
    case 'inpost':
      return `https://www.inpost.pt/seguir-o-meu-envio/?number=${code}`;
    case 'dhl':
      return `https://www.dhl.com/pt-pt/home/tracking.html?tracking-id=${code}`;
    case 'gls':
      return `https://gls-group.com/PT/pt/seguir-encomenda?match=${code}`;
    case 'ups':
      return `https://www.ups.com/track?loc=pt_PT&tracknum=${code}`;
    case 'correos':
      return `https://www.correosexpress.com/web/correosexpress/home`;
    default:
      return `https://parcelsapp.com/en/tracking/${code}`;
  }
}

export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
