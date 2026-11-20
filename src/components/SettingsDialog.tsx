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

  // Fallback for browsers without <dialog closedby="any"> support (e.g. Safari)
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

  useEffect(() => {
    return subscribeThemeStorage(setTheme);
  }, []);

  function handleThemeChange(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
  }

  function handleSaveProxy() {
    setProxyUrl(proxyInput);
    onSaved(proxyInput.trim() ? 'Proxy URL saved.' : 'Proxy URL cleared.');
  }

  async function handleGoogleSignIn() {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
      onSaved('Signed in with Google.');
    } catch {
      onSaved('Could not sign in with Google.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOutUser();
      onSaved('Signed out.');
    } finally {
      setAuthBusy(false);
    }
  }

  const effectiveProxy =
    proxyInput.trim().replace(/\/+$/, '') || 'https://clearpost-proxy.<your-subdomain>.workers.dev';
  const scriptableSnippet = `// Scriptable (iOS) — ClearPost Widget
const url = "${effectiveProxy}/api/widget";
const data = await new Request(url).loadJSON();
const w = new ListWidget();
w.backgroundColor = new Color("#e7eef6", 0.72);
const t = w.addText(data.next?.etaHeadline ?? "No deliveries today");
t.font = Font.boldSystemFont(16);
w.addSpacer(4);
const sub = w.addText(data.next?.label ?? "All caught up");
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
          <h2 id="settings-title">Settings & widget</h2>
          <button type="button" className="ghost-btn" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>

        <section className="dialog-section">
          <h3>Appearance</h3>
          <div className="segmented" role="group" aria-label="Choose theme">
            <button
              type="button"
              aria-pressed={theme === 'system'}
              onClick={() => handleThemeChange('system')}
            >
              System ({getSystemThemeLabel()})
            </button>
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => handleThemeChange('light')}
            >
              Light
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => handleThemeChange('dark')}
            >
              Dark
            </button>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Tracking proxy (Cloudflare Worker)</h3>
          <p className="dialog-help">
            Enter your Worker URL to query DPD, InPost, and DHL live without exposing API keys.
          </p>
          <input
            className="field-input"
            type="url"
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            placeholder="https://clearpost-proxy.your-name.workers.dev"
          />
          <div>
            <button type="button" className="add-submit" onClick={handleSaveProxy}>
              Save proxy
            </button>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Firebase sync (Spark)</h3>
          {!isFirebaseConfigured ? (
            <p className="dialog-help">
              Firebase is not configured in this environment. Copy <code>.env.example</code> to <code>.env</code> with your Firebase Web App keys to sync across devices.
            </p>
          ) : user ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span className="dialog-help">Signed in as {user.email ?? user.displayName}</span>
              <button type="button" className="ghost-btn" disabled={authBusy} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="add-submit" disabled={authBusy} onClick={handleGoogleSignIn}>
                Sign in with Google
              </button>
            </div>
          )}
        </section>

        <section className="dialog-section">
          <h3>Home screen widget (Scriptable / KWGT)</h3>
          <p className="dialog-help">
            Your Worker exposes <code>GET /api/widget</code> with your next arrival. On iOS, paste this snippet into Scriptable:
          </p>
          <pre className="code-block">{scriptableSnippet}</pre>
        </section>
      </div>
    </dialog>
  );
}
