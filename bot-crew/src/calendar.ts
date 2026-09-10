/**
 * 例行任务在时间轴上的位置。
 *
 * schedule 的写法和后端 `crew-server/src/scheduler.ts` 的 `lastDue` 是同一套，改一处要改两处；差别是这段
 * 跑在用户的浏览器里，本来就是用户的时区，所以不做时区换算（后端要做，因为云机器跑在 UTC 上）。
 *
 * 分两类：**点位型**（每天 / 工作日 / 每周几 的某个钟点）能落在网格的一个时刻上；**常驻型**（每 N 分钟、
 * 每小时）一天跑几十次，铺进格子只剩噪音，所以它们不进网格，在顶上单独一行列出来。
 */
export type Cadence =
  | { kind: 'daily' | 'weekdays'; h: number; m: number }
  | { kind: 'weekly'; dow: number; h: number; m: number }
  | { kind: 'interval' };

const WEEK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

export function cadence(schedule: string): Cadence | undefined {
  const s = schedule.replace(/\s+/g, ' ').trim();
  let x: RegExpExecArray | null;
  if ((x = /^每天 ?(\d{1,2}):(\d{2})$/.exec(s))) return { kind: 'daily', h: Number(x[1]), m: Number(x[2]) };
  if ((x = /^工作日 ?(\d{1,2}):(\d{2})$/.exec(s))) return { kind: 'weekdays', h: Number(x[1]), m: Number(x[2]) };
  if ((x = /^每周([一二三四五六日天]) ?(\d{1,2}):(\d{2})$/.exec(s))) return { kind: 'weekly', dow: WEEK[x[1]], h: Number(x[2]), m: Number(x[3]) };
  if (/^每 ?\d+ ?分钟$/.test(s) || /^每小时$/.test(s) || /^每 ?\d+ ?小时$/.test(s)) return { kind: 'interval' };
  return undefined;
}

/** 一周里的哪几天会跑，0 = 周日。常驻型不落在具体某天，给空。 */
const daysOf = (c: Cadence): number[] => (c.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : c.kind === 'weekdays' ? [1, 2, 3, 4, 5] : c.kind === 'weekly' ? [c.dow] : []);

/** 这一天里的触发时刻；这一天不跑就没有。 */
export function firesOn(c: Cadence, day: Date): number | undefined {
  if (c.kind === 'interval' || !daysOf(c).includes(day.getDay())) return undefined;
  const at = new Date(day);
  at.setHours(c.h, c.m, 0, 0);
  return at.getTime();
}

/** 这一周的周日零点。 */
export function weekStart(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 小时数（带小数），用来把一个时刻换成网格里的高度。 */
export const hourOf = (ts: number) => {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60;
};

/**
 * 网格显示哪几个小时。默认 7:00–22:00，但真有任务排在窗口外就把窗口撑开——不能有东西藏在格子外面，
 * 「现在」这条线也算，不然半夜看这一屏，线会掉在格子外面。
 */
export function hourWindow(hours: number[]): { from: number; to: number } {
  let from = 7;
  let to = 22;
  for (const h of hours) {
    from = Math.min(from, Math.floor(h));
    to = Math.max(to, Math.ceil(h + 0.5));
  }
  return { from, to: Math.min(24, to) };
}
