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

export interface TrackingEvent {
  timestamp: string;
  description: string;
  location?: string;
}

export interface Parcel {
  id: string;
  trackingNumber: string;
  carrier: CarrierId;
  label: string;
  status: ParcelStatus;
  etaIso: string | null;
  etaWindow: string | null;
  lastLocation: string | null;
  postalCode?: string | null;
  events: TrackingEvent[];
  createdAt: string;
  updatedAt: string;
}
