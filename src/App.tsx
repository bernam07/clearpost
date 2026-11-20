import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { AddParcelBar } from './components/AddParcelBar';
import { ArrivingWidget } from './components/ArrivingWidget';
import { AuthGate } from './components/AuthGate';
import { CarrierPickerDialog } from './components/CarrierPickerDialog';
import { ParcelRow } from './components/ParcelRow';
import { SettingsDialog } from './components/SettingsDialog';
import {
  isFirebaseConfigured,
  observeAuth,
  removeUserParcel,
  saveUserParcel,
  subscribeUserParcels,
} from './lib/firebase';
import { fetchTrackingUpdate } from './lib/trackingClient';
import type { CarrierId, Parcel } from './types/parcel';

const LOCAL_PARCELS_KEY = 'clearpost.parcels.v2';

type FilterMode = 'all' | 'active' | 'delivered';

interface PendingAmbiguous {
  trackingNumber: string;
  candidates: CarrierId[];
  label: string;
}

function loadLocalParcels(): Parcel[] {
  try {
    const raw = localStorage.getItem(LOCAL_PARCELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Parcel[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function App() {
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [adding, setAdding] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAmbiguous, setPendingAmbiguous] = useState<PendingAmbiguous | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => {
      setToast((curr) => (curr === message ? null : curr));
    }, 2800);
  }

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return observeAuth((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setParcels([]);
      }
    });
  }, []);

  useEffect(() => {
    if (user) {
      return subscribeUserParcels(
        user.uid,
        (remoteParcels) => setParcels(remoteParcels),
        () => showToast('Erro ao sincronizar com o Firestore.'),
      );
    }
    if (localMode) {
      setParcels(loadLocalParcels());
    }
    return undefined;
  }, [user, localMode]);

  useEffect(() => {
    if (user || !localMode) return;
    try {
      localStorage.setItem(LOCAL_PARCELS_KEY, JSON.stringify(parcels));
    } catch {
      // ignore
    }
  }, [parcels, user, localMode]);

  async function persistParcel(parcel: Parcel) {
    if (user) {
      await saveUserParcel(user.uid, parcel);
    } else {
      setParcels((prev) => {
        const exists = prev.some((p) => p.id === parcel.id);
        return exists ? prev.map((p) => (p.id === parcel.id ? parcel : p)) : [parcel, ...prev];
      });
    }
  }

  async function handleAddParcel(trackingNumber: string, carrier: CarrierId, label: string) {
    setAdding(true);
    try {
      const result = await fetchTrackingUpdate(trackingNumber, carrier);
      const now = new Date().toISOString();
      const parcel: Parcel = {
        id: crypto.randomUUID(),
        trackingNumber,
        carrier: result.carrier !== 'unknown' ? result.carrier : carrier,
        label: label || `Encomenda ${trackingNumber.slice(-5)}`,
        status: result.status,
        etaIso: result.etaIso,
        etaWindow: result.etaWindow,
        lastLocation: result.lastLocation,
        events: result.events,
        createdAt: now,
        updatedAt: now,
      };
      await persistParcel(parcel);
      showToast(
        result.source === 'proxy'
          ? 'Encomenda adicionada e atualizada.'
          : 'Encomenda guardada (liga o proxy nas Definições para consulta em tempo real).',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível consultar o código.');
    } finally {
      setAdding(false);
    }
  }

  async function handlePickAmbiguousCarrier(carrier: CarrierId) {
    if (!pendingAmbiguous) return;
    const { trackingNumber, label } = pendingAmbiguous;
    setPendingAmbiguous(null);
    await handleAddParcel(trackingNumber, carrier, label);
  }

  async function handleRefreshParcel(parcel: Parcel) {
    setRefreshingId(parcel.id);
    try {
      const result = await fetchTrackingUpdate(parcel.trackingNumber, parcel.carrier);
      const updated: Parcel = {
        ...parcel,
        carrier: result.carrier !== 'unknown' ? result.carrier : parcel.carrier,
        status: result.status,
        etaIso: result.etaIso,
        etaWindow: result.etaWindow,
        lastLocation: result.lastLocation,
        events: result.events.length > 0 ? result.events : parcel.events,
        updatedAt: new Date().toISOString(),
      };
      await persistParcel(updated);
      showToast('Estado atualizado.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao atualizar.');
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleRefreshAll() {
    const targets = parcels.filter((p) => p.status !== 'delivered');
    if (targets.length === 0 || refreshingAll) return;

    setRefreshingAll(true);
    let updatedCount = 0;

    for (const parcel of targets) {
      try {
        const result = await fetchTrackingUpdate(parcel.trackingNumber, parcel.carrier);
        await persistParcel({
          ...parcel,
          carrier: result.carrier !== 'unknown' ? result.carrier : parcel.carrier,
          status: result.status,
          etaIso: result.etaIso,
          etaWindow: result.etaWindow,
          lastLocation: result.lastLocation,
          events: result.events.length > 0 ? result.events : parcel.events,
          updatedAt: new Date().toISOString(),
        });
        updatedCount += 1;
      } catch {
        // continue refreshing remaining parcels
      }
    }

    setRefreshingAll(false);
    showToast(
      updatedCount > 0
        ? `${updatedCount} ${updatedCount === 1 ? 'encomenda atualizada' : 'encomendas atualizadas'}.`
        : 'Não foi possível atualizar as encomendas.',
    );
  }

  async function handleToggleDelivered(parcel: Parcel) {
    const nextDelivered = parcel.status !== 'delivered';
    const now = new Date().toISOString();
    await persistParcel({
      ...parcel,
      status: nextDelivered ? 'delivered' : 'in_transit',
      updatedAt: now,
      events: nextDelivered
        ? [
            { timestamp: now, description: 'Marcada como entregue manualmente' },
            ...parcel.events,
          ]
        : parcel.events,
    });
    showToast(nextDelivered ? 'Marcada como entregue.' : 'Encomenda reaberta.');
  }

  async function handleDeleteParcel(id: string) {
    if (user) {
      await removeUserParcel(user.uid, id);
    } else {
      setParcels((prev) => prev.filter((p) => p.id !== id));
    }
    showToast('Encomenda removida.');
  }

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      showToast('Código copiado.');
    } catch {
      showToast('Não foi possível copiar o código.');
    }
  }

  const { activeParcels, deliveredParcels, visibleParcels } = useMemo(() => {
    const active = parcels
      .filter((p) => p.status !== 'delivered')
      .sort((a, b) => {
        if (a.status === 'out_for_delivery' && b.status !== 'out_for_delivery') return -1;
        if (b.status === 'out_for_delivery' && a.status !== 'out_for_delivery') return 1;
        return (a.etaIso ?? '9999').localeCompare(b.etaIso ?? '9999');
      });

    const delivered = parcels.filter((p) => p.status === 'delivered');
    const visible =
      filter === 'active'
        ? active
        : filter === 'delivered'
          ? delivered
          : [...active, ...delivered];

    return { activeParcels: active, deliveredParcels: delivered, visibleParcels: visible };
  }, [parcels, filter]);

  if (!authReady) {
    return (
      <main className="auth-stage">
        <div className="auth-loading" role="status" aria-live="polite">
          <img src="/icon.svg" alt="" width={36} height={36} />
          <span>A verificar sessão…</span>
        </div>
      </main>
    );
  }

  if (!user && !localMode) {
    return (
      <AuthGate
        onContinueLocal={!isFirebaseConfigured ? () => setLocalMode(true) : undefined}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={26} height={26} />
          <div>
            <h1 className="brand-name">ClearPost</h1>
            <span className="brand-sync">
              {user ? user.displayName || user.email || 'Sincronizado' : 'Modo local'}
            </span>
          </div>
        </div>

        <div className="topbar-actions">
          {activeParcels.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              disabled={refreshingAll}
              onClick={handleRefreshAll}
            >
              {refreshingAll ? 'A atualizar...' : 'Atualizar todas'}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
          >
            Definições
          </button>
        </div>
      </header>

      <AddParcelBar
        busy={adding}
        onAdd={handleAddParcel}
        onAmbiguous={(trackingNumber, candidates, label) =>
          setPendingAmbiguous({ trackingNumber, candidates, label })
        }
        onNotify={showToast}
      />

      <ArrivingWidget parcels={activeParcels} />

      {parcels.length === 0 ? (
        <section className="empty-state">
          <h2>Ainda sem encomendas</h2>
          <p>
            Cola um código da CTT, DPD, InPost, DHL, GLS ou UPS no campo acima para começar a acompanhar a tua primeira entrega.
          </p>
        </section>
      ) : (
        <>
          <div className="filter-bar">
            <div className="filter-pills" role="group" aria-label="Filtrar encomendas">
              <button
                type="button"
                className="filter-pill"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                Todas ({parcels.length})
              </button>
              <button
                type="button"
                className="filter-pill"
                aria-pressed={filter === 'active'}
                onClick={() => setFilter('active')}
              >
                A chegar ({activeParcels.length})
              </button>
              <button
                type="button"
                className="filter-pill"
                aria-pressed={filter === 'delivered'}
                onClick={() => setFilter('delivered')}
              >
                Entregues ({deliveredParcels.length})
              </button>
            </div>
          </div>

          <section className="parcel-list" aria-label="Lista de encomendas">
            {visibleParcels.length === 0 ? (
              <div className="empty-state">
                <h2>Nada neste filtro</h2>
                <p>Alterna para &ldquo;Todas&rdquo; para ver o resto das tuas encomendas.</p>
              </div>
            ) : (
              visibleParcels.map((parcel) => (
                <ParcelRow
                  key={parcel.id}
                  parcel={parcel}
                  refreshing={refreshingId === parcel.id}
                  onRefresh={handleRefreshParcel}
                  onToggleDelivered={handleToggleDelivered}
                  onCopy={handleCopyCode}
                  onDelete={handleDeleteParcel}
                />
              ))
            )}
          </section>
        </>
      )}

      <CarrierPickerDialog
        open={Boolean(pendingAmbiguous)}
        trackingNumber={pendingAmbiguous?.trackingNumber ?? ''}
        candidates={pendingAmbiguous?.candidates ?? []}
        onSelect={handlePickAmbiguousCarrier}
        onClose={() => setPendingAmbiguous(null)}
      />

      <SettingsDialog
        open={settingsOpen}
        user={user}
        onClose={() => setSettingsOpen(false)}
        onSaved={showToast}
      />

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </main>
  );
}
