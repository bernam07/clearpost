import { useState, type FormEvent } from 'react';
import { CARRIERS, CARRIER_LIST, detectCarrierCandidates } from '../lib/carriers';
import type { CarrierId } from '../types/parcel';

interface AddParcelBarProps {
  busy: boolean;
  onAdd: (trackingNumber: string, carrier: CarrierId, label: string, postalCode?: string) => Promise<void>;
  onAmbiguous: (trackingNumber: string, candidates: CarrierId[], label: string) => void;
  onNotify: (message: string) => void;
}

export function AddParcelBar({ busy, onAdd, onAmbiguous, onNotify }: AddParcelBarProps) {
  const [code, setCode] = useState('');
  const [manualCarrier, setManualCarrier] = useState<CarrierId | null>(null);
  const [label, setLabel] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const trimmed = code.trim();
  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  const candidates = detectCarrierCandidates(normalized);
  const isAmbiguous = !manualCarrier && candidates.length > 1;
  const activeCarrier: CarrierId = manualCarrier ?? candidates[0] ?? 'unknown';
  const carrierMeta = CARRIERS[activeCarrier];

  async function handlePaste() {
    if (!navigator.clipboard?.readText) {
      onNotify('Paste directly into the input field.');
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        onNotify('Clipboard is empty.');
        return;
      }
      setCode(text);
      setManualCarrier(null);
    } catch {
      onNotify('Allow clipboard access or paste manually.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!normalized || busy) return;

    if (isAmbiguous) {
      onAmbiguous(normalized, candidates, label.trim());
      setCode('');
      setLabel('');
      setManualCarrier(null);
      return;
    }

    await onAdd(normalized, activeCarrier, label.trim(), postalCode.trim() || undefined);
    setCode('');
    setLabel('');
    setPostalCode('');
    setManualCarrier(null);
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <div className="add-pill">
        <input
          className="add-input"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (!e.target.value.trim()) setManualCarrier(null);
          }}
          placeholder="Paste CTT, DPD, InPost, DHL code..."
          aria-label="Parcel tracking number"
          autoComplete="off"
          spellCheck={false}
        />

        {!trimmed && (
          <button type="button" className="paste-btn" onClick={handlePaste}>
            Paste
          </button>
        )}

        <button className="add-submit" type="submit" disabled={!trimmed || busy}>
          {busy ? 'Tracking...' : 'Track'}
        </button>
      </div>

      {trimmed.length >= 4 && (
        <div className="add-meta">
          <span className="detected-carrier">
            <span className="carrier-dot" style={{ backgroundColor: carrierMeta.color }} />
            <label htmlFor="carrier-override" style={{ color: 'var(--ink-muted)' }}>
              {isAmbiguous ? 'Multiple matches:' : 'Carrier:'}
            </label>
            <select
              id="carrier-override"
              className="carrier-select"
              value={isAmbiguous ? 'unknown' : activeCarrier}
              onChange={(e) => {
                const val = e.target.value as CarrierId;
                setManualCarrier(val === 'unknown' ? null : val);
              }}
            >
              {isAmbiguous && <option value="unknown">Choose on submit…</option>}
              {CARRIER_LIST.filter((c) => c.id !== 'unknown').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {!isAmbiguous && <option value="unknown">Other carrier</option>}
            </select>
          </span>

          <input
            className="label-input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label (e.g. Keyboard, Sneakers)"
            aria-label="Optional parcel label"
            maxLength={100}
          />

          {activeCarrier === 'mondial_relay' && (
            <input
              className="label-input"
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="Postal code (required by Mondial Relay)"
              aria-label="Destination postal code"
              maxLength={16}
            />
          )}
        </div>
      )}
    </form>
  );
}
