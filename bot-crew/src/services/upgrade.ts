import type { ServerMessage, UpgradeStatus, UpgradeRun, UpgradePhase } from '../types';
import { localHttpBase, localWsUrl } from './runtime';
import { getState, setState } from '../store';
import { t } from '../i18n';

/**
 * 升级. The code lives on the user's own computer, so the local Steadbot is always the one that performs an
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
      return reject(new Error(t('err.noLocalSteadbot', { why: (e as Error).message })));
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
    const timer = setTimeout(() => finish(() => reject(new Error(t('err.upgradeTimeout')))), 50 * 60_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'upgrade' }));
    ws.onmessage = (e) => {
      // 协议就是 shared 里那一份；这里曾经自己手写过一个 { type?, line? }，是四份抄写里的第四份。
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data)) as ServerMessage;
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
    ws.onerror = () => finish(() => { clearTimeout(timer); reject(new Error(t('err.localSteadbotDown'))); });
  });
}

/* ---------------- the upgrade as the whole App sees it ---------------- */

/**
 * An upgrade takes the machine away for a while — it restarts, sometimes rebuilds — so while one is running the
 * App is not a place you can do anything. It runs here rather than inside the settings window, which the user is
 * free to close, and it is drawn as a curtain over everything (UpgradeCurtain.tsx).
 *
 * What the machine prints is the only honest source of progress: these are the lines it actually writes, mapped
 * to the four things that take time.
 */
function phaseOf(line: string, now: UpgradePhase): UpgradePhase {
  if (/升级完成|装好了/.test(line)) return 'back';
  if (/重启容器|重启一下|都空下来了/.test(line)) return 'apply';
  if (/重建镜像|依赖或镜像定义变了/.test(line)) return 'apply';
  if (/忙完这一轮|还在忙/.test(line)) return 'wait';
  if (/拉取|从 GitHub 拉|拉到最新|跟着仓库走/.test(line)) return 'fetch';
  return now;
}

const put = (patch: Partial<UpgradeRun>) => {
  const cur = getState().upgrading;
  if (cur) setState({ upgrading: { ...cur, ...patch } });
};

/** Let go of the curtain: only ever after it has failed, and only because the user said so. */
export const dismissUpgrade = () => setState({ upgrading: undefined });

export async function startUpgrade(to?: string): Promise<void> {
  const cur = getState().upgrading;
  if (cur && cur.phase !== 'error') return;
  setState({ upgrading: { to, phase: 'fetch', line: '', lines: [], startedAt: Date.now() } });
  try {
    const r = await runUpgrade((line) => {
      const run = getState().upgrading;
      if (!run) return;
      setState({ upgrading: { ...run, line, lines: [...run.lines.slice(-200), line], phase: phaseOf(line, run.phase) } });
    });
    put({ phase: 'back', line: '' });
    // The machine is on its way back: the local one restarted itself, or the cloud container did. Either way the
    // only thing to do is wait for it to answer again — and then start clean, on the code that just landed.
    const back = await waitForMachine();
    if (r.restarting || back?.upToDate) {
      put({ phase: 'done' });
      setTimeout(() => window.location.reload(), 1200);
      return;
    }
    put({ phase: 'done' });
    setTimeout(() => setState({ upgrading: undefined }), 1600);
  } catch (e) {
    put({ phase: 'error', err: (e as Error).message });
  }
}

/** Poll until it answers and is no longer busy, at most five minutes (a rebuild is minutes, not seconds). */
async function waitForMachine(): Promise<UpgradeStatus | undefined> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const s = await fetchUpgradeStatus();
    if (s && !s.busy) return s;
    if (Date.now() > deadline) return s;
    await new Promise((r) => setTimeout(r, 2500));
  }
}
