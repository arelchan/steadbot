import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useStore, patchBot, patchSkill, mountLibrarySkill, select, uid, addIntegration, removeIntegration, testIntegration } from '../store';
import { MemoryView } from './MemoryView';
import { KnowledgeView } from './KnowledgeView';
import { LIBRARY_CATEGORY_IDS, botThread, type Bot, type Channel, type GrowthEvent, type GrowthKind, type Integration, type Routine, type SkillDoc } from '../types';
import { agent } from '../services/agent';
import { Avatar } from './Avatar';
import { Sk } from './Skeleton';
import { Markdown } from './Markdown';
import { Pick } from './Field';
import { ConfirmDialog } from './ConfirmDialog';
import { cx, fullDate, fmtTime, msgTime } from '../utils';
import { useT, tn, t as tr } from '../i18n';

/** Library category names live in the catalogs, keyed by the category id the backend uses. */
const libCat = (c: string) => tr(`lib.${c}`);

export type Tab = 'growth' | 'instructions' | 'memory' | 'knowledge' | 'skills' | 'routines' | 'im' | 'integrations';

const TABS: { id: Tab; key: string }[] = [
  { id: 'growth', key: 'cfg.growth' },
  { id: 'instructions', key: 'cfg.instructions' },
  { id: 'memory', key: 'cfg.memory' },
  { id: 'knowledge', key: 'cfg.knowledge' },
  { id: 'skills', key: 'cfg.skills' },
  { id: 'routines', key: 'cfg.routines' },
  { id: 'im', key: 'cfg.channels' },
  { id: 'integrations', key: 'cfg.integrations' },
];

/** Bot detail: identity on the left, one section at a time on the right. Opens on 成长. */
export function BotConfigModal({ bot, tab: initial = 'growth', routineId, onClose }: { bot: Bot; tab?: Tab; /** 直接打开这一条例行任务（从日程上的事件卡进来时用） */ routineId?: string; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initial);
  const integrations = useStore((s) => s.integrations);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const counts: Partial<Record<Tab, number>> = {
    growth: bot.growth?.length ?? 0,
    skills: bot.skills.length,
    routines: bot.routines.filter((r) => r.enabled).length,
    im: bot.channels.filter((c) => c !== 'app').length,
    integrations: integrations.filter((i) => !i.owner && (bot.integrationIds ?? []).includes(i.id)).length,
  };

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal cfg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={bot.name}>
        <aside className="cfg-side">
          <div className="cfg-who">
            <Avatar bot={bot} size="lg" />
            <div className="cfg-name">{bot.name}</div>
            {bot.tagline ? <div className="cfg-tag">{bot.tagline}</div> : null}
            <div className="cfg-since">{t('cfg.created', { date: fullDate(bot.createdAt, false) })}</div>
          </div>
          <nav className="cfg-nav">
            {TABS.map((x) => (
              <button key={x.id} className={cx('cfg-tab', tab === x.id && 'on')} onClick={() => setTab(x.id)}>
                <span>{t(x.key)}</span>
                {counts[x.id] ? <span className="cfg-n">{counts[x.id]}</span> : null}
              </button>
            ))}
          </nav>
        </aside>
        <section className="cfg-main">
          <button className="cfg-close" onClick={onClose} title={t('common.closeEsc')}>×</button>
          <div className={cx('cfg-content', (tab === 'memory' || tab === 'knowledge') && 'flush')}>
            {tab === 'memory' && <MemoryView focus={{ tab: 'skill', botId: bot.id }} />}
            {tab === 'knowledge' && <KnowledgeView />}
            {tab === 'growth' && <Growth bot={bot} />}
            {tab === 'instructions' && <Instructions bot={bot} />}
            {tab === 'skills' && <Skills bot={bot} />}
            {tab === 'routines' && <Routines bot={bot} openId={routineId} />}
            {tab === 'im' && <Channels bot={bot} />}
            {tab === 'integrations' && <Integrations bot={bot} />}
          </div>
        </section>
      </div>
    </div>
    ,
    document.body,
  );
}

function Head({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className="cfg-head">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="cfg-sub">{sub}</div> : null}
      </div>
      {right}
    </header>
  );
}

/* ---------------- 成长 ---------------- */

const KIND_GLYPH: Record<GrowthKind, string> = {
  born: '✦', identity: '◉', renamed: '◉', instructions: '≡', soul: '☺', evolved: '✦',
  skill: '▤', skill_removed: '▤', library: '▣', memory: '◌', forgot: '◌',
  routine: '◷', routine_removed: '◷', connection: '⚭', disconnected: '⚭', channel: '▣', group: '⚇',
};
const REMOVALS = new Set<GrowthKind>(['skill_removed', 'forgot', 'routine_removed', 'disconnected']);
const HIGHLIGHT = new Set<GrowthKind>(['born', 'identity', 'evolved']);

/** 【…】 in an event line is the object it acted on: render it as a chip. */
function growthText(text: string) {
  const parts = text.split(/(【[^】]+】)/g);
  return parts.map((p, i) => (/^【[^】]+】$/.test(p) ? <b className="gw-obj" key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>));
}

function Growth({ bot }: { bot: Bot }) {
  const t = useT();
  const events = useMemo(() => [...(bot.growth ?? [])].sort((a, b) => a.ts - b.ts), [bot.growth]);
  const days = useMemo(() => {
    const out: { key: string; label: string; items: GrowthEvent[] }[] = [];
    for (const e of events) {
      const d = new Date(e.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, label: fullDate(e.ts, false), items: [e] });
    }
    return out;
  }, [events]);
  const first = events[0];
  const spanDays = first ? Math.max(1, Math.round((Date.now() - first.ts) / 86400000)) : 0;
  return (
    <>
      <Head title={t('cfg.growth')} sub={events.length ? `${tn('cfg.growthDays', spanDays)} · ${tn('cfg.growthChanges', events.length)}` : undefined} />
      {!events.length && <div className="cfg-empty">{t('cfg.noRecord')}</div>}
      <ol className="growth">
        {days.map((d) => (
          <li key={d.key} className="gw-day">
            <div className="gw-date">{d.label}</div>
            <ol>
              {d.items.map((e) => (
                <li key={e.id} className={cx('gw-ev', REMOVALS.has(e.kind) && 'minus', HIGHLIGHT.has(e.kind) && 'hi')}>
                  <time className="gw-time" dateTime={new Date(e.ts).toISOString()} title={fullDate(e.ts)}>{fmtTime(e.ts)}</time>
                  <span className="gw-dot"><i>{KIND_GLYPH[e.kind] ?? '·'}</i></span>
                  <span className="gw-text">{growthText(e.text)}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ---------------- 指令 ---------------- */

function Instructions({ bot }: { bot: Bot }) {
  const t = useT();
  const [part, setPart] = useState<'role' | 'soul'>('role');
  return (
    <>
      <Head
        title={t('cfg.instructions')}
        right={
          <div className="seg inst-seg">
            <button className={cx(part === 'role' && 'on')} onClick={() => setPart('role')}>{t('cfg.role')}</button>
            <button className={cx(part === 'soul' && 'on')} onClick={() => setPart('soul')}>{t('cfg.soul')}</button>
          </div>
        }
      />
      {part === 'role' ? (
        <textarea key="role" className="cfg-role sys" rows={14} placeholder={t('cfg.rolePlaceholder')} value={bot.role} onChange={(e) => patchBot(bot.id, { role: e.target.value })} spellCheck={false} />
      ) : (
        <textarea key="soul" className="cfg-role sys" rows={14} placeholder={t('cfg.soulPlaceholder')} value={bot.soul} onChange={(e) => patchBot(bot.id, { soul: e.target.value })} spellCheck={false} />
      )}
    </>
  );
}

/* ---------------- 技能 ---------------- */

function Skills({ bot }: { bot: Bot }) {
  const t = useT();
  const all = useStore((s) => s.skills);
  const docs = all.filter((d) => !d.botId || d.botId === bot.id);
  const library = useStore((s) => s.library);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (open) return <SkillDetail botId={bot.id} name={open} doc={docs.find((d) => d.name === open)} onBack={() => setOpen(null)} />;
  if (picking) return <LibraryPicker bot={bot} onBack={() => setPicking(false)} />;
  return (
    <>
      <Head
        title={t('cfg.skills')}
        right={library.length > 0 ? <button className="btn sm" onClick={() => setPicking(true)}>{t('cfg.library')}</button> : undefined}
      />
      <ul className="skill-list">
        {bot.skills.map((k, i) => {
          const doc = docs.find((d) => d.name === k);
          const pending = !doc || doc.generating;
          return (
            <li key={i} className="skill-row">
              <button className="skill-open" onClick={() => setOpen(k)}>
                <span className="sk-ic">{doc?.library ? '▣' : '▤'}</span>
                <span className="sk-main">
                  <span className="sk-t">
                    {k}
                    {doc?.category && <span className="sk-cat">{libCat(doc.category)}</span>}
                  </span>
                  {pending ? <Sk w="55%" h={10} className="sk-line" style={{ margin: '4px 0 0' }} /> : doc.description ? <span className="sk-d">{doc.description}</span> : null}
                </span>
                <span className="chev">›</span>
              </button>
              <button className="del" title={t('cfg.skillRemove')} onClick={() => patchBot(bot.id, { skills: bot.skills.filter((_, j) => j !== i) })}>✕</button>
            </li>
          );
        })}
        {bot.skills.length === 0 && <li className="quiet">{t('common.none')}</li>}
      </ul>
    </>
  );
}

/** Browse the curated library grouped by category; mounting copies the manual onto this bot. */
function LibraryPicker({ bot, onBack }: { bot: Bot; onBack: () => void }) {
  const t = useT();
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const has = new Set(bot.skills);
  const needle = q.trim().toLowerCase();
  const manuals = library.filter((e) => (e.kind ?? 'skill') === 'skill');
  const hits = manuals.filter((e) => (!cat || e.category === cat) && (!needle || [e.title, e.description, ...e.tags].some((t) => t.toLowerCase().includes(needle))));
  const cats = LIBRARY_CATEGORY_IDS.filter((c) => manuals.some((e) => e.category === c));
  const groups = cats.map((c) => ({ c, items: hits.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <div className="lib-picker">
      <div className="sd-top">
        <button className="back" onClick={onBack}>{t('cfg.backSkills')}</button>
        <span className="quiet">{tn('cfg.manuals', manuals.length)}</span>
      </div>
      <input className="sd-desc-edit" autoFocus placeholder={t('cfg.libSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="lib-cats">
        <button className={`chip${cat === null ? ' accent' : ''}`} onClick={() => setCat(null)}>{t('common.all')}</button>
        {cats.map((c) => (
          <button key={c} className={`chip${cat === c ? ' accent' : ''}`} onClick={() => setCat(cat === c ? null : c)}>{libCat(c)}</button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.c} className="lib-group">
          <h4>{libCat(g.c)}</h4>
          <ul className="skill-list">
            {g.items.map((e) => {
              const mounted = has.has(e.title);
              return (
                <li key={e.slug} className="skill-row lib-row">
                  <span className="sk-main">
                    <span className="sk-t">{e.title}</span>
                    <span className="sk-d wrap">{e.description}</span>
                  </span>
                  <button className={`btn sm${mounted ? '' : ' primary'}`} disabled={mounted} onClick={() => mountLibrarySkill(bot.id, e.slug)}>
                    {mounted ? t('cfg.mounted') : t('cfg.mount')}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!groups.length && <div className="quiet">{t('cfg.noMatch')}</div>}
    </div>
  );
}

/** One skill's SKILL.md: rendered by default, editable in place. */
function SkillDetail({ botId, name, doc, onBack }: { botId: string; name: string; doc?: SkillDoc; onBack: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(doc?.body ?? '');
  const [desc, setDesc] = useState(doc?.description ?? '');
  useEffect(() => {
    if (!editing) {
      setBody(doc?.body ?? '');
      setDesc(doc?.description ?? '');
    }
  }, [doc, editing]);
  const pending = !doc || doc.generating;
  return (
    <div className="skill-detail">
      <div className="sd-top">
        <button className="back" onClick={onBack}>{t('cfg.backSkills')}</button>
        {!pending && !editing && <button className="link quiet-link" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
        {editing && (
          <span className="sd-actions">
            <button className="link quiet-link" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            <button
              className="btn sm primary"
              onClick={() => {
                patchSkill(botId, name, { description: desc.trim(), body });
                setEditing(false);
              }}
            >
              {t('common.save')}
            </button>
          </span>
        )}
      </div>
      <h3 className="sd-title">{name}</h3>
      {pending ? (
        <div className="ident-gen">
          <Sk w="80%" h={11} className="sk-line" />
          <Sk w="95%" h={11} className="sk-line" />
          <Sk w="90%" h={11} className="sk-line" />
          <Sk w="60%" h={11} className="sk-line" />
          <span className="gen-note">{t('cfg.writingManual')}</span>
        </div>
      ) : editing ? (
        <>
          <input className="sd-desc-edit" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('cfg.skillDesc')} />
          <textarea className="cfg-role sys" value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
        </>
      ) : (
        <>
          {doc.description && <p className="sd-desc">{doc.description}</p>}
          <div className="sd-body">
            <Markdown text={doc.body} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- 例行 ---------------- */

/*
 * 例行任务：a list you can point at, and one page per routine — name, instruction, when, where it lands, and the
 * runs it has had. The schedule is picked, not typed: the strings the scheduler understands are Chinese, so a
 * free-text field silently never fires for anyone writing in another language.
 */

type Freq = 'daily' | 'weekdays' | 'weekly' | 'hourly' | 'hours' | 'minutes';
const FREQS: Freq[] = ['daily', 'weekdays', 'weekly', 'hourly', 'hours', 'minutes'];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

interface When {
  freq: Freq;
  /** 'HH:MM' for the clock ones */
  at: string;
  /** weekday index for 每周 */
  day: number;
  /** step for 每 N 分钟 */
  every: number;
}

const DEFAULT_WHEN: When = { freq: 'daily', at: '09:00', day: 1, every: 30 };

/**
 * 认得 scheduler.ts 认的每一种写法——少认一种不是"显示得糙一点"：认不出就回落成 DEFAULT_WHEN，
 * 用户一碰下面任何一个控件，writeWhen 就把它按默认值写回去了。「每周天」和「每 N 小时」曾经就这么丢过。
 */
function readWhen(schedule: string): When {
  const s = schedule.replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;
  if ((m = /^每天 ?(\d{1,2}:\d{2})$/.exec(s))) return { ...DEFAULT_WHEN, freq: 'daily', at: m[1] };
  if ((m = /^工作日 ?(\d{1,2}:\d{2})$/.exec(s))) return { ...DEFAULT_WHEN, freq: 'weekdays', at: m[1] };
  // 星期天两种写法，服务端都收（scheduler.ts 的 WEEK 里 日 和 天 都是 0）
  if ((m = /^每周([日天一二三四五六]) ?(\d{1,2}:\d{2})$/.exec(s))) return { ...DEFAULT_WHEN, freq: 'weekly', day: m[1] === '天' ? 0 : WEEK.indexOf(m[1]), at: m[2] };
  if (/^每小时$/.test(s)) return { ...DEFAULT_WHEN, freq: 'hourly' };
  if ((m = /^每 ?(\d+) ?小时$/.exec(s))) return { ...DEFAULT_WHEN, freq: 'hours', every: Number(m[1]) };
  if ((m = /^每 ?(\d+) ?分钟$/.exec(s))) return { ...DEFAULT_WHEN, freq: 'minutes', every: Number(m[1]) };
  return DEFAULT_WHEN;
}

/** The canonical schedule string the scheduler parses (always Chinese, whatever language the UI is in). */
function writeWhen(w: When): string {
  if (w.freq === 'daily') return `每天 ${w.at}`;
  if (w.freq === 'weekdays') return `工作日 ${w.at}`;
  if (w.freq === 'weekly') return `每周${WEEK[w.day] ?? '一'} ${w.at}`;
  if (w.freq === 'hourly') return '每小时';
  if (w.freq === 'hours') return `每 ${Math.max(1, w.every)} 小时`;
  return `每 ${Math.max(1, w.every)} 分钟`;
}

/** The same schedule said in the reader's language, for the list row. */
export function sayWhen(schedule: string): string {
  const w = readWhen(schedule);
  if (w.freq === 'daily') return tr('cfg.rtSay.daily', { at: w.at });
  if (w.freq === 'weekdays') return tr('cfg.rtSay.weekdays', { at: w.at });
  if (w.freq === 'weekly') return tr('cfg.rtSay.weekly', { day: tr(`cfg.rtDay.${w.day}`), at: w.at });
  if (w.freq === 'hourly') return tr('cfg.rtSay.hourly');
  if (w.freq === 'hours') return tr('cfg.rtSay.hours', { n: String(w.every) });
  return tr('cfg.rtSay.minutes', { n: String(w.every) });
}

const ALL_CHANNELS: Channel[] = ['app', 'weixin', 'feishu', 'wechat', 'slack', 'telegram', 'discord', 'whatsapp'];

function Routines({ bot, openId: initial }: { bot: Bot; openId?: string }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | undefined>(initial);
  // A new routine is a draft on this page until 创建; nothing reaches the bot before that.
  const [draft, setDraft] = useState<Routine | undefined>();
  const open = draft ?? bot.routines.find((r) => r.id === openId);
  if (open)
    return (
      <RoutineDetail
        bot={bot}
        r={open}
        isNew={!!draft}
        onBack={() => { setDraft(undefined); setOpenId(undefined); }}
        onSaved={(id) => { setDraft(undefined); setOpenId(id); }}
      />
    );
  return (
    <>
      <Head title={t('cfg.routines')} />
      <ul className="routine-list">
        {bot.routines.map((r) => (
          <li key={r.id} className={cx(!r.enabled && 'off')}>
            <button className="rt-open" onClick={() => setOpenId(r.id)}>
              <span className="rt-main">
                <span className="rt-t">{r.title.trim() || t('cfg.rtUntitled')}</span>
                <span className="rt-s">{sayWhen(r.schedule)}</span>
              </span>
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="rt-new" onClick={() => setDraft({ id: uid(), title: '', schedule: writeWhen(DEFAULT_WHEN), enabled: true })}>+ {t('cfg.rtNew')}</button>
    </>
  );
}

function RoutineDetail({ bot, r, isNew, onBack, onSaved }: { bot: Bot; r: Routine; isNew: boolean; onBack: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [d, setD] = useState<Routine>(r);
  const [ran, setRan] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState<'delete' | 'drop' | undefined>();
  useEffect(() => setD(r), [r.id]);
  const w = readWhen(d.schedule);
  const set = (patch: Partial<Routine>) => setD({ ...d, ...patch });
  const setWhen = (next: Partial<When>) => set({ schedule: writeWhen({ ...w, ...next }) });
  const dirty = JSON.stringify(d) !== JSON.stringify(r);
  const ok = !!d.title.trim();

  // Where the result lands. Every channel is offered; one the bot is not on yet is dimmed and says so when picked.
  const live = (ch: Channel) => ch === 'app' || bot.im?.[ch]?.status === 'ok';
  const here = ALL_CHANNELS.filter(live);
  const sel = d.channels ?? here;
  const pick = (ch: Channel) => {
    const next = sel.includes(ch) ? sel.filter((x) => x !== ch) : ALL_CHANNELS.filter((x) => sel.includes(x) || x === ch);
    if (next.length) set({ channels: next });
  };
  const asleep = sel.filter((ch) => !live(ch));

  const save = () => {
    // A routine set to 每天 09:00 at four in the afternoon must not fire the moment it is saved: mark it as
    // already handled up to now, both when it is created and whenever its schedule moves.
    const fresh = isNew || d.schedule !== r.schedule;
    const clean: Routine = { ...d, title: d.title.trim(), prompt: d.prompt?.trim() || undefined, lastRun: fresh ? Date.now() : r.lastRun };
    patchBot(bot.id, { routines: isNew ? [...bot.routines, clean] : bot.routines.map((x) => (x.id === clean.id ? clean : x)) });
    onSaved(clean.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const run = () => {
    agent.runRoutine(bot.id, r.id);
    setRan(true);
    setTimeout(() => setRan(false), 2500);
  };
  return (
    <div className="rt-detail">
      <div className="sd-top">
        <button className="back" onClick={() => (dirty ? setAsk('drop') : onBack())}>‹ {t('cfg.routines')}</button>
        <span className="sd-actions">
          {!isNew && <button className="link quiet-link" onClick={() => setAsk('delete')}>{t('common.delete')}</button>}
          {!isNew && <button className="btn sm" onClick={run} disabled={ran}>{ran ? t('cfg.rtRan') : t('cfg.rtTest')}</button>}
          <span className="rt-en">
            <button className={cx('tgl', d.enabled && 'on')} onClick={() => set({ enabled: !d.enabled })} role="switch" aria-checked={d.enabled}><i /></button>
            {t(d.enabled ? 'ws.routineOn' : 'ws.routineOff')}
          </span>
        </span>
      </div>

      <div className="rt-form">
        <label htmlFor="rt-name">{t('cfg.rtName')}</label>
        <input id="rt-name" className="fld-in" autoFocus={isNew} value={d.title} onChange={(e) => set({ title: e.target.value })} />

        <label htmlFor="rt-prompt" className="top">{t('cfg.rtPrompt')}</label>
        <textarea id="rt-prompt" className="fld-in" rows={3} value={d.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} spellCheck={false} />

        <label>{t('cfg.rtWhenLabel')}</label>
        <div className="rt-when">
          <Pick value={w.freq} onChange={(v) => setWhen({ freq: v as Freq })}>
            {FREQS.map((f) => (
              <option key={f} value={f}>{t(`cfg.rtFreq.${f}`)}</option>
            ))}
          </Pick>
          {w.freq === 'weekly' && (
            <Pick value={String(w.day)} onChange={(v) => setWhen({ day: Number(v) })}>
              {WEEK.map((_, i) => (
                <option key={i} value={i}>{t(`cfg.rtDay.${i}`)}</option>
              ))}
            </Pick>
          )}
          {(w.freq === 'daily' || w.freq === 'weekdays' || w.freq === 'weekly') && (
            <input className="fld-in time" type="time" value={w.at} onChange={(e) => setWhen({ at: e.target.value || '09:00' })} />
          )}
          {(w.freq === 'minutes' || w.freq === 'hours') && <input className="fld-in num" type="number" min={1} max={w.freq === 'hours' ? 24 : 720} value={w.every} onChange={(e) => setWhen({ every: Number(e.target.value) || 1 })} />}
        </div>

        <label className="top">{t('cfg.rtTo')}</label>
        <div>
          <div className="rt-ch">
            {ALL_CHANNELS.map((ch) => (
              <button key={ch} className={cx('chip', sel.includes(ch) && 'accent', !live(ch) && 'dim')} onClick={() => pick(ch)}>
                {tr(`channel.${ch}`)}
              </button>
            ))}
          </div>
          {asleep.length > 0 && <div className="rt-note">{t('cfg.rtToOff', { ims: asleep.map((ch) => tr(`channel.${ch}`)).join(tr('common.listSep')) })}</div>}
        </div>

        {r.runs?.length ? (
          <>
            <label className="top">{t('cfg.rtHistory')}</label>
            <ul className="rt-runs">
              {r.runs.map((ts) => (
                <li key={ts}>{msgTime(ts)}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="rt-save">
        <button className="btn sm primary" onClick={save} disabled={!ok || (!isNew && !dirty)}>{isNew ? t('cfg.rtCreate') : t('common.save')}</button>
        {(isNew || dirty) && <button className="link quiet-link" onClick={onBack}>{t('common.cancel')}</button>}
        {saved && <span className="rt-saved">{t('cfg.rtSaved')}</span>}
      </div>

      {ask === 'delete' && (
        <ConfirmDialog
          title={t('cfg.rtDelete', { name: r.title.trim() || t('cfg.rtUntitled') })}
          confirmLabel={t('common.delete')}
          danger
          onCancel={() => setAsk(undefined)}
          onConfirm={() => { patchBot(bot.id, { routines: bot.routines.filter((x) => x.id !== r.id) }); onBack(); }}
        />
      )}
      {ask === 'drop' && (
        <ConfirmDialog
          title={t('cfg.rtDrop')}
          confirmLabel={t('cfg.rtDropOk')}
          danger
          onCancel={() => setAsk(undefined)}
          onConfirm={onBack}
        />
      )}
    </div>
  );
}

/* ---------------- 渠道 ---------------- */

/**
 * Where this bot can be reached. It used to be a section inside 连接, next to MCP servers and external agents,
 * which put three different things under one word: an MCP server is a tool the bot may use, an IM is a place the
 * bot lives — each one is its own account over there, with its own credentials, that people talk to directly.
 */
function Channels({ bot }: { bot: Bot }) {
  const t = useT();
  const channels = useStore((s) => s.integrations).filter((i) => i.kind === 'channel' && i.channel && i.channel !== 'app');
  return (
    <>
      <Head title={t('cfg.channels')} />
      <ul className="integ-list">
        {channels.map((i) => (
          <ImRow key={i.id} i={i} bot={bot} channel={i.channel!} />
        ))}
        {!channels.length && <li className="quiet">{t('common.none')}</li>}
      </ul>
    </>
  );
}

/* ---------------- 连接 ---------------- */

function Integrations({ bot }: { bot: Bot }) {
  const t = useT();
  const integrations = useStore((s) => s.integrations);
  const rt = useStore((s) => s.runtime);
  const granted = new Set(bot.integrationIds ?? []);
  const grant = (i: Integration, on: boolean) => {
    const ids = on ? Array.from(new Set([...(bot.integrationIds ?? []), i.id])) : (bot.integrationIds ?? []).filter((x) => x !== i.id);
    patchBot(bot.id, { integrationIds: ids });
  };
  // A bot's own computer shows up as a private MCP connection (owner = the bot); it is not a shared connection.
  const mcps = integrations.filter((i) => i.kind === 'mcp' && !i.owner);
  const agents = integrations.filter((i) => i.kind === 'agent');
  // Where the agents run when the bots live on a remote machine: on the user's computer, lent over the host link.
  const host = rt && !rt.local ? (rt.agentHost ? t('cfg.hostVia', { name: rt.agentHost.name }) : t('cfg.hostOff')) : undefined;
  return (
    <>
      <Head title={t('cfg.integrations')} />
      <h4>{t('cfg.external')}</h4>
      <ul className="integ-list">
        {mcps.map((i) => (
          <IntegRow key={i.id} i={i} on={granted.has(i.id)} onToggle={(v) => grant(i, v)} />
        ))}
      </ul>
      <AddMcp />

      <h4>
        {t('cfg.agents')}
        {host && <span className={cx('h4-aside', rt?.agentHost ? 'ok' : 'off')}>{host}</span>}
      </h4>
      <ul className="integ-list">
        {agents.map((i) => (
          <IntegRow key={i.id} i={i} on={granted.has(i.id)} onToggle={(v) => grant(i, v)} />
        ))}
      </ul>
    </>
  );
}

type RowState = 'off' | 'connecting' | 'ok' | 'error';

/**
 * One line per connection, the same shape for all three kinds: dot · name · (chips) ······ state · actions · switch.
 * The dot is the state; the words next to it are only what the state does not already say — who it is connected
 * as, or why it failed. Nothing is explained on a row that is simply off.
 */
function Row({ st, name, chips, state, actions, right, dim }: { st: RowState; name: string; chips?: React.ReactNode; state?: string; actions?: React.ReactNode; right?: React.ReactNode; dim?: boolean }) {
  return (
    <li className={cx('integ-row', dim && 'dim')}>
      <span className={cx('integ-dot', st)} />
      <span className="integ-name">
        {name}
        {chips}
      </span>
      <span className={cx('integ-state', st === 'error' && 'error')} title={state}>{state}</span>
      {actions && <span className="integ-actions">{actions}</span>}
      {right}
    </li>
  );
}

/** One IM for this bot: its own account over there, connected from a credentials card in its thread. */
function ImRow({ i, bot, channel }: { i: Integration; bot: Bot; channel: Channel }) {
  const t = useT();
  const link = bot.im?.[channel];
  const st: RowState = link?.status ?? 'off';
  const state = st === 'connecting' ? t('cfg.connecting') : st === 'ok' ? (link?.account ? `@${link.account.replace(/^@/, '')}` : '') : st === 'error' ? link?.note ?? '' : '';
  // 接入 is a request to the bot, not a form: it runs the IM skill (asks which route, does the work, verifies).
  const connect = () => {
    agent.onUserMessage(botThread(bot.id), t(st === 'error' ? 'cfg.imRefillAsk' : 'cfg.imConnectAsk', { im: i.name }));
    select(botThread(bot.id));
  };
  const disconnect = () => {
    if (window.confirm(t('cfg.imDisconnectAsk', { bot: bot.name, im: i.name }))) agent.disconnectChannel(bot.id, channel);
  };
  return (
    <Row
      st={st}
      name={i.name}
      state={state}
      actions={(st === 'ok' || st === 'error') && <button className="link quiet-link danger" onClick={disconnect}>{t('cfg.imDisconnect')}</button>}
      right={
        st === 'off' ? <button className="btn sm" onClick={connect}>{t('cfg.imConnect')}</button>
        : st === 'error' ? <button className="btn sm" onClick={connect}>{t('cfg.imRefill')}</button>
        : <span className="integ-spacer" />
      }
    />
  );
}

/** A shared MCP connection or an external agent: the switch is whether this bot may use it; the dot is whether it works right now. */
function IntegRow({ i, on, onToggle }: { i: Integration; on: boolean; onToggle: (v: boolean) => void }) {
  const t = useT();
  const st: RowState = i.kind === 'agent' && !i.available ? 'off' : i.status === 'ok' ? 'ok' : i.status === 'error' ? 'error' : i.status === 'connecting' ? 'connecting' : 'off';
  const state = st === 'connecting' ? t('cfg.connecting') : st === 'error' ? i.note ?? '' : st === 'ok' ? i.account ?? '' : '';
  const chips = (
    <>
      {i.kind === 'mcp' && i.tools && st === 'ok' ? <span className="integ-n">{tn('cfg.tools', i.tools.length)}</span> : null}
      {i.connector ? <span className="chip cn-chip">{t('cfg.oneClick')}</span> : null}
      {i.viaHost ? <span className="chip cn-chip">{t('cfg.onComputer')}</span> : null}
    </>
  );
  const actions = i.kind === 'mcp' ? (
    <>
      <button className="link quiet-link" onClick={() => testIntegration(i.id)}>{i.connector ? t('cfg.check') : t('cfg.reconnect')}</button>
      <button className="link quiet-link danger" onClick={() => { if (window.confirm(t('cfg.removeConnAsk', { name: i.name }))) removeIntegration(i.id); }}>{t('common.remove')}</button>
    </>
  ) : !i.available ? (
    <button className="link quiet-link" onClick={() => testIntegration(i.id)}>{t('cfg.recheck')}</button>
  ) : undefined;
  return (
    <Row
      st={st}
      name={i.name}
      chips={chips}
      state={state}
      actions={actions}
      dim={i.kind === 'agent' && !i.available}
      right={
        <button className={cx('tgl', on && 'on')} role="switch" aria-checked={on} onClick={() => onToggle(!on)} title={on ? t('cfg.connOn') : t('cfg.connOff')}>
          <i />
        </button>
      }
    />
  );
}

function AddMcp() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [envText, setEnvText] = useState('');
  const submit = () => {
    const n = name.trim();
    const t = target.trim();
    if (!n || !t) return;
    // KEY=VALUE per line; tokens live here instead of in the command, so the list never shows them
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    const envPart = Object.keys(env).length ? { env } : {};
    if (/^https?:\/\//.test(t)) addIntegration({ kind: 'mcp', name: n, transport: 'http', url: t, ...envPart });
    else {
      const parts = t.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [t];
      addIntegration({ kind: 'mcp', name: n, transport: 'stdio', command: parts[0].replace(/"/g, ''), args: parts.slice(1).map((x) => x.replace(/"/g, '')), ...envPart });
    }
    setName('');
    setTarget('');
    setEnvText('');
    setOpen(false);
  };
  if (!open) return <button className="link quiet-link add-integ" onClick={() => setOpen(true)}>{t('cfg.addMcp')}</button>;
  return (
    <div className="add-integ-form">
      <input className="mem-add" placeholder={t('cfg.mcpName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input
        className="mem-add"
        placeholder={t('cfg.mcpTarget')}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <textarea
        className="mem-add env-add"
        rows={2}
        placeholder={t('cfg.mcpEnv')}
        value={envText}
        onChange={(e) => setEnvText(e.target.value)}
        spellCheck={false}
      />
      <div className="add-integ-actions">
        <button className="link quiet-link" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
        <button className="btn sm primary" onClick={submit} disabled={!name.trim() || !target.trim()}>{t('cfg.connect')}</button>
      </div>
    </div>
  );
}
