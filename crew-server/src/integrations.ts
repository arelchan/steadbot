import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CrewStore } from './store.ts';
import { CHANNEL_HOWTO } from './channels.ts';
import type { AgentId, Bot, Channel, Integration } from './types.ts';
import { config } from './config.ts';
import { AcpPool, type AcpClient, type AcpPermissionRequest, type AcpUpdate } from './acp.ts';
import type { AgentHosts } from './host.ts';
import { toolsEnv } from './tools.ts';

const CHANNELS: { channel: Channel; name: string }[] = [
  { channel: 'telegram', name: 'Telegram' },
  { channel: 'feishu', name: '飞书' },
  { channel: 'wechat', name: '企业微信' },
  { channel: 'slack', name: 'Slack' },
];
/**
 * External agents a bot can delegate to. Each has a CLI one-shot form (always works if the binary is there)
 * and, preferably, an ACP launch (streaming output, tool-call visibility, permission requests routed to us,
 * a session that persists across tasks). Claude Code and Codex speak ACP through Zed's adapters.
 */
export interface AgentSpec {
  agent: AgentId;
  name: string;
  bin: string;
  /** ACP launch candidates, first available wins: a dedicated binary, or npx of the adapter package */
  acp: { command: string; args: string[]; needs?: string }[];
  cli: (task: string, cwd: string) => { command: string; args: string[] };
  loginHint: string;
}
export const AGENTS: AgentSpec[] = [
  {
    agent: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    acp: [{ command: 'claude-code-acp', args: [] }, { command: 'npx', args: ['-y', '@zed-industries/claude-code-acp'], needs: 'npx' }],
    cli: (task, cwd) => ({ command: 'claude', args: ['-p', task, '--output-format', 'text', '--permission-mode', 'acceptEdits', '--add-dir', cwd] }),
    loginHint: '在终端里运行一次 claude，按提示登录',
  },
  {
    agent: 'codex',
    name: 'Codex',
    bin: 'codex',
    acp: [{ command: 'codex-acp', args: [] }, { command: 'npx', args: ['-y', '@zed-industries/codex-acp'], needs: 'npx' }],
    cli: (task) => ({ command: 'codex', args: ['exec', '--full-auto', task] }),
    loginHint: '在终端里运行 codex login',
  },
  {
    agent: 'hermes',
    name: 'Hermes',
    bin: 'hermes',
    acp: [{ command: 'hermes', args: ['acp', '--accept-hooks'] }],
    cli: (task) => ({ command: 'hermes', args: ['chat', '-q', task, '--oneshot', '-Q'] }),
    loginHint: '在终端里运行 hermes setup 配好模型',
  },
  {
    agent: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    acp: [{ command: 'opencode', args: ['acp'] }],
    cli: (task) => ({ command: 'opencode', args: ['run', task] }),
    loginHint: '在终端里运行 opencode auth login',
  },
  {
    agent: 'openclaw',
    name: 'OpenClaw',
    bin: 'openclaw',
    acp: [{ command: 'openclaw', args: ['acp'] }],
    cli: (task) => ({ command: 'openclaw', args: ['agent', '--local', '-m', task] }),
    loginHint: '在终端里运行 openclaw login',
  },
];
export const agentSpec = (id: string | undefined) => AGENTS.find((a) => a.agent === id);

export function whichBin(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-lc', `command -v ${bin}`], { stdio: 'ignore', env: toolsEnv() });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

/** First ACP launch whose command exists on this machine (npx counts once for the adapter packages). */
export async function acpLaunch(a: AgentSpec): Promise<{ command: string; args: string[] } | undefined> {
  for (const c of a.acp) if (await whichBin(c.needs ?? c.command)) return { command: c.command, args: c.args };
  return undefined;
}

/** Built-in channel and agent entries always exist; their status reflects the machine and config. */
export async function seedIntegrations(store: CrewStore) {
  for (const c of CHANNELS) {
    // The row is the catalog entry for an IM; each bot's own account and status live on the bot (bot.im), see channels.ts.
    if (c.channel === 'app') continue;
    const existing = store.data.integrations.find((i) => i.kind === 'channel' && i.channel === c.channel);
    if (existing) store.patchIntegration(existing.id, { name: c.name, status: 'off', note: CHANNEL_HOWTO[c.channel], env: undefined });
    else store.addIntegration({ id: `ch-${c.channel}`, kind: 'channel', channel: c.channel, name: c.name, status: 'off', note: CHANNEL_HOWTO[c.channel] });
  }
  // The terminal used to be a grantable integration; it is now simply a tool every bot has.
  for (const i of store.data.integrations.filter((x) => x.kind === 'shell')) store.removeIntegration(i.id);
  for (const a of AGENTS) {
    const available = config.localAgents && (await whichBin(a.bin));
    const acp = available ? !!(await acpLaunch(a)) : false;
    const existing = store.data.integrations.find((i) => i.kind === 'agent' && i.agent === a.agent);
    // On a remote server (token-gated) the agents live on the user's computer, which lends them while its EverBot is open (host.ts).
    const note = !available
      ? config.authToken
        ? `这台机器上没有 ${a.name}。你的电脑上装了它、并开着 EverBot 时，bot 可以借用电脑上的`
        : `本机没有 ${a.bin} 命令；装好后点「重新检测」`
      : acp
        ? `本机已安装 · ACP 接入（流式、可见工具调用、权限确认、会话延续）`
        : `本机已安装 · 一次性调用（装 ACP 适配器可升级）`;
    const patch: Partial<Integration> = { available, acp, status: available ? 'ok' : 'off', note, loginHint: a.loginHint, viaHost: undefined };
    if (existing) store.patchIntegration(existing.id, patch);
    else store.addIntegration({ id: `ag-${a.agent}`, kind: 'agent', agent: a.agent, name: a.name, status: 'off', ...patch });
  }
  // Rows for agents this build no longer knows are dropped (e.g. renamed ids).
  for (const i of store.data.integrations.filter((x) => x.kind === 'agent' && x.agent !== 'custom' && !AGENTS.some((a) => a.agent === x.agent))) store.removeIntegration(i.id);
}

/** Keeps one MCP client per integration; connects lazily and republishes status/tools to the store. */
export class McpManager {
  private clients = new Map<string, Client>();
  /** observers of tool calls, e.g. a bot's computer noting it is in use */
  onCall: ((integrationId: string, tool: string) => void) | undefined;

  constructor(private store: CrewStore) {}

  async connect(id: string): Promise<Integration | undefined> {
    const integ = this.store.integration(id);
    if (!integ || integ.kind !== 'mcp' || integ.connector) return undefined;
    await this.disconnect(id);
    this.store.patchIntegration(id, { status: 'connecting', note: '连接中…' });
    try {
      const client = new Client({ name: 'crew-server', version: '0.1.0' });
      if (integ.transport === 'http') {
        if (!integ.url) throw new Error('缺少 url');
        await client.connect(new StreamableHTTPClientTransport(new URL(integ.url)));
      } else {
        if (!integ.command) throw new Error('缺少命令');
        await client.connect(new StdioClientTransport({ command: integ.command, args: integ.args ?? [], env: { ...(toolsEnv() as Record<string, string>), ...(integ.env ?? {}) }, stderr: 'ignore' }));
      }
      const { tools } = await client.listTools();
      this.clients.set(id, client);
      return this.store.patchIntegration(id, { status: 'ok', note: `${tools.length} 个工具`, tools: tools.map((t) => ({ name: t.name, description: t.description })) });
    } catch (e) {
      return this.store.patchIntegration(id, { status: 'error', note: (e as Error).message.slice(0, 160) });
    }
  }

  async disconnect(id: string) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    try {
      await c.close();
    } catch {
      /* ignore */
    }
  }

  async client(id: string): Promise<Client> {
    const c = this.clients.get(id);
    if (c) return c;
    await this.connect(id);
    const c2 = this.clients.get(id);
    if (!c2) throw new Error(`MCP「${this.store.integration(id)?.name ?? id}」未连接`);
    return c2;
  }

  async callTool(id: string, name: string, args: Record<string, unknown>) {
    const c = await this.client(id);
    this.onCall?.(id, name);
    return c.callTool({ name, arguments: args });
  }

  /** Raw JSON schema for a tool, so the bot's tool registration matches the server's contract. */
  async toolSchema(id: string, name: string): Promise<Record<string, unknown> | undefined> {
    const c = await this.client(id);
    const { tools } = await c.listTools();
    return tools.find((t) => t.name === name)?.inputSchema as Record<string, unknown> | undefined;
  }

  async dispose() {
    for (const id of Array.from(this.clients.keys())) await this.disconnect(id);
  }
}

/** The ACP adapter could not bring the agent up (initialize / session/new failed). The one-shot CLI may still say why. */
export class AcpStartError extends Error {}
export const isAcpStartFailure = (e: unknown) => e instanceof AcpStartError;

/**
 * Runs an external coding agent headlessly in the bot's workspace and returns its final text.
 * Defaults are conservative (edits allowed inside the workspace, no permission bypass); users can
 * override the CLI flags per integration via `agentArgs`.
 */
export class AgentRunner {
  workspaceFor(botId: string) {
    const dir = join(config.botsDir, botId, 'workspace');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  readonly pool = new AcpPool();
  /** The user's computer lending its agents to this (remote) runtime; set by index.ts. */
  hosts: AgentHosts | undefined;

  dispose() {
    this.pool.dispose();
  }

  /**
   * Preferred path: drive the agent over ACP. Streams text and tool calls through `hooks`, routes permission
   * requests to `hooks.permission`, keeps the session for the next task of the same bot. Falls back to nothing:
   * the caller decides whether to try the one-shot CLI instead. An agent that lives on the user's computer
   * (`integ.viaHost`) runs there over the host link, with the same hooks.
   */
  async runAcp(
    integ: Integration,
    task: string,
    cwd: string,
    hooks: { onText: (t: string) => void; onEvent: (line: string) => void; permission: (req: AcpPermissionRequest) => Promise<string | undefined> },
    signal?: AbortSignal,
    opts: { timeoutMs?: number; fresh?: boolean; botId?: string } = {},
  ): Promise<{ output: string; stopReason: string; fresh: boolean; viaHost?: string; synced?: boolean }> {
    const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
    if (integ.viaHost && integ.agent && integ.agent !== 'custom') {
      if (!this.hosts) throw new Error('这台机器不接受电脑转接');
      const r = await this.hosts.run(integ.agent, opts.botId ?? 'shared', task, cwd, hooks, { fresh: opts.fresh, signal, timeoutMs });
      return { output: r.output, stopReason: r.stopReason, fresh: r.fresh, viaHost: integ.viaHost, synced: r.synced };
    }
    const spec = agentSpec(integ.agent);
    if (!spec) throw new Error('这个 agent 没有 ACP 接法');
    if (opts.fresh) this.pool.drop(`${cwd}::${spec.agent}`);
    const launch = await acpLaunch(spec);
    if (!launch) throw new Error(`${spec.name} 的 ACP 适配器不在本机`);
    const key = `${cwd}::${spec.agent}`;
    let acquired: { client: AcpClient; sessionId: string; fresh: boolean };
    try {
      acquired = await this.pool.acquire(key, { ...launch, cwd, env: toolsEnv() });
    } catch (e) {
      const msg = (e as Error).message;
      if (/auth|login|unauthor|credential|401/i.test(msg)) throw new Error(`${spec.name} 还没登录：${spec.loginHint}（${msg.slice(0, 160)}）`);
      throw new AcpStartError(`${spec.name} 启动失败：${msg.slice(0, 300)}`);
    }
    const { client, sessionId, fresh } = acquired;
    let output = '';
    const tools = new Map<string, string>();
    client.onUpdate = (sid, raw: AcpUpdate) => {
      if (sid !== sessionId) return;
      // The union's catch-all member defeats narrowing; read the fields loosely.
      const u = raw as { sessionUpdate: string; content?: { type?: string; text?: string }; toolCallId?: string; title?: string; kind?: string; status?: string; entries?: { content: string; status: string }[] };
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && u.content.text) {
        output += u.content.text;
        hooks.onText(u.content.text);
      } else if (u.sessionUpdate === 'tool_call' && u.toolCallId) {
        tools.set(u.toolCallId, u.title ?? u.toolCallId);
        hooks.onEvent(`▸ ${u.kind ? `[${u.kind}] ` : ''}${u.title ?? u.toolCallId}`);
      } else if (u.sessionUpdate === 'tool_call_update' && u.toolCallId) {
        if (u.status === 'completed' || u.status === 'failed') hooks.onEvent(`${u.status === 'failed' ? '✘' : '✔'} ${u.title ?? tools.get(u.toolCallId) ?? u.toolCallId}`);
      } else if (u.sessionUpdate === 'plan' && u.entries) {
        hooks.onEvent(`计划：${u.entries.map((e) => `${e.status === 'completed' ? '✔' : '·'} ${e.content}`).join('；')}`);
      }
    };
    client.onPermission = hooks.permission;
    const onAbort = () => client.cancel(sessionId);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await client.prompt(sessionId, task, timeoutMs);
      const out = output.trim();
      // An agent whose model call failed often "answers" with just the error line. That is not a result: surface it
      // as a failure with the sign-in hint, so the bot tells the user instead of rephrasing and retrying.
      if (out.length < 240 && /^(HTTP\s*[45]\d\d\b|Error:|Unauthorized|Forbidden|401|403|invalid[_ ]api[_ ]key|not (logged in|authenticated)|login required|authentication (failed|required))/i.test(out)) {
        this.pool.drop(key);
        throw new Error(`${spec.name} 没法工作：${out}。多半是它自己没登录或密钥失效，${spec.loginHint}`);
      }
      return { output: out, stopReason: r.stopReason, fresh };
    } catch (e) {
      // A broken session is not worth keeping.
      this.pool.drop(key);
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      client.onUpdate = undefined;
      client.onPermission = undefined;
    }
  }

  /** One-shot CLI run (no streaming structure, no permissions, fresh process each time). */
  run(integ: Integration, task: string, cwd: string, onChunk: (text: string) => void, signal?: AbortSignal, timeoutMs = 15 * 60 * 1000): Promise<{ output: string; code: number | null }> {
    let command: string;
    let args: string[];
    const spec = agentSpec(integ.agent);
    if (spec) {
      const c = spec.cli(task, cwd);
      command = c.command;
      args = integ.agentArgs?.length ? [...integ.agentArgs, task] : c.args;
    } else {
      if (!integ.command) throw new Error('自定义 agent 缺少命令');
      command = integ.command;
      args = [...(integ.args ?? []), task];
    }
    return new Promise((resolve, reject) => {
      const p = spawn(command, args, { cwd, env: toolsEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
      signal?.addEventListener('abort', () => p.kill('SIGTERM'), { once: true });
      p.stdout.on('data', (d: Buffer) => {
        const t = d.toString();
        out += t;
        onChunk(t);
      });
      p.stderr.on('data', (d: Buffer) => {
        err += d.toString();
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ output: out.trim() || err.trim(), code });
      });
    });
  }
}

/* ---------------- permission policy for ACP agents ---------------- */

export type PermissionDecision = 'allow_once' | 'allow_always' | 'reject_once' | 'ask';

/**
 * What to do when the agent asks before a tool call. Reading, searching and fetching are always fine; edits
 * inside the bot's workspace are fine; running commands, deleting, or touching files outside the workspace is
 * the bot's autonomy level's call: a `do` bot decides itself, a `prepare`/`tell` bot asks the user.
 */
export function decidePermission(req: AcpPermissionRequest, autonomy: Bot['autonomy'], cwd: string): PermissionDecision {
  const kind = req.toolCall.kind ?? 'other';
  const root = resolve(cwd);
  const inside = (req.toolCall.locations ?? []).every((l) => {
    const p = resolve(cwd, l.path);
    return p === root || p.startsWith(root + sep);
  });
  if (['read', 'search', 'think', 'fetch', 'other'].includes(kind)) return 'allow_once';
  if (['edit', 'move'].includes(kind)) return inside || autonomy === 'do' ? 'allow_once' : 'ask';
  return autonomy === 'do' ? 'allow_once' : 'ask'; // execute, delete
}

/** The ACP option id that best matches a decision (agents differ in which option kinds they offer). */
export function pickOption(req: AcpPermissionRequest, want: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'): string | undefined {
  const exact = req.options.find((o) => o.kind === want);
  if (exact) return exact.optionId;
  const family = want.startsWith('allow') ? 'allow' : 'reject';
  return req.options.find((o) => o.kind.startsWith(family))?.optionId;
}

export const PERMISSION_LABEL: Record<string, string> = { allow_once: '允许这一次', allow_always: '允许，以后不用问', reject_once: '不允许', reject_always: '不允许，以后也别问' };
