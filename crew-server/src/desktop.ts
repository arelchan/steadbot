import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { connect as tcpConnect } from 'node:net';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.ts';
import type { CrewStore } from './store.ts';
import type { McpManager } from './integrations.ts';
import type { Desktop } from './types.ts';

/*
 * Every bot can have its own computer: a Linux desktop of its own on the machine the bots run on, with a
 * browser it drives and logins that stay there. The user watches the screen live in the App and can take over.
 * Built from three open-source pieces, no custom GUI stack:
 *   - TigerVNC's Xvnc: an X display that is also a VNC server (one per bot, loopback only);
 *   - openbox + tint2 on that display, so it looks and behaves like a desktop;
 *   - Playwright MCP, launched headed on that display: the bot's browser tools (navigate, read the page as an
 *     accessibility snapshot, click, type, tabs…), attached to the bot as a private MCP connection. Snapshots are
 *     text, so a model without vision drives it fine. noVNC in the App renders the screen over `/vnc/<botId>`.
 * Only a Linux machine with those packages (the cloud image ships them) can host desktops; elsewhere the tool
 * says so and the bot falls back to fetch_url / web_search.
 */

const W = 1280;
const H = 800;
/** A desktop nobody used or watched for this long powers itself off. */
const IDLE_MS = 2 * 60 * 60 * 1000;
const FIRST_DISPLAY = 100;

const which = (bin: string) =>
  new Promise<boolean>((resolve) => {
    const p = spawn('/bin/sh', ['-lc', `command -v ${bin}`], { stdio: 'ignore' });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = tcpConnect({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

function playwrightMcp(): { command: string; args: string[] } {
  try {
    const req = createRequire(import.meta.url);
    return { command: process.execPath, args: [join(dirname(req.resolve('@playwright/mcp/package.json')), 'cli.js')] };
  } catch {
    return { command: 'npx', args: ['-y', '@playwright/mcp@0.0.80'] };
  }
}

interface Live {
  display: number;
  procs: ChildProcess[];
  viewers: number;
}

export class DesktopManager {
  /** whether this machine can host desktops at all */
  capable = false;
  capableNote = '';
  private live = new Map<string, Live>();
  private wss = new WebSocketServer({ noServer: true });
  private sweep: ReturnType<typeof setInterval> | undefined;
  private starting = new Map<string, Promise<void>>();

  constructor(
    private store: CrewStore,
    private mcp: McpManager,
    private refreshTools: (botId: string) => Promise<void>,
  ) {
    mcp.onCall = (id) => {
      const botId = this.store.integration(id)?.owner;
      if (botId && this.live.has(botId)) this.patch(botId, { lastUsed: Date.now() });
    };
  }

  async init() {
    if (platform() !== 'linux') this.capableNote = 'bot 在用户自己的电脑上跑时没有独立桌面；用户把 bot 搬到云机器后你才有自己的电脑';
    else if (!(await which('Xvnc')) || !(await which('openbox'))) this.capableNote = '这台机器上没装桌面组件（tigervnc、openbox）；用最新的安装脚本重装一次就有';
    else this.capable = true;
    // Whatever was on before this process started is gone; say so.
    for (const b of this.store.data.bots) if (b.desktop && b.desktop.state !== 'off') this.patch(b.id, { state: 'off', note: undefined, since: undefined });
    this.sweep = setInterval(() => this.sweepIdle(), 60_000);
  }

  integrationId(botId: string) {
    return `desk-${botId}`;
  }

  private patch(botId: string, d: Partial<Desktop>) {
    const bot = this.store.bot(botId);
    if (!bot) return;
    this.store.patchBot(botId, { desktop: { state: 'off', ...(bot.desktop ?? {}), ...d } }, { growth: false });
  }

  private nextDisplay(): number {
    const used = new Set(Array.from(this.live.values()).map((l) => l.display));
    for (const b of this.store.data.bots) if (b.desktop?.display) used.add(b.desktop.display);
    let d = FIRST_DISPLAY;
    while (used.has(d)) d++;
    return d;
  }

  /** Power on: the display, a desktop on it, and the bot's browser tools. Idempotent. */
  async on(botId: string): Promise<{ tools: string[] }> {
    if (!this.capable) throw new Error(this.capableNote);
    const bot = this.store.bot(botId);
    if (!bot) throw new Error('bot 不存在');
    const pending = this.starting.get(botId);
    if (pending) await pending;
    if (!this.live.has(botId)) {
      const p = this.boot(botId).finally(() => this.starting.delete(botId));
      this.starting.set(botId, p);
      await p;
    }
    const integ = this.store.integration(this.integrationId(botId));
    return { tools: (integ?.tools ?? []).map((t) => t.name) };
  }

  private async boot(botId: string) {
    const bot = this.store.bot(botId)!;
    const display = bot.desktop?.display && !Array.from(this.live.values()).some((l) => l.display === bot.desktop!.display) ? bot.desktop.display : this.nextDisplay();
    const port = 5900 + display;
    const botDir = join(config.botsDir, botId);
    const home = join(botDir, 'computer');
    mkdirSync(join(home, 'chrome'), { recursive: true });
    mkdirSync(join(botDir, 'workspace', '_browser'), { recursive: true });
    this.patch(botId, { state: 'starting', display, note: undefined });
    const procs: ChildProcess[] = [];
    const env = { ...process.env, DISPLAY: `:${display}`, HOME: home, XDG_RUNTIME_DIR: home };
    const run = (cmd: string, args: string[]) => {
      const p = spawn(cmd, args, { env, stdio: 'ignore', detached: false });
      p.on('error', (e) => console.warn(`[crew] ${bot.name}'s computer: ${cmd} failed: ${e.message}`));
      procs.push(p);
      return p;
    };
    try {
      run('Xvnc', [`:${display}`, '-geometry', `${W}x${H}`, '-depth', '24', '-rfbport', String(port), '-SecurityTypes', 'None', '-localhost', '-AlwaysShared', '-desktop', `${bot.name} 的电脑`]);
      const deadline = Date.now() + 10_000;
      while (!(await portOpen(port))) {
        if (Date.now() > deadline) throw new Error('显示器没起来（Xvnc 10 秒内没监听）');
        await new Promise((r) => setTimeout(r, 200));
      }
      // The desktop: a plain dark wallpaper, a window manager, a taskbar.
      run('xsetroot', ['-solid', '#1d1f24']);
      run('openbox', []);
      run('tint2', []);
      // The bot's browser tools, headed on this display, with a profile that keeps its logins.
      const id = this.integrationId(botId);
      const pw = playwrightMcp();
      const args = [...pw.args, '--user-data-dir', join(home, 'chrome'), '--viewport-size', `${W}x${H - 80}`, '--no-sandbox', '--output-dir', join(botDir, 'workspace', '_browser'), '--image-responses', config.modelInfo?.vision ? 'allow' : 'omit', '--timeout-navigation', '30000'];
      // ASCII name: MCP tools are exposed to the model as `<name>__<tool>`, so this yields computer__browser_navigate etc.
      const row = { kind: 'mcp' as const, name: 'computer', transport: 'stdio' as const, command: pw.command, args, env: { DISPLAY: `:${display}`, HOME: home }, owner: botId, status: 'connecting' as const, note: '开机中…' };
      if (this.store.integration(id)) this.store.patchIntegration(id, row);
      else this.store.addIntegration({ id, ...row });
      if (!(bot.integrationIds ?? []).includes(id)) this.store.patchBot(botId, { integrationIds: [...(bot.integrationIds ?? []), id] }, { growth: false });
      const integ = await this.mcp.connect(id);
      if (integ?.status !== 'ok') throw new Error(`浏览器工具没起来：${integ?.note ?? '未知原因'}`);
      this.live.set(botId, { display, procs, viewers: 0 });
      await this.refreshTools(botId).catch(() => undefined);
      this.patch(botId, { state: 'on', since: Date.now(), lastUsed: Date.now(), note: undefined });
      if (!bot.desktop) this.store.grow(botId, 'connection', '有了自己的电脑');
      console.log(`[crew] ${bot.name}'s computer is on (display :${display})`);
    } catch (e) {
      for (const p of procs) p.kill();
      await this.mcp.disconnect(this.integrationId(botId));
      const note = (e as Error).message.slice(0, 160);
      this.patch(botId, { state: 'error', note });
      console.error(`[crew] ${bot.name}'s computer failed to start: ${note}`);
      throw new Error(`电脑没开起来：${note}`);
    }
  }

  /** Power off: browser, desktop, display. The profile (logins) stays on disk. */
  async off(botId: string, note?: string) {
    const l = this.live.get(botId);
    this.live.delete(botId);
    await this.mcp.disconnect(this.integrationId(botId)).catch(() => undefined);
    if (this.store.integration(this.integrationId(botId))) this.store.patchIntegration(this.integrationId(botId), { status: 'off', note: '关机了', tools: undefined });
    if (l) for (const p of l.procs.slice().reverse()) p.kill();
    if (this.store.bot(botId)) {
      this.patch(botId, { state: 'off', note, since: undefined });
      await this.refreshTools(botId).catch(() => undefined);
    }
  }

  isOn(botId: string) {
    return this.live.has(botId);
  }

  /** A viewer connects over WebSocket; bytes go straight to the VNC server on the display's loopback port. */
  proxy(botId: string, req: IncomingMessage, socket: Duplex, head: Buffer) {
    const l = this.live.get(botId);
    if (!l) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const tcp = tcpConnect({ host: '127.0.0.1', port: 5900 + l.display });
      l.viewers++;
      this.patch(botId, { lastUsed: Date.now() });
      const done = () => {
        l.viewers = Math.max(0, l.viewers - 1);
        tcp.destroy();
        if (ws.readyState === WebSocket.OPEN) ws.close();
      };
      tcp.on('data', (d) => ws.readyState === WebSocket.OPEN && ws.send(d));
      tcp.on('close', done);
      tcp.on('error', done);
      ws.on('message', (d) => tcp.write(d as Buffer));
      ws.on('close', done);
      ws.on('error', done);
    });
  }

  private sweepIdle() {
    const now = Date.now();
    for (const [botId, l] of this.live) {
      if (l.viewers > 0) continue;
      const last = this.store.bot(botId)?.desktop?.lastUsed ?? 0;
      if (now - last > IDLE_MS) void this.off(botId, '两小时没人用，自动关机了；需要时再开');
    }
  }

  async stopAll() {
    if (this.sweep) clearInterval(this.sweep);
    for (const botId of Array.from(this.live.keys())) await this.off(botId);
  }
}
