/**
 * UI language. One catalog per language, keyed by short ids; `en` is the source and the last fallback — a missing
 * Japanese line reads better in English than in Chinese, and this is an open project whose contributors read
 * English. The choice is a per-browser preference like the theme: it lives in localStorage, is applied before
 * React renders, and re-renders the whole app when it changes (`useT`).
 */
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { zh } from './locales/zh';
import { zhTW } from './locales/zh-TW';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { de } from './locales/de';
import { pt } from './locales/pt';
import { ru } from './locales/ru';

export type Locale = 'zh' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'ru';

/** Every language is named in itself: someone who lands in the wrong one still finds their own. */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'zh', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' },
  { id: 'ru', label: 'Русский' },
];

/** Every line of UI copy. `en` is the source, so its keys are the whole set — a typo is a compile error now,
 * rather than a key name rendered at the user. */
export type MsgKey = keyof typeof en;
/** 会数数的那些键（catalog 里带 `.other` 的），tn / tx 收的是这个前缀，不是完整键。 */
export type PluralKey = { [K in MsgKey]: K extends `${infer P}.other` ? P : never }[MsgKey];
/**
 * A non-source catalog: missing lines are allowed (lookup falls back), but every key it does carry must be one
 * `en` has. Plural prefixes additionally allow any suffix, because languages disagree about plural categories —
 * Russian wants one / few / many, Chinese wants none of them.
 */
export type Dict = Partial<Record<MsgKey | `${PluralKey}.${string}`, string>>;
const DICTS: Record<Locale, Dict> = { zh, 'zh-TW': zhTW, en, ja, ko, es, fr, de, pt, ru };
const IDS = LOCALES.map((l) => l.id);

const chain = (l: Locale): Locale[] => (l === 'en' ? ['en'] : l === 'zh-TW' ? ['zh-TW', 'zh', 'en'] : [l, 'en']);

const KEY = 'bot-crew:locale';

/**
 * No stored choice means English. Not the browser's language: this is a product people meet in English first —
 * on GitHub, in a README, in someone else's screenshot — and an app that opens in a language the reader did not
 * pick is harder to share than one that opens in the language the project is written in. The switcher in
 * Settings › General is one click away and remembers.
 */
function read(): Locale {
  try {
    const v = localStorage.getItem(KEY) as Locale | null;
    if (v && IDS.includes(v)) return v;
  } catch {
    /* private window */
  }
  return 'en';
}

let current: Locale = read();
const listeners = new Set<() => void>();

export const getLocale = () => current;
/** BCP-47 tag for Intl (dates, numbers, plurals). */
export const intlLocale = (l: Locale = current) => (l === 'zh' ? 'zh-CN' : l === 'pt' ? 'pt-BR' : l);

export function setLocale(l: Locale) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* this session only */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

/** Called once at startup, before the first render. */
export function startI18n() {
  document.documentElement.lang = current;
}

function lookup(key: string): string | undefined {
  for (const l of chain(current)) {
    const v = (DICTS[l] as Record<string, string | undefined>)[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** One line of interface text. An unknown key shows itself, which is loud enough to notice and harmless. */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  return fill(lookup(key) ?? key, vars);
}

/**
 * 键由后端数据决定、编译期算不出来的那几处（技能库分类、云厂商）专用。
 * 别拿它图省事——它绕过的正是 t 的全部价值：打错键只会把键名渲染给用户。
 */
export function tDyn(key: string, vars?: Record<string, string | number>): string {
  return fill(lookup(key) ?? key, vars);
}

/** The plural form of `key` for `n`, in whatever categories this language actually uses. */
function plural(key: string, n: number): string | undefined {
  let cat: string;
  try {
    cat = new Intl.PluralRules(intlLocale()).select(n);
  } catch {
    cat = n === 1 ? 'one' : 'other';
  }
  return lookup(`${key}.${cat}`) ?? lookup(`${key}.other`) ?? lookup(`${key}.one`);
}

/**
 * A line that counts something. The catalogs carry `key.one` / `key.other` (and `.few` / `.many` where the
 * language needs them); `{n}` is filled in for you.
 */
export function tn(key: PluralKey, n: number, vars?: Record<string, string | number>): string {
  return fill(plural(key, n) ?? key, { n, ...vars });
}

/** Same as `t`, but some placeholders are React nodes (a bold count, a link). Returns the pieces in order. */
export function tx(key: MsgKey | PluralKey, nodes: Record<string, ReactNode>, vars?: Record<string, string | number>): ReactNode[] {
  const raw = lookup(key) ?? (vars && typeof vars.n === 'number' ? plural(key, vars.n) : undefined) ?? key;
  // Placeholders that have a node keep their braces here and become that node below.
  const s = raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in nodes ? m : vars && k in vars ? String(vars[k]) : m));
  return s.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : <span key={i}>{part}</span>;
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Re-renders the component whenever the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** The hook every component uses: `const t = useT()`. */
export function useT() {
  useLocale();
  return t;
}
