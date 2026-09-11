/**
 * Memory. The engine is EverOS, run as a sidecar on loopback; this file is the only place that talks
 * to it. Four things live here and nowhere else: whose memory it is, where it is written, how much
 * comes back, and how long a turn is willing to wait for it.
 *
 * Nothing here throws and nothing here blocks a reply. With no sidecar — not installed, crashed, a
 * machine without Python 3.12 — every call is a no-op and the product falls back to the two plain
 * text lists it has always had (memory.ts). Memory is worth something extra, not something required.
 *
 * Ownership is not a parameter. `/memory/add` derives it from each message: the `sender_id` of a
 * `role: "user"` message owns the user track, the `sender_id` of a `role: "assistant"` message owns
 * the agent track — which is why a bot's own id is what we later read back as `agent_id`.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.ts';
import { endpointOf } from './models.ts';
import { DEFAULT_VISION_MODEL } from './vision.ts';
import { PLACEHOLDER, startMeterProxy } from './meter-proxy.ts';
import type { CrewStore } from './store.ts';
import { redactSecrets } from './secrets.ts';

/** The app all of this product's memory lives under. Pinned into the engine's queries: write and read must match. */
const APP = 'everbot';
/** There is one human. When there are more this becomes their id; the shape does not change. */
const HUMAN = 'chen';
/** The user's id as the write path needs it (bots.ts labels his messages with it). */
export const HUMAN_ID = HUMAN;
/** Team knowledge is owned by an agent that is not a bot: nothing writes here without an explicit promotion. */
const CREW = 'crew';
/** Everyone shares one space. Per-bot spaces (`bot_<id>`) are possible and deliberately unused — see DESIGN.md §18. */
const SPACE = 'shared';

/**
 * The cross-encoder that re-scores retrieved passages. OpenRouter does have a rerank endpoint
 * (`POST /api/v1/rerank`, the `{model, query, documents}` shape the engine calls "vllm"); its two models
 * are `cohere/rerank-v3.5` and `qwen/qwen3-reranker-8b`. It matters more than it sounds: the engine
 * refuses every `/knowledge/search` method without one, and the agent track's hybrid lane too.
 */
const rerankModel = () => config.rerankModel;
const hasRerank = () => rerankModel() !== 'off' && !!endpointOf(rerankModel());

const PORT = Number(process.env.CREW_MEMORY_PORT ?? 5211);
const BASE = process.env.EVEROS_URL ?? `http://127.0.0.1:${PORT}`;
/** A finished task is a task nobody has touched for a while: that is where one memory ends and the next begins. */
const IDLE_FLUSH_MS = 90_000;

/**
 * Write scope. `session_id` is the thread — the engine cuts memories along it — with the product's
 * `bot:xxx` / `matter:xxx` colon flattened, since ids like these end up as identifiers downstream.
 */
const sid = (threadId: string) => threadId.replace(/:/g, '_');
const writeScope = (threadId: string) => ({ session_id: sid(threadId), app_id: APP, project_id: SPACE });
/** Read scopes. `user_id` and `agent_id` are exclusive — one call each, never both. */
const readUser = () => ({ user_id: HUMAN, app_id: APP, project_id: SPACE });
const readBot = (botId: string) => ({ agent_id: botId, app_id: APP, project_id: SPACE });
const readCrew = () => ({ agent_id: CREW, app_id: APP, project_id: SPACE });

export interface EvTool {
  name: string;
  args?: string;
}
export interface EvMsg {
  role: 'user' | 'assistant';
  /** the human, or the bot that said it; becomes the owner of whatever is extracted */
  senderId: string;
  text: string;
  ts: number;
  tools?: EvTool[];
}

interface Deps {
  store: CrewStore;
  /** an extraction just happened for these bots: whatever they learned is now worth looking at (builder.ts) */
  onExtract?: (botId: string) => void;
}

let deps: Deps | undefined;
let child: ChildProcess | undefined;
let up = false;
let starting: Promise<boolean> | undefined;
/** Compressed resident profile, refreshed after each extraction; injected every turn without a network call. */
let profileCache: string[] = [];
const idle = new Map<string, ReturnType<typeof setTimeout>>();
/** The engine's own last words. It logs to stdout, which nobody would otherwise ever read (see `said`). */
let tail = '';
let saidWhy = false;
/** Which bots have said something in a thread since its last extraction. */
const contributors = new Map<string, Set<string>>();

export const alive = () => up;
const memoryRoot = () => config.memoryDir;

export function initMemory(d: Deps) {
  deps = d;
}

// ── the sidecar ───────────────────────────────────────────────────────────────

/** Where the CLI is. Installed per-user by uv, so it is often not on a service's PATH. */
function bin(): string | undefined {
  const named = process.env.EVEROS_BIN;
  if (named) return existsSync(named) ? named : undefined;
  for (const p of [join(homedir(), '.local/bin/everos'), '/usr/local/bin/everos', '/opt/everos/bin/everos']) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const exec = promisify(execFile);

/** The one place every version of the engine is written down; the image reads the same file. */
function pins(): { everos: string; with: string[] } {
  const f = join(import.meta.dirname, 'engine.json');
  const d = JSON.parse(readFileSync(f, 'utf8')) as { everos: string; with: string[] };
  return { everos: d.everos, with: d.with };
}

function uvBin(): string | undefined {
  for (const p of [join(homedir(), '.local/bin/uv'), '/usr/local/bin/uv', '/opt/homebrew/bin/uv']) if (existsSync(p)) return p;
  return undefined;
}

/**
 * Make this machine's engine be the one engine.json names — install it if there is none, change it if it is
 * a different version, leave it alone if it already matches.
 *
 * It runs on every start, not just when the engine is missing, because "installed and working" is not the
 * same as "the version we pinned": a machine the bots were moved to, or one someone set up by hand, can be
 * running an engine that writes md in a shape this code does not expect. Converging is cheap — uv re-resolves
 * an already-satisfied set in about 3 seconds — and it is the same rule dependencies follow (DESIGN.md §17):
 * the machine catches up by itself, in the background, and failing just means no memory this time.
 *
 * `force` is for an engine that answers but cannot write, which is what a drifted dependency looks like from
 * out here: reinstall the whole set rather than trusting it.
 */
async function syncEngine(force = false): Promise<string | undefined> {
  const had = bin();
  if (process.env.CREW_MEMORY_INSTALL === '0') return had;
  let uv = uvBin();
  if (!uv) {
    // An engine is already here and no uv to check it with: use it as it is rather than touching the machine.
    if (had && !force) return had;
    console.log('[crew] 记忆：这台机器没有 uv，先装 uv…');
    try {
      await exec('/bin/sh', ['-lc', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], { timeout: 5 * 60_000 });
    } catch (e) {
      console.warn('[crew] 记忆：uv 装不上 —', (e as Error).message.slice(0, 120));
      return had;
    }
    uv = uvBin();
    if (!uv) return had;
  }
  const p = pins();
  const args = ['tool', 'install', '--python', '3.12', ...(force ? ['--force'] : []), ...p.with.flatMap((w) => ['--with', w]), p.everos];
  if (!had) console.log(`[crew] 记忆：这台机器还没有记忆引擎，装一个（${p.everos}，几分钟）…`);
  else if (force) console.log('[crew] 记忆：按钉死的版本重装引擎…');
  try {
    await exec(uv, args, { timeout: 20 * 60_000, maxBuffer: 16 << 20 });
  } catch (e) {
    // Offline, PyPI unreachable, a pin that no longer exists: keep whatever is already here.
    console.warn(`[crew] 记忆：引擎${had ? '版本对不齐' : '装不上'} —`, (e as Error).message.slice(0, 200));
    return had;
  }
  const got = bin();
  if (got && !had) console.log('[crew] 记忆：引擎装好了');
  return got ?? had;
}

/**
 * Whether the engine can actually take a memory — which is not the same question as whether it is running.
 *
 * `/health` only proves the process is up. On 2026-09-10 the sidecar answered `{"status":"ok"}` for a whole
 * day while every single write returned 500 (an everalgo version skew), and from the outside that is
 * indistinguishable from a quiet week: memory just never appears. So startup writes one throwaway line and
 * looks at the answer. It costs one boundary call per process start.
 *
 * The line is an assistant message owned by `crew`: a single message with no tool calls is dropped by the
 * agent extractor, so nothing is ever made of it, and it never reaches the user track.
 */
async function probe(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/v1/memory/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: '__probe__', app_id: APP, project_id: SPACE, messages: [{ sender_id: CREW, role: 'assistant', timestamp: Date.now(), content: '（启动自检）' }] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (r.ok) return true;
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    console.warn(`[crew] 记忆：引擎起来了但写不进去（${r.status} ${j.error?.message ?? ''}）`);
    said(r.status);
    return false;
  } catch (e) {
    console.warn('[crew] 记忆：自检没跑通 —', (e as Error).message.slice(0, 120));
    return false;
  }
}

async function health(ms = 1500): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Model and key come from the product's own config, through the environment: the engine's own
 * config file never holds a credential. Everything else is left at its defaults.
 *
 * The four base URLs point at the local meter (meter-proxy.ts) whenever it is up, so the engine's spending lands
 * in the same ledger as everything else — and the sidecar gets a placeholder where the key used to be. With no
 * proxy it talks to OpenRouter directly with the real key, as it always did.
 */
function childEnv(root: string): Record<string, string> {
  /**
   * One leg of the engine: which model, where it goes, and with whose key. Each of the four can be on a different
   * provider now, so each is resolved on its own — through the meter proxy when it is up (the sidecar then holds a
   * placeholder rather than a credential), straight at the provider when it is not.
   */
  const leg = (spec: string | undefined, fallback: string) => {
    const at = endpointOf(spec) ?? endpointOf(fallback);
    if (!at) return undefined;
    return { model: at.model, base: proxyBase ? `${proxyBase}/${at.provider}` : at.baseUrl, key: proxyBase ? PLACEHOLDER : at.key };
  };
  const llm = leg(config.lightModel ?? config.model, 'openrouter/deepseek/deepseek-v4-flash')!;
  const eyes = leg(config.visionModel, DEFAULT_VISION_MODEL)!;
  const vec = leg(config.embeddingModel, 'openrouter/baai/bge-m3')!;
  const re = hasRerank() ? leg(rerankModel(), 'openrouter/cohere/rerank-v3.5') : undefined;
  return {
    ...process.env,
    EVEROS_ROOT: root,
    EVEROS_LLM__MODEL: llm.model,
    EVEROS_LLM__API_KEY: llm.key,
    EVEROS_LLM__BASE_URL: llm.base,
    // Cheap and multilingual. Changing this invalidates every vector in the index, so it is not a knob: a
    // change means a rebuild.
    EVEROS_EMBEDDING__MODEL: vec.model,
    EVEROS_EMBEDDING__API_KEY: vec.key,
    EVEROS_EMBEDDING__BASE_URL: vec.base,
    // Parsing an uploaded document (knowledge) goes through a model that can read pages, not the text model.
    EVEROS_MULTIMODAL__MODEL: eyes.model,
    EVEROS_MULTIMODAL__API_KEY: eyes.key,
    EVEROS_MULTIMODAL__BASE_URL: eyes.base,
    // Re-scoring for knowledge retrieval and the agent track's hybrid lane.
    ...(re
      ? {
          EVEROS_RERANK__PROVIDER: 'vllm',
          EVEROS_RERANK__MODEL: re.model,
          EVEROS_RERANK__API_KEY: re.key,
          EVEROS_RERANK__BASE_URL: re.base,
        }
      : {}),
    // Both tracks: what the user is like, and how a bot got something done.
    EVEROS_MEMORIZE__MODE: 'agent',
    EVEROS_MEMORY__TIMEZONE: process.env.TZ || 'Asia/Shanghai',
  } as Record<string, string>;
}

/** `everos server start` refuses to run without its two config files; the CLI is what writes them. */
async function scaffold(root: string, exe: string): Promise<void> {
  mkdirSync(root, { recursive: true });
  if (existsSync(join(root, 'everos.toml')) && existsSync(join(root, 'ome.toml'))) return;
  await new Promise<void>((resolve) => {
    const p = spawn(exe, ['init', '--root', root, '--force'], { env: childEnv(root), stdio: 'ignore' });
    p.on('close', () => resolve());
    p.on('error', () => resolve());
  });
}

/**
 * Bring memory up, or decide there is none. Called once at startup and never awaited by a turn:
 * the first few minutes of a fresh machine run without memory, which is correct — there isn't any yet.
 */
let proxyBase: string | undefined;

export function startMemory(): Promise<boolean> {
  if (starting) return starting;
  starting = (async () => {
    if (process.env.CREW_MEMORY === '0') {
      console.log('[crew] 记忆：已关闭（CREW_MEMORY=0）');
      return false;
    }
    if (!endpointOf(config.lightModel ?? config.model)) {
      console.log('[crew] 记忆：对话模型还没配钥匙，先不开');
      return false;
    }
    // Up before the engine is spawned: its base URLs are written into the environment it starts with.
    proxyBase = await startMeterProxy();
    // Something already listening (a dev restart, or a sidecar the user runs themselves): use it, once it
    // has shown it can take a write.
    if (await health()) {
      up = true;
      if (await probe()) {
        console.log(`[crew] 记忆：接上已在跑的 EverOS（${BASE}）`);
        void refreshProfile();
        return true;
      }
      up = false;
      console.warn('[crew] 记忆：那个 EverOS 写不进去，先用纯文本那套');
      return false;
    }
    // Bring this machine's engine to the version engine.json names, whatever it has now.
    const exe = await syncEngine();
    if (!exe) {
      console.log('[crew] 记忆：这台机器没装 EverOS，也没装成，先用纯文本那套');
      return false;
    }
    const root = memoryRoot();
    await scaffold(root, exe);
    let missing = false;
    const spawnOne = () => {
      const c = spawn(exe, ['server', 'start', '--host', '127.0.0.1', '--port', String(PORT), '--root', root], {
        env: childEnv(root),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // The engine logs every request. Nobody reading these pipes would fill the buffer and stall it, so they
      // are drained here and only the tail is kept, for the one line printed if it dies.
      const keep = (d: Buffer) => {
        tail = (tail + d.toString()).slice(-2000);
      };
      c.stdout?.on('data', keep);
      c.stderr?.on('data', keep);
      c.on('error', (e) => {
        // No such binary: it is not installed, and trying again cannot change that.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') missing = true;
        else console.warn('[crew] 记忆：起不来 —', (e as Error).message);
        if (child === c) child = undefined;
      });
      c.on('exit', (code) => {
        if (up) console.warn(`[crew] 记忆：EverOS 退出了（${code}），先用纯文本那套`);
        up = false;
        if (child === c) child = undefined;
      });
      return c;
    };
    child = spawnOne();
    // The engine rebuilds its index on first start, and the start right after an install is slower still
    // (cold bytecode) — 40 seconds was not enough for that one and the whole thing gave up while it was
    // still booting. Nothing waits on this (it runs in the background), so the window is generous; the only
    // thing it costs is how long a truly broken engine takes to be declared broken.
    // It may also die on the first try for a reason that fixes itself: right after this server restarted,
    // the previous sidecar can still be holding the port for a second or two.
    let spawns = 1;
    let repaired = false;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await health()) {
        up = true;
        if (await probe()) {
          console.log(`[crew] 记忆：EverOS 就位（${BASE}，${root}）`);
          void refreshProfile();
          return true;
        }
        up = false;
        // It runs and refuses to write. That is what a drifted dependency looks like from here, so put the
        // whole set back the way engine.json says and try once more.
        child?.kill();
        child = undefined;
        if (repaired) return false;
        repaired = true;
        const fixed = await syncEngine(true);
        if (!fixed) return false;
        child = spawnOne();
        i = 0;
        continue;
      }
      if (missing) {
        console.log('[crew] 记忆：这台机器没装 EverOS，先用纯文本那套');
        return false;
      }
      if (!child) {
        if (spawns >= 3) break;
        spawns += 1;
        child = spawnOne();
      }
    }
    if (!up) {
      console.warn(`[crew] 记忆：EverOS 两分钟内没起来（试了 ${spawns} 次），先用纯文本那套${tail ? ` — ${tail.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-1)[0].slice(0, 160)}` : ''}`);
      child?.kill();
      child = undefined;
    }
    return up;
  })();
  return starting;
}

export function stopMemory() {
  for (const t of idle.values()) clearTimeout(t);
  idle.clear();
  child?.kill();
  child = undefined;
  up = false;
}

/**
 * What the engine said about itself, once. Its 500s arrive as `{"error": "Internal server error"}` with the
 * real cause — a version skew inside everalgo, a missing key — only in its own stdout, which this process
 * drains and drops. Without this, a broken write path looks exactly like a quiet one: memory simply never
 * appears, and nothing in the log says why.
 */
function said(status: number) {
  if (saidWhy || status < 500 || !tail) return;
  saidWhy = true;
  const lines = tail.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const blame = [...lines].reverse().find((l) => /Error|Exception|Traceback/.test(l)) ?? lines[lines.length - 1];
  console.warn(`[crew] 记忆：引擎自己报的错 — ${blame.slice(0, 300)}`);
}

async function call<T>(path: string, body: unknown, ms: number): Promise<T | undefined> {
  if (!up) return undefined;
  try {
    const r = await fetch(`${BASE}/api/v1/memory/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const j = (await r.json()) as { data?: T; error?: { message?: string } };
    if (!r.ok || j.error) {
      console.warn(`[crew] 记忆 ${path}：${j.error?.message ?? r.status}`);
      said(r.status);
      return undefined;
    }
    return j.data;
  } catch (e) {
    // A timeout here is not a failure of the turn; it is memory being slow.
    if ((e as Error).name !== 'TimeoutError') console.warn(`[crew] 记忆 ${path}：${(e as Error).message}`);
    return undefined;
  }
}

// ── writing ───────────────────────────────────────────────────────────────────

/**
 * One turn, after it has settled. Fire and forget.
 *
 * Two shapes matter to the engine and neither is obvious:
 *   · a `role: "tool"` message must carry a `tool_call_id` pairing it to a call, so tool *results*
 *     are not sent at all — what a tool returned is already summarised in what the bot said next;
 *   · an agent case is only extracted from a trajectory that ENDS in the bot's own final answer
 *     (and has at least three tool rounds, and went sideways at some point). A turn is exactly that
 *     shape, which is why this is per-turn and not per-message.
 */
export async function turnDone(threadId: string, msgs: EvMsg[]): Promise<void> {
  if (!up || !msgs.length) return;
  const store = deps?.store;
  const messages = msgs
    .map((m) => ({
      sender_id: m.senderId,
      role: m.role,
      timestamp: m.ts,
      // The extractor's input is the raw conversation, and a credential has met a page before now.
      content: store ? redactSecrets(m.text, store) : m.text,
      ...(m.tools?.length
        ? {
            tool_calls: m.tools.slice(0, 12).map((t, i) => ({
              id: `c${i}`,
              type: 'function' as const,
              function: { name: t.name, arguments: (t.args ?? '{}').slice(0, 2000) },
            })),
          }
        : {}),
    }))
    .filter((m) => m.content.trim() || m.tool_calls?.length);
  if (!messages.length) return;
  for (const m of msgs) if (m.role === 'assistant') (contributors.get(threadId) ?? contributors.set(threadId, new Set()).get(threadId)!).add(m.senderId);
  await call('add', { ...writeScope(threadId), messages }, 20_000);
  // Reset the quiet timer: the memory for this thread is cut when the work on it stops.
  const prev = idle.get(threadId);
  if (prev) clearTimeout(prev);
  idle.set(
    threadId,
    setTimeout(() => {
      idle.delete(threadId);
      void flush(threadId);
    }, IDLE_FLUSH_MS),
  );
}

/** Force the boundary: the thread went quiet, a matter was closed, or the server is going down. */
export async function flush(threadId: string): Promise<void> {
  if (!up) return;
  const t = idle.get(threadId);
  if (t) {
    clearTimeout(t);
    idle.delete(threadId);
  }
  const d = await call<{ status?: string }>('flush', writeScope(threadId), 300_000);
  if (d?.status !== 'extracted') return;
  void refreshProfile();
  const who = contributors.get(threadId);
  contributors.delete(threadId);
  for (const botId of who ?? []) {
    hasAgent.delete(botId);
    deps?.onExtract?.(botId);
  }
  turnCache.clear();
}

/** Every thread with unfinished business, before the process goes away. */
export async function flushAll(): Promise<void> {
  await Promise.all([...idle.keys()].map((t) => flush(t)));
}

/**
 * A fact the product holds by hand (the `remember` tool, or the user editing PROFILE.md) said to the
 * engine as if the user had said it — otherwise the two halves of "what we know about him" drift apart.
 */
export async function statedFact(threadId: string, fact: string): Promise<void> {
  if (!up || !fact.trim()) return;
  await turnDone(threadId, [{ role: 'user', senderId: HUMAN, text: fact.trim(), ts: Date.now() }]);
}

/** Promote one bot's way of working to the whole crew. An explicit act, never a side effect of a turn. */
export async function promote(text: string, fromBotName: string): Promise<boolean> {
  if (!up || !text.trim()) return false;
  const now = Date.now();
  const d = await call(
    'add',
    {
      ...writeScope(`crew_${now}`),
      messages: [
        { sender_id: HUMAN, role: 'user', timestamp: now, content: `把这条做法定为团队通用（来自 ${fromBotName}）：${text.trim()}` },
        { sender_id: CREW, role: 'assistant', timestamp: now + 1, content: text.trim() },
      ],
    },
    20_000,
  );
  if (d) void flush(`crew_${now}`);
  return !!d;
}

// ── reading ───────────────────────────────────────────────────────────────────

interface Episode {
  summary?: string;
  episode?: string;
  subject?: string;
  timestamp?: string;
  score?: number;
}
interface Skill {
  name?: string;
  description?: string;
  content?: string;
  updated_at?: string;
}
interface Case {
  task_intent?: string;
  approach?: string;
  key_insight?: string;
  timestamp?: string;
}
interface SearchData {
  episodes?: Episode[];
  profiles?: { profile_data?: ProfileData }[];
  agent_cases?: Case[];
  agent_skills?: Skill[];
}
interface ProfileData {
  summary?: string;
  explicit_info?: { category?: string; description?: string }[];
  implicit_traits?: { trait?: string; description?: string }[];
}

const day = (iso?: string) => (iso ? iso.slice(5, 10) : '');
const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * The user's resident profile, compressed to lines that fit in a prompt. The engine's own profile
 * carries its evidence for every claim, which is right for a record and wrong for an instruction.
 */
async function refreshProfile(): Promise<void> {
  const d = await call<SearchData>('get', { ...readUser(), memory_type: 'profile', page: 1, page_size: 5 }, 8000);
  const p = d?.profiles?.[0]?.profile_data;
  if (!p) return;
  const lines = [
    ...(p.explicit_info ?? []).map((e) => e.description ?? ''),
    ...(p.implicit_traits ?? []).map((e) => e.description ?? ''),
  ]
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((l) => trim(l, 60));
  profileCache = [...new Set(lines)].slice(0, 8);
}

export const profileLines = () => profileCache;

/**
 * Whether an agent track has anything in it at all. Most do not: a case is only kept from a trajectory
 * that went sideways and got fixed, so a bot can work for weeks and have none. Searching an empty track
 * still costs an embedding call, so the answer is remembered until that bot extracts something new.
 */
const hasAgent = new Map<string, boolean>();

/** One turn's recall, kept for a minute: a nudge or an empty reply re-runs the turn and must not pay again. */
const turnCache = new Map<string, { at: number; val: Recalled }>();
interface Recalled {
  profile: string[];
  episodes: string[];
  skills: string[];
}

/**
 * What this bot should have in mind for this turn: the cached profile (free), what the user has done
 * before, and what this bot worked out for itself.
 *
 * Measured on the real endpoint: a search is 0.4–0.5 s warm, 3 s cold, and 6 s when the embedding
 * endpoint has a bad minute. So there is a budget and it is generous — the turn behind it takes tens of
 * seconds — but it is a budget: whatever has not arrived is left out and the reply goes ahead without it.
 *
 * The agent track runs `vector` rather than `hybrid` on purpose: the engine's agent hybrid lane demands
 * a rerank provider (or an extra LLM call per turn), and neither belongs in front of the first token.
 */
export async function forTurn(botId: string, query: string, budgetMs = 2500): Promise<Recalled> {
  const out: Recalled = { profile: profileCache, episodes: [], skills: [] };
  if (!up || query.trim().length < 4) return out;
  const q = trim(query.replace(/\s+/g, ' ').trim(), 300);
  const key = `${botId}|${q}`;
  const hit = turnCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return { ...hit.val, profile: profileCache };
  const empty = Promise.resolve(undefined);
  const mine = hasAgent.get(botId) === false ? empty : call<SearchData>('search', { ...readBot(botId), query: q, top_k: 4, method: 'vector' }, budgetMs);
  const his = call<SearchData>('search', { ...readUser(), query: q, top_k: 6, method: 'hybrid' }, budgetMs);
  const crew = hasAgent.get(CREW) === false ? empty : call<SearchData>('search', { ...readCrew(), query: q, top_k: 2, method: 'vector' }, budgetMs);
  const [a, b, c] = await Promise.all([his, mine, crew]);
  if (b) hasAgent.set(botId, !!(b.agent_skills?.length || b.agent_cases?.length));
  if (c) hasAgent.set(CREW, !!(c.agent_skills?.length || c.agent_cases?.length));
  out.episodes = (a?.episodes ?? [])
    .map((e) => `${day(e.timestamp)} ${trim((e.summary || e.episode || e.subject || '').replace(/\s+/g, ' ').trim(), 150)}`)
    .filter((l) => l.trim().length > 6)
    .slice(0, 6);
  const skills = [...(b?.agent_skills ?? []), ...(c?.agent_skills ?? [])].map((s) => `${s.name ?? ''}：${trim((s.content || s.description || '').replace(/\s+/g, ' ').trim(), 180)}`);
  const cases = (b?.agent_cases ?? []).map((k) => `${k.task_intent ?? ''}：${trim((k.key_insight || k.approach || '').replace(/\s+/g, ' ').trim(), 150)}`);
  out.skills = [...skills, ...cases].filter((l) => l.replace(/[：\s]/g, '').length > 4).slice(0, 5);
  if (a || b || c) turnCache.set(key, { at: Date.now(), val: out });
  if (turnCache.size > 40) for (const k of [...turnCache.keys()].slice(0, 20)) turnCache.delete(k);
  return out;
}

/** The `recall` tool: the bot asking for something the turn's own injection would not have found. */
export async function recall(botId: string, query: string, scope: 'user' | 'self' | 'crew', k = 5): Promise<string> {
  if (!up) return '记忆引擎没在跑，只有你身上那几条（工作方式和「你对用户的认知」）。';
  const q = trim(query.replace(/\s+/g, ' ').trim(), 300);
  if (q.length < 2) return '要找什么？给一句具体点的。';
  const top = Math.max(1, Math.min(20, k));
  if (scope === 'user') {
    const d = await call<SearchData>('search', { ...readUser(), query: q, top_k: top, method: 'hybrid', include_profile: true }, 25_000);
    const eps = (d?.episodes ?? []).map((e) => `- ${day(e.timestamp)} ${trim((e.summary || e.episode || '').replace(/\s+/g, ' ').trim(), 300)}`);
    return eps.length ? `关于用户，找到 ${eps.length} 条：\n${eps.join('\n')}` : '这件事没有记录。';
  }
  const who = scope === 'crew' ? readCrew() : readBot(botId);
  // The hybrid lane needs one of the two re-scorers. With a rerank provider configured that is a cross-encoder
  // call; without one the engine's own LLM lane stands in, which costs a whole model call.
  const d = await call<SearchData>('search', { ...who, query: q, top_k: top, method: 'hybrid', enable_llm_rerank: !hasRerank() }, 40_000);
  const items = [
    ...(d?.agent_skills ?? []).map((s) => `- 做法「${s.name ?? ''}」：${trim((s.content || s.description || '').replace(/\s+/g, ' ').trim(), 400)}`),
    ...(d?.agent_cases ?? []).map((k2) => `- ${day(k2.timestamp)} ${k2.task_intent ?? ''}：${trim((k2.approach || k2.key_insight || '').replace(/\s+/g, ' ').trim(), 300)}`),
  ];
  if (items.length) return `${scope === 'crew' ? '团队' : '你自己'}干过的：\n${items.join('\n')}`;
  return scope === 'crew' ? '团队里没有这方面的共识。' : '你没干过这类活，或者干得太顺利，没留下记录（只有出过岔子的活才会被记下来）。';
}

/** Everything a bot has learned about how to work, newest first. Used by the settings panel and by the build loop. */
export async function skillsOf(botId: string): Promise<{ name: string; text: string; at: string }[]> {
  const d = await call<SearchData>('get', { ...readBot(botId), memory_type: 'agent_skill', page: 1, page_size: 50, sort_by: 'updated_at' }, 8000);
  return (d?.agent_skills ?? []).map((s) => ({
    name: s.name ?? '',
    text: (s.content || s.description || '').replace(/\s+/g, ' ').trim(),
    at: s.updated_at ?? '',
  }));
}


// ── the profile as a document ─────────────────────────────────────────────────
//
// md is the engine's truth and it watches the files: editing `user.md` *is* editing memory, and the
// index follows. Nothing else in the product touches these files (the read tools refuse them).

const profilePath = () => join(memoryRoot(), APP, SPACE, 'users', HUMAN, 'user.md');

export interface ProfileEntry {
  category?: string;
  description: string;
  evidence?: string;
}
export interface TraitEntry {
  trait?: string;
  description: string;
  basis?: string;
  evidence?: string;
}
export interface ProfileDoc {
  summary: string;
  explicit: ProfileEntry[];
  traits: TraitEntry[];
  /** the engine's own stamp: the newest conversation that fed this synthesis */
  at: number;
}

function readProfileFile(): { fm: Record<string, unknown>; body: string } | undefined {
  const f = profilePath();
  if (!existsSync(f)) return undefined;
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(readFileSync(f, 'utf8'));
  if (!m) return undefined;
  try {
    return { fm: (YAML.parse(m[1]) as Record<string, unknown>) ?? {}, body: m[2] };
  } catch {
    return undefined;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function profileDoc(): ProfileDoc | undefined {
  const r = readProfileFile();
  if (!r) return undefined;
  const ex = Array.isArray(r.fm.explicit_info) ? (r.fm.explicit_info as Record<string, unknown>[]) : [];
  const tr = Array.isArray(r.fm.implicit_traits) ? (r.fm.implicit_traits as Record<string, unknown>[]) : [];
  return {
    summary: str(r.fm.summary),
    explicit: ex.map((e) => ({ category: str(e.category) || undefined, description: str(e.description), evidence: str(e.evidence) || undefined })),
    traits: tr.map((e) => ({ trait: str(e.trait) || undefined, description: str(e.description), basis: str(e.basis) || undefined, evidence: str(e.evidence) || undefined })),
    at: Number(r.fm.profile_timestamp_ms ?? 0) || 0,
  };
}

/**
 * Change or drop one line of the profile. Two things happen, because the engine re-synthesises this
 * document from its clusters and would otherwise say the same thing again next time: the file is
 * rewritten now (the watcher re-indexes it), and the correction is said to the engine as the user
 * saying it, so the next synthesis has the counter-evidence.
 */
export async function editProfile(kind: 'explicit' | 'trait', index: number, text: string | null): Promise<boolean> {
  const r = readProfileFile();
  if (!r) return false;
  const key = kind === 'explicit' ? 'explicit_info' : 'implicit_traits';
  const list = Array.isArray(r.fm[key]) ? ([...(r.fm[key] as Record<string, unknown>[])] as Record<string, unknown>[]) : [];
  const cur = list[index];
  if (!cur) return false;
  const old = str(cur.description);
  const next = text?.trim() ?? '';
  if (next) list[index] = { ...cur, description: next };
  else list.splice(index, 1);
  r.fm[key] = list;
  writeFileSync(profilePath(), `---\n${YAML.stringify(r.fm)}---\n${r.body}`);
  void statedFact('user_edits', next ? `（更正）「${old}」这条不准确，应该是：${next}` : `（更正）「${old}」这条不对，作废。`);
  void flush('user_edits');
  return true;
}

/** A fact the user typed in by hand. It goes through the engine like anything else the user says. */
export async function addFact(text: string): Promise<boolean> {
  if (!up || !text.trim()) return false;
  await statedFact('user_edits', text.trim());
  await flush('user_edits');
  return true;
}

/** "This is wrong" on a memory that is not editable as a line (an episode): said back as a correction. */
export async function correct(text: string): Promise<boolean> {
  if (!up || !text.trim()) return false;
  await statedFact('user_edits', `（更正）${text.trim()}`);
  void flush('user_edits');
  return true;
}

// ── listings for the memory page ──────────────────────────────────────────────

export interface EpisodeItem {
  id: string;
  subject: string;
  summary: string;
  content: string;
  at: string;
  senders: string[];
  session: string;
}
interface RawEpisode {
  id?: string;
  subject?: string;
  summary?: string;
  episode?: string;
  timestamp?: string;
  sender_ids?: string[];
  session_id?: string;
}
const toEpisode = (e: RawEpisode): EpisodeItem => ({
  id: e.id ?? '',
  subject: e.subject ?? '',
  summary: e.summary ?? '',
  content: e.episode ?? '',
  at: e.timestamp ?? '',
  senders: e.sender_ids ?? [],
  session: e.session_id ?? '',
});

/** Newest first; or, with a query, what the engine's hybrid search finds. */
export async function episodes(query: string, page = 1, size = 30): Promise<{ items: EpisodeItem[]; total: number }> {
  if (!up) return { items: [], total: 0 };
  const q = query.trim();
  if (q) {
    const d = await call<{ episodes?: RawEpisode[] }>('search', { ...readUser(), query: trim(q, 300), top_k: 30, method: 'hybrid' }, 30_000);
    const items = (d?.episodes ?? []).map(toEpisode);
    return { items, total: items.length };
  }
  const d = await call<{ episodes?: RawEpisode[]; total_count?: number }>('get', { ...readUser(), memory_type: 'episode', page, page_size: Math.min(100, size), sort_by: 'timestamp', sort_order: 'desc' }, 15_000);
  return { items: (d?.episodes ?? []).map(toEpisode), total: d?.total_count ?? 0 };
}

export interface CaseItem {
  id: string;
  botId: string;
  intent: string;
  approach: string;
  insight: string;
  quality: number;
  at: string;
  session: string;
}
export interface SkillItem {
  id: string;
  botId: string;
  name: string;
  description: string;
  content: string;
  confidence: number;
  maturity: number;
  sources: string[];
}

/** Every bot's cases (or one bot's), newest first. One call per bot: the engine partitions by owner. */
export async function cases(botIds: string[]): Promise<CaseItem[]> {
  if (!up) return [];
  const per = await Promise.all(
    botIds.map(async (botId) => {
      const d = await call<{ agent_cases?: Record<string, unknown>[] }>('get', { ...readBot(botId), memory_type: 'agent_case', page: 1, page_size: 100, sort_by: 'timestamp', sort_order: 'desc' }, 15_000);
      return (d?.agent_cases ?? []).map((k) => ({
        id: str(k.id),
        botId,
        intent: str(k.task_intent),
        approach: str(k.approach),
        insight: str(k.key_insight),
        quality: Number(k.quality_score ?? 0) || 0,
        at: str(k.timestamp),
        session: str(k.session_id),
      }));
    }),
  );
  return per.flat().sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function skills(botIds: string[]): Promise<SkillItem[]> {
  if (!up) return [];
  const per = await Promise.all(
    botIds.map(async (botId) => {
      const d = await call<{ agent_skills?: Record<string, unknown>[] }>('get', { ...readBot(botId), memory_type: 'agent_skill', page: 1, page_size: 100, sort_by: 'updated_at', sort_order: 'desc' }, 15_000);
      return (d?.agent_skills ?? []).map((k) => ({
        id: str(k.id),
        botId,
        name: str(k.name),
        description: str(k.description),
        content: str(k.content),
        confidence: Number(k.confidence ?? 0) || 0,
        maturity: Number(k.maturity_score ?? 0) || 0,
        sources: Array.isArray(k.source_case_ids) ? (k.source_case_ids as string[]) : [],
      }));
    }),
  );
  return per.flat();
}

/** The team's shared ways of working (owner `crew`), for the same page. */
export const crewSkills = () => skills([CREW]);
export const CREW_ID = CREW;

// ── knowledge ────────────────────────────────────────────────────────────────
//
// The other half of what a bot knows, and the opposite shape from memory: memory grows out of the
// conversation, knowledge is a document the user hands over. The engine splits an upload into a tree
// of topics (each with a summary and its full text), classifies it into one of its own categories, and
// keeps it under `knowledge/<category>/<title>/`. No owner: a document is the whole crew's.
//
// It is also the one kind the engine can really delete, so "remove" here means removed.

const kBase = `${BASE}/api/v1/knowledge`;
const kScope = `app_id=${APP}&project_id=${SPACE}`;

export interface KDoc {
  docId: string;
  category: string;
  title: string;
  topics: number;
  at: string;
}
export interface KTopic {
  id: string;
  name: string;
  path: string;
  depth: number;
  summary: string;
  content?: string;
}
export interface KDocDetail {
  docId: string;
  category: string;
  title: string;
  summary: string;
  source?: string;
  topics: KTopic[];
}

async function kcall<T>(path: string, init?: RequestInit, ms = 20_000): Promise<T | undefined> {
  if (!up) return undefined;
  try {
    const r = await fetch(`${kBase}${path}`, { ...init, signal: AbortSignal.timeout(ms) });
    const j = (await r.json()) as { data?: T; error?: { message?: string } };
    if (!r.ok || j.error) {
      console.warn(`[crew] 知识 ${path}：${j.error?.message ?? r.status}`);
      return undefined;
    }
    return j.data;
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError') console.warn(`[crew] 知识 ${path}：${(e as Error).message}`);
    return undefined;
  }
}

const str2 = (v: unknown) => (typeof v === 'string' ? v : '');

export async function kDocs(): Promise<{ items: KDoc[]; categories: { id: string; docs: number }[] }> {
  const [d, c] = await Promise.all([
    kcall<{ documents?: Record<string, unknown>[] }>(`/documents?${kScope}&page_size=100`),
    kcall<{ categories?: Record<string, unknown>[] }>(`/categories?${kScope}`),
  ]);
  return {
    items: (d?.documents ?? []).map((x) => ({ docId: str2(x.doc_id), category: str2(x.category_id), title: str2(x.title), topics: Number(x.topic_count ?? 0) || 0, at: str2(x.created_at) })),
    // Only the categories that actually hold something: the engine ships a whole taxonomy.
    categories: (c?.categories ?? []).map((x) => ({ id: str2(x.category_id), docs: Number(x.document_count ?? 0) || 0 })).filter((x) => x.docs > 0),
  };
}

export async function kDoc(docId: string): Promise<KDocDetail | undefined> {
  const d = await kcall<Record<string, unknown>>(`/documents/${encodeURIComponent(docId)}?${kScope}`);
  if (!d) return undefined;
  const topics = Array.isArray(d.topics) ? (d.topics as Record<string, unknown>[]) : [];
  return {
    docId: str2(d.doc_id),
    category: str2(d.category_id),
    title: str2(d.title),
    summary: str2(d.summary),
    source: str2(d.source_name) || undefined,
    topics: topics.map((t) => ({ id: str2(t.topic_id), name: str2(t.topic_name), path: str2(t.topic_path), depth: Number(t.depth ?? 1) || 1, summary: str2(t.summary) })),
  };
}

export async function kTopic(topicId: string): Promise<KTopic | undefined> {
  const d = await kcall<Record<string, unknown>>(`/topics/${encodeURIComponent(topicId)}?${kScope}`);
  if (!d) return undefined;
  return { id: str2(d.topic_id), name: str2(d.topic_name), path: str2(d.topic_path), depth: Number(d.depth ?? 1) || 1, summary: str2(d.summary), content: str2(d.content) };
}

/**
 * Hand a file to the engine. Slow — splitting a 30 KB design doc into 25 topics took 109 s — so this is
 * never awaited by a turn; the caller reports "在读" and the document shows up when it is done.
 */
export async function kAdd(name: string, bytes: Buffer, title: string, category?: string): Promise<{ docId: string; topics: number } | undefined> {
  if (!up) return undefined;
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)]), name);
  form.set('title', title.trim() || name);
  form.set('app_id', APP);
  form.set('project_id', SPACE);
  if (category) form.set('category_id', category);
  const d = await kcall<{ doc_id?: string; topic_count?: number }>('/documents', { method: 'POST', body: form }, 600_000);
  return d ? { docId: str2(d.doc_id), topics: Number(d.topic_count ?? 0) || 0 } : undefined;
}

/** Really gone, unlike a memory: the document and every topic under it. */
export async function kRemove(docId: string): Promise<boolean> {
  const d = await kcall<{ doc_id?: string }>(`/documents/${encodeURIComponent(docId)}?${kScope}`, { method: 'DELETE' });
  return !!d;
}

/**
 * Retrieval over the topics.
 *
 * The engine's own `/knowledge/search` needs a rerank provider for every method (`_require_search_providers`),
 * which is configured above. The word-overlap pass below stays as the fallback for when it is not — no key, a
 * rerank model that went away, the account out of credits — because three weak lines still beat none.
 */
let kIndex: { at: number; rows: { topic: KTopic; doc: string }[] } | undefined;

async function kAllTopics(): Promise<{ topic: KTopic; doc: string }[]> {
  if (kIndex && Date.now() - kIndex.at < 120_000) return kIndex.rows;
  const { items } = await kDocs();
  const detail = await Promise.all(items.slice(0, 40).map((d) => kDoc(d.docId)));
  const rows = detail.flatMap((d) => (d ? d.topics.map((topic) => ({ topic, doc: d.title })) : []));
  kIndex = { at: Date.now(), rows };
  return rows;
}

export async function kSearch(query: string, k = 8): Promise<{ topic: KTopic; doc: string; score: number }[]> {
  if (!up) return [];
  const q = trim(query.replace(/\s+/g, ' ').trim(), 300);
  if (q.length < 2) return [];
  const d = await kcall<{ hits?: Record<string, unknown>[] }>('/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: q, app_id: APP, project_id: SPACE, top_k: k, method: 'hybrid', include_content: false }),
  }, 30_000);
  if (d?.hits?.length) {
    return d.hits.map((h) => ({
      topic: { id: str2(h.topic_id), name: str2(h.topic_name), path: str2(h.topic_path), depth: Number(h.depth ?? 1) || 1, summary: str2(h.summary) },
      doc: str2((h.document as Record<string, unknown> | undefined)?.title),
      score: Number(h.score ?? 0) || 0,
    }));
  }
  // Word overlap over what we hold. CJK has no spaces, so a query is also cut into 2-grams.
  const rows = await kAllTopics();
  const words = new Set<string>();
  for (const w of q.toLowerCase().split(/[\s,，。、;；:：?？!！()（）]+/)) {
    if (!w) continue;
    if (/[a-z0-9]/i.test(w) && w.length > 1) words.add(w);
    for (let i = 0; i < w.length - 1; i++) if (/[\u4e00-\u9fa5]/.test(w[i])) words.add(w.slice(i, i + 2));
  }
  if (!words.size) return [];
  return rows
    .map((r) => {
      const name = r.topic.name.toLowerCase();
      const hay = `${name} ${r.topic.summary} ${r.doc}`.toLowerCase();
      let hit = 0;
      for (const w of words) if (hay.includes(w)) hit += (name.includes(w) ? 2 : 1);
      return { ...r, score: hit / (words.size * 2) };
    })
    // Ranked by how much of the query a topic actually contains, not by a ratio threshold: a two-word
    // query about one section matches only a fraction of its own grams and would fail any fixed floor.
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** The段 that goes in front of a turn: three topic summaries and which document they came from. */
export async function knowledgeFor(query: string, budgetMs = 2500): Promise<string[]> {
  if (!up || query.trim().length < 4) return [];
  const hits = await Promise.race([kSearch(query, 3), new Promise<never[]>((r) => setTimeout(() => r([]), budgetMs))]).catch(() => []);
  return hits.slice(0, 3).map((h) => `${h.doc}｜${h.topic.name}：${trim(h.topic.summary.replace(/\s+/g, ' ').trim(), 160)}`);
}
