import { useState, type PointerEvent } from 'react';
import { isFirebaseConfigured, signInWithGoogle } from '../lib/firebase';

interface AuthGateProps {
  onContinueLocal?: () => void;
}

export function AuthGate({ onContinueLocal }: AuthGateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty('--mx', `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty('--my', `${y.toFixed(1)}%`);
  }

  async function handleGoogleLogin() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setError('A janela de autenticação foi fechada antes de concluir.');
      } else {
        setError('Não foi possível iniciar sessão com Google. Tenta novamente.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-stage">
      <section
        className="auth-glass"
        aria-labelledby="auth-heading"
        onPointerMove={handlePointerMove}
      >
        <div className="auth-brand">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <span className="auth-wordmark">ClearPost</span>
        </div>

        <div className="auth-copy">
          <h1 id="auth-heading" className="auth-title">
            As tuas encomendas, num só vidro.
          </h1>
          <p className="auth-subtitle">
            Acompanha CTT, DPD, InPost, DHL e outras num painel limpo, sincronizado entre telemóvel e computador.
          </p>
        </div>

        <ul className="auth-carriers" aria-label="Transportadoras suportadas">
          <li>CTT</li>
          <li>DPD / BRT</li>
          <li>InPost</li>
          <li>DHL</li>
          <li>GLS</li>
          <li>UPS</li>
        </ul>

        <div className="auth-actions">
          <button
            type="button"
            className="google-btn"
            disabled={busy || !isFirebaseConfigured}
            onClick={handleGoogleLogin}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.96 8.96 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
              />
            </svg>
            <span>{busy ? 'A iniciar sessão...' : 'Continuar com Google'}</span>
          </button>

          {!isFirebaseConfigured && onContinueLocal && (
            <button type="button" className="ghost-btn" onClick={onContinueLocal}>
              Continuar em modo local (Firebase sem .env)
            </button>
          )}
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <p className="auth-footnote">
          Os teus códigos ficam privados na tua conta Firebase. Sem anúncios nem partilha de dados.
        </p>
      </section>
    </main>
  );
}
