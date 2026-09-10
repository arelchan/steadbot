import { useEffect, useRef, useState } from 'react';
import { useStore, openPendings, select } from '../store';
import { botThread, type Bot, type Routine } from '../types';
import { Avatar } from './Avatar';
import { PendingActions } from './Cards';
import { cadence, firesOn, weekStart, addDays, sameDay, hourOf, hourWindow } from '../calendar';
import { cx, waited } from '../utils';
import { useT, intlLocale } from '../i18n';

const HOUR = 44; // 一小时一格
const TICK = 20; // 一条例行任务的高度

/** 现在这条线要自己走，所以这一屏每分钟重画一次。 */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const md = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' }).format(d);
const dow = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d);
/** 时区就写一个偏移，日历上的惯例；完整的 Asia/Shanghai 太长，角上放不下。 */
const zone = () => {
  const h = -new Date().getTimezoneOffset() / 60;
  const n = Math.abs(h);
  return `GMT${h < 0 ? '-' : '+'}${Number.isInteger(n) ? n : n.toFixed(1)}`;
};

const hm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 一条例行任务在某一天的那个时刻。`lastRun` 只记得最后一次跑，所以我们只敢说两件事：还没到点（todo），
 * 和到点了之后再没跑过（missed，这才是要看的）；更早的历史一律当跑过了，不去替它编细节。
 */
type Tick = { at: number; bot: Bot; r: Routine; state: 'done' | 'missed' | 'todo' };

/**
 * 一周的时间轴。这一版上面只有我们自己排的东西——每个 bot 的例行任务——因为它们已经在跑了（后端
 * `scheduler.ts`），只是过去散在各个 bot 的设置里，没有一个地方能看见全体的下一次触发。外部日历和会议
 * 是后面的事，接进来以后落在同一个网格上。
 */
export function Week() {
  const t = useT();
  const s = useStore((x) => x);
  const now = useNow();
  const [off, setOff] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  const start = addDays(weekStart(), off * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date(now);

  const ticks: Tick[][] = days.map(() => []);
  // 进不了格子的两种：常驻型（每 30 分钟这种），和后台压根不认的写法——后者根本不会被触发，得看得见。
  const standing: { bot: Bot; r: Routine; unknown?: boolean }[] = [];
  for (const bot of s.bots) {
    for (const r of bot.routines) {
      if (!r.enabled) continue;
      const c = cadence(r.schedule);
      if (!c) {
        standing.push({ bot, r, unknown: true });
        continue;
      }
      if (c.kind === 'interval') {
        standing.push({ bot, r });
        continue;
      }
      days.forEach((day, i) => {
        const at = firesOn(c, day);
        if (at === undefined) return;
        ticks[i].push({ at, bot, r, state: at > now ? 'todo' : (r.lastRun ?? 0) >= at ? 'done' : 'missed' });
      });
    }
  }
  for (const list of ticks) list.sort((a, b) => a.at - b.at);

  const { from, to } = hourWindow([...ticks.flat().map((k) => hourOf(k.at)), hourOf(now)]);
  const height = (to - from) * HOUR;
  const top = (ts: number) => (hourOf(ts) - from) * HOUR;
  // 同一天里挨得太近的两条会叠在一起，往下顺一格；位置差几分钟，但至少两条都看得见。
  const laid = ticks.map((list) => {
    let floor = -Infinity;
    return list.map((k) => {
      const y = Math.max(top(k.at), floor);
      floor = y + TICK + 1;
      return { ...k, y };
    });
  });

  // 打开时把「现在」放到靠上的位置，而不是从窗口最上面开始看。
  useEffect(() => {
    if (body.current) body.current.scrollTop = Math.max(0, (hourOf(Date.now()) - from - 1) * HOUR);
  }, [from]);

  const waiting = openPendings(s).sort((a, b) => (a.kind === 'blocked' ? -1 : 0) - (b.kind === 'blocked' ? -1 : 0) || a.createdAt - b.createdAt);

  return (
    <section className="col week">
      <div className="hd">
        <div className="who">
          <span className="n">{t('side.week')}</span>
          <span className="t">{md(start)} – {md(days[6])}</span>
        </div>
        <div className="hd-tools">
          <button className="iconbtn" onClick={() => setOff(off - 1)} title={t('week.prev')}>‹</button>
          <button className="iconbtn" onClick={() => setOff(off + 1)} title={t('week.next')}>›</button>
        </div>
        {off !== 0 && <button className="btn" onClick={() => setOff(0)}>{t('week.today')}</button>}
      </div>

      <div className="week-wrap">
        <div className="week-main">
          <div className="wk-days">
            <div className="wk-tz">{zone()}</div>
            {days.map((d) => (
              <div className={cx('wk-day', sameDay(d, today) && 'today')} key={d.getTime()}>
                <div className="d1">{dow(d)}</div>
                <div className="d2">{md(d)}</div>
              </div>
            ))}
          </div>

          {standing.length > 0 && (
            <div className="wk-standing">
              <div className="lbl">{t('week.standing')}</div>
              <div className="wk-standing-list">
                {standing.map(({ bot, r, unknown }) => (
                  <button
                    className={cx('chip', 'wk-standing-chip', unknown && 'warn')}
                    key={`${bot.id}:${r.id}`}
                    title={unknown ? t('week.unknown', { schedule: r.schedule }) : `${r.title} · ${r.schedule} · ${bot.name}`}
                    onClick={() => select(botThread(bot.id))}
                  >
                    {r.title}<span className="quiet"> · {r.schedule}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="week-body" ref={body}>
            <div className="wk-grid" style={{ height }}>
              <div className="wk-hours">
                {Array.from({ length: to - from + 1 }, (_, i) => (
                  <i style={{ top: i * HOUR }} key={i}>{String(from + i).padStart(2, '0')}:00</i>
                ))}
              </div>
              {days.map((d, i) => {
                const isToday = sameDay(d, today);
                return (
                  <div className={cx('wk-col', isToday && 'today')} style={{ backgroundSize: `100% ${HOUR}px` }} key={d.getTime()}>
                    {laid[i].map((k) => (
                      <button className={cx('wk-tick', k.state)} style={{ top: k.y }} key={`${k.bot.id}:${k.r.id}`} onClick={() => select(botThread(k.bot.id))} title={`${hm(k.at)} ${k.r.title} · ${k.r.schedule} · ${k.bot.name}`}>
                        <Avatar bot={k.bot} size="xs" />
                        <span className="wk-tick-t">{k.r.title}</span>
                      </button>
                    ))}
                    {isToday && <div className="wk-now" style={{ top: (hourOf(now) - from) * HOUR }}><b /></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="week-side">
          <div className="wk-side-hd">
            <span className="n">{t('inbox.title')}</span>
            {waiting.length > 0 ? <span className="badge">{waiting.length}</span> : <span className="quiet">{t('side.clear')}</span>}
          </div>
          <div className="wk-side-body">
            {waiting.map((p) => {
              const bot = s.bots.find((b) => b.id === p.botId);
              const msg = s.messages.find((m) => m.id === p.messageId);
              return (
                <div className={cx('ib', p.kind)} key={p.id}>
                  <Avatar bot={bot} />
                  <div style={{ minWidth: 0 }}>
                    <div className="ib-t">{p.title}</div>
                    {(msg?.text || p.detail) && <div className="ib-d">{msg?.text ?? p.detail}</div>}
                    <div className="ib-m">
                      {bot?.name} · <span className={cx('ib-w', p.kind === 'blocked' && 'hot')}>{waited(p.createdAt)}</span>
                    </div>
                    <div className="ib-a"><PendingActions p={p} small /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
