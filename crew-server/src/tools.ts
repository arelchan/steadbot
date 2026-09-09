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

/** Installed pip distributions, by name, lower-cased (`Pillow` and `pillow` are the same thing to pip). */
async function pipInstalled(): Promise<Set<string>> {
  if (!existsSync(python)) return new Set();
  try {
    const out = await run(python, ['-c', 'import json,importlib.metadata as m;print(json.dumps(sorted({d.metadata["Name"].lower() for d in m.distributions() if d.metadata["Name"]})))'], 30_000);
    return new Set(JSON.parse(out) as string[]);
  } catch {
    return new Set();
  }
}

const npmInstalled = (name: string) => existsSync(join(nodeDir, 'node_modules', ...bare(name).split('/')));

async function hasBin(name: string): Promise<boolean> {
  try {
    await run('/bin/sh', ['-lc', `command -v ${name}`], 10_000);
    return true;
  } catch {
    return false;
  }
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
 * Make `req` available here, installing what can be installed. System binaries are not installed: on the user's own
 * computer that would be taking over their machine, and in the container they are the image's job (recorded in
 * system.json so a rebuilt machine can put them back).
 */
export async function ensure(req: Requires, forEntry: string): Promise<Ready> {
  const need = await missing(req);
  const installed = { pip: [] as string[], npm: [] as string[] };
  const errors: string[] = [];

  if (need.pip?.length) {
    await serial(async () => {
      try {
        await ensureVenv();
        const args = ['install', '--no-input', ...(config.tools.pipIndex ? ['-i', config.tools.pipIndex] : []), ...need.pip!];
        await run(join(pyBin, 'pip'), args, 15 * 60_000);
        installed.pip = need.pip!;
      } catch (e) {
        errors.push(`pip：${(e as Error).message.split('\n').slice(-1)[0].slice(0, 200)}`);
      }
    });
  }
  if (need.npm?.length) {
    await serial(async () => {
      try {
        mkdirSync(nodeDir, { recursive: true });
        if (!existsSync(join(nodeDir, 'package.json'))) writeFileSync(join(nodeDir, 'package.json'), JSON.stringify({ name: 'crew-tools', private: true }, null, 2));
        const args = ['install', '--prefix', nodeDir, '--no-audit', '--no-fund', '--omit=dev', ...(config.tools.npmRegistry ? ['--registry', config.tools.npmRegistry] : []), ...need.npm!];
        await run('npm', args, 15 * 60_000);
        installed.npm = need.npm!;
      } catch (e) {
        errors.push(`npm：${(e as Error).message.split('\n').slice(-1)[0].slice(0, 200)}`);
      }
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
  if (need.bin?.length) recordSystem(need.bin, forEntry);

  const left = await missing(req);
  const ok = !left.pip?.length && !left.npm?.length && !left.bin?.length;
  const note = ok
    ? undefined
    : [left.bin?.length ? `这台机器上没有 ${left.bin.join('、')}` : '', ...errors, left.pip?.length || left.npm?.length ? `装不上：${[...(left.pip ?? []), ...(left.npm ?? [])].join('、')}` : ''].filter(Boolean).join('；');
  return { ok, installed, missing: left, note };
}

/**
 * Command names are not package names: `soffice` comes from libreoffice, `pdftoppm` from poppler-utils. Only the
 * common ones are worth a table; anything unknown is recorded under its own name and simply reported.
 */
const APT_FOR: Record<string, string> = {
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
};

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
  const s = systemNeeds();
  const wanted = Object.keys(s.apt);
  if (!wanted.length) return;
  const gone: string[] = [];
  for (const b of wanted) if (!(await hasBin(b))) gone.push(b);
  if (!gone.length) return;
  // Only where a package manager is ours to use: the container runs as root and is rebuilt from an image, so
  // installing there is putting back what the image dropped. The user's own computer is not ours to change.
  const rootLinux = platform() === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
  if (!rootLinux) {
    console.log(`[crew] tools: 这台机器上没有 ${gone.join('、')}，需要的技能会说明缺什么`);
    return;
  }
  const pkgs = [...new Set(gone.map((b) => APT_FOR[b] ?? b))];
  console.log(`[crew] tools: 补装系统包 ${pkgs.join(', ')}…`);
  try {
    await run('/bin/sh', ['-lc', `apt-get update && apt-get install -y --no-install-recommends ${pkgs.join(' ')} && rm -rf /var/lib/apt/lists/*`], 20 * 60_000);
    console.log('[crew] tools: 系统包补装完成');
  } catch (e) {
    console.warn('[crew] tools: 系统包补装失败 —', (e as Error).message.split('\n').slice(-1)[0].slice(0, 200));
  }
}

/** One line about whether this machine can run something, for the bot's own skill list. */
export async function describe(req: Requires): Promise<string> {
  const left = await missing(req);
  const all = [...(left.pip ?? []), ...(left.npm ?? []), ...(left.bin ?? [])];
  return all.length ? `缺 ${all.join('、')}` : '就位';
}

export async function restoreTools(): Promise<void> {
  const m = manifest();
  const want = { pip: Object.keys(m.pip), npm: Object.keys(m.npm) };
  if (!want.pip.length && !want.npm.length) return;
  const gone = await missing(want);
  if (!gone.pip?.length && !gone.npm?.length) return;
  console.log(`[crew] tools: ${[...(gone.pip ?? []), ...(gone.npm ?? [])].join(', ')} 不在这台机器上，后台补装…`);
  const r = await ensure(gone, 'restore');
  console.log(r.ok ? '[crew] tools: 补装完成' : `[crew] tools: 补装未完成 — ${r.note ?? ''}`);
}

/** Everything a fresh or rebuilt machine has to put back, in the background. */
export async function restoreAll(): Promise<void> {
  await restoreSystem();
  await restoreTools();
}
