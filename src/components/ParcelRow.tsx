import {
  CARRIERS,
  formatEtaHeadline,
  formatEventTime,
  officialTrackingUrl,
  statusLabel,
} from '../lib/carriers';
import type { Parcel } from '../types/parcel';

interface ParcelRowProps {
  parcel: Parcel;
  refreshing: boolean;
  onRefresh: (parcel: Parcel) => void;
  onToggleDelivered: (parcel: Parcel) => void;
  onCopy: (code: string) => void;
  onDelete: (id: string) => void;
}

export function ParcelRow({
  parcel,
  refreshing,
  onRefresh,
  onToggleDelivered,
  onCopy,
  onDelete,
}: ParcelRowProps) {
  const carrier = CARRIERS[parcel.carrier];
  const etaShort = formatEtaHeadline(parcel);

  return (
    <details className="parcel-row">
      <summary className="parcel-summary">
        <span className="parcel-summary-main">
          <span className="parcel-summary-title">{parcel.label || parcel.trackingNumber}</span>
          <span className="parcel-summary-sub">
            <span className="carrier-dot" style={{ backgroundColor: carrier.color }} />
            <span>
              {carrier.name}
              {parcel.lastLocation ? ` — ${parcel.lastLocation}` : ''}
            </span>
          </span>
        </span>

        <span className="parcel-summary-end">
          <span className="status-badge" data-status={parcel.status}>
            {statusLabel(parcel.status)}
          </span>
          {parcel.status !== 'delivered' && <span className="parcel-eta-mini">{etaShort}</span>}
        </span>
      </summary>

      <div className="parcel-body">
        <div className="parcel-toolbar">
          <span className="tracking-code">{parcel.trackingNumber}</span>

          <div className="parcel-actions">
            <a
              className="ghost-btn"
              href={officialTrackingUrl(parcel.carrier, parcel.trackingNumber)}
              target="_blank"
              rel="noreferrer"
            >
              Abrir na transportadora
            </a>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onCopy(parcel.trackingNumber)}
            >
              Copiar código
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={refreshing}
              onClick={() => onRefresh(parcel)}
            >
              {refreshing ? 'A atualizar...' : 'Atualizar'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onToggleDelivered(parcel)}
            >
              {parcel.status === 'delivered' ? 'Reabrir' : 'Marcar entregue'}
            </button>
            <button
              type="button"
              className="ghost-btn danger"
              onClick={() => onDelete(parcel.id)}
            >
              Remover
            </button>
          </div>
        </div>

        {parcel.events.length > 0 ? (
          <ol className="timeline">
            {parcel.events.map((ev, index) => (
              <li key={`${ev.timestamp}-${index}`} className="timeline-item">
                <span className="timeline-desc">{ev.description}</span>
                <span className="timeline-meta">
                  {formatEventTime(ev.timestamp)}
                  {ev.location ? ` · ${ev.location}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dialog-help">Ainda sem eventos registados pela transportadora.</p>
        )}
      </div>
    </details>
  );
}
