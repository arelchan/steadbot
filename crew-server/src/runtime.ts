import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';
import { RUNNING_BUILD } from './version.ts';
import { hostname, platform, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, configPath, readFileConfig, writeConfigKeys } from './config.ts';
import type { RuntimeInfo } from './types.ts';

const execFileP = promisify(execFile);

/**
 * "Where the bots live." A crew home (`~/.crew`) is the whole state of one user's bots; the server that
 * holds the lease on it is the one place they run. This module owns: the instance identity, the lease,
 * the moved-away marker, what a client needs to know about the runtime, and moving a home to another server.
 */
export type RuntimeMode = RuntimeInfo['mode'];

const LEASE_TTL_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const leasePath = () => join(config.home, 'lease.json');
const movedPath = () => join(config.home, 'moved.json');
const instancePath = () => join(config.home, 'instance.json');

function instanceId(): string {
  try {
    const cur = JSON.parse(readFileSync(instancePath(), 'utf8')) as { id?: string };
    if (cur.id) return cur.id;
  } catch {
    /* new */
  }
  const id = `${hostname().replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24)}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(instancePath(), JSON.stringify({ id, createdAt: Date.now() }));
  return id;
}

export class Runtime {
  readonly id = instanceId();
  readonly startedAt = Date.now();
  mode: RuntimeMode = 'active';
  movedTo: string | undefined;
  /** filled in by index.ts from the host link / agent hosts (see host.ts) */
  extra: () => Pick<RuntimeInfo, 'agentHost' | 'hostLink'> = () => ({});
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Decide whether this instance may run the bots: not if the home was moved away, or another live server holds the lease. */
  claim(): RuntimeMode {
    if (existsSync(movedPath())) {
      try {
        this.movedTo = (JSON.parse(readFileSync(movedPath(), 'utf8')) as { to?: string }).to;
      } catch {
        /* keep undefined */
      }
      this.mode = 'moved';
      return this.mode;
    }
    try {
      const lease = JSON.parse(readFileSync(leasePath(), 'utf8')) as { holder?: string; ts?: number };
      if (lease.holder && lease.holder !== this.id && Date.now() - (lease.ts ?? 0) < LEASE_TTL_MS) {
        this.mode = 'standby';
        return this.mode;
      }
    } catch {
      /* no lease */
    }
    this.mode = 'active';
    this.heartbeat();
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    return this.mode;
  }

  private heartbeat() {
    try {
      writeFileSync(leasePath(), JSON.stringify({ holder: this.id, ts: Date.now(), host: hostname() }));
    } catch (e) {
      console.warn('[crew] lease heartbeat failed:', (e as Error).message);
    }
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      const lease = JSON.parse(readFileSync(leasePath(), 'utf8')) as { holder?: string };
      if (lease.holder === this.id) rmSync(leasePath(), { force: true });
    } catch {
      /* ignore */
    }
  }

  info(): RuntimeInfo {
    return {
      instanceId: this.id,
      hostname: hostname(),
      platform: platform(),
      home: config.home,
      botsDir: config.botsDir,
      serverDir: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''),
      publicUrl: config.publicUrl,
      local: !config.authToken,
      build: RUNNING_BUILD,
      desktop: platform() === 'darwin' || platform() === 'win32' || !!process.env.DISPLAY,
      mode: this.mode,
      movedTo: this.movedTo,
      version: pkgVersion(),
      startedAt: this.startedAt,
      ...this.extra(),
    };
  }

  /**
   * Pack this home for another server: everything except machine-bound files (lease, instance, moved marker,
   * this server's own port/bind/token). Model and IM credentials travel with the bots, because the bots move.
   */
  async exportArchive(): Promise<string> {
    const out = join(tmpdir(), `crew-export-${Date.now()}.tar.gz`);
    const skip = ['lease.json', 'instance.json', 'moved.json', 'machine.json', 'config.json', 'pi-agent/auth.json', 'library'];
    const entries = readdirSync(config.home).filter((n) => !skip.includes(n) && !n.startsWith('.') && !n.endsWith('.tmp'));
    // The library mirror: only what the user added travels. Skills mirrored from the bundled library (tracked in
    // .bundled.json, each carrying .source.json) are re-mirrored by the receiving server from its own copy, so
    // shipping them would only push ~20 MB over the link for nothing.
    entries.push(...userLibraryEntries());
    // config.json goes in as a stripped copy so keys and IM credentials arrive, but not port/bind/token.
    const stripped: Record<string, unknown> = { ...(readFileConfig() as Record<string, unknown>) };
    for (const k of ['port', 'bind', 'authToken', 'publicUrl', 'machine', 'movedTo']) delete stripped[k];
    const stage = join(tmpdir(), `crew-export-config-${Date.now()}`);
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, 'config.moved.json'), JSON.stringify(stripped, null, 2), { mode: 0o600 });
    await execFileP('tar', ['-czf', out, '-C', config.home, ...entries, '-C', stage, 'config.moved.json'], { maxBuffer: 1024 * 1024 });
    rmSync(stage, { recursive: true, force: true });
    return out;
  }

  /**
   * Mark this home as moved: the bots now run at `to`. This instance keeps answering as a signpost only, and — with
   * the other side's token, kept in config.json like every credential — lends this computer's agents to it (host.ts).
   */
  markMoved(to: string, token?: string, name?: string) {
    this.release();
    writeFileSync(movedPath(), JSON.stringify({ to, at: Date.now(), from: this.id }));
    this.mode = 'moved';
    this.movedTo = to;
    if (token) saveMovedTarget({ url: to, token, name });
  }

  /** Reverse of markMoved: this home is live here again. */
  static clearMoved() {
    rmSync(movedPath(), { force: true });
    saveMovedTarget(undefined);
  }

  /**
   * Unpack an archive from another server into this home. Refuses when this home already has bots unless
   * `force` (the caller has confirmed). Merges the shipped config keys into this machine's config.json,
   * keeping this machine's port, bind and token.
   */
  static async importArchive(archive: string, opts: { force?: boolean }): Promise<{ bots: number }> {
    const hasBots = existsSync(config.botsDir) && readdirSync(config.botsDir).some((n) => statSync(join(config.botsDir, n)).isDirectory());
    const hasStore = existsSync(config.dataFile);
    if ((hasBots || hasStore) && !opts.force) throw new Error('这台机器上已经有 bot 数据；确认覆盖才能继续');
    // Old state aside (kept for a manual rescue), then unpack.
    const backup = join(config.home, `.replaced-${Date.now()}`);
    mkdirSync(backup, { recursive: true });
    for (const n of readdirSync(config.home)) {
      // Machine-bound files stay; dot-entries (the incoming archive itself, earlier backups) are not state.
      if (['config.json', 'lease.json', 'instance.json', 'moved.json', 'machine.json'].includes(n) || n.startsWith('.')) continue;
      renameSync(join(config.home, n), join(backup, n));
    }
    await execFileP('tar', ['-xzf', archive, '-C', config.home], { maxBuffer: 1024 * 1024 });
    const shipped = join(config.home, 'config.moved.json');
    if (existsSync(shipped)) {
      try {
        const keys = JSON.parse(readFileSync(shipped, 'utf8')) as Record<string, unknown>;
        const flat: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(keys)) if (typeof v === 'string') flat[k] = v;
        writeConfigKeys(flat);
        // Nested objects (keys, modelInfo) aren't strings: merge them by hand.
        const cur = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(keys)) if (typeof v === 'object' && v !== null) cur[k] = { ...((cur[k] as object) ?? {}), ...(v as object) };
        writeFileSync(configPath, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
      } finally {
        rmSync(shipped, { force: true });
      }
    }
    Runtime.clearMoved();
    rmSync(leasePath(), { force: true });
    const bots = existsSync(config.botsDir) ? readdirSync(config.botsDir).filter((n) => statSync(join(config.botsDir, n)).isDirectory()).length : 0;
    return { bots };
  }
}

/** Where the bots went and how to talk to it, for the host link. config.json (mode 600) is the one credential store. */
export interface MovedTarget {
  url: string;
  token: string;
  name?: string;
}
export function saveMovedTarget(t: MovedTarget | undefined) {
  const cur = readFileConfig() as Record<string, unknown>;
  if (t) cur.movedTo = t;
  else delete cur.movedTo;
  const tmp = configPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, configPath);
}
/** The moved-to server's credentials: saved at the move, or the machine record when it is that machine. */
export function loadMovedTarget(movedTo: string | undefined): MovedTarget | undefined {
  if (!movedTo) return undefined;
  const cfg = readFileConfig() as { movedTo?: MovedTarget; machine?: { url?: string; token?: string; name?: string } };
  const same = (a?: string) => !!a && a.replace(/\/$/, '') === movedTo.replace(/\/$/, '');
  // The machine record is re-paired on every install and upgrade, so when both describe the same machine its
  // token is the fresher one; a stale `movedTo` would only get us 401s on the agent link.
  if (cfg.machine?.token && same(cfg.machine.url)) return { url: movedTo, token: cfg.machine.token, name: cfg.machine.name ?? cfg.movedTo?.name };
  if (cfg.movedTo?.token && same(cfg.movedTo.url)) return cfg.movedTo;
  return undefined;
}

/** Paths (relative to the home) of library entries the user added themselves, plus the mirror's tracking file. */
function userLibraryEntries(): string[] {
  const lib = config.libraryDir;
  if (!existsSync(lib)) return [];
  let mirrored: string[] = [];
  try {
    mirrored = JSON.parse(readFileSync(join(lib, '.bundled.json'), 'utf8')) as string[];
  } catch {
    /* none tracked */
  }
  const out: string[] = [];
  if (existsSync(join(lib, '.bundled.json'))) out.push('library/.bundled.json');
  for (const cat of readdirSync(lib)) {
    if (cat.startsWith('.') || !statSync(join(lib, cat)).isDirectory()) continue;
    for (const slug of readdirSync(join(lib, cat))) {
      const rel = `${cat}/${slug}`;
      if (mirrored.includes(rel) || existsSync(join(lib, rel, '.source.json'))) continue;
      out.push(`library/${rel}`);
    }
  }
  return out;
}

function pkgVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0';
  } catch {
    return '0';
  }
}

/** Parse a pairing code (base64url of {url, token, name}) as printed by the install script. */
export function parsePairingCode(code: string): { url: string; token: string; name?: string } {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { url?: string; token?: string; name?: string };
  if (!j.url || !j.token) throw new Error('连接码不完整');
  return { url: j.url.replace(/\/$/, ''), token: j.token, name: j.name };
}

export const archiveName = (p: string) => basename(p);
