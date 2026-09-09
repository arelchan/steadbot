import type { CrewStore } from './store.ts';
import type { BotManager } from './bots.ts';
import { botThread, type Routine } from './types.ts';

const WEEK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/**
 * Parse the human schedule strings the UI collects ("每天 20:30", "每周一 09:00", "工作日 18:00",
 * "每 30 分钟", "每小时") into the most recent due time <= now, or undefined if not due yet today.
 */
export function lastDue(schedule: string, now: Date): number | undefined {
  const s = schedule.replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;
  if ((m = /^每天 ?(\d{1,2}):(\d{2})$/.exec(s))) return dueAt(now, Number(m[1]), Number(m[2]));
  if ((m = /^工作日 ?(\d{1,2}):(\d{2})$/.exec(s))) {
    const d = now.getDay();
    return d >= 1 && d <= 5 ? dueAt(now, Number(m[1]), Number(m[2])) : undefined;
  }
  if ((m = /^每周([一二三四五六日天]) ?(\d{1,2}):(\d{2})$/.exec(s))) return now.getDay() === WEEK[m[1]] ? dueAt(now, Number(m[2]), Number(m[3])) : undefined;
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

function dueAt(now: Date, h: number, min: number) {
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  return d.getTime() <= now.getTime() ? d.getTime() : undefined;
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
        const due = lastDue(r.schedule, now);
        if (due === undefined || (r.lastRun ?? 0) >= due) return r;
        changed = true;
        void this.bots.send(bot.id, {
          threadId: botThread(bot.id),
          kind: 'routine',
          text: `【例行任务】「${r.title}」到点了（${r.schedule}）。按职责执行；只有需要用户拍板或有值得说的结果时才说话。`,
        });
        return { ...r, lastRun: now.getTime() };
      });
      if (changed) this.store.patchBot(bot.id, { routines });
    }
  }

  /** Run one routine now (used by the UI's "立即执行"). */
  runNow(botId: string, routineId: string) {
    const bot = this.store.bot(botId);
    const r = bot?.routines.find((x) => x.id === routineId);
    if (!bot || !r) return false;
    void this.bots.send(bot.id, { threadId: botThread(bot.id), kind: 'routine', text: `【例行任务】「${r.title}」由用户手动触发。按职责执行。` });
    this.store.patchBot(bot.id, { routines: bot.routines.map((x) => (x.id === r.id ? { ...x, lastRun: Date.now() } : x)) });
    return true;
  }
}
