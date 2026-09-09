import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
/** Idle this long with nobody watching and no tool call → the computer sleeps (its browser is ~1.4 GB of RAM). Waking takes ~10 s. */
const IDLE_MS = 30 * 60 * 1000;
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

const execP = (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; maxBuffer?: number; timeout?: number } = {}) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile(cmd, args, { encoding: 'buffer', maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, env: opts.env, timeout: opts.timeout ?? 15_000 }, (err, out) => (err ? reject(err) : resolve(out as Buffer)));
  });

/** Playwright's Chromium, so the dock's browser is the very one the bot drives (same profile, same logins). */
function chromiumBinary(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright';
  try {
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse())
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const bin = join(root, dir, rel);
        if (existsSync(bin)) return bin;
      }
  } catch {
    /* no Playwright browsers here */
  }
  for (const bin of ['/opt/google/chrome/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(bin)) return bin;
  return undefined;
}

/** The dock: launcher entries and a tint2 config that shows them, a task list and a clock, along the bottom. */
function writeDock(home: string, botId: string, botDir: string) {
  const apps = join(home, 'apps');
  mkdirSync(apps, { recursive: true });
  const workspace = join(botDir, 'workspace');
  const chrome = chromiumBinary();
  // Same binary and profile as the browser the bot drives (started in boot()): Chrome hands this off to the running
  // instance as a new window, so the user and the bot share one browser and its logins.
  const browserCmd = `${chrome ?? 'x-www-browser'} --no-sandbox --user-data-dir=${join(home, 'chrome')} --no-first-run`;
  const entries: [string, string, string, string][] = [
    ['browser', '浏览器', browserCmd, 'web-browser'],
    ['files', '文件', `pcmanfm ${workspace}`, 'system-file-manager'],
    ['terminal', '终端', `lxterminal --working-directory=${workspace}`, 'utilities-terminal'],
  ];
  for (const [id, name, exec, icon] of entries)
    writeFileSync(join(apps, `${id}.desktop`), `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nIcon=${icon}\nTerminal=false\n`);
  const tint2rc = [
    '# generated by EverBot (desktop.ts) — the dock of a bot\'s computer',
    'panel_items = LTSC',
    'panel_size = 46% 56',
    'panel_position = bottom center horizontal',
    'panel_margin = 0 10',
    'panel_background_id = 1',
    'panel_padding = 12 6 12',
    'font_shadow = 0',
    'rounded = 16',
    'border_width = 0',
    'background_color = #1c1c1e 72',
    'border_color = #000000 0',
    'launcher_padding = 6 4 12',
    'launcher_icon_size = 38',
    'launcher_icon_theme = Adwaita',
    'launcher_icon_theme_override = 1',
    'launcher_tooltip = 1',
    ...entries.map(([id]) => `launcher_item_app = ${join(apps, `${id}.desktop`)}`),
    'taskbar_mode = single_desktop',
    'taskbar_padding = 8 4 6',
    'task_icon = 1',
    'task_text = 1',
    'task_maximum_size = 180 36',
    'task_font = Noto Sans CJK SC 9',
    'task_font_color = #f2f2f2 100',
    'task_active_background_id = 2',
    'rounded = 8',
    'background_color = #ffffff 18',
    'border_color = #ffffff 0',
    'systray = 0',
    'time1_format = %H:%M',
    'time1_font = Noto Sans CJK SC 10',
    'time2_format = %m月%d日 %a',
    'time2_font = Noto Sans CJK SC 8',
    'clock_font_color = #f2f2f2 100',
    'clock_padding = 10 4',
    '',
  ].join('\n');
  writeFileSync(join(home, 'tint2rc'), tint2rc);
  writeFileSync(join(home, 'README.txt'), `这是 bot ${botId} 的电脑。它的文件在 ${workspace}。\n`);
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
      // The desktop. It has to read as a computer at a glance: a wallpaper, a window manager, and a dock with the
      // things a person expects to find — a browser, the bot's files, a terminal — all of which work when the
      // user takes over. The browser launcher opens the same profile the bot uses, so logins are shared.
      const wall = join(home, 'wallpaper.png');
      if (!existsSync(wall)) await execP('convert', ['-size', `${W}x${H}`, 'radial-gradient:#f2f0eb-#b9b5ad', wall]).catch(() => undefined);
      run('xsetroot', ['-solid', '#c9c5bd']);
      if (existsSync(wall)) run('feh', ['--bg-fill', wall]);
      run('openbox', []);
      writeDock(home, botId, botDir);
      run('tint2', ['-c', join(home, 'tint2rc')]);
      // One browser per computer, started here and shared: the bot drives it over CDP (Playwright MCP attaches),
      // and the dock's browser icon opens a window in this same instance, so what the user signs into the bot has.
      // A profile lock left by a previous container (different hostname) would make Chrome refuse to start.
      const profile = join(home, 'chrome');
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, f), { force: true });
      const chrome = chromiumBinary();
      if (!chrome) throw new Error('这台机器上没有浏览器（Playwright 的 Chromium 没装上）');
      const cdp = 9222 + (display - FIRST_DISPLAY);
      run(chrome, ['--no-sandbox', `--user-data-dir=${profile}`, `--remote-debugging-port=${cdp}`, '--no-first-run', '--no-default-browser-check', '--disable-features=TranslateUI', `--window-size=${W - 80},${H - 120}`, '--window-position=40,20', 'about:blank']);
      const cdpDeadline = Date.now() + 20_000;
      while (!(await portOpen(cdp))) {
        if (Date.now() > cdpDeadline) throw new Error('浏览器 20 秒内没起来');
        await new Promise((r) => setTimeout(r, 250));
      }
      // The bot's browser tools, attached to that browser.
      const id = this.integrationId(botId);
      const pw = playwrightMcp();
      const args = [...pw.args, '--cdp-endpoint', `http://127.0.0.1:${cdp}`, '--output-dir', join(botDir, 'workspace', '_browser'), '--image-responses', config.modelInfo?.vision ? 'allow' : 'omit', '--timeout-navigation', '30000'];
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

  /**
   * Sleep: browser, desktop, display all go; the profile (logins) stays on disk, and so does a last frame of the
   * screen, which the card keeps showing (dimmed) so the computer is still visibly *there* while it sleeps.
   */
  async off(botId: string, note?: string) {
    const l = this.live.get(botId);
    if (l) await this.keepLastFrame(botId, l.display);
    this.live.delete(botId);
    await this.mcp.disconnect(this.integrationId(botId)).catch(() => undefined);
    if (this.store.integration(this.integrationId(botId))) this.store.patchIntegration(this.integrationId(botId), { status: 'off', note: '电脑在休眠', tools: undefined });
    if (l) for (const p of l.procs.slice().reverse()) p.kill();
    if (this.store.bot(botId)) {
      this.patch(botId, { state: 'off', note, since: undefined });
      await this.refreshTools(botId).catch(() => undefined);
    }
  }

  isOn(botId: string) {
    return this.live.has(botId);
  }

  private lastFramePath(botId: string) {
    return join(config.botsDir, botId, 'computer', 'last.jpg');
  }

  private async keepLastFrame(botId: string, display: number) {
    try {
      const jpeg = await execP('import', ['-display', `:${display}`, '-window', 'root', '-resize', '640x', '-quality', '70', 'jpeg:-'], { env: { ...process.env, DISPLAY: `:${display}` }, timeout: 5000 });
      if (jpeg.length > 0) writeFileSync(this.lastFramePath(botId), jpeg);
    } catch {
      /* no frame to keep; the card falls back to a dark screen */
    }
  }

  private shots = new Map<string, { at: number; jpeg: Promise<Buffer> }>();

  /**
   * A small still of the screen for the card in the App. Far cheaper than a live stream for a thumbnail: one
   * ~30 KB JPEG every couple of seconds, shared by every viewer. The real stream only runs when the user opens it.
   */
  snapshot(botId: string, width = 640): Promise<Buffer> | undefined {
    const l = this.live.get(botId);
    if (!l) {
      // Asleep: the frame it went to sleep on, if there is one.
      const last = this.lastFramePath(botId);
      return existsSync(last) ? readFile(last) : undefined;
    }
    const cached = this.shots.get(botId);
    if (cached && Date.now() - cached.at < 2000) return cached.jpeg;
    const jpeg = execP('import', ['-display', `:${l.display}`, '-window', 'root', '-resize', `${width}x`, '-quality', '70', 'jpeg:-'], { env: { ...process.env, DISPLAY: `:${l.display}` } });
    this.shots.set(botId, { at: Date.now(), jpeg });
    jpeg.catch(() => this.shots.delete(botId));
    return jpeg;
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
      if (now - last > IDLE_MS) void this.off(botId);
    }
  }

  async stopAll() {
    if (this.sweep) clearInterval(this.sweep);
    for (const botId of Array.from(this.live.keys())) await this.off(botId);
  }
}
