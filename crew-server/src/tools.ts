/**
 * Where the things a bot installs actually live. A skill or an MCP server is useless if its dependencies vanish on
 * the next restart, and that is exactly what happened before this file existed: pip / npm / `npx -y` wrote into the
 * container's own filesystem, outside the volume, so every rebuild wiped them.
 *
 * So: one directory under CREW_HOME (`~/.crew/tools` on the user's computer, `/data/tools` in the container), one
 * `toolsEnv()` that every spawned process inherits, and a manifest that lets a fresh machine put itself back
 * together. The manifest travels between machines; the binaries never do, because they are platform-specific.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform, arch } from 'node:os';
import { join } from 'node:path';
import { config } from './config.ts';

export const toolsDir = join(config.home, 'tools');
const pyDir = join(toolsDir, 'py');
const nodeDir = join(toolsDir, 'node');
const binDir = join(toolsDir, 'bin');
const manifestFile = join(toolsDir, 'manifest.json');
const systemFile = join(toolsDir, 'system.json');
const pyBin = join(pyDir, 'bin');
const python = join(pyBin, 'python3');

/**
 * The two dependency states the system prompt compares against. Constants rather than prose, because
 * identity.ts branches on them — the day one of these was a translated sentence, the branch silently died.
 */
export const READY = 'ready';
export const INSTALLING = 'installing';

export interface Requires {
  pip?: string[];
  npm?: string[];
  bin?: string[];
}

/** What is installed here and who asked for it, so a fresh machine can rebuild the same set. */
interface Manifest {
  platform?: string;
  pip: Record<string, { for: string[]; at: number }>;
  npm: Record<string, { for: string[]; at: number }>;
  /** names that are not real packages (a scanner reads `import png`, the distribution is `pypng`): do not keep retrying */
  failed?: Record<string, { kind: string; at: number }>;
}
interface SystemNeeds {
  /** apt package name -> which library entries need it */
  apt: Record<string, { for: string[]; at: number }>;
}

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
};
const manifest = () => readJson<Manifest>(manifestFile, { pip: {}, npm: {} });
const systemNeeds = () => readJson<SystemNeeds>(systemFile, { apt: {} });
const save = (file: string, data: unknown) => {
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
};

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 << 20, env: toolsEnv() }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr?.toString().trim() || err.message).slice(-600))) : resolve(stdout.toString()),
    );
  });

/**
 * The environment every bot-facing process runs in: its bash, the MCP servers it connects, the external agents it
 * delegates to. Without this, a package installed for a skill is invisible to the MCP server that needs it.
 */
export function toolsEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = [pyBin, join(nodeDir, 'node_modules', '.bin'), binDir, base.PATH ?? ''].filter(Boolean).join(':');
  const nodePath = [join(nodeDir, 'node_modules'), base.NODE_PATH ?? ''].filter(Boolean).join(':');
  return { ...base, PATH: path, NODE_PATH: nodePath, VIRTUAL_ENV: existsSync(python) ? pyDir : base.VIRTUAL_ENV, PIP_DISABLE_PIP_VERSION_CHECK: '1' };
}

/** npm's own name rules; anything else is a shell injection risk dressed as a package. */
const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~*>=<-]+)?$/i;
const PIP_NAME = /^[A-Za-z0-9][\w.-]*(\[[\w,-]+\])?([<>=!~]=?[\w.*-]+)?$/;
const BIN_NAME = /^[A-Za-z0-9][\w.+-]*$/;
const bare = (spec: string) => spec.replace(/^(@[^/]+\/[^@]+|[^@[<>=!~]+).*$/, '$1');

export const sanitize = (req: Requires): Requires => ({
  pip: (req.pip ?? []).filter((x) => PIP_NAME.test(x)).slice(0, 40),
  npm: (req.npm ?? []).filter((x) => NPM_NAME.test(x)).slice(0, 40),
  bin: (req.bin ?? []).filter((x) => BIN_NAME.test(x)).slice(0, 20),
});

// The system prompt asks "is this skill runnable here?" every turn; without a cache that is a Python start-up and a
// handful of `command -v` per turn, for an answer that changes only when something is installed.
let pipCache: { at: number; set: Set<string> } | undefined;
const binCache = new Map<string, { at: number; ok: boolean }>();
const CACHE_MS = 60_000;
const dropCaches = () => {
  pipCache = undefined;
  binCache.clear();
};

/** Installed pip distributions, by name, lower-cased (`Pillow` and `pillow` are the same thing to pip). */
async function pipInstalled(): Promise<Set<string>> {
  if (pipCache && Date.now() - pipCache.at < CACHE_MS) return pipCache.set;
  if (!existsSync(python)) return new Set();
  try {
    const out = await run(python, ['-c', 'import json,importlib.metadata as m;print(json.dumps(sorted({d.metadata["Name"].lower() for d in m.distributions() if d.metadata["Name"]})))'], 30_000);
    const set = new Set(JSON.parse(out) as string[]);
    pipCache = { at: Date.now(), set };
    return set;
  } catch {
    return new Set();
  }
}

const npmInstalled = (name: string) => existsSync(join(nodeDir, 'node_modules', ...bare(name).split('/')));

async function hasBin(name: string): Promise<boolean> {
  const hit = binCache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  let ok = true;
  try {
    await run('/bin/sh', ['-lc', `command -v ${name}`], 10_000);
  } catch {
    ok = false;
  }
  binCache.set(name, { at: Date.now(), ok });
  return ok;
}

/** What of this is not on this machine right now. Cheap: no installs, no network. */
export async function missing(req: Requires): Promise<Requires> {
  const r = sanitize(req);
  const pip = await pipInstalled();
  const bins: string[] = [];
  for (const b of r.bin ?? []) if (!(await hasBin(b))) bins.push(b);
  return {
    pip: (r.pip ?? []).filter((x) => !pip.has(bare(x).toLowerCase())),
    npm: (r.npm ?? []).filter((x) => !npmInstalled(x)),
    bin: bins,
  };
}

// One install at a time: pip and npm both corrupt their trees when two of them write at once.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
};

async function ensureVenv() {
  if (existsSync(python)) return;
  mkdirSync(toolsDir, { recursive: true });
  await run('python3', ['-m', 'venv', pyDir], 180_000);
}

export interface Ready {
  ok: boolean;
  installed: { pip: string[]; npm: string[] };
  missing: Requires;
  /** why it is not ok, in one line a bot can act on */
  note?: string;
}

/**
 * Make `req` available here, installing what can be installed. System binaries go through whichever package manager
 * is ours to run on this machine (installSystem) and are recorded in system.json either way, so a rebuilt or new
 * machine can put them back.
 */
const COOLDOWN = 7 * 24 * 60 * 60_000;

export async function ensure(req: Requires, forEntry: string): Promise<Ready> {
  const all = await missing(req);
  // Something that failed to install a moment ago will fail again; retrying it on every mount only burns minutes.
  const failed = manifest().failed ?? {};
  const fresh = (kind: string, n: string) => !(failed[`${kind}:${n}`] && Date.now() - failed[`${kind}:${n}`].at < COOLDOWN);
  const need: Requires = { pip: (all.pip ?? []).filter((n) => fresh('pip', n)), npm: (all.npm ?? []).filter((n) => fresh('npm', n)), bin: (all.bin ?? []).filter((n) => fresh('bin', n)) };
  const installed = { pip: [] as string[], npm: [] as string[] };
  const errors: string[] = [];

  /**
   * Install as one batch, and if that fails, one at a time. A dependency list read out of a manual always contains
   * a name or two that is not a real package (`import png` is the `pypng` distribution), and both pip and npm fail
   * the whole transaction on one bad name — so a single wrong guess would leave the bot with nothing.
   */
  const install = async (kind: 'pip' | 'npm', names: string[], one: (batch: string[]) => Promise<void>) => {
    try {
      await one(names);
      installed[kind] = names;
      return;
    } catch (e) {
      if (names.length === 1) {
        errors.push(`${kind}：${(e as Error).message.split('\n').slice(-1)[0].slice(0, 160)}`);
        return;
      }
    }
    const bad: string[] = [];
    for (const n of names) {
      try {
        await one([n]);
        installed[kind].push(n);
      } catch {
        bad.push(n);
      }
    }
    if (bad.length) {
      errors.push(`${kind} could not be installed: ${bad.join(', ')}`);
      const m = manifest();
      m.failed = { ...m.failed };
      for (const n of bad) m.failed[`${kind}:${n}`] = { kind, at: Date.now() };
      save(manifestFile, m);
    }
  };

  if (need.pip?.length) {
    await serial(async () => {
      try {
        await ensureVenv();
      } catch (e) {
        errors.push(`could not create the python environment: ${(e as Error).message.slice(0, 160)}`);
        return;
      }
      await install('pip', need.pip!, (batch) => run(join(pyBin, 'pip'), ['install', '--no-input', ...(config.tools.pipIndex ? ['-i', config.tools.pipIndex] : []), ...batch], 15 * 60_000).then(() => undefined));
    });
  }
  if (need.npm?.length) {
    await serial(async () => {
      mkdirSync(nodeDir, { recursive: true });
      if (!existsSync(join(nodeDir, 'package.json'))) writeFileSync(join(nodeDir, 'package.json'), JSON.stringify({ name: 'crew-tools', private: true }, null, 2));
      await install('npm', need.npm!, (batch) =>
        run('npm', ['install', '--prefix', nodeDir, '--no-audit', '--no-fund', '--omit=dev', ...(config.tools.npmRegistry ? ['--registry', config.tools.npmRegistry] : []), ...batch], 15 * 60_000).then(() => undefined),
      );
    });
  }
  if (installed.pip.length || installed.npm.length) {
    const m = manifest();
    m.platform = `${platform()}-${arch()}`;
    for (const [kind, names] of [['pip', installed.pip] as const, ['npm', installed.npm] as const]) {
      for (const n of names) {
        const cur = m[kind][n] ?? { for: [], at: Date.now() };
        m[kind][n] = { for: cur.for.includes(forEntry) ? cur.for : [...cur.for, forEntry], at: Date.now() };
      }
    }
    save(manifestFile, m);
  }
  if (installed.pip.length || installed.npm.length) dropCaches();
  if (need.bin?.length) {
    recordSystem(need.bin, forEntry);
    await installSystem(need.bin);
  }

  const left = await missing(req);
  const ok = !left.pip?.length && !left.npm?.length && !left.bin?.length;
  const note = ok ? undefined : [left.bin?.length ? `not on this machine: ${left.bin.join(', ')}` : '', ...errors].filter(Boolean).join('; ') || `could not install: ${[...(left.pip ?? []), ...(left.npm ?? [])].join(', ')}`;
  return { ok, installed, missing: left, note };
}

/**
 * Command names are not package names: `soffice` comes from libreoffice, `pdftoppm` from poppler-utils. Only the
 * common ones are worth a table; anything unknown is installed under its own name and, failing that, reported.
 */
const PKG_FOR: Record<string, string> = {
  soffice: 'libreoffice',
  libreoffice: 'libreoffice',
  pdftoppm: 'poppler-utils',
  pdftotext: 'poppler-utils',
  convert: 'imagemagick',
  magick: 'imagemagick',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffmpeg',
  pandoc: 'pandoc',
  git: 'git',
  rg: 'ripgrep',
  gs: 'ghostscript',
  inkscape: 'inkscape',
  chromium: 'chromium',
  tesseract: 'tesseract-ocr',
  import: 'imagemagick',
  identify: 'imagemagick',
  xdotool: 'xdotool',
  cliclick: 'cliclick',
  // what the pool's audio/video manuals reach for (ffmpeg-*, media-*)
  'yt-dlp': 'yt-dlp',
  sox: 'sox',
  exiftool: 'libimage-exiftool-perl',
  mediainfo: 'mediainfo',
};
/** Where Homebrew names differ from Debian's. */
const BREW_FOR: Record<string, string> = { 'poppler-utils': 'poppler', 'tesseract-ocr': 'tesseract', libreoffice: 'libreoffice', chromium: 'chromium', 'libimage-exiftool-perl': 'exiftool' };

/**
 * Install OS-level tools with the package manager that is ours to run here: apt as root in the container (the image
 * is rebuilt from scratch, so this is putting back what it dropped), Homebrew on a Mac (adds a tool, changes nothing
 * else). Nowhere else — returns what is still missing.
 */
export async function installSystem(bins: string[]): Promise<string[]> {
  const gone: string[] = [];
  // What failed to install a week ago will fail again (no formula, no such package): once is enough.
  const failed = manifest().failed ?? {};
  for (const b of bins) if (!(await hasBin(b)) && !(failed[`bin:${b}`] && Date.now() - failed[`bin:${b}`].at < COOLDOWN)) gone.push(b);
  if (!gone.length) return [];
  const rootLinux = platform() === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
  const brew = platform() === 'darwin' && (await hasBin('brew'));
  if (!rootLinux && !brew) {
    console.log(`[crew] tools: not on this machine: ${gone.join(', ')} — skills that need them will say so`);
    return gone;
  }
  const debs = [...new Set(gone.map((b) => PKG_FOR[b] ?? b))];
  const pkgs = brew ? debs.map((p) => BREW_FOR[p] ?? p) : debs;
  console.log(`[crew] tools: installing system packages ${pkgs.join(', ')}…`);
  try {
    // Formulae only: a command-line tool is an addition, a cask (LibreOffice, a browser) is an application on the
    // user's Mac — that stays their call, and the skill says what it is missing.
    if (brew) await run('/bin/sh', ['-lc', `HOMEBREW_NO_AUTO_UPDATE=1 brew install --formula ${pkgs.join(' ')}`], 20 * 60_000);
    else await run('/bin/sh', ['-lc', `apt-get update && apt-get install -y --no-install-recommends ${pkgs.join(' ')} && rm -rf /var/lib/apt/lists/*`], 20 * 60_000);
    console.log('[crew] tools: system packages installed');
  } catch (e) {
    console.warn('[crew] tools: system packages failed —', (e as Error).message.split('\n').slice(-1)[0].slice(0, 200));
  }
  dropCaches();
  const still: string[] = [];
  for (const b of gone) if (!(await hasBin(b))) still.push(b);
  if (still.length) {
    const m = manifest();
    m.failed = m.failed ?? {};
    for (const n of still) m.failed[`bin:${n}`] = { kind: 'bin', at: Date.now() };
    save(manifestFile, m);
  }
  return still;
}

/** Remember an OS-level dependency so a rebuilt machine can put it back. Never installs on the user's computer. */
export function recordSystem(bins: string[], forEntry: string) {
  const s = systemNeeds();
  for (const b of bins.filter((x) => BIN_NAME.test(x))) {
    const cur = s.apt[b] ?? { for: [], at: Date.now() };
    s.apt[b] = { for: cur.for.includes(forEntry) ? cur.for : [...cur.for, forEntry], at: Date.now() };
  }
  save(systemFile, s);
}

/**
 * On startup: put back everything the manifest says should be here. This is what survives a container rebuild (the
 * volume keeps the manifest, the image throws away the packages) and what makes a move to another machine work —
 * the records travel, the binaries do not.
 */
export async function restoreSystem(): Promise<void> {
  const wanted = Object.keys(systemNeeds().apt);
  if (wanted.length) await installSystem(wanted);
}

/** One line about whether this machine can run something, for the bot's own skill list. */
export async function describe(req: Requires): Promise<string> {
  const left = await missing(req);
  const all = [...(left.pip ?? []), ...(left.npm ?? []), ...(left.bin ?? [])];
  return all.length ? `missing ${all.join(', ')}` : READY;
}

export async function restoreTools(): Promise<void> {
  const m = manifest();
  const want = { pip: Object.keys(m.pip), npm: Object.keys(m.npm) };
  if (!want.pip.length && !want.npm.length) return;
  const gone = await missing(want);
  if (!gone.pip?.length && !gone.npm?.length) return;
  console.log(`[crew] tools: ${[...(gone.pip ?? []), ...(gone.npm ?? [])].join(', ')} not on this machine, installing in the background…`);
  const r = await ensure(gone, 'restore');
  console.log(r.ok ? '[crew] tools: installed' : `[crew] tools: not finished — ${r.note ?? ''}`);
}

/** Everything a fresh or rebuilt machine has to put back, in the background. */
export async function restoreAll(): Promise<void> {
  await restoreSystem();
  await restoreTools();
}
