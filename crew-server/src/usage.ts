import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import type { CrewStore } from './store.ts';
import type { UsageReport } from './types.ts';

/*
 * What the crew has cost. Every model call is already recorded in the bot's own session log (pi writes one JSONL
 * line per message, with token counts and a cost), so nothing new is tracked at runtime: the report is read off
 * those files on demand, cached briefly, and shown in 设置 › 用量.
 */

interface Row {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
}
const zero = (): Row => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 });
const add = (a: Row, b: Partial<Row>) => {
  a.input += b.input ?? 0;
  a.output += b.output ?? 0;
  a.cacheRead += b.cacheRead ?? 0;
  a.cacheWrite += b.cacheWrite ?? 0;
  a.cost += b.cost ?? 0;
  a.calls += b.calls ?? 0;
};

const dayOf = (iso: string) => iso.slice(0, 10);

let cache: { at: number; report: UsageReport } | undefined;

/** Read every bot's session logs and total up tokens and cost. Cached for a minute — the files only grow. */
export function usageReport(store: CrewStore, days = 30): UsageReport {
  if (cache && Date.now() - cache.at < 60_000) return cache.report;
  const since = Date.now() - days * 86_400_000;
  const perBot = new Map<string, Row>();
  const perDay = new Map<string, Row>();
  const perModel = new Map<string, Row>();
  const total = zero();
  let firstAt: number | undefined;

  for (const bot of store.data.bots) {
    const dir = join(config.botsDir, bot.id, 'sessions');
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    const row = perBot.get(bot.id) ?? zero();
    perBot.set(bot.id, row);
    for (const f of files) {
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < since) continue;
      } catch {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let r: { timestamp?: string; message?: { model?: string; provider?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } } };
        try {
          r = JSON.parse(line) as typeof r;
        } catch {
          continue;
        }
        const u = r.message?.usage;
        if (!u) continue;
        const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
        if (Number.isFinite(ts)) {
          if (ts < since) continue;
          if (!firstAt || ts < firstAt) firstAt = ts;
        }
        const one: Partial<Row> = { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, cost: u.cost?.total ?? 0, calls: 1 };
        add(row, one);
        add(total, one);
        if (r.timestamp) {
          const d = dayOf(r.timestamp);
          const dr = perDay.get(d) ?? zero();
          perDay.set(d, dr);
          add(dr, one);
        }
        const model = r.message?.model ?? '未知模型';
        const mr = perModel.get(model) ?? zero();
        perModel.set(model, mr);
        add(mr, one);
      }
    }
  }

  const report: UsageReport = {
    days,
    since: firstAt,
    total,
    bots: [...perBot.entries()]
      .map(([id, r]) => ({ botId: id, name: store.bot(id)?.name ?? id, ...r }))
      .filter((b) => b.calls > 0)
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls),
    daily: [...perDay.entries()].map(([day, r]) => ({ day, ...r })).sort((a, b) => (a.day < b.day ? -1 : 1)),
    models: [...perModel.entries()].map(([model, r]) => ({ model, ...r })).sort((a, b) => b.cost - a.cost),
  };
  cache = { at: Date.now(), report };
  return report;
}
