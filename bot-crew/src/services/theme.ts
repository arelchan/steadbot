/**
 * 外观. The palette is a set of CSS variables on :root (styles.css); a theme swaps them by setting
 * `data-theme` on <html>, and an accent swaps the warm-brown highlight for another. Both are per-browser
 * preferences, kept in localStorage, applied before React renders so there is no flash.
 */

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'clay' | 'ink' | 'moss' | 'plum';

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];
export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'clay', label: '陶土', swatch: '#9a4b28' },
  { id: 'ink', label: '墨蓝', swatch: '#2f5d80' },
  { id: 'moss', label: '苔绿', swatch: '#4a6b3d' },
  { id: 'plum', label: '梅紫', swatch: '#77436b' },
];

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

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** Put the current preferences on <html>. `system` follows the OS and keeps following it while the app is open. */
export function applyTheme(theme = getTheme(), accent = getAccent()) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && !!media()?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = accent;
  root.style.colorScheme = dark ? 'dark' : 'light';
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

/** Called once at startup: apply, and keep following the OS while 跟随系统 is chosen. */
export function startTheme() {
  applyTheme();
  media()?.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme();
  });
}
