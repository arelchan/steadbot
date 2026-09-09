import type { UpgradeStatus } from '../types';
import { localHttpBase, localWsUrl } from './runtime';

/**
 * 升级. The code lives on the user's own computer, so the local EverBot is always the one that performs an
 * upgrade — it restarts itself when the bots run here, and pushes to the machine over ssh when they don't.
 * That means this talks to localhost even while the App is pointed at a cloud runtime.
 */

const base = localHttpBase || window.location.origin;

export async function fetchUpgradeStatus(): Promise<UpgradeStatus | undefined> {
  try {
    const r = await fetch(`${base}/upgrade/status`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return undefined;
    return (await r.json()) as UpgradeStatus;
  } catch {
    return undefined;
  }
}

/** Run the upgrade, streaming the machine's own output. Resolves when it finishes (or the process restarts). */
export function runUpgrade(onLine: (line: string) => void): Promise<{ restarting: boolean }> {
  return new Promise((resolve, reject) => {
    const url = localWsUrl || `${window.location.origin.replace(/^http/, 'ws')}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(new Error(`连不上这台电脑上的 EverBot：${(e as Error).message}`));
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('升级超时了；那台机器可能还在构建，过几分钟刷新看看'))), 50 * 60_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'upgrade' }));
    ws.onmessage = (e) => {
      let m: { type?: string; line?: string; error?: string; restarting?: boolean };
      try {
        m = JSON.parse(String(e.data)) as typeof m;
      } catch {
        return;
      }
      if (m.type === 'upgrade_log' && m.line) onLine(m.line);
      if (m.type === 'error' && m.error) finish(() => { clearTimeout(timer); reject(new Error(m.error!)); });
      if (m.type === 'upgrade_done') {
        clearTimeout(timer);
        if (m.error) finish(() => reject(new Error(m.error!)));
        else finish(() => resolve({ restarting: !!m.restarting }));
      }
    };
    // The local server restarts itself mid-upgrade when the bots run here: a closed socket is the success signal.
    ws.onclose = () => finish(() => { clearTimeout(timer); resolve({ restarting: true }); });
    ws.onerror = () => finish(() => { clearTimeout(timer); reject(new Error('连不上这台电脑上的 EverBot；它可能没在跑')); });
  });
}
