/**
 * One want-set per machine, reconciled in the background.
 *
 * Dependencies used to be something the app showed: a list of what each manual needed, and a button that installed
 * it. That is the wrong shape twice over — nobody wants to read a list of pip packages, and a bot that hits a
 * missing import halfway through a deliverable has already burned the turn. So: anything that arrives here (a
 * manual, an MCP server) declares what it needs, this file unions those declarations into the machine's want-set,
 * and one serialized worker converges the machine to it. Use time only ever asks "is it here yet?", with a short
 * bounded wait, because in practice a package is seconds away, not minutes.
 *
 * The want-set is derived, never stored. It is read back out of the manuals and connections that are actually here,
 * so it needs no syncing of its own: the manuals travel (runtime.exportArchive), and every machine that receives
 * them — a fresh cloud box, a rebuilt container, the computer coming home — reconstructs the same want-set and
 * installs on its own.
 */
import { basename } from 'node:path';
import type { Integration } from './types.ts';
import type { SkillStore } from './skills.ts';
import { type Requires, type Ready, describe, ensure, missing, restoreSystem, sanitize } from './tools.ts';
import { pipNameFor } from './requires.ts';

const NPX = new Set(['npx', 'pnpx', 'bunx', 'yarn']);
const PYX = new Set(['uvx', 'pipx']);
/** Interpreters and drivers that are the machine's own, not something to record as a dependency. */
const HOST = new Set(['sh', 'bash', 'zsh', 'node', 'deno', 'bun', 'python', 'python3', 'uv', 'npm', 'pnpm', 'docker', 'env']);

/**
 * What an MCP connection needs to start. The library entry may say so (`mcp.npm`), but most connections are added
 * by a bot or by hand as a command line, and `npx -y some-server` is a package like any other: recorded here, it
 * gets installed into the product's own prefix instead of being downloaded on every start — and it comes back by
 * itself on the next machine.
 */
export function mcpRequires(i: Pick<Integration, 'kind' | 'command' | 'args'>): Requires {
  if (i.kind !== 'mcp' || !i.command) return {};
  const cmd = basename(i.command);
  const args = (i.args ?? []).filter((a) => !a.startsWith('-'));
  if (NPX.has(cmd)) return { npm: args[0] ? [args[0]] : [] };
  if (PYX.has(cmd)) return { pip: args[0] ? [args[0]] : [] };
  if (cmd === 'python' || cmd === 'python3') {
    const m = (i.args ?? []).indexOf('-m');
    const mod = m >= 0 ? (i.args ?? [])[m + 1] : undefined;
    return mod ? { pip: [pipNameFor(mod.split('.')[0])] } : {};
  }
  return HOST.has(cmd) ? {} : { bin: [cmd] };
}

const has = (r: Requires) => !!(r.pip?.length || r.npm?.length || r.bin?.length);
const names = (r: Requires) => [...(r.pip ?? []), ...(r.npm ?? []), ...(r.bin ?? [])];

interface Sources {
  skills: () => SkillStore;
  integrations: () => Integration[];
}

let sources: Sources | undefined;
/** Packages the worker is installing right now, so a bot asking about them is told "wait" rather than "missing". */
const installing = new Set<string>();
let running = false;
let again = '';
let timer: NodeJS.Timeout | undefined;

export function initDeps(s: Sources) {
  sources = s;
}

/** Everything this machine should be able to run, and where each need came from. */
export function wantSet(): { entry: string; req: Requires }[] {
  if (!sources) return [];
  const out: { entry: string; req: Requires }[] = [];
  const sk = sources.skills();
  for (const d of sk.list()) {
    const r = sk.requiresOf(d.name);
    if (r && has(r)) out.push({ entry: `skill:${d.name}`, req: sanitize(r) });
  }
  for (const i of sources.integrations()) {
    const r = sanitize(mcpRequires(i));
    if (has(r)) out.push({ entry: `mcp:${i.name}`, req: r });
  }
  return out;
}

/**
 * Install whatever the want-set says is not here. Serialized, and re-entrant in the only way that matters: a call
 * that lands mid-pass leaves a note, and the pass runs again rather than in parallel.
 */
export async function reconcile(reason: string): Promise<void> {
  if (!sources) return;
  if (running) {
    again = reason;
    return;
  }
  running = true;
  try {
    do {
      again = '';
      const want = wantSet();
      const todo: { entry: string; req: Requires }[] = [];
      for (const w of want) {
        const left = await missing(w.req).catch(() => undefined);
        if (left && has(left)) todo.push({ entry: w.entry, req: left });
      }
      if (todo.length) {
        const all = [...new Set(todo.flatMap((t) => names(t.req)))];
        console.log(`[crew] 依赖（${reason}）：${all.join('、')} 不在这台机器上，后台装…`);
        for (const n of all) installing.add(n);
        try {
          for (const t of todo) {
            const r = await ensure(t.req, t.entry).catch((e: Error) => ({ ok: false, note: e.message }) as Ready);
            if (!r.ok) console.warn(`[crew] 依赖：${t.entry} 还差 ${r.note ?? ''}`);
            for (const n of names(t.req)) installing.delete(n);
          }
        } finally {
          installing.clear();
        }
        // System binaries are not pip's or npm's to install; `ensure` only records them. In the container — which is
        // ours, and is rebuilt from an image that drops them — putting them back is the same background job.
        if (todo.some((t) => t.req.bin?.length)) await restoreSystem().catch(() => undefined);
        console.log('[crew] 依赖：这一轮装完');
      }
    } while (again);
  } finally {
    running = false;
  }
}

/** Something arrived that may need packages. Debounced: ten manuals seeded at boot are one pass. */
export function kick(reason: string, delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void reconcile(reason).catch((e: Error) => console.warn('[crew] 依赖收敛失败：', e.message));
  }, delay);
  timer.unref?.();
}

/**
 * Use time. Nearly always this returns immediately because the worker installed it minutes ago; when it does not,
 * waiting a few seconds beats telling the bot to come back — most packages are seconds, and only the rare heavy one
 * (a browser, an office suite) is worth handing back as "still installing".
 */
export async function ready(req: Requires, forEntry: string, budgetMs = 25_000): Promise<{ ok: boolean; pending?: string[]; note?: string }> {
  const left = await missing(req).catch(() => undefined);
  if (!left || !has(left)) return { ok: true };
  const want = names(left);
  for (const n of want) installing.add(n);
  const job = ensure(req, forEntry)
    .catch((e: Error) => ({ ok: false, note: e.message, installed: { pip: [], npm: [] }, missing: left }) as Ready)
    .finally(() => {
      for (const n of want) installing.delete(n);
    });
  const done = await Promise.race([job, new Promise<undefined>((r) => setTimeout(() => r(undefined), budgetMs))]);
  if (!done) return { ok: false, pending: want, note: `正在装 ${want.join('、')}，装好就能用` };
  return done.ok ? { ok: true } : { ok: false, note: done.note };
}

/** One line for the system prompt: ready, on its way, or not happening here. */
export async function line(req: Requires): Promise<string> {
  const state = await describe(req).catch(() => '就位');
  if (state === '就位') return '就位';
  const left = await missing(req).catch(() => ({}) as Requires);
  const waiting = names(left).filter((n) => installing.has(n));
  if (waiting.length && waiting.length === names(left).length) return `正在装 ${waiting.join('、')}`;
  return state;
}
