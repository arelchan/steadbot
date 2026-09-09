import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import { config } from './config.ts';
import { AGENTS, AgentRunner, acpLaunch, agentSpec, isAcpStartFailure, whichBin } from './integrations.ts';
import { chunksOf, packDir, unpackInto, send, type HostAgentInfo, type HostToRuntime, type RuntimeToHost } from './host.ts';
import type { AcpPermissionRequest } from './acp.ts';
import type { Integration } from './types.ts';

/**
 * The computer's end of 本机转接 (see host.ts): dial the machine the bots moved to, say which agents are installed
 * here, and run the tasks it sends using this computer's agents and logins. Reconnects on its own; stops when the
 * bots come back home.
 */
export class HostClient {
  private ws: WebSocket | undefined;
  private stopped = false;
  private retry = 0;
  private runs = new Map<string, { chunks: string[]; meta: Extract<RuntimeToHost, { type: 'run' }>; abort: AbortController; pending: Map<string, (optionId?: string) => void> }>();
  state: 'connecting' | 'connected' | 'off' = 'off';
  onState: ((s: HostClient['state']) => void) | undefined;

  constructor(
    private target: { url: string; token: string; name?: string },
    private workDir = join(config.home, 'host-work'),
    private runner: Pick<AgentRunner, 'runAcp' | 'run' | 'pool' | 'dispose'> = new AgentRunner(),
  ) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
    this.ws = undefined;
    for (const r of this.runs.values()) r.abort.abort();
    this.runs.clear();
    this.runner.dispose();
    this.set('off');
  }

  private set(s: HostClient['state']) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  private connect() {
    if (this.stopped) return;
    this.set('connecting');
    const url = `${this.target.url.replace(/^http/, 'ws')}/host?token=${encodeURIComponent(this.target.token)}`;
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', async () => {
      this.retry = 0;
      this.set('connected');
      console.log(`[crew] lending this computer's agents to ${this.target.name ?? this.target.url}`);
      send(ws, await this.hello());
    });
    ws.on('message', (raw) => {
      let m: RuntimeToHost;
      try {
        m = JSON.parse(String(raw)) as RuntimeToHost;
      } catch {
        return;
      }
      void this.handle(ws, m);
    });
    const gone = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      for (const r of this.runs.values()) r.abort.abort();
      this.runs.clear();
      if (this.stopped) return;
      this.set('connecting');
      const delay = Math.min(60_000, 2_000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.on('close', gone);
    ws.on('error', (e) => {
      if (this.retry === 0) console.warn(`[crew] agent host link: ${(e as Error).message}`);
      ws.close();
    });
  }

  private async hello(): Promise<HostToRuntime> {
    const agents: HostAgentInfo[] = [];
    for (const a of AGENTS) {
      const available = await whichBin(a.bin);
      agents.push({ agent: a.agent, available, acp: available ? !!(await acpLaunch(a)) : false });
    }
    return { type: 'hello', name: hostname().replace(/\.local$/, ''), platform: platform(), agents };
  }

  private async handle(ws: WebSocket, m: RuntimeToHost) {
    switch (m.type) {
      case 'detect':
        send(ws, await this.hello());
        return;
      case 'run':
        this.runs.set(m.runId, { chunks: [], meta: m, abort: new AbortController(), pending: new Map() });
        return;
      case 'chunk':
        this.runs.get(m.runId)?.chunks.push(m.data);
        return;
      case 'go': {
        const r = this.runs.get(m.runId);
        if (r) void this.execute(ws, m.runId);
        return;
      }
      case 'permission_reply': {
        const r = this.runs.get(m.runId);
        const cb = r?.pending.get(m.reqId);
        if (cb) {
          r!.pending.delete(m.reqId);
          cb(m.optionId);
        }
        return;
      }
      case 'cancel':
        this.runs.get(m.runId)?.abort.abort();
        return;
    }
  }

  private async execute(ws: WebSocket, runId: string) {
    const r = this.runs.get(runId);
    if (!r) return;
    const { meta } = r;
    const spec = agentSpec(meta.agent);
    const cwd = join(this.workDir, meta.botId);
    try {
      if (!spec) throw new Error(`不认识的 agent ${meta.agent}`);
      mkdirSync(cwd, { recursive: true });
      if (meta.synced && r.chunks.length) {
        // The bot's workspace lands over the mirror (create/overwrite, never delete) so a kept agent session keeps a
        // valid cwd; a `fresh` run starts from an empty mirror.
        if (meta.fresh) rmSync(cwd, { recursive: true, force: true });
        await unpackInto(cwd, Buffer.from(r.chunks.join(''), 'base64'));
        r.chunks = [];
      }
      const integ: Integration = { id: `host-${meta.agent}`, kind: 'agent', agent: meta.agent, name: spec.name, status: 'ok', createdAt: 0, available: true, loginHint: spec.loginHint };
      const acp = !!(await acpLaunch(spec));
      const hooks = {
        onText: (text: string) => send(ws, { type: 'text', runId, text }),
        onEvent: (line: string) => send(ws, { type: 'event', runId, line }),
        permission: (req: AcpPermissionRequest) =>
          new Promise<string | undefined>((resolve) => {
            const reqId = Math.random().toString(36).slice(2, 10);
            r.pending.set(reqId, resolve);
            r.abort.signal.addEventListener('abort', () => resolve(undefined), { once: true });
            send(ws, { type: 'permission', runId, reqId, req });
          }),
      };
      if (meta.fresh) this.runner.pool.drop(`${cwd}::${meta.agent}`);
      let result: { output: string; stopReason: string; fresh: boolean; mode: 'acp' | 'cli' } | undefined;
      if (acp) {
        try {
          const x = await this.runner.runAcp(integ, meta.task, cwd, hooks, r.abort.signal);
          result = { ...x, mode: 'acp' };
        } catch (e) {
          // The adapter could not even start the agent: the one-shot CLI usually prints the real reason (billing, login…).
          if (!isAcpStartFailure(e) || r.abort.signal.aborted) throw e;
          hooks.onEvent(`ACP 没起来（${(e as Error).message.slice(0, 120)}），改用一次性调用看看原因`);
        }
      }
      if (!result) {
        const x = await this.runner.run(integ, meta.task, cwd, hooks.onText, r.abort.signal);
        if (x.code && x.code !== 0) throw new Error(`${spec.name} 退出码 ${x.code}：${x.output.slice(-300)}`);
        result = { output: x.output, stopReason: 'end_turn', fresh: true, mode: 'cli' };
      }
      // Whatever the agent wrote goes back to the bot's workspace.
      let synced = false;
      const packed = await packDir(cwd).catch(() => undefined);
      if (packed) {
        for (const data of chunksOf(packed)) send(ws, { type: 'chunk', runId, data });
        synced = true;
      }
      send(ws, { type: 'done', runId, ...result, synced, cwd });
    } catch (e) {
      send(ws, { type: 'error', runId, error: (e as Error).message });
    } finally {
      this.runs.delete(runId);
    }
  }
}
