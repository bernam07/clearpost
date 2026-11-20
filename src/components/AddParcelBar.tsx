import { useState, type FormEvent } from 'react';
import { CARRIERS, CARRIER_LIST, detectCarrierCandidates } from '../lib/carriers';
import type { CarrierId } from '../types/parcel';

interface AddParcelBarProps {
  busy: boolean;
  onAdd: (trackingNumber: string, carrier: CarrierId, label: string) => Promise<void>;
  onAmbiguous: (trackingNumber: string, candidates: CarrierId[], label: string) => void;
  onNotify: (message: string) => void;
}

export function AddParcelBar({ busy, onAdd, onAmbiguous, onNotify }: AddParcelBarProps) {
  const [code, setCode] = useState('');
  const [manualCarrier, setManualCarrier] = useState<CarrierId | null>(null);
  const [label, setLabel] = useState('');

  const trimmed = code.trim();
  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  const candidates = detectCarrierCandidates(normalized);
  const isAmbiguous = !manualCarrier && candidates.length > 1;
  const activeCarrier: CarrierId = manualCarrier ?? candidates[0] ?? 'unknown';
  const carrierMeta = CARRIERS[activeCarrier];

  async function handlePaste() {
    if (!navigator.clipboard?.readText) {
      onNotify('Cola diretamente no campo de texto.');
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        onNotify('A área de transferência está vazia.');
        return;
      }
      setCode(text);
      setManualCarrier(null);
    } catch {
      onNotify('Permite o acesso à área de transferência ou cola manualmente.');
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

    await onAdd(normalized, activeCarrier, label.trim());
    setCode('');
    setLabel('');
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
          placeholder="Colar código CTT, DPD, InPost, DHL..."
          aria-label="Código de tracking da encomenda"
          autoComplete="off"
          spellCheck={false}
        />

        {!trimmed && (
          <button type="button" className="paste-btn" onClick={handlePaste}>
            Colar
          </button>
        )}

        <button className="add-submit" type="submit" disabled={!trimmed || busy}>
          {busy ? 'A seguir...' : 'Seguir'}
        </button>
      </div>

      {trimmed.length >= 4 && (
        <div className="add-meta">
          <span className="detected-carrier">
            <span className="carrier-dot" style={{ backgroundColor: carrierMeta.color }} />
            <label htmlFor="carrier-override" style={{ color: 'var(--ink-muted)' }}>
              {isAmbiguous ? 'Várias opções:' : 'Transportadora:'}
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
              {isAmbiguous && <option value="unknown">Escolher ao seguir…</option>}
              {CARRIER_LIST.filter((c) => c.id !== 'unknown').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {!isAmbiguous && <option value="unknown">Outra transportadora</option>}
            </select>
          </span>

          <input
            className="label-input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nome opcional (ex: Teclado, Sapatilhas)"
            aria-label="Nome opcional da encomenda"
            maxLength={100}
          />
        </div>
      )}
    </form>
  );
}
