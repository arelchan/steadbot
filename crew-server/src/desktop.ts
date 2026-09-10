import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { connect as tcpConnect } from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.ts';
import type { CrewStore } from './store.ts';
import type { McpManager } from './integrations.ts';
import type { Computer } from './types.ts';

/*
 * The bots' computer: one, on the machine the bots run on, shared by all of them — the way a team shares one
 * workstation. One browser, one profile (so a login done once is there for every bot). Each bot drives the browser
 * through its own Playwright MCP process attached to the same browser over CDP; each process keeps its own current
 * tab, so the bots work side by side in their own tabs without locking each other out.
 *
 * Two layers, and everything a bot does lives in the second:
 *   - the **screen** the browser's window is on. On a cloud machine there is none, so one is made — TigerVNC's Xvnc
 *     (an X display that is also a VNC server), openbox + tint2 so it reads as a desktop — and the App watches it
 *     live over `/vnc`. On the user's own computer the screen is the machine's own: the window is simply there on
 *     their desktop, and the App shows a still of it instead of a stream.
 *   - the **browser**: a Chromium with its own profile and remote debugging on, plus Playwright MCP per bot with
 *     `--cdp-endpoint` to it (navigate, read the page as an accessibility snapshot, click, type, tabs…). Snapshots
 *     are text, so a model without vision drives it fine. Nothing here knows which screen it is on; the harvest,
 *     the login cards and the channel probe read pages over the same CDP port on either.
 */

// The virtual screen is a laptop, because everything on it is read by a person watching the card and by a model
// looking at screenshots: too small and web apps go into their cramped layout, too big and every operate step
// carries more pixels than it needs (a screenshot is ~1300 prompt tokens at this size).
const W = 1440;
const H = 900;
/** Idle this long with nobody watching and no tool call → the computer sleeps (its browser is ~1.4 GB of RAM). Waking takes ~10 s. */
const IDLE_MS = 30 * 60 * 1000;
/** A bot counts as "using it" for this long after its last browser call. */
const USING_MS = 2 * 60 * 1000;
/**
 * What keeps the shared computer from growing without limit. Left alone it does: every bot that touches it opens a
 * tab and leaves a node process behind, and neither was ever cleaned up — 23 pages and a browser near two gigabytes
 * on a two-core box, which is what made a Playwright client's handshake time out. So the machine holds a shape:
 * at most this many tabs, a bot's browser tools let go when it stops using them, and a browser that has grown too
 * heavy is restarted while nobody is watching (the profile — every login — is on disk and survives).
 */
const TAB_CAP = 8;
const BOT_IDLE_MS = 15 * 60 * 1000;
const CHROME_RSS_MB = 2000;
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

/**
 * The browser binary: Playwright's Chromium first (on the cloud image it is the only one, and the dock's browser
 * icon opens the very instance the bots drive), then whatever Chromium-based browser the machine has.
 */
function chromiumBinary(): string | undefined {
  const os = platform();
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (os === 'linux' ? '/ms-playwright' : os === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'ms-playwright'));
  const inside = os === 'linux' ? ['chrome-linux64/chrome', 'chrome-linux/chrome'] : os === 'darwin' ? ['chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'] : ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  try {
    for (const dir of readdirSync(pwRoot).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse())
      for (const rel of inside) {
        const bin = join(pwRoot, dir, rel);
        if (existsSync(bin)) return bin;
      }
  } catch {
    /* no Playwright browsers here */
  }
  const installed =
    os === 'linux'
      ? ['/opt/google/chrome/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
      : os === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
        : [
            join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
            join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
            join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
          ];
  for (const bin of installed) if (existsSync(bin)) return bin;
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

type Run = (cmd: string, args: string[]) => ChildProcess;

/**
 * The screen the browser window is on. Two of them exist; the rest of this file talks to this shape and does not
 * know which one it has.
 */
interface Screen {
  /** X display name, for processes on it and for the hands (gui.ts); the machine's own screen has none */
  readonly display?: string;
  /** whether the App can watch it live over /vnc */
  readonly live: boolean;
  /** why this machine cannot have this screen, or nothing if it can */
  check(): Promise<string | undefined>;
  /** bring the display up; `run` starts a process on it, `keep` one that is restarted if it dies */
  start(run: Run, keep: Run): Promise<void>;
  /** environment for processes on this screen */
  env(): NodeJS.ProcessEnv;
  /** browser flags this screen needs */
  browserArgs(): string[];
  /** a still of the whole screen, or undefined to fall back to a picture of the browser's page */
  shot(width: number): Promise<Buffer> | undefined;
}

/** A virtual X display we start ourselves, with a window manager and a dock, watchable over VNC. The cloud machine. */
function virtualScreen(): Screen {
  const display = `:${DISPLAY}`;
  return {
    display,
    live: true,
    async check() {
      if (!(await which('Xvnc')) || !(await which('openbox'))) return '这台机器上没装桌面组件（tigervnc、openbox）；用最新的安装脚本重装一次就有';
      return undefined;
    },
    env: () => ({ ...process.env, DISPLAY: display, HOME: config.computerDir, XDG_RUNTIME_DIR: config.computerDir }),
    async start(run, keep) {
      const home = config.computerDir;
      run('Xvnc', [display, '-geometry', `${W}x${H}`, '-depth', '24', '-rfbport', String(VNC_PORT), '-SecurityTypes', 'None', '-localhost', '-AlwaysShared', '-desktop', 'EverBot 的电脑']);
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
    },
    // Container + software-rendered X: no GPU (SwiftShader compositing is slower than plain CPU here), no reliance on
    // the tiny /dev/shm, no smooth scrolling (dozens of in-between frames over VNC read as lag). Maximized, so the
    // window follows the desktop when the viewer resizes it.
    browserArgs: () => ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-smooth-scrolling', '--force-device-scale-factor=1', '--start-maximized'],
    shot: (width) => execP('import', ['-display', display, '-window', 'root', '-resize', `${width}x`, '-quality', '70', 'jpeg:-'], { env: { ...process.env, DISPLAY: display }, timeout: 5000 }),
  };
}

/**
 * The machine's own screen: the bots run on the user's computer and the browser window is on their desktop. Nothing
 * to start, nothing to stream — the App shows a still of the browser's page, and 「切到窗口」 brings the window up.
 */
function ownScreen(): Screen {
  return {
    live: false,
    check: async () => undefined,
    env: () => ({ ...process.env }),
    start: async () => undefined,
    // A fresh profile on a Mac makes Chrome ask for the login keychain; the mock keychain is what Playwright uses too.
    browserArgs: () => [`--window-size=${W},${H}`, ...(platform() === 'darwin' ? ['--use-mock-keychain'] : [])],
    shot: () => undefined,
  };
}

interface Live {
  procs: ChildProcess[];
  browser: ChildProcess;
  viewers: number;
  /** bots whose browser tools are attached, with the time of their last call */
  bots: Map<string, number>;
}

export class DesktopManager {
  /** whether this machine can host a computer at all */
  capable = false;
  capableNote = '';
  private screen: Screen = platform() === 'linux' ? virtualScreen() : ownScreen();
  private browserBin: string | undefined;
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
    this.browserBin = chromiumBinary();
    const screenNote = await this.screen.check();
    if (screenNote) this.capableNote = screenNote;
    else if (!this.browserBin) this.capableNote = platform() === 'linux' ? '这台机器上没有浏览器（Playwright 的 Chromium 没装上）' : '这台电脑上没有 Chrome / Chromium / Edge，装一个就有电脑';
    else this.capable = true;
    // Whatever was on before this process started is gone; say so.
    if (this.store.data.computer && this.store.data.computer.state !== 'off') this.patch({ state: 'off', note: undefined, since: undefined, users: [] });
    for (const i of this.store.data.integrations) if (/^desk-/.test(i.id) && i.status !== 'off') this.store.patchIntegration(i.id, { status: 'off', note: '电脑在休眠', tools: undefined });
    this.sweep = setInterval(() => this.sweepIdle(), 60_000);
  }

  /** Whether the App can watch this screen live (over /vnc); otherwise it shows stills and can bring the window up. */
  get liveScreen() {
    return this.screen.live;
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

  /**
   * Force this bot's browser tools to be built again. `on` is idempotent and would keep a wedged process; this is
   * for the case where the process is there but no longer works (extensions/recover.ts).
   */
  async reattach(botId: string) {
    await this.mcp.disconnect(this.integrationId(botId)).catch(() => undefined);
    this.live?.bots.delete(botId);
    return this.on(botId);
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

  /**
   * The browser window in front of the user, on their own screen. Through the browser itself (CDP's bringToFront
   * activates the window at the OS level), so it needs no OS permission and is the same on every system — and it
   * finds *our* instance, where `open Google Chrome.app` would raise whichever Chrome the user has running.
   */
  async focus() {
    await this.wake();
    const page = await this.frontPage();
    await page.bringToFront();
  }

  private async boot() {
    const home = config.computerDir;
    const profile = join(home, 'chrome');
    mkdirSync(profile, { recursive: true });
    inheritProfile(profile);
    this.patch({ state: 'starting', note: undefined, users: [] });
    const procs: ChildProcess[] = [];
    const env = this.screen.env();
    const run: Run = (cmd, args) => {
      const p = spawn(cmd, args, { env, stdio: 'ignore', detached: false });
      p.on('error', (e) => console.warn(`[crew] computer: ${cmd} failed: ${e.message}`));
      procs.push(p);
      return p;
    };
    // The window manager and the dock are what make the screen read as a computer; tint2 in particular dies when
    // the desktop is resized (the viewer sets the resolution). Bring them back while the desktop is live.
    const keep: Run = (cmd, args) => {
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
      await this.screen.start(run, keep);
      // One browser, started here and shared: every bot drives it over CDP (its own Playwright MCP attaches), and
      // on the virtual screen the dock's browser icon opens a window in this same instance, so what the user signs
      // into every bot has. A profile lock left by a previous container (different hostname) would make Chrome
      // refuse to start.
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, f), { force: true });
      const chrome = this.browserBin;
      if (!chrome) throw new Error('这台机器上没有浏览器');
      const browser = run(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-features=TranslateUI,Translate', ...this.screen.browserArgs(), 'about:blank']);
      const cdpDeadline = Date.now() + 20_000;
      while (!(await portOpen(CDP_PORT))) {
        if (Date.now() > cdpDeadline) throw new Error('浏览器 20 秒内没起来');
        await new Promise((r) => setTimeout(r, 250));
      }
      this.live = { procs, browser, viewers: 0, bots: new Map() };
      // The port opens long before the browser is usable. Chrome brings back the session it was killed with — a
      // dozen heavy tabs (Feishu, Telegram, each with its own service and shared workers) all loading at once on a
      // two-core box — and a Playwright client has to attach to every one of those targets before it can do
      // anything. Measured on this machine: that handshake takes 0.8 s once things are quiet and blows past 30 s
      // while they are not, which is exactly the "websocket 初始化超时" the bots kept hitting. So: clean up what
      // does not need to be there, then wait until the handshake is actually fast before handing the browser out.
      await this.tidyTabs().catch(() => undefined);
      await this.settle();
      this.patch({ state: 'on', since: Date.now(), lastUsed: Date.now(), note: undefined, users: [] });
      console.log(`[crew] the computer is on (${this.screen.display ? `display ${this.screen.display}` : 'the machine\'s own screen'})`);
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
    const env: Record<string, string> = {};
    if (this.screen.display) Object.assign(env, { DISPLAY: this.screen.display, HOME: config.computerDir });
    // ASCII name: MCP tools are exposed to the model as `<name>__<tool>`, so this yields computer__browser_navigate etc.
    const row = { kind: 'mcp' as const, name: 'computer', transport: 'stdio' as const, command: pw.command, args, env, owner: botId, status: 'connecting' as const, note: '接上电脑…' };
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
    if (this.cdp) void this.cdp.then((b) => b.close()).catch(() => undefined);
    this.cdp = undefined;
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

  /** The X display while the computer is on (for the hands, gui.ts); none on a machine's own screen. */
  get display(): string | undefined {
    return this.live ? this.screen.display : undefined;
  }

  /** A bot used the screen through something other than its browser tools (the hands); keeps the computer awake. */
  touch(botId: string) {
    if (!this.live) return;
    this.live.bots.set(botId, Date.now());
    this.patch({ lastUsed: Date.now(), users: this.users() });
  }

  /**
   * Wait until connecting over CDP is quick. Every bot's browser tools do this handshake on their first call, and
   * a slow one surfaces to the model as a timeout it cannot act on.
   */
  private async settle(budgetMs = 90_000) {
    const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
    const started = Date.now();
    for (let i = 0; Date.now() - started < budgetMs; i++) {
      const t = Date.now();
      const ok = await chromium
        .connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 15_000 })
        .then(async (b) => {
          await b.close();
          return true;
        })
        .catch(() => false);
      if (ok && Date.now() - t < 5000) {
        if (i) console.log(`[crew] computer: 浏览器 ${Math.round((Date.now() - started) / 1000)} 秒后才接得动，现在可以了`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.warn('[crew] computer: 浏览器一直很慢，先放行，bot 的浏览器工具可能会超时');
  }

  /** first time each target was seen, so "the oldest ones" means something without asking Chrome */
  private seenTabs = new Map<string, number>();

  private async tabs(): Promise<{ id: string; type: string; url: string }[]> {
    return fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ id: string; type: string; url: string }[]>)
      .catch(() => []);
  }

  /**
   * Hold the browser to a size a new client can attach to quickly. Blank tabs are pure residue (one per bot per
   * attach) — keep one to land on. Past the cap, the tabs that have been sitting around longest go first.
   */
  private async tidyTabs(cap = TAB_CAP) {
    const pages = (await this.tabs()).filter((t) => t.type === 'page');
    if (!pages.length) return;
    const now = Date.now();
    for (const p of pages) if (!this.seenTabs.has(p.id)) this.seenTabs.set(p.id, now);
    for (const id of [...this.seenTabs.keys()]) if (!pages.some((p) => p.id === id)) this.seenTabs.delete(id);
    const blank = (t: { url: string }) => t.url === 'about:blank' || t.url === 'chrome://newtab/';
    const doomed = new Set(pages.filter(blank).slice(1));
    if (Number.isFinite(cap)) {
      const rest = pages.filter((p) => !doomed.has(p)).sort((a, b) => (this.seenTabs.get(a.id) ?? 0) - (this.seenTabs.get(b.id) ?? 0));
      for (const t of rest.slice(0, Math.max(0, rest.length - cap))) doomed.add(t);
    }
    for (const t of doomed) {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
      this.seenTabs.delete(t.id);
    }
    if (doomed.size) console.log(`[crew] computer: 关掉 ${doomed.size} 个标签页（还剩 ${pages.length - doomed.size} 个）`);
  }

  /**
   * How much memory the browser is holding, in MB: the process we started and everything under it (Chrome is one
   * process per tab). Counted from the tree, not by name, so the user's own browser on the same machine is not it.
   */
  private async chromeRssMb(): Promise<number> {
    const root = this.live?.browser.pid;
    if (!root) return 0;
    const procs: { pid: number; ppid: number; rssKb: number }[] = [];
    if (existsSync('/proc')) {
      for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
        try {
          const status = readFileSync(`/proc/${pid}/status`, 'utf8');
          const ppid = Number(/PPid:\s+(\d+)/.exec(status)?.[1] ?? 0);
          const rss = Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1] ?? 0);
          procs.push({ pid: Number(pid), ppid, rssKb: rss });
        } catch {
          /* the process ended while we were reading it */
        }
      }
    } else {
      const out = await execP('ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 5000 }).catch(() => Buffer.alloc(0));
      for (const line of out.toString().split('\n')) {
        const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
        if (pid) procs.push({ pid, ppid, rssKb: rss || 0 });
      }
    }
    const tree = new Set([root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of procs) if (!tree.has(p.pid) && tree.has(p.ppid)) (tree.add(p.pid), (grew = true));
    }
    return Math.round(procs.filter((p) => tree.has(p.pid)).reduce((s, p) => s + p.rssKb, 0) / 1024);
  }

  /** A bot has stopped using the computer: close its tab and let its browser process go. */
  private async release(botId: string) {
    const id = this.integrationId(botId);
    await this.mcp.callTool(id, 'browser_tabs', { action: 'close' }).catch(() => undefined);
    await this.mcp.disconnect(id).catch(() => undefined);
    this.store.patchIntegration(id, { status: 'off', note: '闲着，用的时候会自己接回来', tools: undefined });
    this.live?.bots.delete(botId);
    await this.refreshTools(botId).catch(() => undefined);
    console.log(`[crew] computer: ${this.store.bot(botId)?.name ?? botId} 十五分钟没用浏览器，先放开了`);
  }

  private cdp: Promise<import('playwright-core').Browser> | undefined;

  /** The server's own connection to the shared browser, made once and kept. */
  private async browser(): Promise<import('playwright-core').Browser> {
    if (!this.live) throw new Error('电脑没开');
    if (!this.cdp) {
      this.cdp = (async () => {
        // playwright-core is CommonJS whose entry re-exports at run time, so `import()` gives it back with nothing
        // but a default: asking for `{ chromium }` there yields undefined, and harvest died on the first real page.
        const req = createRequire(import.meta.url);
        const { chromium } = req('playwright-core') as typeof import('playwright-core');
        const b = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        b.on('disconnected', () => (this.cdp = undefined));
        return b;
      })().catch((e) => {
        this.cdp = undefined;
        throw e;
      });
    }
    return this.cdp;
  }

  /**
   * The server's own eyes on the shared browser (harvest, see index.ts): a playwright-core connection over the same
   * CDP port the bots' MCP processes use. Pages are the bots' tabs; `match` picks one by a piece of its URL or
   * title. Nothing read here goes through a model unless the caller passes it on.
   */
  async readPage<T>(match: { url?: string; title?: string }, fn: (page: import('playwright-core').Page) => Promise<T>): Promise<T> {
    const browser = await this.browser();
    const pages = browser.contexts().flatMap((c) => c.pages());
    const want = pages.filter((p) => (!match.url || p.url().includes(match.url)) && (!match.title || false));
    let picked = want;
    if (match.title) {
      const titled: typeof pages = [];
      for (const p of want.length ? want : pages) if ((await p.title().catch(() => '')).includes(match.title)) titled.push(p);
      picked = titled;
    }
    if (picked.length === 0) throw new Error(`没有匹配的标签页。现在开着的：${pages.map((p) => p.url()).join('、') || '（没有）'}`);
    if (picked.length > 1) throw new Error(`有 ${picked.length} 个标签页都匹配，url 写得更具体些：${picked.map((p) => p.url()).join('、')}`);
    return fn(picked[0]);
  }

  /** Whether this bot's browser tools are live right now. */
  attached(botId: string) {
    return !!this.live?.bots.has(botId);
  }

  private lastFramePath() {
    return join(config.computerDir, 'last.jpg');
  }

  /** The page most recently in front in the browser (Chrome lists targets most-recent first), else any page. */
  private async frontPage(): Promise<import('playwright-core').Page> {
    const front = (await this.tabs()).find((t) => t.type === 'page' && t.url !== 'about:blank' && t.url !== 'chrome://newtab/');
    const browser = await this.browser();
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = (front && pages.find((p) => p.url() === front.url)) ?? pages[0];
    if (!page) throw new Error('浏览器里没有页面');
    return page;
  }

  /** A picture of the computer: the whole screen where there is one of ours, otherwise the page in front in the browser. */
  private async frame(width: number): Promise<Buffer> {
    const whole = this.screen.shot(width);
    if (whole) return whole;
    const page = await this.frontPage();
    // Straight to CDP: Playwright's screenshot cannot scale, and a full-size frame every couple of seconds is
    // twenty times the bytes the card needs.
    // `scale` is on top of the device pixel ratio, so a Retina screen needs half of it for the same width.
    const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: Math.min(1, width / (size.width * size.dpr)) } });
      return Buffer.from(data, 'base64');
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  private async keepLastFrame() {
    try {
      const jpeg = await this.frame(640);
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
    const jpeg = this.frame(width);
    this.shot = { at: Date.now(), jpeg };
    jpeg.catch(() => (this.shot = undefined));
    return jpeg;
  }

  /** A viewer connects over WebSocket; bytes go straight to the VNC server on the display's loopback port. */
  proxy(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const l = this.live;
    if (!l || !this.screen.live) {
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
    void this.sweepShape(l).catch((e: Error) => console.warn('[crew] computer: 收拾了一半没收拾完 —', e.message));
    const users = this.users();
    const shown = this.store.data.computer?.users ?? [];
    if (users.length !== shown.length || users.some((u) => !shown.includes(u))) this.patch({ users });
    if (l.viewers > 0) return;
    const last = this.store.data.computer?.lastUsed ?? 0;
    if (Date.now() - last > IDLE_MS) void this.off();
  }

  /**
   * Every minute: let go of what nobody is using, and keep the browser inside its shape — but never while someone
   * is working. A tab cannot be traced back to the bot that opened it, so trimming during a run could close the
   * page a bot is halfway through; blank tabs are always safe, everything else waits until the screen is quiet.
   */
  private async sweepShape(l: NonNullable<typeof this.live>) {
    for (const [botId, at] of [...l.bots]) if (Date.now() - at > BOT_IDLE_MS) await this.release(botId);
    const busy = this.users().length > 0 || l.viewers > 0;
    await this.tidyTabs(busy ? Infinity : TAB_CAP);
    const mb = await this.chromeRssMb().catch(() => 0);
    if (mb <= CHROME_RSS_MB) return;
    if (busy) return void console.warn(`[crew] computer: 浏览器占了 ${mb}MB，有人在用，等它闲下来再收`);
    console.warn(`[crew] computer: 浏览器占了 ${mb}MB，收紧到 4 个标签页`);
    await this.tidyTabs(4);
    // Still heavy with nobody on it: start it over. The profile is on disk, so every login comes back.
    if ((await this.chromeRssMb().catch(() => 0)) > CHROME_RSS_MB && !l.bots.size && !l.viewers) {
      console.warn('[crew] computer: 还是太重，趁没人用重开一次浏览器');
      await this.off('浏览器占用太高，重开一次');
    }
  }

  async stopAll() {
    if (this.sweep) clearInterval(this.sweep);
    await this.off();
  }
}
