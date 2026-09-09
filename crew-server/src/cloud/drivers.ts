import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const execFileP = promisify(execFile);

/** One tenant's server, as the control plane sees it. */
export interface HomeSpec {
  id: string;
  /** localhost port the control plane proxies to */
  port: number;
  token: string;
  publicUrl: string;
}

/**
 * How tenant servers are run. `docker`: one container + one volume per tenant (production).
 * `process`: one plain `tsx` process + one directory per tenant (development, no Docker needed).
 */
export interface Driver {
  readonly kind: 'docker' | 'process';
  ensureRunning(h: HomeSpec): Promise<void>;
  stop(h: HomeSpec): Promise<void>;
  destroy(h: HomeSpec): Promise<void>;
  isRunning(h: HomeSpec): Promise<boolean>;
  /** Write a tar.gz of the tenant's whole home to `out`. */
  backup(h: HomeSpec, out: string): Promise<void>;
}

const tenantEnv = (h: HomeSpec) => ({ CREW_PORT: String(h.port), CREW_AUTH_TOKEN: h.token, CREW_PUBLIC_URL: h.publicUrl, CREW_BIND: '127.0.0.1' });

export class DockerDriver implements Driver {
  readonly kind = 'docker' as const;
  constructor(private image: string) {}
  private name = (h: HomeSpec) => `crew-${h.id}`;
  private volume = (h: HomeSpec) => `crew-${h.id}-data`;

  async isRunning(h: HomeSpec) {
    try {
      const { stdout } = await execFileP('docker', ['inspect', '-f', '{{.State.Running}}', this.name(h)]);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }
  async ensureRunning(h: HomeSpec) {
    if (await this.isRunning(h)) return;
    const exists = await execFileP('docker', ['inspect', this.name(h)]).then(() => true, () => false);
    if (exists) {
      await execFileP('docker', ['start', this.name(h)]);
      return;
    }
    await execFileP('docker', ['volume', 'create', this.volume(h)]);
    const env = { ...tenantEnv(h), CREW_BIND: '0.0.0.0' };
    await execFileP('docker', [
      'run', '-d', '--name', this.name(h), '--restart', 'unless-stopped',
      '-p', `127.0.0.1:${h.port}:5200`,
      '-v', `${this.volume(h)}:/data`,
      '--memory', '2g', '--cpus', '1',
      ...Object.entries({ ...env, CREW_PORT: '5200' }).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      this.image,
    ]);
  }
  async stop(h: HomeSpec) {
    await execFileP('docker', ['stop', this.name(h)]).catch(() => undefined);
  }
  async destroy(h: HomeSpec) {
    await execFileP('docker', ['rm', '-f', this.name(h)]).catch(() => undefined);
    await execFileP('docker', ['volume', 'rm', this.volume(h)]).catch(() => undefined);
  }
  async backup(h: HomeSpec, out: string) {
    // A throwaway container mounts the volume read-only and tars it to the host path.
    const dir = join(out, '..');
    await execFileP('docker', ['run', '--rm', '-v', `${this.volume(h)}:/data:ro`, '-v', `${dir}:/out`, 'alpine', 'tar', '-czf', `/out/${out.split('/').pop()}`, '-C', '/data', '.']);
  }
}

export class ProcessDriver implements Driver {
  readonly kind = 'process' as const;
  private procs = new Map<string, ChildProcess>();
  constructor(
    private dataRoot: string,
    private serverDir: string,
  ) {}
  private home = (h: HomeSpec) => join(this.dataRoot, 'homes', h.id);

  async isRunning(h: HomeSpec) {
    const p = this.procs.get(h.id);
    if (p && p.exitCode === null && !p.killed) return true;
    // Maybe a previous control plane left it running: probe the port.
    try {
      const r = await fetch(`http://127.0.0.1:${h.port}/health`, { signal: AbortSignal.timeout(800) });
      return r.ok;
    } catch {
      return false;
    }
  }
  async ensureRunning(h: HomeSpec) {
    if (await this.isRunning(h)) return;
    mkdirSync(this.home(h), { recursive: true });
    const child = spawn('sh', ['scripts/run.sh'], {
      cwd: this.serverDir,
      env: { ...process.env, ...tenantEnv(h), CREW_HOME: this.home(h) },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
    });
    this.procs.set(h.id, child);
    child.on('exit', () => this.procs.delete(h.id));
  }
  async stop(h: HomeSpec) {
    const p = this.procs.get(h.id);
    if (p) {
      // The supervisor shell restarts on non-zero exits: stop it first, then the server.
      p.kill('SIGTERM');
      this.procs.delete(h.id);
    }
    await execFileP('sh', ['-c', `lsof -nP -iTCP:${h.port} -sTCP:LISTEN -t | xargs kill 2>/dev/null || true`]).catch(() => undefined);
  }
  async destroy(h: HomeSpec) {
    await this.stop(h);
    rmSync(this.home(h), { recursive: true, force: true });
  }
  async backup(h: HomeSpec, out: string) {
    if (!existsSync(this.home(h))) return;
    await execFileP('tar', ['-czf', out, '-C', this.home(h), '.']);
  }
}
