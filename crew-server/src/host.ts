import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WebSocket } from 'ws';
import type { AcpPermissionRequest } from './acp.ts';
import type { CrewStore } from './store.ts';
import type { AgentId, Integration } from './types.ts';
import { AGENTS } from './integrations.ts';

const execFileP = promisify(execFile);

/**
 * "本机转接" — the user's own computer lends its agents (Claude Code, Codex, Hermes…) to bots that run elsewhere.
 *
 * The bots may live on a cloud machine, but the agents and their logins stay on the user's computer. When the
 * local Steadbot is a signpost (its home was moved away), it dials the machine the bots moved to and offers
 * itself as an agent host. A bot's `delegate_agent` then runs on the computer, the bot's workspace travelling
 * there and back, while every permission question still goes through the bot (its autonomy, its user).
 * Computer off → the agents are simply unavailable; the bots keep doing everything else.
 *
 * Wire: one WebSocket (`/host`, same token as the App), JSON per frame. File bodies ride as base64 chunks.
 */
export interface HostAgentInfo {
  agent: AgentId;
  available: boolean;
  acp: boolean;
}

export type HostToRuntime =
  | { type: 'hello'; name: string; platform: string; agents: HostAgentInfo[] }
  | { type: 'text'; runId: string; text: string }
  | { type: 'event'; runId: string; line: string }
  | { type: 'permission'; runId: string; reqId: string; req: AcpPermissionRequest }
  | { type: 'chunk'; runId: string; data: string }
  | { type: 'done'; runId: string; output: string; stopReason: string; fresh: boolean; mode: 'acp' | 'cli'; synced: boolean; cwd: string }
  | { type: 'error'; runId: string; error: string };

export type RuntimeToHost =
  | { type: 'run'; runId: string; agent: AgentId; botId: string; task: string; fresh?: boolean; synced: boolean }
  | { type: 'chunk'; runId: string; data: string }
  | { type: 'go'; runId: string }
  | { type: 'permission_reply'; runId: string; reqId: string; optionId?: string }
  | { type: 'cancel'; runId: string }
  | { type: 'detect' };

export interface HostRunHooks {
  onText: (t: string) => void;
  onEvent: (line: string) => void;
  permission: (req: AcpPermissionRequest) => Promise<string | undefined>;
}

export interface HostRunResult {
  output: string;
  stopReason: string;
  fresh: boolean;
  mode: 'acp' | 'cli';
  /** the workspace came back from the computer (files the agent wrote are now in the bot's workspace) */
  synced: boolean;
}

/** Workspaces above this travel as text only: the agent works on an empty folder and nothing comes back. */
export const SYNC_CAP = 64 * 1024 * 1024;
const CHUNK = 384 * 1024;
const SKIP = ['node_modules', '.venv', '__pycache__', '.cache', '.DS_Store'];

/** tar+gzip a directory (skipping caches). Undefined when empty or over the cap. */
export async function packDir(dir: string): Promise<Buffer | undefined> {
  if (!existsSync(dir) || !readdirSync(dir).length) return undefined;
  if (dirSize(dir, SYNC_CAP) > SYNC_CAP) return undefined;
  const out = join(tmpdir(), `steadbot-ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.tgz`);
  try {
    await execFileP('tar', ['-czf', out, ...SKIP.map((s) => `--exclude=${s}`), '-C', dir, '.'], { maxBuffer: 1024 * 1024 });
    const buf = readFileSync(out);
    return buf.length > SYNC_CAP ? undefined : buf;
  } finally {
    rmSync(out, { force: true });
  }
}

/** Unpack over a directory: files are created or overwritten, nothing is deleted. */
export async function unpackInto(dir: string, buf: Buffer): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const tmp = join(tmpdir(), `steadbot-ws-in-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.tgz`);
  writeFileSync(tmp, buf);
  try {
    await execFileP('tar', ['-xzf', tmp, '-C', dir], { maxBuffer: 1024 * 1024 });
  } finally {
    rmSync(tmp, { force: true });
  }
}

function dirSize(dir: string, stopAt: number): number {
  let total = 0;
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP.includes(n) || total > stopAt) continue;
      const p = join(d, n);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

export function* chunksOf(buf: Buffer): Generator<string> {
  for (let i = 0; i < buf.length; i += CHUNK) yield buf.subarray(i, i + CHUNK).toString('base64');
}

export const send = (ws: WebSocket, m: HostToRuntime | RuntimeToHost) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
};

/* ---------------- runtime side: the computers that lend their agents ---------------- */

type Run = {
  hooks: HostRunHooks;
  resolve: (r: HostRunResult) => void;
  reject: (e: Error) => void;
  chunks: string[];
  cwd: string;
  timer: ReturnType<typeof setTimeout>;
};

/** One connected computer at a time (the user has one). A second connection replaces the first. */
export class AgentHosts {
  private ws: WebSocket | undefined;
  private info: { name: string; platform: string; agents: HostAgentInfo[]; since: number } | undefined;
  private runs = new Map<string, Run>();
  onChange: (() => void) | undefined;

  constructor(private store: CrewStore) {}

  /** What the App shows: which computer is lending agents right now. */
  status(): { name: string; agents: AgentId[]; since: number } | undefined {
    return this.info ? { name: this.info.name, agents: this.info.agents.filter((a) => a.available).map((a) => a.agent), since: this.info.since } : undefined;
  }

  has(agent: AgentId): HostAgentInfo | undefined {
    return this.info?.agents.find((a) => a.agent === agent && a.available);
  }

  attach(ws: WebSocket) {
    if (this.ws && this.ws !== ws) {
      const old = this.ws;
      this.ws = undefined;
      old.close(4000, 'replaced');
    }
    this.ws = ws;
    ws.on('message', (raw) => {
      let m: HostToRuntime;
      try {
        m = JSON.parse(String(raw)) as HostToRuntime;
      } catch {
        return;
      }
      this.handle(ws, m);
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.info = undefined;
      for (const [id, r] of this.runs) {
        clearTimeout(r.timer);
        r.reject(new Error('和你电脑的连接断了（Steadbot 关了或电脑睡了），这次没做完'));
        this.runs.delete(id);
      }
      this.announce();
      this.onChange?.();
    });
  }

  private handle(ws: WebSocket, m: HostToRuntime) {
    if (m.type === 'hello') {
      this.info = { name: m.name, platform: m.platform, agents: m.agents, since: this.info?.since ?? Date.now() };
      console.log(`[crew] agent host online: ${m.name} (${m.agents.filter((a) => a.available).map((a) => a.agent).join(', ') || 'no agents'})`);
      this.announce();
      this.onChange?.();
      return;
    }
    const run = this.runs.get(m.runId);
    if (!run) return;
    switch (m.type) {
      case 'text':
        run.hooks.onText(m.text);
        break;
      case 'event':
        run.hooks.onEvent(m.line);
        break;
      case 'permission':
        void run.hooks
          .permission(m.req)
          .then((optionId) => send(ws, { type: 'permission_reply', runId: m.runId, reqId: m.reqId, optionId }))
          .catch(() => send(ws, { type: 'permission_reply', runId: m.runId, reqId: m.reqId }));
        break;
      case 'chunk':
        run.chunks.push(m.data);
        break;
      case 'done': {
        this.runs.delete(m.runId);
        clearTimeout(run.timer);
        const finish = async () => {
          let synced = false;
          if (m.synced && run.chunks.length) {
            try {
              await unpackInto(run.cwd, Buffer.from(run.chunks.join(''), 'base64'));
              synced = true;
            } catch (e) {
              run.hooks.onEvent(`工作区没同步回来：${(e as Error).message}`);
            }
          }
          return { output: m.output, stopReason: m.stopReason, fresh: m.fresh, mode: m.mode, synced };
        };
        void finish().then(run.resolve, run.reject);
        break;
      }
      case 'error':
        this.runs.delete(m.runId);
        clearTimeout(run.timer);
        run.reject(new Error(m.error));
        break;
    }
  }

  /**
   * Run a task on the connected computer. The bot's workspace goes along (unless it is huge), the agent works in a
   * mirror of it on the computer, and whatever it wrote comes back into the workspace.
   */
  async run(agent: AgentId, botId: string, task: string, cwd: string, hooks: HostRunHooks, opts: { fresh?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<HostRunResult> {
    const ws = this.ws;
    if (!ws || !this.info) throw new Error('你的电脑上的 Steadbot 不在线，本机 agent 现在用不了。电脑开着、Steadbot 开着就行');
    if (!this.has(agent)) throw new Error(`你的电脑「${this.info.name}」上没有装 ${AGENTS.find((a) => a.agent === agent)?.name ?? agent}`);
    const runId = Math.random().toString(36).slice(2, 12);
    const packed = await packDir(cwd);
    if (!packed && existsSync(cwd) && readdirSync(cwd).length) hooks.onEvent(`工作区超过 ${SYNC_CAP / 1024 / 1024} MB，没有带过去；agent 在电脑上从空文件夹开始，只带回文字结果`);
    return new Promise<HostRunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.runs.delete(runId);
        send(ws, { type: 'cancel', runId });
        reject(new Error('电脑上的 agent 太久没有做完'));
      }, opts.timeoutMs ?? 30 * 60_000);
      this.runs.set(runId, { hooks, resolve, reject, chunks: [], cwd, timer });
      opts.signal?.addEventListener('abort', () => send(ws, { type: 'cancel', runId }), { once: true });
      send(ws, { type: 'run', runId, agent, botId, task, fresh: opts.fresh, synced: !!packed });
      if (packed) for (const data of chunksOf(packed)) send(ws, { type: 'chunk', runId, data });
      send(ws, { type: 'go', runId });
    });
  }

  /** Ask the computer to look again at which agents it has (after the user installed one). */
  redetect() {
    if (this.ws) send(this.ws, { type: 'detect' });
  }

  /**
   * Reflect the computer's agents onto the integration rows: an agent this machine lacks but the computer has is
   * available "经电脑转接"; when the computer goes away those rows say so, so the user knows what to do.
   */
  announce() {
    for (const spec of AGENTS) {
      const row = this.store.data.integrations.find((i) => i.kind === 'agent' && i.agent === spec.agent);
      if (!row) continue;
      if (row.available && !row.viaHost) continue; // installed right here; the computer is not needed for it
      const h = this.has(spec.agent);
      const patch: Partial<Integration> = h
        ? { available: true, acp: h.acp, status: 'ok', viaHost: this.info!.name, note: `装在你的电脑「${this.info!.name}」上 · 经它调用${h.acp ? '（ACP：流式、可见工具调用、权限确认）' : '（一次性调用）'} · 电脑开着才能用` }
        : this.info
          ? { available: false, acp: false, status: 'off', viaHost: undefined, note: `你的电脑「${this.info.name}」上没有 ${spec.bin} 命令；在电脑上装好后点「重新检测」` }
          : { available: false, acp: false, status: 'off', viaHost: undefined, note: `你的电脑不在线。电脑上开着 Steadbot，bot 就能借用电脑上的 ${spec.name}` };
      const changed = (Object.keys(patch) as (keyof Integration)[]).some((k) => row[k] !== patch[k]);
      if (changed) this.store.patchIntegration(row.id, patch);
    }
  }
}
