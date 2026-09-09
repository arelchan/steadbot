/**
 * 外观. The palette is a set of CSS variables on :root (styles.css); a theme swaps them by setting
 * `data-theme` on <html>, and an accent swaps the warm-brown highlight for another. Both are per-browser
 * preferences, kept in localStorage, applied before React renders so there is no flash.
 */

export type Theme = 'system' | 'light' | 'dark';
export type Scale = 'sm' | 'md' | 'lg';
export type Accent = 'clay' | 'ink' | 'moss' | 'plum';

/** Names live in the language catalogs (`theme.*`, `accent.*`, `scale.*`); only the ids and the swatches are here. */
export const THEMES: { id: Theme }[] = [{ id: 'system' }, { id: 'light' }, { id: 'dark' }];
export const ACCENTS: { id: Accent; swatch: string }[] = [
  { id: 'clay', swatch: '#9a4b28' },
  { id: 'ink', swatch: '#2f5d80' },
  { id: 'moss', swatch: '#4a6b3d' },
  { id: 'plum', swatch: '#77436b' },
];
export const SCALES: { id: Scale }[] = [{ id: 'sm' }, { id: 'md' }, { id: 'lg' }];
const SCALE_OF: Record<Scale, string> = { sm: '0.92', md: '1', lg: '1.12' };

const S_KEY = 'bot-crew:scale';
const T_KEY = 'bot-crew:theme';
const A_KEY = 'bot-crew:accent';
const read = <T extends string>(key: string, ok: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

export const getTheme = () => read<Theme>(T_KEY, ['system', 'light', 'dark'], 'system');
export const getAccent = () => read<Accent>(A_KEY, ['clay', 'ink', 'moss', 'plum'], 'clay');
export const getScale = () => read<Scale>(S_KEY, ['sm', 'md', 'lg'], 'md');

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** Put the current preferences on <html>. `system` follows the OS and keeps following it while the app is open. */
export function applyTheme(theme = getTheme(), accent = getAccent(), scale = getScale()) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && !!media()?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = accent;
  root.style.colorScheme = dark ? 'dark' : 'light';
  // The layout is in pixels, so density is a zoom of the whole app rather than a font-size change.
  root.style.setProperty('--ui-scale', SCALE_OF[scale]);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(T_KEY, theme);
  } catch {
    /* private window: this session only */
  }
  applyTheme(theme);
}

export function setAccent(accent: Accent) {
  try {
    localStorage.setItem(A_KEY, accent);
  } catch {
    /* private window: this session only */
  }
  applyTheme(undefined, accent);
}

export function setScale(scale: Scale) {
  try {
    localStorage.setItem(S_KEY, scale);
  } catch {
    /* private window: this session only */
  }
  applyTheme(undefined, undefined, scale);
}

/* ---- 桌面通知：per browser, needs the user's permission ---- */
const N_KEY = 'bot-crew:notify';
export const getDesktopNotify = () => {
  try {
    return localStorage.getItem(N_KEY) === '1' && Notification?.permission === 'granted';
  } catch {
    return false;
  }
};
export const notifySupported = () => typeof Notification !== 'undefined';
/** Turning it on asks the browser; returns whether it ended up on. */
export async function setDesktopNotify(on: boolean): Promise<boolean> {
  if (!on) {
    try {
      localStorage.setItem(N_KEY, '0');
    } catch {
      /* ignore */
    }
    return false;
  }
  if (!notifySupported()) return false;
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  try {
    localStorage.setItem(N_KEY, p === 'granted' ? '1' : '0');
  } catch {
    /* ignore */
  }
  return p === 'granted';
}

/** Called once at startup: apply, and keep following the OS while 跟随系统 is chosen. */
export function startTheme() {
  applyTheme();
  media()?.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme();
  });
}
