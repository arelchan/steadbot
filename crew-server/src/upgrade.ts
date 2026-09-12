import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadMachine, machineLink, pairMachine, probeMachine, type MachineLink } from './machine.ts';
import type { Runtime } from './runtime.ts';
import { BRANCH, REPO, RUNNING_BUILD, currentCommit, hasGit, isDirty, latestCommit, syncTags, versionName, VERSION } from './version.ts';
import type { UpgradeStatus } from './types.ts';

const execFileP = promisify(execFile);
const repoDir = join(fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''), '..');
const REMOTE = `git@github.com:${REPO}.git`;
const CHECKOUT = '/opt/crew';
const KEY = '/opt/crew/.deploy-key';

/*
 * 升级：the product is a git repository, so a version is a commit and upgrading is a fetch.
 *   bots here    → pull, then restart on the new code;
 *   bots on a VM → that machine pulls the same commit itself (it talks to GitHub directly, which is fast), then
 *                  either restarts the container (code-only change: seconds) or rebuilds the image (deps changed).
 * The machine reads the repository through a read-only deploy key it generates itself; nothing else is stored there.
 */
export class Upgrader extends EventEmitter {
  private running = false;
  /** newest commit on the branch, refreshed in the background */
  latest: string | undefined;

  constructor(
    private runtime: Runtime,
    /** the commit the machine the bots moved to is on (undefined when unreachable) */
    private machineBuild: () => string | undefined,
    /** stop this process so the supervisor starts it again on the new code */
    private restart: () => void,
    /** bots mid-turn here (the local target); a restart waits for them */
    private busyBots: () => string[] = () => [],
  ) {
    super();
  }

  get busy() {
    return this.running;
  }

  async refreshLatest(): Promise<string | undefined> {
    syncTags();
    const l = await latestCommit();
    if (l) this.latest = l;
    return this.latest;
  }

  status(): UpgradeStatus {
    const moved = this.runtime.mode === 'moved';
    const m = moved ? loadMachine() : undefined;
    const running = moved ? this.machineBuild() : RUNNING_BUILD;
    const dirty = isDirty();
    const st: UpgradeStatus = {
      target: moved ? 'machine' : 'local',
      running,
      latest: this.latest,
      runningName: versionName(running),
      latestName: versionName(this.latest),
      version: VERSION,
      repo: REPO,
      branch: BRANCH,
      dirty,
      upToDate: !!running && !!this.latest && running === this.latest,
      machineName: m?.name,
      busy: this.running,
    };
    if (!hasGit()) st.blocked = '这台电脑上的 Steadbot 不是从 git 仓库装的；重新 clone 一份再用，升级才有来源';
    else if (moved && !m?.host) st.blocked = '这台电脑上没有那台机器的登录信息，没法替它升级；在「云电脑」里重新连一次';
    else if (this.runtime.mode === 'standby') st.blocked = '另一台机器正在跑这些 bot';
    else if (dirty && !moved) st.blocked = '这台电脑上有没提交的改动，先提交或撤销再升级';
    return st;
  }

  /** Bring the runtime that runs the bots up to the newest commit. Progress arrives as 'log' events. */
  async run(): Promise<{ restarting: boolean }> {
    if (this.running) throw new Error('已经在升级了');
    await this.refreshLatest();
    const st = this.status();
    if (st.blocked) throw new Error(st.blocked);
    if (!st.latest) throw new Error('连不上 GitHub，看不到有没有新版本');
    if (st.upToDate) throw new Error('已经是最新的了');
    this.running = true;
    const log = (line: string) => this.emit('log', line);
    try {
      if (st.target === 'local') {
        log(`拉取 ${REPO} 的 ${BRANCH}…`);
        const out = await execFileP('git', ['pull', '--ff-only', 'origin', BRANCH], { cwd: repoDir, timeout: 120_000 }).catch((e: Error) => {
          throw new Error(`拉取失败：${e.message.split('\n').slice(-2).join(' ').slice(0, 160)}`);
        });
        log(out.stdout.trim().split('\n').slice(-3).join('\n') || '已经拉到最新');
        log(`现在是 ${currentCommit() ?? '?'}，重启一下就生效。`);
        await waitIdle(log, async () => this.busyBots());
        setTimeout(() => this.restart(), 400);
        return { restarting: true };
      }
      const m = loadMachine();
      if (!m) throw new Error('找不到那台机器的登录信息');
      log(`连上 ${m.name ?? m.host}…`);
      const l = machineLink();
      await l.connect();
      await ensureCheckout(l, log);
      const changed = await pullOnMachine(l, st.latest, log);
      // The restart cuts off whatever a bot is in the middle of; let them finish the turn first.
      await waitIdle(log, async () => (m.url && m.token ? ((await probeMachine({ url: m.url, token: m.token })).busy ?? []) : []));
      await applyOnMachine(l, changed, log);
      try {
        const p = await pairMachine(l);
        log(p.reachable ? '✔ 升级完成' : `升级完成，但从这里访问不到 ${p.url}：${p.note ?? ''}`);
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

const sh = (v: string) => `'${v.split("'").join(`'\\''`)}'`;
/** Run as root, falling back to an interactive sudo when the passwordless one is refused. */
const root = (l: MachineLink, script: string, timeoutMs = 120_000) =>
  l.exec(`sudo -n sh -c ${sh(script)} 2>&1 || sudo sh -c ${sh(script)} 2>&1`, { timeoutMs, pty: true });

const clean = (s: string) => s.replace(/\x1b?\[[0-9;]*m/g, '');

/**
 * Make /opt/crew a checkout of the repository, converting the plain directory an older install left there.
 * Reading uses a deploy key the machine generates: it never leaves the machine and cannot write.
 */
async function ensureCheckout(l: MachineLink, log: (s: string) => void) {
  const probe = await root(l, `command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git); test -d ${CHECKOUT}/.git && echo HASREPO || echo NOREPO`, 300_000);
  if (clean(probe.out).includes('HASREPO')) return;
  log('把那台机器接到仓库上（第一次要装一个只读部署密钥）…');
  const key = await root(
    l,
    `mkdir -p /root/.ssh && chmod 700 /root/.ssh; test -f ${KEY} || ssh-keygen -q -t ed25519 -f ${KEY} -N '' -C steadbot-deploy; chmod 600 ${KEY}; ` +
      `ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null; sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts 2>/dev/null; ` +
      `echo KEY=$(cat ${KEY}.pub)`,
  );
  const pub = /KEY=(ssh-ed25519 \S+(?: [^\r\n]*)?)/.exec(clean(key.out))?.[1]?.trim();
  if (!pub) throw new Error('那台机器上没能生成部署密钥');
  await addDeployKey(pub, l.m.name ?? l.m.host);
  const init = await root(
    l,
    `cd ${CHECKOUT} && (git init -q 2>/dev/null; true) && (git remote remove origin 2>/dev/null; true) && git remote add origin ${REMOTE} && ` +
      `GIT_SSH_COMMAND='ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git fetch -q --depth 50 origin ${BRANCH} && ` +
      `git checkout -q -f -B ${BRANCH} origin/${BRANCH} && echo DONE`,
    600_000,
  );
  if (!clean(init.out).includes('DONE')) throw new Error(`那台机器上没能拉到仓库：${clean(init.out).trim().slice(-240)}`);
  log('✔ 那台机器现在跟着仓库走了');
}

/** Register a read-only deploy key on the repository, ignoring one that is already registered. */
async function addDeployKey(pub: string, title: string) {
  try {
    await execFileP('gh', ['api', `repos/${REPO}/keys`, '--method', 'POST', '-f', `title=steadbot · ${title}`, '-f', `key=${pub}`, '-F', 'read_only=true'], { timeout: 30_000 });
  } catch (e) {
    const err = ((e as { stderr?: string }).stderr ?? (e as Error).message) || '';
    // Re-running an upgrade re-offers the same key; GitHub rejects the duplicate, which is exactly what we want.
    if (/already in use|already exists|key is already/i.test(err)) return;
    throw new Error(`登记部署密钥失败：${err.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 160) ?? err.slice(0, 160)}（需要这台电脑上的 gh 已登录且有仓库权限）`);
  }
}

/** Fetch and check out the newest commit; returns the paths that changed. */
/** Hold until no bot is mid-turn (polling every few seconds), at most ten minutes; says who it is waiting for. */
async function waitIdle(log: (s: string) => void, busy: () => Promise<string[]>) {
  const deadline = Date.now() + 10 * 60_000;
  let said = '';
  for (;;) {
    const names = await busy().catch(() => [] as string[]);
    if (!names.length) {
      if (said) log('都空下来了，重启。');
      return;
    }
    if (Date.now() > deadline) {
      log(`等了十分钟 ${names.join('、')} 还在忙，不等了。`);
      return;
    }
    const line = `等 ${names.join('、')} 忙完这一轮再重启…`;
    if (line !== said) log((said = line));
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function pullOnMachine(l: MachineLink, want: string, log: (s: string) => void): Promise<string[]> {
  log(`那台机器直接从 GitHub 拉 ${want}…`);
  const r = await root(
    l,
    `cd ${CHECKOUT} && GIT_SSH_COMMAND='ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git fetch -q --depth 50 origin ${BRANCH} && ` +
      `echo "WAS=$(git rev-parse --short=12 HEAD 2>/dev/null || echo none)" && git checkout -q -f -B ${BRANCH} origin/${BRANCH} && ` +
      `echo "NOW=$(git rev-parse --short=12 HEAD)" && echo DONE`,
    600_000,
  );
  const out = clean(r.out);
  if (!out.includes('DONE')) throw new Error(`拉取失败：${out.trim().slice(-240)}`);
  const was = /WAS=(\S+)/.exec(out)?.[1];
  const now = /NOW=(\S+)/.exec(out)?.[1];
  log(`${was && was !== 'none' ? `${was} → ` : ''}${now ?? want}`);
  if (!was || was === 'none' || was === now) return ['*'];
  const diff = await root(l, `cd ${CHECKOUT} && git diff --name-only ${was} ${now} | head -400`);
  return clean(diff.out)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith('sudo'));
}

/** Restart when only code changed; rebuild the image when its inputs did. */
async function applyOnMachine(l: MachineLink, changed: string[], log: (s: string) => void) {
  // …and the memory engine's pinned versions: they are installed into the image, not the volume (engine.json).
  const heavy = changed.some(
    (f) => f === '*' || /^crew-server\/(package(-lock)?\.json|Dockerfile|src\/engine\.json)$/.test(f) || f.startsWith('crew-server/deploy/'),
  );
  if (heavy) {
    log('依赖或镜像定义变了，要重建镜像（几分钟）…');
    const r = await root(l, `cd ${CHECKOUT}/crew-server/deploy && CREW_COMMIT=$(git -C ${CHECKOUT} rev-parse HEAD) bash ./install.sh`, 45 * 60_000);
    if (!/装好了/.test(clean(r.out))) throw new Error(`重建失败：${clean(r.out).trim().slice(-240)}`);
    return;
  }
  log('只是代码变了，重启容器就行（几秒）…');
  const dep = `${CHECKOUT}/crew-server/deploy`;
  // The container has no .git, so tell it which commit it is now running (version.ts reads CREW_COMMIT).
  const stamp =
    `cd ${dep} && C=$(git -C ${CHECKOUT} rev-parse HEAD) && ` +
    `if grep -q '^CREW_COMMIT=' .env 2>/dev/null; then sed -i "s/^CREW_COMMIT=.*/CREW_COMMIT=$C/" .env; else echo "CREW_COMMIT=$C" >> .env; fi`;
  const compose = `cd ${dep} && docker compose`;
  // Recreate rather than restart: the container has to pick up the new CREW_COMMIT. Then wait for it to answer,
  // so the App is not told "cannot reach the machine" while it is still booting.
  // 循环跑完没答应也要说出来：以前这里是 `…; echo DONE`，超时照样打 DONE，于是 App 上显示
  // 「✔ 升级完成」而容器其实还没起来（或者在崩溃重启循环里，而 docker ps 显示 Up）。
  // 那是最坏的一种假象：出了事，你看到的是成功。
  const wait = `P=$(sed -n 's/^CREW_PORT=//p' .env); P=${'${P:-5200}'}; for i in $(seq 1 90); do curl -fsS -m 2 "http://127.0.0.1:$P/health" >/dev/null 2>&1 && { echo DONE; exit 0; }; sleep 1; done; echo NOANSWER; exit 1`;
  const r = await root(l, `${stamp} && (${compose} up -d --no-build >/dev/null 2>&1 || ${compose} restart >/dev/null 2>&1); cd ${dep} && ${wait}`, 8 * 60_000);
  const said = clean(r.out);
  if (said.includes('NOANSWER')) throw new Error('容器起来了但 90 秒内没答应 /health——多半在崩溃重启循环里，去机器上看 docker logs');
  if (!said.includes('DONE')) throw new Error(`重启失败：${said.trim().slice(-240)}`);
}
