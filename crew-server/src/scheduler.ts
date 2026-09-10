import type { CrewStore } from './store.ts';
import type { BotManager } from './bots.ts';
import { botThread, type Bot, type Routine } from './types.ts';

/**
 * Where this routine's result goes. A routine can name its channels, but only somewhere the bot still is: an IM it
 * was later disconnected from would otherwise swallow the result silently. Nothing left = wherever it normally goes.
 */
function routeFor(bot: Bot, r: Routine) {
  if (!r.channels?.length) return undefined;
  const live = r.channels.filter((ch) => ch === 'app' || bot.im?.[ch]?.status === 'ok');
  return live.length ? live : undefined;
}

/** What the bot is told when a routine fires: its own instruction if it has one, else just the title. */
function fire(r: Routine, why: string) {
  const what = r.prompt?.trim() ? `${r.prompt.trim()}\n` : '';
  return `【例行任务】「${r.title}」${why}。${what}按职责执行；只有需要用户拍板或有值得说的结果时才说话。`;
}

/** Keep the last ten runs; the routine's own page shows them. */
const withRun = (r: Routine, at: number): Routine => ({ ...r, lastRun: at, runs: [at, ...(r.runs ?? [])].slice(0, 10) });

const WEEK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/*
 * Times are the user's, not the machine's. A cloud machine runs on UTC, so "每天 20:00" would otherwise fire at
 * 04:00 for someone in Beijing — which is exactly what happened. Every wall-clock schedule below is resolved in
 * the timezone the user's App reported (settings.timezone), falling back to this machine's own.
 */
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** How far `tz` is ahead of UTC at this instant, in ms (DST included). */
function offsetMs(at: Date, tz: string): number {
  try {
    return Date.parse(`${at.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T')}Z`) - at.getTime();
  } catch {
    return 0;
  }
}

/** The same instant read as a wall clock in `tz`; use its getUTC* accessors. */
function wall(now: Date, tz: string): Date {
  return new Date(now.getTime() + offsetMs(now, tz));
}

/** The instant at which `tz` reads that date and time. */
function instantOf(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const naive = Date.UTC(y, mo, d, h, mi);
  const once = naive - offsetMs(new Date(naive), tz);
  // Settle a DST edge: the offset that applies is the one at the resulting instant, not at the naive guess.
  return naive - offsetMs(new Date(once), tz);
}

/**
 * Parse the human schedule strings the UI collects ("每天 20:30", "每周一 09:00", "工作日 18:00",
 * "每 30 分钟", "每小时") into the most recent due time <= now, or undefined if not due yet today.
 */
export function lastDue(schedule: string, now: Date, tz: string = localZone()): number | undefined {
  const s = schedule.replace(/\s+/g, ' ').trim();
  const w = wall(now, tz);
  let m: RegExpExecArray | null;
  if ((m = /^每天 ?(\d{1,2}):(\d{2})$/.exec(s))) return dueAt(now, w, tz, Number(m[1]), Number(m[2]));
  if ((m = /^工作日 ?(\d{1,2}):(\d{2})$/.exec(s))) {
    const d = w.getUTCDay();
    return d >= 1 && d <= 5 ? dueAt(now, w, tz, Number(m[1]), Number(m[2])) : undefined;
  }
  if ((m = /^每周([一二三四五六日天]) ?(\d{1,2}):(\d{2})$/.exec(s))) return w.getUTCDay() === WEEK[m[1]] ? dueAt(now, w, tz, Number(m[2]), Number(m[3])) : undefined;
  if ((m = /^每 ?(\d+) ?分钟$/.exec(s))) {
    const step = Number(m[1]) * 60_000;
    return Math.floor(now.getTime() / step) * step;
  }
  if (/^每小时$/.test(s)) return Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  if ((m = /^每 ?(\d+) ?小时$/.exec(s))) {
    const step = Number(m[1]) * 3_600_000;
    return Math.floor(now.getTime() / step) * step;
  }
  return undefined;
}

function dueAt(now: Date, w: Date, tz: string, h: number, min: number) {
  const t = instantOf(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), h, min, tz);
  return t <= now.getTime() ? t : undefined;
}

/** Fires enabled routines when due and hands them to the bot as a routine message. */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private store: CrewStore,
    private bots: BotManager,
  ) {}

  start() {
    this.timer = setInterval(() => this.tick(), 20_000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  tick(now = new Date()) {
    for (const bot of this.store.data.bots) {
      let changed = false;
      const routines: Routine[] = bot.routines.map((r) => {
        if (!r.enabled) return r;
        const due = lastDue(r.schedule, now, this.store.data.settings?.timezone || undefined);
        if (due === undefined || (r.lastRun ?? 0) >= due) return r;
        changed = true;
        void this.bots.send(bot.id, {
          threadId: botThread(bot.id),
          kind: 'routine',
          to: routeFor(bot, r),
          text: fire(r, `到点了（${r.schedule}）`),
        });
        return withRun(r, now.getTime());
      });
      if (changed) this.store.patchBot(bot.id, { routines });
    }
  }

  /** Run one routine now (the routine's own page has a 试跑 button). */
  runNow(botId: string, routineId: string) {
    const bot = this.store.bot(botId);
    const r = bot?.routines.find((x) => x.id === routineId);
    if (!bot || !r) return false;
    void this.bots.send(bot.id, { threadId: botThread(bot.id), kind: 'routine', to: routeFor(bot, r), text: fire(r, '由你手动触发') });
    this.store.patchBot(bot.id, { routines: bot.routines.map((x) => (x.id === r.id ? withRun(x, Date.now()) : x)) });
    return true;
  }
}
