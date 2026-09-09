import { Client } from 'ssh2';
import { chmodSync, closeSync, existsSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath, readFileConfig } from './config.ts';
import { friendly, pathMtu, sendChunk, sha256File } from './remote-install.ts';
import type { CrewStore } from './store.ts';
import type { Bot } from './types.ts';

const execFileP = promisify(execFile);
const serverDir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/**
 * The steward (管家): the product's own bot for "where do the bots live". It gets the user from "I have no
 * machine" to "the bots run on a machine that stays on" the way a competent operator would: log in, look
 * around, install, read what fails and fix it. The user only does what needs a person: buy a machine, type
 * its address and password on a card, open a firewall port, click "move".
 *
 * What the steward may touch is exactly one machine: the one on the connection card. Its address, login and
 * password live in the local credential file (~/.crew/config.json, mode 600) like every other credential;
 * the bot sees command output, never the password or the pairing token.
 */
export const STEWARD_SKILL_NAME = '云机器配置';

export const STEWARD: Omit<Bot, 'id' | 'createdAt' | 'avatarSeed'> = {
  name: '管家',
  glyph: '⌂',
  tagline: '把 bot 们安顿到一台不关机的机器上',
  role: `你负责「bot 们住在哪」：让用户的 bot 们跑在一台 24 小时开着的 Linux 机器上，之后照看那台机器。

你不是流程机器。你有登录那台机器执行命令的手（machine_ssh）、看网络的眼（machine_probe），装的过程自己做、自己看输出、自己找原因、自己换办法；只在必须由人来做的地方才开口：买机器、在卡上填地址和密码、去云控制台放开端口、点「搬过去」。

工作方式：
- 每一轮先 machine_status 看现状，再决定下一步。
- 还没连上机器：问用户手头有没有一台 24 小时开着的 Linux 机器。没有就按「${STEWARD_SKILL_NAME}」技能推荐并给购买时要选的几项和直达链接；有就 machine_card(stage=connect) 让他把 IP、登录用户名、密码填在卡上。密码只进卡，不进对话，不要问。
- 连上后系统会给你一份体检（系统、CPU、内存、磁盘、Docker、MTU、能否访问 GitHub 和 Docker Hub、sudo）。按技能里的标准流程装：machine_probe → 需要就调 MTU → machine_upload → machine_ssh 跑安装脚本 → machine_pair → machine_probe 从外面测端口 → machine_card(stage=move)。
- 安装脚本、Docker 构建要跑几分钟：用 vigil 值守（后台跑命令 + 定时看日志和健康检查），出问题它会叫你，你自己解决，不用一直守着。
- 每一步都看输出。失败了就读报错，判断原因，按技能里的对策或你自己的判断修（换镜像源、调 MTU、装依赖、清磁盘、等一会重试），修完接着装。同一个问题连着两次没修好，才把情况和你的判断告诉用户，问他是重试还是换机器 / 换地域。
- 装的过程不用汇报每一步；命令和输出用户在卡片里看得见。装完、卡住、需要他动手时才说话，一次一件事，说人话，不贴日志，不让他敲命令。
- 绝不：在对话里要密码；把 token、连接码写进对话；试图在这台电脑（本机）上执行任何东西——你的命令只在那台机器上跑。`,
  soul: '像一个懂行、手快、话少的运维老手：先动手再说话，说结论不说过程；对用户用他听得懂的词，除了「IP」「密码」「端口」「防火墙」不用别的术语，非说不可就顺手一句话解释。用户迷糊了就换个说法再讲，不催，不甩一堆链接。',
  channels: ['app'],
  connections: [],
  autonomy: 'do',
  viewOfYou: [],
  skills: [STEWARD_SKILL_NAME],
  routines: [],
  notify: true,
  pinned: false,
  kind: 'steward',
};

/** The first thing the user "says" to the steward for each way of summoning it. */
export const STEWARD_FIRST_QUERY: Record<'move_out', string> = {
  move_out: '我想把 bot 们搬到一台不关机的机器上，带我一步步做。',
};

/** Find the steward, or create it. Returns whether it was just created so the caller can announce a birth. */
export function ensureSteward(store: CrewStore): { bot: Bot; created: boolean } {
  const cur = store.data.bots.find((b) => b.kind === 'steward');
  if (cur) {
    // The steward's role and manual belong to the product: keep them current.
    if (cur.role !== STEWARD.role || cur.soul !== STEWARD.soul) store.patchBot(cur.id, { role: STEWARD.role, soul: STEWARD.soul }, { growth: false });
    return { bot: store.bot(cur.id) ?? cur, created: false };
  }
  const bot = store.addBot({ ...STEWARD, avatarSeed: `${STEWARD.name}:${Date.now()}` });
  return { bot, created: true };
}

/* ---------------- the machine: one record in the local credential file ---------------- */

export interface SavedMachine {
  host: string;
  user: string;
  port: number;
  /** ssh password, kept here (mode 600) like every other credential; never shown to bots or clients */
  password?: string;
  name: string;
  /** set by pairing: the crew-server on it */
  url?: string;
  token?: string;
  connectedAt: number;
  pairedAt?: number;
  /** the machine's network drops full-size packets: its MTU was lowered to this (also carried into install.sh) */
  mtu?: number;
}

export function loadMachine(): SavedMachine | undefined {
  const m = (readFileConfig() as { machine?: SavedMachine }).machine;
  return m?.host ? m : undefined;
}

export function saveMachine(m: SavedMachine | undefined) {
  const cur = readFileConfig() as Record<string, unknown>;
  if (m) cur.machine = m;
  else delete cur.machine;
  const tmp = configPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, configPath);
  try {
    chmodSync(configPath, 0o600);
  } catch {
    /* ignore */
  }
}

export const portOf = (url: string) => /:(\d+)/.exec(url.replace(/^https?:\/\//, ''))?.[1] ?? (url.startsWith('https') ? '443' : '80');

/** Strip what must never reach a bot or a transcript: the pairing token and anything shaped like a pairing code. */
export function redact(s: string): string {
  return s.replace(/(CREW_AUTH_TOKEN=)\S+/g, '$1••••').replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{60,}(?![A-Za-z0-9_-])/g, '••••');
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').trimEnd();

/** One ssh connection to the machine, reconnected on demand. Commands run there and nowhere else. */
export class MachineLink {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  constructor(readonly m: SavedMachine) {}

  connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    const pw = this.m.password?.trim() || undefined;
    this.connecting = new Promise<Client>((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => {
        this.client = c;
        this.connecting = undefined;
        resolve(c);
      })
        .on('error', (e) => {
          this.connecting = undefined;
          if (this.client === c) this.client = undefined;
          reject(new Error(friendly(e)));
        })
        .on('close', () => {
          if (this.client === c) this.client = undefined;
        })
        .on('keyboard-interactive', (_n, _i, _l, _prompts, finish) => finish(pw ? [pw] : []))
        .connect({ host: this.m.host, port: this.m.port || 22, username: this.m.user || 'root', password: pw, readyTimeout: 20_000, tryKeyboard: true, agent: process.env.SSH_AUTH_SOCK, keepaliveInterval: 15_000, keepaliveCountMax: 3 });
    });
    return this.connecting;
  }

  /**
   * Run one command on the machine. Answers sudo's password prompt itself (the bot never sees the password),
   * streams cleaned lines to `onLine`, and returns exit code + output with secrets redacted. A timeout closes
   * the channel and reports code 124.
   */
  async exec(cmd: string, o: { timeoutMs?: number; pty?: boolean; onLine?: (line: string) => void } = {}): Promise<{ code: number; out: string; timedOut: boolean }> {
    const c = await this.connect();
    const pw = this.m.password?.trim() || undefined;
    return new Promise((resolve, reject) => {
      c.exec(cmd, { pty: o.pty ? { term: 'xterm', cols: 120, rows: 30 } : undefined }, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        let buf = '';
        let timedOut = false;
        const timer = o.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              stream.close();
            }, o.timeoutMs)
          : undefined;
        const feed = (chunk: Buffer) => {
          const s = chunk.toString('utf8');
          out += s;
          if (pw && /\[sudo\] password|Password:/i.test(s) && !/Docker/.test(s)) stream.write(pw + '\n');
          buf += s;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? '';
          for (const l of lines) {
            const clean = strip(l);
            if (clean.trim() && !(pw && clean.includes(pw))) o.onLine?.(redact(clean));
          }
        };
        stream.on('data', feed);
        stream.stderr.on('data', feed);
        stream.on('close', (code: number | null) => {
          if (timer) clearTimeout(timer);
          if (buf.trim() && !(pw && buf.includes(pw))) o.onLine?.(redact(strip(buf)));
          resolve({ code: timedOut ? 124 : (code ?? 0), out: redact(pw ? out.split(pw).join('••••') : out), timedOut });
        });
        stream.on('error', (e: Error) => {
          if (timer) clearTimeout(timer);
          reject(e);
        });
      });
    });
  }

  close() {
    this.client?.end();
    this.client = undefined;
  }

  /** Drop the current TCP connection and open a fresh one — needed after changing the machine's MTU, so the new
   * connection negotiates a segment size that fits (an established connection keeps the size it agreed at SYN time). */
  async reconnect(): Promise<Client> {
    this.close();
    // give the kernel a moment to tear the socket down
    await new Promise((r) => setTimeout(r, 300));
    return this.connect();
  }
}

let link: MachineLink | undefined;

/** The link to the saved machine (reconnects lazily). Throws when no machine has been connected yet. */
export function machineLink(): MachineLink {
  const m = loadMachine();
  if (!m) throw new Error('还没有连上任何机器：先 machine_card(stage=connect) 让用户填机器的 IP、用户名和密码');
  if (!link || link.m.host !== m.host || link.m.user !== m.user || link.m.port !== m.port || link.m.password !== m.password) {
    link?.close();
    link = new MachineLink(m);
  }
  return link;
}

/** First contact from the connection card: log in with the password; only a password that works is saved. */
export async function connectMachine(o: { host: string; user: string; port?: number; password?: string }): Promise<MachineLink> {
  const prev = loadMachine();
  const m: SavedMachine = {
    host: o.host.trim(),
    user: o.user.trim() || 'root',
    port: o.port ?? 22,
    password: o.password?.trim() || undefined,
    name: prev?.host === o.host.trim() ? prev.name : o.host.trim(),
    connectedAt: Date.now(),
    // A re-connect to the same machine keeps its pairing.
    ...(prev?.host === o.host.trim() ? { url: prev.url, token: prev.token, pairedAt: prev.pairedAt } : {}),
  };
  const l = new MachineLink(m);
  await l.connect();
  saveMachine(m);
  link?.close();
  link = l;
  return l;
}

export function forgetMachine() {
  link?.close();
  link = undefined;
  saveMachine(undefined);
}

/** A quick look around a freshly connected machine, as text the bot can reason about. */
export async function surveyMachine(l: MachineLink): Promise<string> {
  const script = [
    `[ -f /etc/os-release ] && . /etc/os-release; echo "系统: \${PRETTY_NAME:-$(uname -sr)}"`,
    `echo "CPU: $(nproc 2>/dev/null || echo ?) 核"`,
    `echo "内存: $(free -m 2>/dev/null | awk '/Mem:/{print $2}') MB，可用 $(free -m 2>/dev/null | awk '/Mem:/{print $7}') MB"`,
    `echo "磁盘: $(df -h / 2>/dev/null | awk 'NR==2{print $4" 可用 / 共 "$2}')"`,
    `echo "Docker: $(command -v docker >/dev/null 2>&1 && docker --version 2>/dev/null || echo 未安装)"`,
    `iface="$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')"; echo "网卡: \${iface:-?} MTU $(cat /sys/class/net/\${iface:-lo}/mtu 2>/dev/null)"`,
    `echo "sudo: $(sudo -n true 2>/dev/null && echo 免密 || echo 需要密码)"`,
    `echo "公网 IP: $(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || echo 未知)"`,
    `echo "GitHub: $(curl -sS -o /dev/null --max-time 6 -w 'HTTP %{http_code}' https://github.com 2>/dev/null || echo 不通)"`,
    `echo "Docker Hub: $(curl -sS -o /dev/null --max-time 6 -w 'HTTP %{http_code}（401 也算通）' https://registry-1.docker.io/v2/ 2>/dev/null || echo 不通)"`,
    `echo "已装的 crew-server: $([ -f /opt/crew/crew-server/deploy/.env ] && echo 有一份，可配对 || echo 没有)"`,
    `echo "5200 端口: $(ss -ltn 2>/dev/null | grep -q ':5200 ' && echo 已有进程在听 || echo 空闲)"`,
  ].join('; ');
  const r = await l.exec(script, { timeoutMs: 45_000 });
  return r.out.split(/\r?\n/).map(strip).filter((x) => x.trim()).join('\n') || '（没有输出）';
}

/**
 * Put this server's code on the machine at /opt/crew/crew-server: the code alone (the skill library is pulled from
 * GitHub there), in small chunks with a per-chunk timeout, skipped when the machine already has this exact version.
 */
export async function uploadCode(l: MachineLink, log: (line: string) => void): Promise<{ skipped: boolean; bytes: number; mtu?: number }> {
  const prep = await l.exec('sudo -n mkdir -p /opt/crew/crew-server && sudo -n chown -R "$(id -u):$(id -g)" /opt/crew && echo ok', { timeoutMs: 20_000 });
  if (!prep.out.includes('ok')) {
    const r2 = await l.exec('sudo mkdir -p /opt/crew/crew-server && sudo chown -R "$(id -u):$(id -g)" /opt/crew && echo ok', { pty: true, timeoutMs: 20_000 });
    if (!r2.out.includes('ok')) throw new Error('这个账号没有管理员权限（sudo 失败）：换 root 或有 sudo 权限的用户');
  }
  log('打包代码…');
  const tgz = join(tmpdir(), `crew-server-${Date.now()}.tgz`);
  const entries = readdirSync(serverDir).filter((n) => !['node_modules', '.git', 'library'].includes(n) && !n.endsWith('.log') && !n.startsWith('.'));
  await execFileP('tar', ['--no-xattrs', '-czf', tgz, '-C', serverDir, ...entries, 'library/manifest.json'], { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } }).catch(() =>
    execFileP('tar', ['-czf', tgz, '-C', serverDir, ...entries, 'library/manifest.json'], { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } }),
  );
  const size = statSync(tgz).size;
  const sha = sha256File(tgz);
  try {
    const have = (await l.exec('cat /opt/crew/crew-server/.upload-sha 2>/dev/null || true', { timeoutMs: 15_000 })).out.trim();
    if (have === sha) {
      log('那台机器上已经是这份代码，跳过上传');
      return { skipped: true, bytes: size };
    }
    // Some paths (this one to the Tencent box included) silently drop full-size packets: tiny ssh commands work,
    // any bulk transfer stalls. Detect it before wasting a 60 s timeout, then lower the machine's MTU AND reconnect
    // (an already-open connection keeps the segment size it agreed at connect time, so the fix only takes on a fresh one).
    let mtu = loadMachine()?.mtu;
    const fixMtu = async (why: string) => {
      const val = mtu ?? 1400;
      log(`${why}：把那台机器的网卡 MTU 调到 ${val} 再重连`);
      await l.exec(`sudo ip link set dev "$(ip route show default | awk '/default/{print $5; exit}')" mtu ${val} 2>/dev/null; echo done`, { pty: true, timeoutMs: 20_000 });
      const cur = loadMachine();
      if (cur && cur.mtu !== val) saveMachine({ ...cur, mtu: val });
      mtu = val;
      await l.reconnect();
    };
    if (mtu) await fixMtu('这台机器之前记录过大包不通');
    else if ((await pathMtu(l.m.host)) === 'low') await fixMtu('这条网络对大包不友好（1500 字节的包过不去）');

    log(`上传代码（${(size / 1024).toFixed(0)} KB）…`);
    await l.exec('rm -f /tmp/crew-server.tgz', { timeoutMs: 15_000 });
    const CHUNK = 48 * 1024;
    const fd = openSync(tgz, 'r');
    try {
      let sent = 0;
      const buf = Buffer.alloc(CHUNK);
      while (sent < size) {
        const n = readSync(fd, buf, 0, CHUNK, sent);
        const piece = Buffer.from(buf.subarray(0, n));
        let attempt = 0;
        for (;;) {
          try {
            await sendChunk(await l.connect(), piece, sent === 0);
            break;
          } catch (e) {
            attempt++;
            // A stall on the very first block with no MTU fix yet is almost always the packet-size black hole
            // (ICMP was probably blocked so the probe couldn't see it). Apply the fix and restart from the top.
            if (!mtu && sent === 0 && attempt === 1) {
              await fixMtu('传数据就卡、小命令能通');
              await l.exec('rm -f /tmp/crew-server.tgz', { timeoutMs: 15_000 });
              continue;
            }
            if (attempt >= 3) throw new Error(`上传卡住了（${(e as Error).message}）。到那台机器的网络传大文件传不过去，已试着调小 MTU 仍不行——多半是它所在地域离你太远，换一个近的地域重买一台再试`);
            log(`这一块没传过去，重试…`);
            if (sent === 0) await l.exec('rm -f /tmp/crew-server.tgz', { timeoutMs: 15_000 });
          }
        }
        sent += n;
        if (sent % (4 * CHUNK) === 0 || sent === size) log(`已上传 ${(sent / 1024).toFixed(0)} / ${(size / 1024).toFixed(0)} KB`);
      }
    } finally {
      closeSync(fd);
    }
    const check = await l.exec(`test "$(stat -c %s /tmp/crew-server.tgz)" = "${size}" && echo same || echo diff`, { timeoutMs: 15_000 });
    if (!check.out.includes('same')) throw new Error('上传的文件不完整，重试一次');
    // deploy/.env holds the machine's pairing (token + public URL). It is not code and must survive the wipe, or
    // every upgrade would hand the user a new connection code. Save and restore run in the same root shell as the
    // wipe, so the kept copy is always readable by whoever puts it back.
    const script =
      `cd /opt/crew/crew-server && ` +
      `{ cp -p deploy/.env /tmp/crew-env.keep 2>/dev/null || true; } && ` +
      `rm -rf /tmp/crew-library.keep; if [ -d library ]; then mv library /tmp/crew-library.keep; fi; ` +
      `rm -rf ./* && tar -xzf /tmp/crew-server.tgz -C . && rm -f /tmp/crew-server.tgz && ` +
      `if [ -f /tmp/crew-env.keep ]; then mkdir -p deploy && cp -p /tmp/crew-env.keep deploy/.env && rm -f /tmp/crew-env.keep; fi && ` +
      `if [ -d /tmp/crew-library.keep ]; then rm -rf library && mv /tmp/crew-library.keep library; fi && ` +
      `echo '${sha}' > .upload-sha && echo ok`;
    const ex = await l.exec(`sudo -n sh -c ${shq(script)} 2>&1 || sudo sh -c ${shq(script)} 2>&1`, { timeoutMs: 60_000, pty: true });
    if (!ex.out.includes('ok')) throw new Error('解压失败：' + ex.out.slice(-300));
    // Persist the MTU where install.sh can read it, so the same fix carries into the Docker build and survives reboots.
    if (mtu) await l.exec(`printf '%s' '${mtu}' > /opt/crew/crew-server/.mtu && echo ok`, { timeoutMs: 15_000 });
    log('✔ 代码已放到 /opt/crew/crew-server');
    return { skipped: false, bytes: size, mtu };
  } finally {
    rmSync(tgz, { force: true });
  }
}

/**
 * The skill library, shipped from the user's computer. Used by the very first install over ssh; once the machine
 * is a git checkout (upgrade.ts) the library arrives with the repository instead, which is far quicker.
 */
export async function uploadLibrary(l: MachineLink, log: (line: string) => void): Promise<{ skipped: boolean; skills: number }> {
  const libDir = join(serverDir, 'library');
  const skills = countSkills(libDir);
  if (!skills) return { skipped: true, skills: 0 };
  const tgz = join(tmpdir(), `crew-library-${Date.now()}.tgz`);
  const pack = (args: string[]) => execFileP('tar', args, { maxBuffer: 8 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await pack(['--no-xattrs', '-czf', tgz, '-C', serverDir, 'library']).catch(() => pack(['-czf', tgz, '-C', serverDir, 'library']));
  try {
    const size = statSync(tgz).size;
    const sha = sha256File(tgz);
    const have = (await l.exec('cat /opt/crew/crew-server/.library-sha 2>/dev/null || true', { timeoutMs: 15_000 })).out.trim();
    if (have === sha) {
      log(`技能库已经是这一份（${skills} 个技能），跳过`);
      return { skipped: true, skills };
    }
    log(`上传技能库（${skills} 个技能，${(size / 1024 / 1024).toFixed(1)} MB，比代码慢）…`);
    await l.exec('rm -f /tmp/crew-library.tgz', { timeoutMs: 15_000 });
    const CHUNK = 48 * 1024;
    const fd = openSync(tgz, 'r');
    try {
      let sent = 0;
      let lastPct = -1;
      const buf = Buffer.alloc(CHUNK);
      while (sent < size) {
        const n = readSync(fd, buf, 0, CHUNK, sent);
        const piece = Buffer.from(buf.subarray(0, n));
        for (let attempt = 0; ; attempt++) {
          try {
            await sendChunk(await l.connect(), piece, sent === 0, '/tmp/crew-library.tgz');
            break;
          } catch (e) {
            if (attempt >= 2) throw new Error(`技能库没传完（${(e as Error).message}）`);
            log('这一块没传过去，重试…');
            if (sent === 0) await l.exec('rm -f /tmp/crew-library.tgz', { timeoutMs: 15_000 });
          }
        }
        sent += n;
        const pct = Math.floor((sent / size) * 10) * 10;
        if (pct !== lastPct && pct > 0) {
          lastPct = pct;
          log(`技能库 ${pct}%`);
        }
      }
    } finally {
      closeSync(fd);
    }
    const script = `cd /opt/crew/crew-server && rm -rf library && tar -xzf /tmp/crew-library.tgz -C . && rm -f /tmp/crew-library.tgz && echo '${sha}' > .library-sha && echo ok`;
    const ex = await l.exec(`sudo -n sh -c ${shq(script)} 2>&1 || sudo sh -c ${shq(script)} 2>&1`, { timeoutMs: 180_000, pty: true });
    if (!ex.out.includes('ok')) throw new Error('技能库解压失败：' + ex.out.slice(-200));
    log(`✔ 技能库已送到（${skills} 个技能）`);
    return { skipped: false, skills };
  } finally {
    rmSync(tgz, { force: true });
  }
}

/** How many skills a library directory holds (one SKILL.md each). */
export function countSkills(libDir: string): number {
  let n = 0;
  let cats: string[];
  try {
    cats = readdirSync(libDir);
  } catch {
    return 0;
  }
  for (const c of cats) {
    let slugs: string[];
    try {
      slugs = readdirSync(join(libDir, c));
    } catch {
      continue;
    }
    for (const sl of slugs) if (existsSync(join(libDir, c, sl, 'SKILL.md'))) n++;
  }
  return n;
}

/** Read the pairing (token + public URL) the install script wrote on the machine, keep it here, and check the service from outside. */
export async function pairMachine(l: MachineLink): Promise<{ url: string; name: string; port: string; reachable: boolean; note?: string }> {
  const r = await l.exec('sudo cat /opt/crew/crew-server/deploy/.env 2>/dev/null; echo "HOST=$(hostname)"', { pty: true, timeoutMs: 20_000 });
  // Read the raw output here (before redaction) is not possible: exec redacts. Ask for the two values in a form redact leaves alone.
  const raw = await l.exec(`sudo sh -c 'sed -n "s/^CREW_AUTH_TOKEN=//p" /opt/crew/crew-server/deploy/.env | fold -w 40; echo URL=$(sed -n "s/^CREW_PUBLIC_URL=//p" /opt/crew/crew-server/deploy/.env)'`, { pty: true, timeoutMs: 20_000 });
  const lines = raw.out.split(/\r?\n/).map(strip).filter((x) => x && !/password/i.test(x));
  const url = lines.find((x) => x.startsWith('URL='))?.slice(4).trim();
  const token = lines.filter((x) => !x.startsWith('URL=') && /^[A-Za-z0-9]+$/.test(x)).join('');
  if (!url || token.length < 32) throw new Error('那台机器上没有配对信息：安装脚本还没跑成功（/opt/crew/crew-server/deploy/.env 不存在或不完整）');
  const name = /HOST=(\S+)/.exec(r.out)?.[1] ?? l.m.name;
  const cur = loadMachine();
  if (!cur) throw new Error('机器记录丢了，重新连接');
  saveMachine({ ...cur, url: url.replace(/\/$/, ''), token, name, pairedAt: Date.now() });
  const probe = await probeMachine({ url, token });
  return { url, name, port: portOf(url), reachable: probe.reachable, note: probe.note };
}

/** Can this machine reach that one over HTTP, and is it ours (the token is accepted)? */
export async function probeMachine(m: { url: string; token: string }): Promise<{ reachable: boolean; note?: string; mode?: string; hostname?: string; build?: string; busy?: string[] }> {
  try {
    const r = await fetch(`${m.url}/runtime/info`, { headers: { authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(6000) });
    if (r.status === 401) return { reachable: true, note: '那台机器拒绝了配对信息：服务被重装过，重新 machine_pair 一次' };
    if (!r.ok) return { reachable: false, note: `那台机器回应异常（${r.status}）` };
    const info = (await r.json()) as { mode?: string; hostname?: string; build?: string; busy?: string[] };
    return { reachable: true, mode: info.mode, hostname: info.hostname, build: info.build, busy: info.busy };
  } catch {
    return { reachable: false, note: `从外面连不上 ${portOf(m.url)} 端口：多半是云厂商的防火墙还没放开它` };
  }
}

/** Quote a string as one single-quoted shell word. */
function shq(v: string): string {
  return `'${v.split("'").join(`'\\''`)}'`;
}
