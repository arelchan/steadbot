/**
 * What the crew spends, all of it.
 *
 * The bots' own turns are written by pi into each bot's session log, which is where 用量 used to read the whole
 * report from — and that is why the page could only ever see one model: everything else the product does with a
 * model happens outside a session. Writing an identity at birth, rewriting a manual, reading a screenshot, driving
 * a screen, drawing, searching, embedding the pool, and the memory engine's own traffic are all real money on the
 * same key. Measured on the live machine: OpenRouter had billed $11.49 while the page could account for $2.93.
 *
 * So there is one ledger, and every call that is not a bot's own turn goes through here. New model calls that skip
 * it show up as a hole in the report rather than silently: that is the point of having one door.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Usage } from '@earendil-works/pi-ai';
import { config } from './config.ts';

/** What the money was spent on, in the words the app shows (types.ts owns the list; the client shows it). */
export type { UsageKind } from './types.ts';
import type { UsageKind } from './types.ts';

export interface UsageEntry {
  ts: number;
  /** Which bot this was for. Absent when the product itself spent it. */
  who?: string;
  kind: UsageKind;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Things that are not tokens: images drawn, search results, documents parsed. */
  units?: number;
  cost: number;
  /** A failed call still costs (prompt tokens are billed); it is marked so the report can say so. */
  ok?: boolean;
}

const file = () => join(config.home, 'usage.jsonl');
const KEEP_DAYS = 120;

/** Bumped by every write, so whoever is showing the ledger knows there is something new to show. */
let version = 0;
export const ledgerVersion = () => version;

/** One line per call. Append-only; the report reads it back (usage.ts). */
export function record(e: UsageEntry): void {
  version += 1;
  try {
    appendFileSync(file(), JSON.stringify(e) + '\n');
  } catch (err) {
    console.warn('[crew] 记账失败：', (err as Error).message);
  }
}

/** Read the ledger back, newest lines last. Anything unparseable is skipped rather than fatal. */
export function entries(since: number): UsageEntry[] {
  const f = file();
  if (!existsSync(f)) return [];
  const out: UsageEntry[] = [];
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.length < 2) continue;
      try {
        const e = JSON.parse(line) as UsageEntry;
        if (e.ts >= since) out.push(e);
      } catch {
        /* skip */
      }
    }
  } catch (err) {
    console.warn('[crew] 账本读不了：', (err as Error).message);
  }
  return out;
}

/** Startup: drop what is older than the report can ever show. */
export function trimLedger(): void {
  const f = file();
  if (!existsSync(f)) return;
  try {
    const since = Date.now() - KEEP_DAYS * 86_400_000;
    const kept = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => {
        if (l.length < 2) return false;
        try {
          return (JSON.parse(l) as UsageEntry).ts >= since;
        } catch {
          return false;
        }
      });
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
    renameSync(tmp, f);
  } catch (err) {
    console.warn('[crew] 账本整理失败：', (err as Error).message);
  }
}

/* ---------------- 价格表 ---------------- */

interface Price {
  prompt: number;
  completion: number;
  /** Per image the model was given. */
  image: number;
  /** Per token of generated picture — how the picture models are actually billed. */
  imageOutput: number;
  request: number;
}
/** Bump when the shape of Price changes: a cached file written by an older shape is missing fields, silently. */
const PRICE_SHAPE = 2;
let prices: { at: number; map: Record<string, Price> } | undefined;
const priceFile = () => join(config.home, 'prices.json');

/**
 * OpenRouter's own price list, pulled once a day. Most calls come back with a cost already worked out (pi does
 * that, and OpenRouter returns one when asked) — this is for the ones that do not: embeddings, rerank, images.
 */
export async function loadPrices(): Promise<Record<string, Price>> {
  if (prices && Date.now() - prices.at < 86_400_000) return prices.map;
  if (!prices && existsSync(priceFile())) {
    try {
      const c = JSON.parse(readFileSync(priceFile(), 'utf8')) as { v?: number; at: number; map: Record<string, Price> };
      if (c.v === PRICE_SHAPE && Date.now() - c.at < 86_400_000) prices = c;
    } catch {
      /* refetch */
    }
  }
  if (prices && Date.now() - prices.at < 86_400_000) return prices.map;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = (await r.json()) as { data?: { id?: string; pricing?: Record<string, string> }[] };
    const map: Record<string, Price> = {};
    for (const m of d.data ?? []) {
      if (!m.id) continue;
      const n = (v?: string) => (v ? Number(v) || 0 : 0);
      map[m.id] = { prompt: n(m.pricing?.prompt), completion: n(m.pricing?.completion), image: n(m.pricing?.image), imageOutput: n(m.pricing?.image_output), request: n(m.pricing?.request) };
    }
    prices = { at: Date.now(), map };
    try {
      writeFileSync(priceFile(), JSON.stringify({ v: PRICE_SHAPE, ...prices }));
    } catch {
      /* cache is optional */
    }
    console.log(`[crew] 价格表：${Object.keys(map).length} 个模型`);
  } catch (e) {
    console.warn('[crew] 价格表拉不到，按 0 记：', (e as Error).message);
    prices = prices ?? { at: Date.now(), map: {} };
  }
  return prices.map;
}

/** Price a call the provider did not price for us. Model ids may or may not carry the `openrouter/` prefix. */
export function priceOf(model: string, u: { input?: number; output?: number; images?: number; requests?: number }): number {
  const map = prices?.map ?? {};
  const p = map[model] ?? map[model.replace(/^openrouter\//, '')];
  if (!p) return 0;
  return (u.input ?? 0) * p.prompt + (u.output ?? 0) * p.completion + (u.images ?? 0) * p.image + (u.requests ?? 0) * p.request;
}

/* ---------------- 计量入口 ---------------- */

const fromUsage = (u: Usage | undefined) => ({
  input: u?.input ?? 0,
  output: u?.output ?? 0,
  cacheRead: u?.cacheRead ?? 0,
  cacheWrite: u?.cacheWrite ?? 0,
  cost: u?.cost?.total ?? 0,
});

/**
 * File one text completion. pi has already counted the tokens and worked out the cost by the time the message is
 * back, so this only writes it down — one line after the call, which is why nothing has to be wrapped in a
 * closure to be counted.
 */
export function noteUsage(kind: UsageKind, who: string | undefined, res: { usage?: Usage; model?: string; provider?: string }): void {
  // `openrouter#visionModel` is one row's private copy of a provider (bots.ts); the ledger only cares who it is.
  const provider = (res.provider ?? '').split('#')[0];
  const model = res.model ? `${provider}/${res.model}`.replace(/^\//, "") : "未知模型";
  record({ ts: Date.now(), who, kind, model, ...fromUsage(res.usage), ok: true });
}
/**
 * Pictures. The unit is the picture; the price is per token of generated image, which is how the providers bill
 * (Gemini counts a picture as 1290 output tokens). When the call came back with its own usage that is used
 * instead — it is the provider's own number rather than our arithmetic.
 */
const TOKENS_PER_IMAGE = 1290;
export function recordImages(kind: UsageKind, who: string | undefined, model: string, images: number, usage?: Usage): void {
  const map = prices?.map ?? {};
  const p = map[model] ?? map[model.replace(/^openrouter\//, '')];
  const approx = images * (p?.imageOutput ? p.imageOutput * TOKENS_PER_IMAGE : (p?.image ?? 0));
  const cost = usage?.cost?.total || approx;
  record({ ts: Date.now(), who, kind, model, ...fromUsage(usage), cost, units: images, ok: true });
}

/** Calls we make over plain HTTP (search, embeddings): token counts come back in the body, the cost may not. */
export function recordRaw(
  kind: UsageKind,
  who: string | undefined,
  model: string,
  u: { input?: number; output?: number; cost?: number; units?: number },
): void {
  record({
    ts: Date.now(),
    who,
    kind,
    model,
    input: u.input ?? 0,
    output: u.output ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    units: u.units,
    cost: u.cost ?? priceOf(model, { input: u.input, output: u.output, requests: 1 }),
    ok: true,
  });
}
