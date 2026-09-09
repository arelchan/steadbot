import { EventEmitter } from 'node:events';
import { loadMachine, machineLink, pairMachine, probeMachine, uploadCode, uploadLibrary } from './machine.ts';
import type { Runtime } from './runtime.ts';
import { buildOfDisk, RUNNING_BUILD, VERSION } from './version.ts';
import type { UpgradeStatus } from './types.ts';

/*
 * One button: 升级. The code on this computer is the version of record (version.ts), so upgrading means making
 * whatever runs the bots match it.
 *   bots here      → the process restarts on the code already on disk (run.sh brings it back up);
 *   bots on a VM   → this computer pushes its code over ssh and rebuilds there, then the VM comes back.
 * Either way the user presses one thing and ends up on the new version.
 */
export class Upgrader extends EventEmitter {
  private running = false;

  constructor(
    private runtime: Runtime,
    /** ask the machine the bots moved to which build it is on (undefined when unreachable) */
    private machineBuild: () => string | undefined,
    /** stop this process so the supervisor starts it again on the new code */
    private restart: () => void,
  ) {
    super();
  }

  get busy() {
    return this.running;
  }

  status(): UpgradeStatus {
    const disk = buildOfDisk();
    const moved = this.runtime.mode === 'moved';
    const m = moved ? loadMachine() : undefined;
    const running = moved ? this.machineBuild() : RUNNING_BUILD;
    const base: UpgradeStatus = {
      target: moved ? 'machine' : 'local',
      running,
      disk,
      version: VERSION,
      upToDate: !!running && running === disk,
      machineName: m?.name,
      busy: this.running,
    };
    if (moved && !m?.password && !m?.host) base.blocked = '这台电脑上没有那台机器的登录信息，没法替它升级；在「bot 们在哪台机器上干活」里重新连一次';
    if (this.runtime.mode === 'standby') base.blocked = '另一台机器正在跑这些 bot';
    return base;
  }

  /** Bring the runtime that runs the bots up to this computer's code. Progress arrives as 'log' events. */
  async run(): Promise<{ restarting: boolean }> {
    if (this.running) throw new Error('已经在升级了');
    const st = this.status();
    if (st.blocked) throw new Error(st.blocked);
    if (st.upToDate) throw new Error('已经是最新的了');
    this.running = true;
    const log = (line: string) => this.emit('log', line);
    try {
      if (st.target === 'local') {
        log('这台电脑上的代码就是新版本，重启一下就生效。');
        // The supervisor (scripts/run.sh) starts us again; the App reconnects on its own.
        setTimeout(() => this.restart(), 400);
        return { restarting: true };
      }
      const m = loadMachine();
      if (!m) throw new Error('找不到那台机器的登录信息');
      log(`连上 ${m.name ?? m.host}…`);
      const l = machineLink();
      await l.connect();
      await uploadCode(l, log);
      await uploadLibrary(l, log);
      // Re-run the installer exactly as it was configured, so an upgrade never silently reconfigures the machine.
      const envRead = await l.exec('sudo sh -c \'echo "D=$(sed -n "s/^DOMAIN=//p" /opt/crew/crew-server/deploy/.env)"; echo "P=$(sed -n "s/^CREW_PORT=//p" /opt/crew/crew-server/deploy/.env)"\'', { timeoutMs: 20_000, pty: true });
      const lines = envRead.out.replace(/\x1b?\[[0-9;]*m/g, '').split(/\r?\n/).map((x) => x.trim());
      const domain = (lines.find((x) => x.startsWith('D=')) ?? 'D=').slice(2).trim();
      const port = (lines.find((x) => x.startsWith('P=')) ?? '').slice(2).trim() || portOf(m.url);
      log('在那台机器上重建并重启（第一次带浏览器要十几分钟）…');
      const r = await l.exec(`sudo DOMAIN='${domain}' CREW_PORT='${port}' bash /opt/crew/crew-server/deploy/install.sh 2>&1`, {
        timeoutMs: 45 * 60_000,
        pty: true,
        onLine: (line) => {
          const t = line.replace(/\x1b?\[[0-9;]*m/g, '').trim();
          // The build prints a spinner frame per 100 ms; keep the lines that say something.
          if (t && !/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(t) && !/^\[\+\]/.test(t)) log(t.slice(0, 200));
        },
      });
      if (r.timedOut) throw new Error('那台机器上的安装超时了；机器可能还在构建，过几分钟再看');
      if (r.code !== 0) throw new Error(`那台机器上的安装失败（退出码 ${r.code}）`);
      // The pairing survives an upgrade (uploadCode keeps deploy/.env), but re-read it in case it was rebuilt.
      try {
        const p = await pairMachine(l);
        log(p.reachable ? '✔ 升级完成，那台机器已经回来了' : `升级完成，但从这里访问不到 ${p.url}：${p.note ?? ''}`);
      } catch {
        const cur = loadMachine();
        const ok = cur?.url && cur.token ? (await probeMachine({ url: cur.url, token: cur.token })).reachable : false;
        log(ok ? '✔ 升级完成' : '升级完成，但还连不上那台机器，稍等一会儿再刷新');
      }
      return { restarting: false };
    } finally {
      this.running = false;
    }
  }
}

const portOf = (url?: string) => (url ? (/:(\d+)/.exec(url.replace(/^https?:\/\//, ''))?.[1] ?? '5200') : '5200');
