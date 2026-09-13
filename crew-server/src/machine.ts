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
import { botThread, type Bot } from './types.ts';

const execFileP = promisify(execFile);
const serverDir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/**
 * The Assistant: the bot that comes with the product, present from the first start, pinned to the top.
 *
 * It takes three kinds of work: **setup** (messengers, MCP, external agents, and moving the bots to a machine
 * that never sleeps — it carries all four manuals), **whatever has no other outlet** (a message sent in a
 * messenger to an account bound to no bot lands here; so does anything the system needs to tell the user when no
 * other bot is the right one to say it), and **the everyday** (whatever the user asks in passing that no
 * specialised bot owns).
 *
 * Having it means nobody has to create a bot for a one-off job like moving house. The only machine it can touch
 * is the one on the connection card: the address, account and password live in the local credential file
 * (~/.crew/config.json, mode 600), and the bot sees command output only — never the password or the pairing code.
 */
export const STEWARD_SKILL_NAME = 'Setting up a cloud machine';

export const STEWARD: Omit<Bot, 'id' | 'createdAt' | 'avatarSeed'> = {
  // Visible identity is English: it is the first bot anyone sees on a fresh install, and the App opens in
  // English. What it says is another matter — LANGUAGE_RULE makes every bot answer in the user's own language.
  name: 'Assistant',
  glyph: 'A',
  tagline: 'Setup questions, and anything nobody else owns',
  role: `You are the assistant that comes with this product, here from the first start. You have three kinds of work.

**One: setup.** Everything in the App about "how do I connect this, how do I configure that" is yours: messengers, MCP servers, external agents, and moving the bots onto a machine that stays on 24 hours a day. You carry all four manuals ("Connecting a messenger", "Connecting an external service", "Connecting an external agent", "${STEWARD_SKILL_NAME}") — follow them rather than inventing steps. The user will also ask you product questions like "how do I give a bot a skill" or "why isn't this bot answering". You are the one who knows.

**Two: whatever has no other outlet.** A message sent in a messenger to an account bound to no bot arrives here; so does anything the system needs to tell the user when no other bot is the right one to say it. In both cases work out whose it is first: if a bot owns that subject, hand it over (@ them, with the context spelled out); if none does, do it yourself.

**Three: the everyday.** Whatever the user asks in passing that no specialised bot owns — look something up, work out a number, write a paragraph, keep an eye on a time. Do it. Do not make them create a bot for that.

Rules:
- When a bot owns the subject, hand it over rather than going round them — unless the user explicitly asked you to do it.
- You are not a wizard on rails. For moving machines you have hands that run commands over ssh (machine_ssh) and eyes on the network (machine_probe): do the install yourself, read your own output, work out causes, try another way. Speak only where a person is genuinely required — buying the machine, filling the address and password into the card, opening a port in the cloud console, pressing "move".
- Every round of a move starts with machine_status, then decide. Not connected yet: ask whether they have a Linux machine that stays on; if not, recommend one from the manual with the few choices that matter and a direct link; if yes, machine_card(stage=connect) so they can fill in the IP, username and password. The password goes on the card only — never in the conversation, and never ask for it.
- Once connected the system hands you a health report. Install per the manual: machine_probe → adjust the MTU if needed → machine_upload → machine_ssh to run the installer → machine_pair → machine_probe to test the port from outside → machine_card(stage=move). The install and the build take minutes; stand watch with vigil and it will wake you if something goes wrong.
- Read the output at every step. On failure, read the error, work out the cause, fix it from the manual's remedies or your own judgement (change mirror, adjust MTU, install a dependency, free disk, wait and retry), and carry on. Only after failing twice on the same problem do you bring it to the user with what you saw and what you think, and ask whether to retry or change machine / region.
- Never: ask for a password in the conversation; write a token or a pairing code into the conversation; try to run anything on this computer — machine_ssh commands only ever run on that machine.
- Do not narrate every step; the user can see the commands and the output on the card. Speak when it is done, when it is stuck, or when you need them to act. One thing at a time, in plain words, no logs, and never a command for them to type.`,
  soul:
    'Like someone who has done this many times: hands first, words after; conclusions, not process. Use words the user already knows — apart from "IP", "password", "port" and "firewall", no jargon, and if one is unavoidable, explain it in the same breath. When they look lost, say it another way. No chasing, no walls of links, no pleasantries.',
  channels: ['app'],
  connections: [],
  autonomy: 'do',
  viewOfYou: [],
  skills: [STEWARD_SKILL_NAME],
  routines: [],
  notify: true,
  // The one that comes with the product, at the top of the list.
  pinned: true,
  kind: 'steward',
};

/** The first line in its thread when it is born. */
const STEWARD_BORN = 'Comes with the product. Setup, moving to another machine, and anything nobody else owns.';

/** The first thing the user "says" to the steward for each way of summoning it. */
export const STEWARD_FIRST_QUERY: Record<'move_out', string> = {
  move_out: 'I want to move the bots onto a machine that stays on. Walk me through it.',
};

/**
 * The assistant always exists: called once at start-up, created if missing. Returns whether it was just created,
 * so the caller can generate the avatar.
 *
 * Older installs have a "steward" that existed only to move machines. It is not converted — it is demoted to an
 * ordinary bot (its thread and the machine cards of the time stay, because that is work it did), and the one that
 * comes with the product is a freshly created assistant from then on. One the user renamed is left alone: that is
 * their bot now, and it goes on being the assistant.
 */
export function ensureSteward(store: CrewStore): { bot: Bot; created: boolean } {
  // The Chinese name is deliberate: installs from before the rename have a bot called 管家, and this is how it
  // is recognised. Both spellings are matched because the name was English for a while in between.
  const old = store.data.bots.find((b) => b.kind === 'steward' && (b.name === '管家' || b.name === 'Steward'));
  if (old) store.patchBot(old.id, { kind: undefined, pinned: false }, { growth: false });

  const cur = store.data.bots.find((b) => b.kind === 'steward');
  if (cur) {
    // Remit and character belong to the product: when they change, the bot follows.
    if (cur.role !== STEWARD.role || cur.soul !== STEWARD.soul) store.patchBot(cur.id, { role: STEWARD.role, soul: STEWARD.soul }, { growth: false });
    return { bot: store.bot(cur.id) ?? cur, created: false };
  }
  const bot = store.addBot({ ...STEWARD, avatarSeed: `${STEWARD.name}:${Date.now()}` });
  store.addMessage({ threadId: botThread(bot.id), author: 'system', botId: bot.id, text: STEWARD_BORN, ts: bot.createdAt - 1, status: 'born' });
  store.grow(bot.id, 'born', 'comes with the product', bot.createdAt);
  store.grow(bot.id, 'skill', `learned the manual "${STEWARD_SKILL_NAME}"`);
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
  if (!m) throw new Error('no machine is connected yet: use machine_card(stage=connect) so the user can fill in its IP, username and password');
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
    `[ -f /etc/os-release ] && . /etc/os-release; echo "OS: \${PRETTY_NAME:-$(uname -sr)}"`,
    `echo "CPU: $(nproc 2>/dev/null || echo ?) cores"`,
    `echo "Memory: $(free -m 2>/dev/null | awk '/Mem:/{print $2}') MB, $(free -m 2>/dev/null | awk '/Mem:/{print $7}') MB free"`,
    `echo "Disk: $(df -h / 2>/dev/null | awk 'NR==2{print $4" free of "$2}')"`,
    `echo "Docker: $(command -v docker >/dev/null 2>&1 && docker --version 2>/dev/null || echo 'not installed')"`,
    `iface="$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')"; echo "NIC: \${iface:-?} MTU $(cat /sys/class/net/\${iface:-lo}/mtu 2>/dev/null)"`,
    `echo "sudo: $(sudo -n true 2>/dev/null && echo 'no password' || echo 'password required')"`,
    `echo "Public IP: $(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || echo unknown)"`,
    `echo "GitHub: $(curl -sS -o /dev/null --max-time 6 -w 'HTTP %{http_code}' https://github.com 2>/dev/null || echo unreachable)"`,
    `echo "Docker Hub: $(curl -sS -o /dev/null --max-time 6 -w 'HTTP %{http_code} (401 counts as reachable)' https://registry-1.docker.io/v2/ 2>/dev/null || echo unreachable)"`,
    `echo "crew-server already installed: $([ -f /opt/crew/crew-server/deploy/.env ] && echo 'yes, can pair' || echo no)"`,
    `echo "port 5200: $(ss -ltn 2>/dev/null | grep -q ':5200 ' && echo 'something is listening' || echo free)"`,
  ].join('; ');
  const r = await l.exec(script, { timeoutMs: 45_000 });
  return r.out.split(/\r?\n/).map(strip).filter((x) => x.trim()).join('\n') || '(no output)';
}

/**
 * Put this server's code on the machine at /opt/crew/crew-server: the code alone (the skill library is pulled from
 * GitHub there), in small chunks with a per-chunk timeout, skipped when the machine already has this exact version.
 */
export async function uploadCode(l: MachineLink, log: (line: string) => void): Promise<{ skipped: boolean; bytes: number; mtu?: number }> {
  const prep = await l.exec('sudo -n mkdir -p /opt/crew/crew-server && sudo -n chown -R "$(id -u):$(id -g)" /opt/crew && echo ok', { timeoutMs: 20_000 });
  if (!prep.out.includes('ok')) {
    const r2 = await l.exec('sudo mkdir -p /opt/crew/crew-server && sudo chown -R "$(id -u):$(id -g)" /opt/crew && echo ok', { pty: true, timeoutMs: 20_000 });
    if (!r2.out.includes('ok')) throw new Error('this account has no administrator rights (sudo failed): use root or an account with sudo');
  }
  log('packing the code…');
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
      log('that machine already has this code; skipping the upload');
      return { skipped: true, bytes: size };
    }
    // Some paths (this one to the Tencent box included) silently drop full-size packets: tiny ssh commands work,
    // any bulk transfer stalls. Detect it before wasting a 60 s timeout, then lower the machine's MTU AND reconnect
    // (an already-open connection keeps the segment size it agreed at connect time, so the fix only takes on a fresh one).
    let mtu = loadMachine()?.mtu;
    const fixMtu = async (why: string) => {
      const val = mtu ?? 1400;
      log(`${why}: setting that machine's NIC MTU to ${val} and reconnecting`);
      await l.exec(`sudo ip link set dev "$(ip route show default | awk '/default/{print $5; exit}')" mtu ${val} 2>/dev/null; echo done`, { pty: true, timeoutMs: 20_000 });
      const cur = loadMachine();
      if (cur && cur.mtu !== val) saveMachine({ ...cur, mtu: val });
      mtu = val;
      await l.reconnect();
    };
    if (mtu) await fixMtu('this machine was recorded as dropping large packets before');
    else if ((await pathMtu(l.m.host)) === 'low') await fixMtu('this network dislikes large packets (1500-byte packets do not get through)');

    log(`uploading the code (${(size / 1024).toFixed(0)} KB)…`);
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
              await fixMtu('data transfers stall while small commands get through');
              await l.exec('rm -f /tmp/crew-server.tgz', { timeoutMs: 15_000 });
              continue;
            }
            if (attempt >= 3) throw new Error(`the upload stalled (${(e as Error).message}). Large files will not cross the network to that machine, and lowering the MTU did not help — most likely its region is too far away; buy one in a nearer region and try again`);
            log(`that chunk did not get through; retrying…`);
            if (sent === 0) await l.exec('rm -f /tmp/crew-server.tgz', { timeoutMs: 15_000 });
          }
        }
        sent += n;
        if (sent % (4 * CHUNK) === 0 || sent === size) log(`uploaded ${(sent / 1024).toFixed(0)} / ${(size / 1024).toFixed(0)} KB`);
      }
    } finally {
      closeSync(fd);
    }
    const check = await l.exec(`test "$(stat -c %s /tmp/crew-server.tgz)" = "${size}" && echo same || echo diff`, { timeoutMs: 15_000 });
    if (!check.out.includes('same')) throw new Error('the uploaded file is incomplete; try once more');
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
    if (!ex.out.includes('ok')) throw new Error('could not unpack: ' + ex.out.slice(-300));
    // Persist the MTU where install.sh can read it, so the same fix carries into the Docker build and survives reboots.
    if (mtu) await l.exec(`printf '%s' '${mtu}' > /opt/crew/crew-server/.mtu && echo ok`, { timeoutMs: 15_000 });
    log('✔ code is in place at /opt/crew/crew-server');
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
      log(`the skill library is already this one (${skills} skills); skipping`);
      return { skipped: true, skills };
    }
    log(`uploading the skill library (${skills} skills, ${(size / 1024 / 1024).toFixed(1)} MB — slower than the code)…`);
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
            if (attempt >= 2) throw new Error(`the skill library did not finish uploading (${(e as Error).message})`);
            log('that chunk did not get through; retrying…');
            if (sent === 0) await l.exec('rm -f /tmp/crew-library.tgz', { timeoutMs: 15_000 });
          }
        }
        sent += n;
        const pct = Math.floor((sent / size) * 10) * 10;
        if (pct !== lastPct && pct > 0) {
          lastPct = pct;
          log(`skill library ${pct}%`);
        }
      }
    } finally {
      closeSync(fd);
    }
    const script = `cd /opt/crew/crew-server && rm -rf library && tar -xzf /tmp/crew-library.tgz -C . && rm -f /tmp/crew-library.tgz && echo '${sha}' > .library-sha && echo ok`;
    const ex = await l.exec(`sudo -n sh -c ${shq(script)} 2>&1 || sudo sh -c ${shq(script)} 2>&1`, { timeoutMs: 180_000, pty: true });
    if (!ex.out.includes('ok')) throw new Error('could not unpack the skill library: ' + ex.out.slice(-200));
    log(`✔ skill library delivered (${skills} skills)`);
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
  if (!url || token.length < 32) throw new Error('that machine has no pairing details: the installer has not finished successfully (/opt/crew/crew-server/deploy/.env is missing or incomplete)');
  const name = /HOST=(\S+)/.exec(r.out)?.[1] ?? l.m.name;
  const cur = loadMachine();
  if (!cur) throw new Error('the machine record is gone; connect again');
  saveMachine({ ...cur, url: url.replace(/\/$/, ''), token, name, pairedAt: Date.now() });
  const probe = await probeMachine({ url, token });
  return { url, name, port: portOf(url), reachable: probe.reachable, note: probe.note };
}

/** Can this machine reach that one over HTTP, and is it ours (the token is accepted)? */
export async function probeMachine(m: { url: string; token: string }): Promise<{ reachable: boolean; note?: string; mode?: string; hostname?: string; build?: string; busy?: string[] }> {
  try {
    const r = await fetch(`${m.url}/runtime/info`, { headers: { authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(6000) });
    if (r.status === 401) return { reachable: true, note: 'that machine rejected the pairing details: the service was reinstalled, so machine_pair again' };
    if (!r.ok) return { reachable: false, note: `that machine answered oddly (${r.status})` };
    const info = (await r.json()) as { mode?: string; hostname?: string; build?: string; busy?: string[] };
    return { reachable: true, mode: info.mode, hostname: info.hostname, build: info.build, busy: info.busy };
  } catch {
    return { reachable: false, note: `port ${portOf(m.url)} is not reachable from outside: most likely the provider's firewall has not opened it` };
  }
}

/** Quote a string as one single-quoted shell word. */
function shq(v: string): string {
  return `'${v.split("'").join(`'\\''`)}'`;
}
