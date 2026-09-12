import type { FileRef, RuntimeInfo } from '../types';
import { t } from '../i18n';

/**
 * Which server this client talks to: the user's own machine (default, from VITE_CREW_WS) or a server the
 * user paired with a code. Stored per browser. Changing it reloads the page, so every module picks it up.
 */
export type RuntimeTarget = { kind: 'local' } | { kind: 'remote'; url: string; token: string; name?: string; provider?: 'byo' | 'hosted' };

const KEY = 'bot-crew:runtime';
const ENV_WS = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_CREW_WS;

/**
 * 首屏每条线最多要多少条历史。写在地址里，是因为快照在连上那一刻就发出来了，
 * 服务端没机会先问客户端要多少；而让服务端一刀切的话，老客户端会把截断结果
 * 整体写回 localStorage，把自己那份完整历史盖掉，还没有恢复路径。
 */
export const RECENT = 200;
const withRecent = (u: string) => (u ? `${u}${u.includes('?') ? '&' : '?'}recent=${RECENT}` : u);

export const localWsUrl = withRecent(ENV_WS ?? '');
export const localHttpBase = ENV_WS ? ENV_WS.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws$/, '') : '';

export function getRuntime(): RuntimeTarget {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t = JSON.parse(raw) as RuntimeTarget;
      if (t.kind === 'remote' && t.url && t.token) return t;
    }
  } catch {
    /* fall through */
  }
  return { kind: 'local' };
}

export function setRuntime(t: RuntimeTarget) {
  try {
    if (t.kind === 'local') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

const target = getRuntime();
export const isRemote = target.kind === 'remote';
/** WebSocket URL of the runtime this page is connected to ('' = in-browser mock). */
export const wsUrl = target.kind === 'remote' ? withRecent(`${target.url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(target.token)}`) : localWsUrl;
/** HTTP base of that runtime. */
export const httpBase = target.kind === 'remote' ? target.url : localHttpBase;
const token = target.kind === 'remote' ? target.token : '';

/** Headers for HTTP calls to the current runtime. */
export const authHeaders = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});
/** Append the token to a URL that will be opened by the browser itself (links, iframes, images). */
export const withToken = (url: string) => (token && !/[?&]token=/.test(url) ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
/** Absolute, openable link for a file the server described. Older messages carry absolute URLs already. */
export const fileHref = (f: Pick<FileRef, 'url'>) => withToken(/^(https?:|blob:|data:)/.test(f.url) ? f.url : `${httpBase}${f.url}`);
/**
 * 给 iframe 用的地址：令牌走路径前缀，页面里的相对地址（图片、css、js）才跟着带上令牌。
 * 单个文件（图片、PDF）用 fileHref 就够，查询串那种写法它们自己带得上。
 */
export const frameHref = (f: Pick<FileRef, 'url'>) => {
  const abs = /^(https?:|blob:|data:)/.test(f.url) ? f.url : `${httpBase}${f.url}`;
  if (!token || /^(blob:|data:)/.test(abs)) return fileHref(f);
  const u = new URL(abs);
  return `${u.origin}/tok/${encodeURIComponent(token)}${u.pathname}${u.search}`;
};

/** "Open on the desktop" endpoint for a file, or undefined when this runtime has no desktop to hand it to. */
export const openHref = (f: Pick<FileRef, 'url'>, rt: RuntimeInfo | undefined) => (rt?.desktop && rt.local ? withToken(`${httpBase}${f.url.replace(/^https?:\/\/[^/]+/, '').replace('/files/', '/open/')}`) : undefined);

/** Decode a pairing code printed by the install script: base64url of {url, token, name}. */
export function parsePairingCode(code: string): { url: string; token: string; name?: string } {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const j = JSON.parse(new TextDecoder().decode(bytes)) as { url?: string; token?: string; name?: string };
  if (!j.url || !j.token) throw new Error(t('err.badCode'));
  return { url: j.url.replace(/\/$/, ''), token: j.token, name: j.name };
}

/** Ask a server (by HTTP base + token) who it is. */
export async function probeRuntime(url: string, tok: string): Promise<RuntimeInfo> {
  let r: Response;
  try {
    r = await fetch(`${url.replace(/\/$/, '')}/runtime/info`, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(8000) });
  } catch {
    const port = /:(\d+)/.exec(url.replace(/^https?:\/\//, ''))?.[1] ?? (url.startsWith('https') ? '443' : '80');
    throw new Error(t('err.portClosed', { port }));
  }
  if (r.status === 401) throw new Error(t('err.badToken'));
  if (!r.ok) throw new Error(t('err.noAnswer', { code: r.status }));
  return (await r.json()) as RuntimeInfo;
}

/**
 * Send one message to a server over a fresh WebSocket and wait for its answer. Used to talk to the machine
 * we are NOT connected to during a move (e.g. tell the local server to pull the bots back).
 */
export function oneShot<T extends { type: string }>(ws: string, msg: object, wantType: string, timeoutMs = 10 * 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(ws);
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error(t('err.timeout')));
    }, timeoutMs);
    sock.onopen = () => sock.send(JSON.stringify(msg));
    sock.onerror = () => {
      clearTimeout(timer);
      reject(new Error(t('err.unreachable')));
    };
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; error?: string };
      if (m.type === wantType) {
        clearTimeout(timer);
        sock.close();
        resolve(m as T);
      } else if (m.type === 'error') {
        clearTimeout(timer);
        sock.close();
        reject(new Error(m.error ?? t('err.failed')));
      }
    };
  });
}

/**
 * A stored pairing can go stale: reinstalling the machine regenerates its token, and the App then retries a
 * connection that will never succeed. The EverBot on this computer always knows where the bots are, so ask it and
 * follow. Returns true when the target changed (the caller reloads).
 */
export async function healRuntimeTarget(): Promise<boolean> {
  if (!localHttpBase) return false;
  try {
    const r = await fetch(`${localHttpBase}/runtime/target`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const t = (await r.json()) as { url?: string; token?: string; name?: string; local?: boolean };
    const cur = getRuntime();
    if (t.local) {
      if (cur.kind === 'local') return false;
      setRuntime({ kind: 'local' });
      return true;
    }
    if (!t.url || !t.token) return false;
    if (cur.kind === 'remote' && cur.url.replace(/\/$/, '') === t.url.replace(/\/$/, '') && cur.token === t.token) return false;
    setRuntime({ kind: 'remote', url: t.url.replace(/\/$/, ''), token: t.token, name: t.name, provider: 'byo' });
    return true;
  } catch {
    return false;
  }
}
