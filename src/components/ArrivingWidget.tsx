import { useState, type CSSProperties, type PointerEvent } from 'react';
import { CARRIERS, formatEtaHeadline, statusLabel } from '../lib/carriers';
import type { Parcel, ParcelStatus } from '../types/parcel';

interface ArrivingWidgetProps {
  parcels: Parcel[];
}

const STEPS = ['Registered', 'In transit', 'Out for delivery', 'Delivered'] as const;

function routeProgress(status: ParcelStatus): { percent: number; stepIndex: number; colorVar: string } {
  switch (status) {
    case 'delivered':
      return { percent: 100, stepIndex: 3, colorVar: 'var(--status-delivered)' };
    case 'out_for_delivery':
      return { percent: 74, stepIndex: 2, colorVar: 'var(--status-out)' };
    case 'in_transit':
      return { percent: 44, stepIndex: 1, colorVar: 'var(--status-transit)' };
    case 'exception':
      return { percent: 52, stepIndex: 1, colorVar: 'var(--status-error)' };
    case 'pending':
    default:
      return { percent: 10, stepIndex: 0, colorVar: 'var(--status-pending)' };
  }
}

export function ArrivingWidget({ parcels }: ArrivingWidgetProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const activeParcels = parcels.filter((p) => p.status !== 'delivered');
  if (activeParcels.length === 0) return null;

  const safeIndex = Math.min(selectedIndex, activeParcels.length - 1);
  const current = activeParcels[safeIndex];
  const carrier = CARRIERS[current.carrier];
  const etaHeadline = formatEtaHeadline(current);
  const progress = routeProgress(current.status);
  const hasMultiple = activeParcels.length > 1;

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty('--mx', `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty('--my', `${y.toFixed(1)}%`);
  }

  function stepBy(delta: number) {
    setSelectedIndex((prev) => (prev + delta + activeParcels.length) % activeParcels.length);
  }

  return (
    <div className="lens-stack" data-stacked={hasMultiple ? 'true' : 'false'}>
      {hasMultiple && <div className="lens-deck-back" aria-hidden="true" />}

      <section
        className="hero-widget"
        aria-label="Arriving parcel"
        onPointerMove={handlePointerMove}
      >
        <div className="hero-top">
          <div>
            <h2 className="hero-eta">{etaHeadline}</h2>
            <p className="hero-window">
              {current.etaWindow ? `Estimated window ${current.etaWindow}` : statusLabel(current.status)}
            </p>
          </div>

          <span className="carrier-pill">
            <span className="carrier-dot" style={{ backgroundColor: carrier.color }} />
            {carrier.name}
          </span>
        </div>

        <div className="hero-subject">
          <p className="hero-label">{current.label || 'Untitled parcel'}</p>
          <span className="tracking-code">{current.trackingNumber}</span>
        </div>

        <div
          className="optical-rail"
          style={{ '--rail-color': progress.colorVar } as CSSProperties}
          aria-label={`Current status: ${statusLabel(current.status)}`}
        >
          <div className="rail-track-wrap" aria-hidden="true">
            <div className="rail-base">
              <div className="rail-fill" style={{ width: `${progress.percent}%` }} />
              <div className="rail-beacon" style={{ left: `${progress.percent}%` }} />
            </div>
          </div>

          <ol className="rail-labels">
            {STEPS.map((name, idx) => (
              <li key={name} data-current={idx === progress.stepIndex ? 'true' : undefined}>
                {name}
              </li>
            ))}
          </ol>
        </div>

        <div className="hero-footer">
          <span className="hero-location">
            {current.lastLocation || 'Waiting for first carrier scan'}
          </span>

          {hasMultiple && (
            <div className="hero-nav" role="group" aria-label="Switch featured parcel">
              <button
                type="button"
                className="hero-nav-btn"
                aria-label="Previous parcel"
                onClick={() => stepBy(-1)}
              >
                ‹
              </button>
              <span className="hero-counter">
                {safeIndex + 1} / {activeParcels.length}
              </span>
              <button
                type="button"
                className="hero-nav-btn"
                aria-label="Next parcel"
                onClick={() => stepBy(1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
