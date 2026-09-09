import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import type { Computer } from './types.ts';

/*
 * The bots' computer: one Linux desktop on the machine the bots run on, shared by all of them — the way a team
 * shares one workstation. One browser, one profile (so a login done once is there for every bot), one screen the
 * user watches live in the App (and can use at the same time). Each bot drives the browser through its own
 * Playwright MCP process attached to the same browser over CDP; each process keeps its own current tab, so the
 * bots work side by side in their own tabs without locking each other out. Built from open-source pieces:
 *   - TigerVNC's Xvnc: an X display that is also a VNC server (loopback only);
 *   - openbox + tint2 on that display, so it looks and behaves like a desktop;
 *   - Playwright's Chromium, headed on that display, with remote debugging on;
 *   - Playwright MCP per bot, `--cdp-endpoint` to that Chromium: navigate, read the page as an accessibility
 *     snapshot, click, type, tabs… Snapshots are text, so a model without vision drives it fine.
 * noVNC in the App renders the screen over `/vnc`. Only a Linux machine with those packages (the cloud image ships
 * them) can host it; elsewhere the tool says so and the bot falls back to fetch_url / web_search.
 */

const W = 1280;
const H = 800;
/** Idle this long with nobody watching and no tool call → the computer sleeps (its browser is ~1.4 GB of RAM). Waking takes ~10 s. */
const IDLE_MS = 30 * 60 * 1000;
/** A bot counts as "using it" for this long after its last browser call. */
const USING_MS = 2 * 60 * 1000;
const DISPLAY = 100;
const VNC_PORT = 5900 + DISPLAY;
const CDP_PORT = 9222;

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

/** Playwright's Chromium, so the dock's browser is the very one the bots drive (same profile, same logins). */
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

/**
 * The first time the shared computer starts on a machine that had one computer per bot, it takes over the browser
 * profile that was used most recently, so the logins the user already did are not lost.
 */
function inheritProfile(profile: string) {
  if (existsSync(join(profile, 'Default'))) return;
  let best: { dir: string; at: number } | undefined;
  try {
    for (const id of readdirSync(config.botsDir)) {
      const dir = join(config.botsDir, id, 'computer', 'chrome');
      if (!existsSync(join(dir, 'Default'))) continue;
      const at = statSync(dir).mtimeMs;
      if (!best || at > best.at) best = { dir, at };
    }
  } catch {
    return;
  }
  if (!best) return;
  try {
    rmSync(profile, { recursive: true, force: true });
    cpSync(best.dir, profile, { recursive: true });
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, f), { force: true });
    console.log(`[crew] computer: browser profile inherited from ${best.dir}`);
  } catch (e) {
    console.warn(`[crew] computer: could not inherit a profile: ${(e as Error).message}`);
  }
}

/** The dock: launcher entries and a tint2 config that shows them, a task list and a clock, along the bottom. */
function writeDock(home: string) {
  const apps = join(home, 'apps');
  mkdirSync(apps, { recursive: true });
  const chrome = chromiumBinary();
  // Same binary and profile as the browser the bots drive (started in boot()): Chrome hands this off to the running
  // instance as a new window, so the user and the bots share one browser and its logins.
  const browserCmd = `${chrome ?? 'x-www-browser'} --no-sandbox --user-data-dir=${join(home, 'chrome')} --no-first-run`;
  const entries: [string, string, string, string][] = [
    ['browser', '浏览器', browserCmd, 'web-browser'],
    ['files', '文件', `pcmanfm ${config.botsDir}`, 'system-file-manager'],
    ['terminal', '终端', `lxterminal --working-directory=${config.botsDir}`, 'utilities-terminal'],
  ];
  for (const [id, name, exec, icon] of entries)
    writeFileSync(join(apps, `${id}.desktop`), `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nIcon=${icon}\nTerminal=false\n`);
  const tint2rc = [
    "# generated by EverBot (desktop.ts) — the dock of the bots' computer",
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
  writeFileSync(join(home, 'README.txt'), `这是 bot 们共用的电脑。每个 bot 的文件在 ${config.botsDir}/<bot>/workspace。\n`);
}

interface Live {
  procs: ChildProcess[];
  viewers: number;
  /** bots whose browser tools are attached, with the time of their last call */
  bots: Map<string, number>;
}

export class DesktopManager {
  /** whether this machine can host a desktop at all */
  capable = false;
  capableNote = '';
  private live: Live | undefined;
  private wss = new WebSocketServer({ noServer: true });
  private sweep: ReturnType<typeof setInterval> | undefined;
  private booting: Promise<void> | undefined;
  private attaching = new Map<string, Promise<void>>();

  constructor(
    private store: CrewStore,
    private mcp: McpManager,
    private refreshTools: (botId: string) => Promise<void>,
  ) {
    mcp.onCall = (id) => {
      const botId = this.store.integration(id)?.owner;
      if (!botId || !this.live?.bots.has(botId)) return;
      this.live.bots.set(botId, Date.now());
      this.patch({ lastUsed: Date.now(), users: this.users() });
    };
  }

  async init() {
    if (platform() !== 'linux') this.capableNote = 'bot 在用户自己的电脑上跑时没有独立桌面；用户把 bot 搬到云机器后才有电脑';
    else if (!(await which('Xvnc')) || !(await which('openbox'))) this.capableNote = '这台机器上没装桌面组件（tigervnc、openbox）；用最新的安装脚本重装一次就有';
    else this.capable = true;
    // Whatever was on before this process started is gone; say so.
    if (this.store.data.computer && this.store.data.computer.state !== 'off') this.patch({ state: 'off', note: undefined, since: undefined, users: [] });
    for (const i of this.store.data.integrations) if (/^desk-/.test(i.id) && i.status !== 'off') this.store.patchIntegration(i.id, { status: 'off', note: '电脑在休眠', tools: undefined });
    this.sweep = setInterval(() => this.sweepIdle(), 60_000);
  }

  integrationId(botId: string) {
    return `desk-${botId}`;
  }

  private patch(d: Partial<Computer>) {
    this.store.setComputer(d);
  }

  private users(): string[] {
    const cutoff = Date.now() - USING_MS;
    return this.live ? [...this.live.bots.entries()].filter(([, at]) => at > cutoff).map(([id]) => id) : [];
  }

  /** The computer on (booting it if it sleeps) and this bot's browser tools attached. Idempotent. */
  async on(botId: string): Promise<{ tools: string[] }> {
    if (!this.capable) throw new Error(this.capableNote);
    if (!this.store.bot(botId)) throw new Error('bot 不存在');
    await this.wake();
    const pending = this.attaching.get(botId);
    if (pending) await pending;
    if (!this.live?.bots.has(botId)) {
      const p = this.attach(botId).finally(() => this.attaching.delete(botId));
      this.attaching.set(botId, p);
      await p;
    }
    const integ = this.store.integration(this.integrationId(botId));
    return { tools: (integ?.tools ?? []).map((t) => t.name) };
  }

  /** The computer on, nobody attached yet (the App opening the screen). Idempotent. */
  async wake() {
    if (!this.capable) throw new Error(this.capableNote);
    if (this.live) return;
    if (!this.booting) this.booting = this.boot().finally(() => (this.booting = undefined));
    await this.booting;
  }

  private async boot() {
    const home = config.computerDir;
    const profile = join(home, 'chrome');
    mkdirSync(profile, { recursive: true });
    inheritProfile(profile);
    this.patch({ state: 'starting', note: undefined, users: [] });
    const procs: ChildProcess[] = [];
    const env = { ...process.env, DISPLAY: `:${DISPLAY}`, HOME: home, XDG_RUNTIME_DIR: home };
    const run = (cmd: string, args: string[]) => {
      const p = spawn(cmd, args, { env, stdio: 'ignore', detached: false });
      p.on('error', (e) => console.warn(`[crew] computer: ${cmd} failed: ${e.message}`));
      procs.push(p);
      return p;
    };
    // The window manager and the dock are what make the screen read as a computer; tint2 in particular dies when
    // the desktop is resized (the viewer sets the resolution). Bring them back while the desktop is live.
    const keep = (cmd: string, args: string[]) => {
      const start = () => {
        const p = run(cmd, args);
        p.on('exit', (code) => {
          const l = this.live;
          if (!l || !l.procs.includes(p)) return;
          l.procs = l.procs.filter((x) => x !== p);
          console.warn(`[crew] computer: ${cmd} exited (${code ?? 'signal'}), restarting it`);
          setTimeout(() => this.live && l.procs.push(start()), 800);
        });
        return p;
      };
      return start();
    };
    try {
      run('Xvnc', [`:${DISPLAY}`, '-geometry', `${W}x${H}`, '-depth', '24', '-rfbport', String(VNC_PORT), '-SecurityTypes', 'None', '-localhost', '-AlwaysShared', '-desktop', 'EverBot 的电脑']);
      const deadline = Date.now() + 10_000;
      while (!(await portOpen(VNC_PORT))) {
        if (Date.now() > deadline) throw new Error('显示器没起来（Xvnc 10 秒内没监听）');
        await new Promise((r) => setTimeout(r, 200));
      }
      // The desktop. It has to read as a computer at a glance: a wallpaper, a window manager, and a dock with the
      // things a person expects to find — a browser, the bots' files, a terminal — all of which work for the user.
      const wall = join(home, 'wallpaper.png');
      if (!existsSync(wall)) await execP('convert', ['-size', `${W}x${H}`, 'radial-gradient:#f2f0eb-#b9b5ad', wall]).catch(() => undefined);
      run('xsetroot', ['-solid', '#c9c5bd']);
      if (existsSync(wall)) run('feh', ['--bg-fill', wall]);
      keep('openbox', []);
      writeDock(home);
      keep('tint2', ['-c', join(home, 'tint2rc')]);
      // One browser, started here and shared: every bot drives it over CDP (its own Playwright MCP attaches), and
      // the dock's browser icon opens a window in this same instance, so what the user signs into every bot has.
      // A profile lock left by a previous container (different hostname) would make Chrome refuse to start.
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, f), { force: true });
      const chrome = chromiumBinary();
      if (!chrome) throw new Error('这台机器上没有浏览器（Playwright 的 Chromium 没装上）');
      // Container + software-rendered X: no GPU (SwiftShader compositing is slower than plain CPU here), no reliance on
      // the tiny /dev/shm, no smooth scrolling (dozens of in-between frames over VNC read as lag). Maximized, so the
      // window follows the desktop when the viewer resizes it.
      run(chrome, ['--no-sandbox', `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-features=TranslateUI', '--disable-gpu', '--disable-dev-shm-usage', '--disable-smooth-scrolling', '--force-device-scale-factor=1', '--start-maximized', 'about:blank']);
      const cdpDeadline = Date.now() + 20_000;
      while (!(await portOpen(CDP_PORT))) {
        if (Date.now() > cdpDeadline) throw new Error('浏览器 20 秒内没起来');
        await new Promise((r) => setTimeout(r, 250));
      }
      this.live = { procs, viewers: 0, bots: new Map() };
      this.patch({ state: 'on', since: Date.now(), lastUsed: Date.now(), note: undefined, users: [] });
      console.log(`[crew] the computer is on (display :${DISPLAY})`);
    } catch (e) {
      for (const p of procs) p.kill();
      const note = (e as Error).message.slice(0, 160);
      this.patch({ state: 'error', note });
      console.error(`[crew] the computer failed to start: ${note}`);
      throw new Error(`电脑没开起来：${note}`);
    }
  }

  /**
   * This bot's browser tools: its own Playwright MCP process on the shared browser. Attaching over CDP, Playwright
   * adopts whatever tab happens to be first as "current" — another bot's — so the first thing done is opening a tab
   * of its own. From then on each process works in its own current tab.
   */
  private async attach(botId: string) {
    const l = this.live;
    const bot = this.store.bot(botId);
    if (!l || !bot) throw new Error('电脑没开');
    const botDir = join(config.botsDir, botId);
    mkdirSync(join(botDir, 'workspace', '_browser'), { recursive: true });
    const id = this.integrationId(botId);
    const fresh = !this.store.integration(id);
    const pw = playwrightMcp();
    const args = [...pw.args, '--cdp-endpoint', `http://127.0.0.1:${CDP_PORT}`, '--output-dir', join(botDir, 'workspace', '_browser'), '--image-responses', config.modelInfo?.vision ? 'allow' : 'omit', '--timeout-navigation', '30000'];
    // ASCII name: MCP tools are exposed to the model as `<name>__<tool>`, so this yields computer__browser_navigate etc.
    const row = { kind: 'mcp' as const, name: 'computer', transport: 'stdio' as const, command: pw.command, args, env: { DISPLAY: `:${DISPLAY}`, HOME: config.computerDir }, owner: botId, status: 'connecting' as const, note: '接上电脑…' };
    if (fresh) this.store.addIntegration({ id, ...row });
    else this.store.patchIntegration(id, row);
    if (!(bot.integrationIds ?? []).includes(id)) this.store.patchBot(botId, { integrationIds: [...(bot.integrationIds ?? []), id] }, { growth: false });
    try {
      const integ = await this.mcp.connect(id);
      if (integ?.status !== 'ok') throw new Error(`浏览器工具没起来：${integ?.note ?? '未知原因'}`);
      await this.mcp.callTool(id, 'browser_tabs', { action: 'new' });
      l.bots.set(botId, Date.now());
      await this.refreshTools(botId).catch(() => undefined);
      this.patch({ lastUsed: Date.now(), users: this.users() });
      if (fresh) this.store.grow(botId, 'connection', '用上了电脑');
      console.log(`[crew] ${bot.name} is on the computer`);
    } catch (e) {
      await this.mcp.disconnect(id).catch(() => undefined);
      this.store.patchIntegration(id, { status: 'error', note: (e as Error).message.slice(0, 160), tools: undefined });
      throw e;
    }
  }

  /**
   * Sleep: browser, desktop, display and every bot's browser tools all go; the profile (logins) stays on disk, and
   * so does a last frame of the screen, which the card keeps showing (dimmed) so the computer is still visibly
   * *there* while it sleeps.
   */
  async off(note?: string) {
    const l = this.live;
    if (l) await this.keepLastFrame();
    this.live = undefined;
    const attached = l ? [...l.bots.keys()] : [];
    for (const i of this.store.data.integrations.filter((x) => /^desk-/.test(x.id))) {
      await this.mcp.disconnect(i.id).catch(() => undefined);
      this.store.patchIntegration(i.id, { status: 'off', note: '电脑在休眠', tools: undefined });
    }
    if (l) for (const p of l.procs.slice().reverse()) p.kill();
    this.patch({ state: 'off', note, since: undefined, users: [] });
    for (const botId of attached) if (this.store.bot(botId)) await this.refreshTools(botId).catch(() => undefined);
  }

  isOn() {
    return !!this.live;
  }

  /** Whether this bot's browser tools are live right now. */
  attached(botId: string) {
    return !!this.live?.bots.has(botId);
  }

  private lastFramePath() {
    return join(config.computerDir, 'last.jpg');
  }

  private async keepLastFrame() {
    try {
      const jpeg = await execP('import', ['-display', `:${DISPLAY}`, '-window', 'root', '-resize', '640x', '-quality', '70', 'jpeg:-'], { env: { ...process.env, DISPLAY: `:${DISPLAY}` }, timeout: 5000 });
      if (jpeg.length > 0) writeFileSync(this.lastFramePath(), jpeg);
    } catch {
      /* no frame to keep; the card falls back to a dark screen */
    }
  }

  private shot: { at: number; jpeg: Promise<Buffer> } | undefined;

  /**
   * A small still of the screen for the card in the App. Far cheaper than a live stream for a thumbnail: one
   * ~30 KB JPEG every couple of seconds, shared by every viewer. The real stream only runs when the user opens it.
   */
  snapshot(width = 640): Promise<Buffer> | undefined {
    if (!this.live) {
      // Asleep: the frame it went to sleep on, if there is one.
      const last = this.lastFramePath();
      return existsSync(last) ? readFile(last) : undefined;
    }
    if (this.shot && Date.now() - this.shot.at < 2000) return this.shot.jpeg;
    const jpeg = execP('import', ['-display', `:${DISPLAY}`, '-window', 'root', '-resize', `${width}x`, '-quality', '70', 'jpeg:-'], { env: { ...process.env, DISPLAY: `:${DISPLAY}` } });
    this.shot = { at: Date.now(), jpeg };
    jpeg.catch(() => (this.shot = undefined));
    return jpeg;
  }

  /** A viewer connects over WebSocket; bytes go straight to the VNC server on the display's loopback port. */
  proxy(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const l = this.live;
    if (!l) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const tcp = tcpConnect({ host: '127.0.0.1', port: VNC_PORT });
      l.viewers++;
      this.patch({ lastUsed: Date.now() });
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
    const l = this.live;
    if (!l) return;
    const users = this.users();
    const shown = this.store.data.computer?.users ?? [];
    if (users.length !== shown.length || users.some((u) => !shown.includes(u))) this.patch({ users });
    if (l.viewers > 0) return;
    const last = this.store.data.computer?.lastUsed ?? 0;
    if (Date.now() - last > IDLE_MS) void this.off();
  }

  async stopAll() {
    if (this.sweep) clearInterval(this.sweep);
    await this.off();
  }
}
