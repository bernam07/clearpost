import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  applyThemePreference,
  getStoredTheme,
  getSystemThemeLabel,
  subscribeThemeStorage,
  type ThemePreference,
} from '../lib/theme';
import { getProxyUrl, setProxyUrl } from '../lib/trackingClient';
import { isFirebaseConfigured, signInWithGoogle, signOutUser } from '../lib/firebase';

interface SettingsDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function SettingsDialog({ open, user, onClose, onSaved }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useState<ThemePreference>(() => getStoredTheme());
  const [proxyInput, setProxyInput] = useState(() => getProxyUrl());
  const [authBusy, setAuthBusy] = useState(false);

  // Open/close native modal dialog via showModal()
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setProxyInput(getProxyUrl());
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback for browsers without <dialog closedby="any"> support (e.g., Safari)
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

      if (!insideContent) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, []);

  // Keep theme state synced across tabs
  useEffect(() => {
    return subscribeThemeStorage(setTheme);
  }, []);

  function handleThemeChange(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
  }

  function handleSaveProxy() {
    setProxyUrl(proxyInput);
    onSaved(proxyInput.trim() ? 'URL do proxy guardado.' : 'Proxy limpo (modo demonstração).');
  }

  async function handleGoogleSignIn() {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
      onSaved('Sessão Google iniciada.');
    } catch {
      onSaved('Não foi possível iniciar sessão com Google.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOutUser();
      onSaved('Sessão terminada.');
    } finally {
      setAuthBusy(false);
    }
  }

  const effectiveProxy = proxyInput.trim().replace(/\/+$/, '') || 'https://clearpost-proxy.<teu-subdominio>.workers.dev';
  const scriptableSnippet = `// Scriptable (iOS) — Widget ClearPost
const url = "${effectiveProxy}/api/widget";
const data = await new Request(url).loadJSON();
const w = new ListWidget();
w.backgroundColor = new Color("#e7eef6", 0.72);
const t = w.addText(data.next?.etaHeadline ?? "Sem entregas hoje");
t.font = Font.boldSystemFont(16);
w.addSpacer(4);
const sub = w.addText(data.next?.label ?? "Tudo entregue");
sub.font = Font.systemFont(13);
Script.setWidget(w);
Script.complete();`;

  return (
    <dialog
      ref={dialogRef}
      className="glass-dialog"
      aria-labelledby="settings-title"
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 id="settings-title">Definições e widget</h2>
          <button type="button" className="ghost-btn" onClick={() => dialogRef.current?.close()}>
            Fechar
          </button>
        </div>

        <section className="dialog-section">
          <h3>Aspeto</h3>
          <div className="segmented" role="group" aria-label="Escolher tema">
            <button
              type="button"
              aria-pressed={theme === 'system'}
              onClick={() => handleThemeChange('system')}
            >
              Sistema ({getSystemThemeLabel()})
            </button>
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => handleThemeChange('light')}
            >
              Claro
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => handleThemeChange('dark')}
            >
              Escuro
            </button>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Proxy de tracking (Cloudflare Worker)</h3>
          <p className="dialog-help">
            Indica o endereço do teu Worker para consultar CTT, DPD, InPost e outras via Ship24 sem expor a chave API.
          </p>
          <input
            className="field-input"
            type="url"
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            placeholder="https://clearpost-proxy.teu-user.workers.dev"
          />
          <div>
            <button type="button" className="add-submit" onClick={handleSaveProxy}>
              Guardar proxy
            </button>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Sincronização Firebase (Spark)</h3>
          {!isFirebaseConfigured ? (
            <p className="dialog-help">
              Firebase ainda não configurado neste ambiente. Preenche o ficheiro <code>.env</code> com as chaves da tua Web App no Firebase Console para sincronizar entre dispositivos.
            </p>
          ) : user ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span className="dialog-help">Sessão ativa: {user.email ?? user.displayName}</span>
              <button type="button" className="ghost-btn" disabled={authBusy} onClick={handleSignOut}>
                Terminar sessão
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="add-submit" disabled={authBusy} onClick={handleGoogleSignIn}>
                Entrar com Google
              </button>
            </div>
          )}
        </section>

        <section className="dialog-section">
          <h3>Widget no ecrã inicial (Scriptable / KWGT)</h3>
          <p className="dialog-help">
            O teu Worker expõe <code>GET /api/widget</code> com a próxima entrega. No iOS podes colar este snippet no Scriptable:
          </p>
          <pre className="code-block">{scriptableSnippet}</pre>
        </section>
      </div>
    </dialog>
  );
}
