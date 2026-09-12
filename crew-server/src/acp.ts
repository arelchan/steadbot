import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * A small Agent Client Protocol (ACP, v1) client: JSON-RPC 2.0 over the agent's stdio, one JSON object per line.
 * Enough to drive Claude Code, Codex, Hermes, OpenCode and OpenClaw the same way: initialize → session/new →
 * session/prompt, streaming `session/update` notifications back, and answering the agent's
 * `session/request_permission` requests through a policy the caller supplies.
 */
export type AcpUpdate =
  | { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk'; content: { type: string; text?: string } }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title: string; kind?: string; status?: string; locations?: { path: string }[]; rawInput?: unknown }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; title?: string; kind?: string; status?: string; content?: unknown[]; rawOutput?: unknown }
  | { sessionUpdate: 'plan'; entries: { content: string; status: string; priority?: string }[] }
  | { sessionUpdate: string; [k: string]: unknown };

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: { toolCallId: string; title: string; kind?: string; status?: string; locations?: { path: string }[]; rawInput?: unknown };
  options: { optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[];
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class AcpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  private stderr = '';
  /** Called for every session/update notification. */
  onUpdate: ((sessionId: string, update: AcpUpdate) => void) | undefined;
  /** Decides a permission request; returning undefined cancels the tool call. */
  onPermission: ((req: AcpPermissionRequest) => Promise<string | undefined>) | undefined;
  agentInfo: { name?: string; version?: string } | undefined;
  authMethods: { id: string; name: string; description?: string }[] = [];
  exited = false;
  exitCode: number | null = null;

  constructor(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
    this.proc = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d: Buffer) => this.feed(d.toString('utf8')));
    this.proc.stderr.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString('utf8')).slice(-4000);
    });
    this.proc.on('exit', (code) => {
      this.exited = true;
      this.exitCode = code;
      for (const p of this.pending.values()) p.reject(new Error(`agent 进程退出（${code ?? '?'}）${this.stderrTail()}`));
      this.pending.clear();
    });
    this.proc.on('error', (e) => {
      this.exited = true;
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });
  }

  stderrTail(): string {
    const t = this.stderr
      .split('\n')
      .filter((l) => l.trim() && !/\[INFO\]|\[DEBUG\]/.test(l))
      .slice(-3)
      .join(' | ')
      .trim();
    return t ? `：${t.slice(0, 300)}` : '';
  }

  private feed(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // agents occasionally print non-JSON to stdout; ignore
      }
      if (msg.method && msg.id !== undefined) void this.handleRequest(msg.id, msg.method, msg.params);
      else if (msg.method) this.handleNotification(msg.method, msg.params);
      else if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message}${msg.error.data ? ` ${JSON.stringify(msg.error.data).slice(0, 200)}` : ''}`));
        else p.resolve(msg.result);
      }
    }
  }

  private handleNotification(method: string, params: unknown) {
    if (method === 'session/update') {
      const p = params as { sessionId: string; update: AcpUpdate };
      this.onUpdate?.(p.sessionId, p.update);
    }
  }

  private async handleRequest(id: number, method: string, params: unknown) {
    if (method === 'session/request_permission') {
      try {
        const optionId = await this.onPermission?.(params as AcpPermissionRequest);
        this.write({ jsonrpc: '2.0', id, result: optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } } });
      } catch (e) {
        this.write({ jsonrpc: '2.0', id, error: { code: -32000, message: (e as Error).message } });
      }
      return;
    }
    // We advertise no fs / terminal capabilities; anything else the agent asks for is declined.
    this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `client does not support ${method}` } });
  }

  private write(o: unknown) {
    if (this.exited) return;
    this.proc.stdin.write(JSON.stringify(o) + '\n');
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.exited) return Promise.reject(new Error(`agent 进程已退出${this.stderrTail()}`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`${method} ${timeoutMs / 1000} 秒没有回应${this.stderrTail()}`));
          }, timeoutMs)
        : undefined;
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  async initialize(): Promise<void> {
    const r = await this.request<{ agentInfo?: { name?: string; version?: string }; authMethods?: { id: string; name: string; description?: string }[] }>(
      'initialize',
      { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'steadbot', version: '0.1' } },
      90_000,
    );
    this.agentInfo = r.agentInfo;
    this.authMethods = r.authMethods ?? [];
  }

  async newSession(cwd: string): Promise<string> {
    const r = await this.request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] }, 120_000);
    return r.sessionId;
  }

  /** One turn. Resolves with the agent's stop reason once the turn ends. */
  prompt(sessionId: string, text: string, timeoutMs: number): Promise<{ stopReason: string }> {
    return this.request<{ stopReason: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
  }

  cancel(sessionId: string) {
    this.notify('session/cancel', { sessionId });
  }

  kill() {
    if (!this.exited) this.proc.kill('SIGTERM');
  }
}

/**
 * One live agent process + session per (bot, agent), reused across delegations so follow-up tasks keep the
 * agent's context. Idle sessions are closed after a while; a dead process is replaced on next use.
 */
export class AcpPool {
  private live = new Map<string, { client: AcpClient; sessionId: string; lastUsed: number; cwd: string }>();
  private sweeper = setInterval(() => this.sweep(), 60_000);

  constructor(private idleMs = 15 * 60_000) {}

  async acquire(key: string, spawnSpec: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }): Promise<{ client: AcpClient; sessionId: string; fresh: boolean }> {
    const cur = this.live.get(key);
    if (cur && !cur.client.exited && cur.cwd === spawnSpec.cwd) {
      cur.lastUsed = Date.now();
      return { client: cur.client, sessionId: cur.sessionId, fresh: false };
    }
    if (cur) this.live.delete(key);
    const client = new AcpClient(spawnSpec.command, spawnSpec.args, { cwd: spawnSpec.cwd, env: spawnSpec.env });
    try {
      await client.initialize();
      const sessionId = await client.newSession(spawnSpec.cwd);
      this.live.set(key, { client, sessionId, lastUsed: Date.now(), cwd: spawnSpec.cwd });
      return { client, sessionId, fresh: true };
    } catch (e) {
      client.kill();
      throw e;
    }
  }

  drop(key: string) {
    const cur = this.live.get(key);
    if (cur) cur.client.kill();
    this.live.delete(key);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.live) if (v.client.exited || now - v.lastUsed > this.idleMs) this.drop(k);
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const k of [...this.live.keys()]) this.drop(k);
  }
}
