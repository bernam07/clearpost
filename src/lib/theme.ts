export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

export function getStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Ignore storage access errors (private browsing / blocked storage)
  }
  return 'system';
}

export function applyThemePreference(pref: ThemePreference): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const metaValue = pref === 'system' ? 'light dark' : pref;

  if (meta) {
    meta.content = metaValue;
  }

  try {
    if (pref === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, pref);
    }
  } catch {
    // Still apply theme to the document even if persistence fails
  }
}

export function getSystemThemeLabel(): string {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? 'dark' : 'light';
}

export function subscribeThemeStorage(onChange: (pref: ThemePreference) => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const next: ThemePreference =
      event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system';
    applyThemePreference(next);
    onChange(next);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
