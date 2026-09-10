import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useStore, patchBot, patchSkill, mountLibrarySkill, select, uid, addIntegration, removeIntegration, testIntegration } from '../store';
import { LIBRARY_CATEGORY_IDS, botThread, type Bot, type Channel, type GrowthEvent, type GrowthKind, type Integration, type Routine, type SkillDoc } from '../types';
import { agent } from '../services/agent';
import { Avatar } from './Avatar';
import { Sk } from './Skeleton';
import { Markdown } from './Markdown';
import { cx, fullDate, fmtTime, shortDay } from '../utils';
import { useT, tn, t as tr } from '../i18n';

/** Library category names live in the catalogs, keyed by the category id the backend uses. */
const libCat = (c: string) => tr(`lib.${c}`);

type Tab = 'growth' | 'instructions' | 'memory' | 'skills' | 'routines' | 'integrations';

const TABS: { id: Tab; key: string }[] = [
  { id: 'growth', key: 'cfg.growth' },
  { id: 'instructions', key: 'cfg.instructions' },
  { id: 'memory', key: 'cfg.memory' },
  { id: 'skills', key: 'cfg.skills' },
  { id: 'routines', key: 'cfg.routines' },
  { id: 'integrations', key: 'cfg.integrations' },
];

/** Bot detail: identity on the left, one section at a time on the right. Opens on 成长. */
export function BotConfigModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('growth');
  const integrations = useStore((s) => s.integrations);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const counts: Partial<Record<Tab, number>> = {
    growth: bot.growth?.length ?? 0,
    memory: bot.viewOfYou.length,
    skills: bot.skills.length,
    routines: bot.routines.filter((r) => r.enabled).length,
    integrations: integrations.filter((i) => !i.owner && ((bot.integrationIds ?? []).includes(i.id) || (i.channel && bot.channels.includes(i.channel)))).length,
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
          <div className="cfg-content">
            {tab === 'growth' && <Growth bot={bot} />}
            {tab === 'instructions' && <Instructions bot={bot} />}
            {tab === 'memory' && <Memory bot={bot} onClose={onClose} />}
            {tab === 'skills' && <Skills bot={bot} />}
            {tab === 'routines' && <Routines bot={bot} />}
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

/* ---------------- 记忆 ---------------- */

function Memory({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const t = useT();
  const shared = useStore((s) => s.sharedProfile);
  const [draft, setDraft] = useState('');
  return (
    <>
      <Head title={t('cfg.memory')} />
      <ul className="mem">
        {bot.viewOfYou.map((v, i) => (
          <li key={i}>
            <span>{v}</span>
            <button className="del" title={t('cfg.memDelete')} onClick={() => patchBot(bot.id, { viewOfYou: bot.viewOfYou.filter((_, j) => j !== i) })}>✕</button>
          </li>
        ))}
        {bot.viewOfYou.length === 0 && <li className="quiet">{t('common.none')}</li>}
      </ul>
      <input
        className="mem-add"
        placeholder={t('cfg.memAdd')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            patchBot(bot.id, { viewOfYou: [...bot.viewOfYou, draft.trim()] });
            setDraft('');
          }
        }}
      />
      <h4>{t('cfg.sharedMem')} <button className="link" onClick={() => { select('profile'); onClose(); }}>{t('common.edit')}</button></h4>
      <ul className="mem readonly">
        {shared.map((v, i) => <li key={i}><span>{v}</span></li>)}
        {shared.length === 0 && <li className="quiet">{t('common.none')}</li>}
      </ul>
    </>
  );
}

/* ---------------- 技能 ---------------- */

function Skills({ bot }: { bot: Bot }) {
  const t = useT();
  const docs = useStore((s) => s.skills);
  const library = useStore((s) => s.library);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (open) return <SkillDetail name={open} doc={docs.find((d) => d.name === open)} onBack={() => setOpen(null)} />;
  if (picking) return <LibraryPicker bot={bot} onBack={() => setPicking(false)} />;
  return (
    <>
      <Head
        title={t('cfg.skills')}
        sub={t('cfg.skillsSub')}
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
      <input
        className="mem-add"
        placeholder={t('cfg.skillAdd')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            patchBot(bot.id, { skills: [...bot.skills, draft.trim()] });
            setDraft('');
          }
        }}
      />
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
function SkillDetail({ name, doc, onBack }: { name: string; doc?: SkillDoc; onBack: () => void }) {
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
                patchSkill(name, { description: desc.trim(), body });
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

function Routines({ bot }: { bot: Bot }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState('');
  // Where a routine's result goes. Only offered once the bot is somewhere other than here.
  const where: Channel[] = ['app', ...(['feishu', 'wechat', 'slack', 'telegram'] as Channel[]).filter((ch) => bot.im?.[ch]?.status === 'ok')];
  const pick = (r: Routine, ch: Channel) => {
    const on = r.channels ?? where;
    const next = on.includes(ch) ? on.filter((x) => x !== ch) : [...where.filter((x) => on.includes(x) || x === ch)];
    if (!next.length) return;
    const channels = next.length === where.length ? undefined : next;
    patchBot(bot.id, { routines: bot.routines.map((x) => (x.id === r.id ? { ...x, channels } : x)) });
  };
  const toggle = (id: string) => patchBot(bot.id, { routines: bot.routines.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) });
  const remove = (id: string) => patchBot(bot.id, { routines: bot.routines.filter((r) => r.id !== id) });
  const add = () => {
    if (!title.trim() || !schedule.trim()) return;
    patchBot(bot.id, { routines: [...bot.routines, { id: uid(), title: title.trim(), schedule: schedule.trim(), enabled: true }] });
    setTitle('');
    setSchedule('');
  };
  const last = (ts: number) => (shortDay(ts) === fmtTime(ts) ? fmtTime(ts) : `${shortDay(ts)} ${fmtTime(ts)}`);
  return (
    <>
      <Head title={t('cfg.routines')} />
      <ul className="routine-list">
        {bot.routines.map((r) => (
          <li key={r.id} className={cx(!r.enabled && 'off')}>
            <div className="rt-main">
              <div className="rt-t">{r.title}</div>
              <div className="rt-s">{r.schedule}{r.lastRun ? t('ws.lastRun', { when: last(r.lastRun) }) : ''}</div>
              {where.length > 1 && (
                <div className="rt-ch">
                  {where.map((ch) => (
                    <button key={ch} className={cx('chip', (r.channels ?? where).includes(ch) && 'accent')} onClick={() => pick(r, ch)}>
                      {tr(`channel.${ch}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className={cx('tgl', r.enabled && 'on')} onClick={() => toggle(r.id)} role="switch" aria-checked={r.enabled}><i /></button>
            <button className="del" onClick={() => remove(r.id)} title={t('common.delete')}>✕</button>
          </li>
        ))}
        {bot.routines.length === 0 && <li className="quiet">{t('common.none')}</li>}
      </ul>
      <div className="rt-add">
        <input className="mem-add" placeholder={t('cfg.rtDo')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="mem-add" placeholder={t('cfg.rtWhen')} value={schedule} onChange={(e) => setSchedule(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn sm" onClick={add} disabled={!title.trim() || !schedule.trim()}>{t('cfg.rtAdd')}</button>
      </div>
    </>
  );
}

/* ---------------- 连接 ---------------- */

function Integrations({ bot }: { bot: Bot }) {
  const t = useT();
  const integrations = useStore((s) => s.integrations);
  const granted = new Set(bot.integrationIds ?? []);
  const grant = (i: Integration, on: boolean) => {
    const ids = on ? Array.from(new Set([...(bot.integrationIds ?? []), i.id])) : (bot.integrationIds ?? []).filter((x) => x !== i.id);
    patchBot(bot.id, { integrationIds: ids });
  };
  // A bot's own computer shows up as a private MCP connection (owner = the bot); it is not a shared connection.
  const mcps = integrations.filter((i) => i.kind === 'mcp' && !i.owner);
  const channels = integrations.filter((i) => i.kind === 'channel');
  const agents = integrations.filter((i) => i.kind === 'agent');
  return (
    <>
      <Head title={t('cfg.integrations')} />
      <h4>{t('cfg.external')}</h4>
      <ul className="integ-list">
        {mcps.map((i) => (
          <IntegRow key={i.id} i={i} on={granted.has(i.id)} onToggle={(v) => grant(i, v)} removable />
        ))}
        {mcps.length === 0 && <li className="quiet integ-empty">{t('common.none')}</li>}
      </ul>
      <AddMcp />

      <h4>{t('cfg.im')}</h4>
      <ul className="integ-list">
        {channels.map((i) => (i.channel && i.channel !== 'app' ? <ImRow key={i.id} i={i} bot={bot} channel={i.channel} /> : null))}
      </ul>

      <h4>{t('cfg.agents')}</h4>
      <AgentsNote />
      <ul className="integ-list">
        {agents.map((i) => (
          <IntegRow key={i.id} i={i} on={granted.has(i.id)} onToggle={(v) => grant(i, v)} disabled={!i.available} />
        ))}
      </ul>
    </>
  );
}

/** Where the agents run when the bots live on a remote machine: on the user's computer, lent over the host link. */
function AgentsNote() {
  const t = useT();
  const rt = useStore((s) => s.runtime);
  if (!rt || rt.local) return null;
  const h = rt.agentHost;
  return (
    <div className={cx('integ-lead', h ? 'ok' : 'off')}>
      {h ? t('cfg.viaComputer', { name: h.name }) : t('cfg.computerOffline')}
    </div>
  );
}

/** One IM for this bot: its own account over there, connected from a credentials card in its thread. */
function ImRow({ i, bot, channel }: { i: Integration; bot: Bot; channel: Channel }) {
  const t = useT();
  const link = bot.im?.[channel];
  const st = link?.status ?? 'off';
  const dot = st === 'ok' ? 'ok' : st === 'error' ? 'error' : st === 'connecting' ? 'connecting' : 'off';
  const note =
    st === 'connecting'
      ? t('cfg.connecting')
      : st === 'ok'
        ? `${link?.account ? t('cfg.namedThere', { account: link.account }) : ''}${link?.note ?? ''}`
        : st === 'error'
          ? t('cfg.imFailed', { note: link?.note ?? '' })
          : i.note;
  const connect = () => {
    agent.connectChannel(bot.id, channel);
    select(botThread(bot.id));
  };
  const disconnect = () => {
    if (window.confirm(t('cfg.imDisconnectAsk', { bot: bot.name, im: i.name }))) agent.disconnectChannel(bot.id, channel);
  };
  return (
    <li className="integ-row">
      <span className={cx('integ-dot', dot)} />
      <div className="integ-main">
        <div className="integ-name">{i.name}</div>
        <div className="integ-note">{note}</div>
      </div>
      <span className="integ-actions im-actions">
        {st === 'off' && <button className="btn sm" onClick={connect}>{t('cfg.imConnect')}</button>}
        {st === 'error' && <button className="btn sm" onClick={connect}>{t('cfg.imRefill')}</button>}
        {(st === 'ok' || st === 'error') && <button className="link quiet-link danger" onClick={disconnect}>{t('cfg.imDisconnect')}</button>}
      </span>
    </li>
  );
}

function IntegRow({ i, on, onToggle, hint, removable, disabled }: { i: Integration; on: boolean; onToggle: (v: boolean) => void; hint?: string; removable?: boolean; disabled?: boolean }) {
  const t = useT();
  const dot = i.status === 'ok' ? 'ok' : i.status === 'error' ? 'error' : i.status === 'connecting' ? 'connecting' : 'off';
  return (
    <li className={cx('integ-row', disabled && 'disabled')}>
      <span className={cx('integ-dot', dot)} />
      <div className="integ-main">
        <div className="integ-name">
          {i.name}
          {i.kind === 'mcp' && i.tools && i.status === 'ok' ? <span className="quiet">{tn('cfg.tools', i.tools.length)}</span> : null}
          {i.connector ? <span className="chip cn-chip">{t('cfg.oneClick')}</span> : null}
          {i.viaHost ? <span className="chip cn-chip">{t('cfg.onComputer')}</span> : null}
        </div>
        <div className="integ-note">{i.status === 'connecting' ? t('cfg.connecting') : i.note || (i.kind === 'mcp' ? [i.command, ...(i.args ?? [])].filter(Boolean).join(' ') || i.url : '')}</div>
        {hint && on && <div className="integ-hint">{hint}</div>}
      </div>
      <span className="integ-actions">
        {i.kind === 'mcp' && <button className="link quiet-link" onClick={() => testIntegration(i.id)}>{i.connector ? t('cfg.check') : t('cfg.reconnect')}</button>}
        {i.kind === 'agent' && !i.available && <button className="link quiet-link" onClick={() => testIntegration(i.id)}>{t('cfg.recheck')}</button>}
        {removable && <button className="link quiet-link danger" onClick={() => { if (window.confirm(t('cfg.removeConnAsk', { name: i.name }))) removeIntegration(i.id); }}>{t('common.remove')}</button>}
      </span>
      <button className={cx('tgl', on && 'on')} role="switch" aria-checked={on} disabled={disabled} onClick={() => !disabled && onToggle(!on)} title={disabled ? i.note : on ? t('cfg.connOn') : t('cfg.connOff')}>
        <i />
      </button>
    </li>
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
