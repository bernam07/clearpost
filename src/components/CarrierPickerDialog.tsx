import { useEffect, useRef } from 'react';
import { CARRIERS, SELECTABLE_CARRIERS } from '../lib/carriers';
import type { CarrierId } from '../types/parcel';

interface CarrierPickerDialogProps {
  open: boolean;
  trackingNumber: string;
  candidates: CarrierId[];
  onSelect: (carrier: CarrierId) => void;
  onClose: () => void;
}

export function CarrierPickerDialog({
  open,
  trackingNumber,
  candidates,
  onSelect,
  onClose,
}: CarrierPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for Safari (browsers without <dialog closedby="any">)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const insideContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (!insideContent) dialog.close();
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, []);

  const primaryOptions = candidates.map((id) => CARRIERS[id]);
  const otherOptions = SELECTABLE_CARRIERS.filter((c) => !candidates.includes(c.id));

  return (
    <dialog
      ref={dialogRef}
      className="glass-dialog"
      aria-labelledby="carrier-picker-title"
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 id="carrier-picker-title">Escolher transportadora</h2>
          <button type="button" className="ghost-btn" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </button>
        </div>

        <p className="dialog-help">
          O código <span className="tracking-code">{trackingNumber}</span> coincide com mais do que uma transportadora. Qual pretendes usar?
        </p>

        <div className="carrier-choices">
          {primaryOptions.map((c) => (
            <button
              key={c.id}
              type="button"
              className="carrier-choice-btn"
              onClick={() => onSelect(c.id)}
            >
              <span className="carrier-dot" style={{ backgroundColor: c.color }} />
              <span className="carrier-choice-text">
                <span className="carrier-choice-name">{c.name}</span>
                <span className="carrier-choice-hint">{c.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {otherOptions.length > 0 && (
          <details className="other-carriers">
            <summary className="other-carriers-summary">Outras transportadoras</summary>
            <div className="carrier-choices" style={{ marginTop: 8 }}>
              {otherOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="carrier-choice-btn"
                  onClick={() => onSelect(c.id)}
                >
                  <span className="carrier-dot" style={{ backgroundColor: c.color }} />
                  <span className="carrier-choice-text">
                    <span className="carrier-choice-name">{c.name}</span>
                    <span className="carrier-choice-hint">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </dialog>
  );
}
