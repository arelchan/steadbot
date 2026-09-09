import { useEffect, useMemo, useState } from 'react';
import { useStore, patchBot, patchSkill, mountLibrarySkill, select, uid, addIntegration, removeIntegration, testIntegration } from '../store';
import { LIBRARY_CATEGORIES, botThread, type Bot, type Channel, type GrowthEvent, type GrowthKind, type Integration, type SkillDoc } from '../types';
import { agent } from '../services/agent';
import { Avatar } from './Avatar';
import { Sk } from './Skeleton';
import { Markdown } from './Markdown';
import { cx, fullDate, fmtTime, shortDay } from '../utils';

type Tab = 'growth' | 'instructions' | 'memory' | 'skills' | 'routines' | 'integrations';

const TABS: { id: Tab; title: string }[] = [
  { id: 'growth', title: '成长' },
  { id: 'instructions', title: '指令' },
  { id: 'memory', title: '记忆' },
  { id: 'skills', title: '技能' },
  { id: 'routines', title: '例行' },
  { id: 'integrations', title: '连接' },
];

/** Bot detail: identity on the left, one section at a time on the right. Opens on 成长. */
export function BotConfigModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cfg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={bot.name}>
        <aside className="cfg-side">
          <div className="cfg-who">
            <Avatar bot={bot} size="lg" />
            <div className="cfg-name">{bot.name}</div>
            {bot.tagline ? <div className="cfg-tag">{bot.tagline}</div> : null}
            <div className="cfg-since">{fullDate(bot.createdAt, false)} 创建</div>
          </div>
          <nav className="cfg-nav">
            {TABS.map((t) => (
              <button key={t.id} className={cx('cfg-tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>
                <span>{t.title}</span>
                {counts[t.id] ? <span className="cfg-n">{counts[t.id]}</span> : null}
              </button>
            ))}
          </nav>
        </aside>
        <section className="cfg-main">
          <button className="cfg-close" onClick={onClose} title="关闭（Esc）">×</button>
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
      <Head title="成长" sub={events.length ? `${spanDays} 天 · ${events.length} 次变化` : undefined} />
      {!events.length && <div className="cfg-empty">还没有记录。</div>}
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
  const [part, setPart] = useState<'role' | 'soul'>('role');
  return (
    <>
      <Head
        title="指令"
        right={
          <div className="seg inst-seg">
            <button className={cx(part === 'role' && 'on')} onClick={() => setPart('role')}>工作方式</button>
            <button className={cx(part === 'soul' && 'on')} onClick={() => setPart('soul')}>人设</button>
          </div>
        }
      />
      {part === 'role' ? (
        <textarea key="role" className="cfg-role sys" rows={14} placeholder="负责什么、按什么流程做、哪一步要先问你" value={bot.role} onChange={(e) => patchBot(bot.id, { role: e.target.value })} spellCheck={false} />
      ) : (
        <textarea key="soul" className="cfg-role sys" rows={14} placeholder="性格、说话方式" value={bot.soul} onChange={(e) => patchBot(bot.id, { soul: e.target.value })} spellCheck={false} />
      )}
      <div className="cfg-note">改完立即生效，它下一轮就照新的来。</div>
    </>
  );
}

/* ---------------- 记忆 ---------------- */

function Memory({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const shared = useStore((s) => s.sharedProfile);
  const [draft, setDraft] = useState('');
  return (
    <>
      <Head title="记忆" sub="它记住的关于你的事" />
      <ul className="mem">
        {bot.viewOfYou.map((v, i) => (
          <li key={i}>
            <span>{v}</span>
            <button className="del" title="删掉" onClick={() => patchBot(bot.id, { viewOfYou: bot.viewOfYou.filter((_, j) => j !== i) })}>✕</button>
          </li>
        ))}
        {bot.viewOfYou.length === 0 && <li className="quiet">还没有。</li>}
      </ul>
      <input
        className="mem-add"
        placeholder="加一条，回车"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            patchBot(bot.id, { viewOfYou: [...bot.viewOfYou, draft.trim()] });
            setDraft('');
          }
        }}
      />
      <h4>所有 bot 共享 <button className="link" onClick={() => { select('profile'); onClose(); }}>编辑</button></h4>
      <ul className="mem readonly">
        {shared.map((v, i) => <li key={i}><span>{v}</span></li>)}
        {shared.length === 0 && <li className="quiet">还没有。</li>}
      </ul>
    </>
  );
}

/* ---------------- 技能 ---------------- */

function Skills({ bot }: { bot: Bot }) {
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
        title="技能"
        sub="每个技能是一份它照着做的手册"
        right={library.length > 0 ? <button className="btn sm" onClick={() => setPicking(true)}>技能库</button> : undefined}
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
                    {doc?.category && <span className="sk-cat">{LIBRARY_CATEGORIES[doc.category] ?? doc.category}</span>}
                  </span>
                  {pending ? <Sk w="55%" h={10} className="sk-line" style={{ margin: '4px 0 0' }} /> : doc.description ? <span className="sk-d">{doc.description}</span> : null}
                </span>
                <span className="chev">›</span>
              </button>
              <button className="del" title="移除" onClick={() => patchBot(bot.id, { skills: bot.skills.filter((_, j) => j !== i) })}>✕</button>
            </li>
          );
        })}
        {bot.skills.length === 0 && <li className="quiet">还没有。</li>}
      </ul>
      <input
        className="mem-add"
        placeholder="写一个技能名，回车，它自己写手册"
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
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const has = new Set(bot.skills);
  const needle = q.trim().toLowerCase();
  const hits = library.filter((e) => (!cat || e.category === cat) && (!needle || [e.title, e.description, ...e.tags].some((t) => t.toLowerCase().includes(needle))));
  const cats = Object.keys(LIBRARY_CATEGORIES).filter((c) => library.some((e) => e.category === c));
  const groups = cats.map((c) => ({ c, items: hits.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <div className="lib-picker">
      <div className="sd-top">
        <button className="back" onClick={onBack}>← 技能</button>
        <span className="quiet">{library.length} 份手册</span>
      </div>
      <input className="sd-desc-edit" autoFocus placeholder="搜：架构图、评审、Excel、竞品…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="lib-cats">
        <button className={`chip${cat === null ? ' accent' : ''}`} onClick={() => setCat(null)}>全部</button>
        {cats.map((c) => (
          <button key={c} className={`chip${cat === c ? ' accent' : ''}`} onClick={() => setCat(cat === c ? null : c)}>{LIBRARY_CATEGORIES[c]}</button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.c} className="lib-group">
          <h4>{LIBRARY_CATEGORIES[g.c]}</h4>
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
                    {mounted ? '已挂载' : '挂载'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!groups.length && <div className="quiet">没有匹配的。</div>}
    </div>
  );
}

/** One skill's SKILL.md: rendered by default, editable in place. */
function SkillDetail({ name, doc, onBack }: { name: string; doc?: SkillDoc; onBack: () => void }) {
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
        <button className="back" onClick={onBack}>← 技能</button>
        {!pending && !editing && <button className="link quiet-link" onClick={() => setEditing(true)}>编辑</button>}
        {editing && (
          <span className="sd-actions">
            <button className="link quiet-link" onClick={() => setEditing(false)}>取消</button>
            <button
              className="btn sm primary"
              onClick={() => {
                patchSkill(name, { description: desc.trim(), body });
                setEditing(false);
              }}
            >
              保存
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
          <span className="gen-note">正在写手册…</span>
        </div>
      ) : editing ? (
        <>
          <input className="sd-desc-edit" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话：做什么、什么时候用" />
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
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState('');
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
      <Head title="例行" sub="到点自己做，不用你说" />
      <ul className="routine-list">
        {bot.routines.map((r) => (
          <li key={r.id} className={cx(!r.enabled && 'off')}>
            <div className="rt-main">
              <div className="rt-t">{r.title}</div>
              <div className="rt-s">{r.schedule}{r.lastRun ? ` · 上次 ${last(r.lastRun)}` : ''}</div>
            </div>
            <button className={cx('tgl', r.enabled && 'on')} onClick={() => toggle(r.id)} role="switch" aria-checked={r.enabled}><i /></button>
            <button className="del" onClick={() => remove(r.id)} title="删除">✕</button>
          </li>
        ))}
        {bot.routines.length === 0 && <li className="quiet">还没有。</li>}
      </ul>
      <div className="rt-add">
        <input className="mem-add" placeholder="做什么" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="mem-add" placeholder="什么时候，如：每天 20:00 / 每周一 09:00 / 每 30 分钟" value={schedule} onChange={(e) => setSchedule(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn sm" onClick={add} disabled={!title.trim() || !schedule.trim()}>加上</button>
      </div>
    </>
  );
}

/* ---------------- 连接 ---------------- */

function Integrations({ bot }: { bot: Bot }) {
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
      <Head title="连接" sub="开关决定这个 bot 能不能用" />
      <h4>外部服务</h4>
      <ul className="integ-list">
        {mcps.map((i) => (
          <IntegRow key={i.id} i={i} on={granted.has(i.id)} onToggle={(v) => grant(i, v)} removable />
        ))}
        {mcps.length === 0 && <li className="quiet integ-empty">还没有。</li>}
      </ul>
      <AddMcp />

      <h4>IM</h4>
      <div className="integ-lead">在每个 IM 里，「{bot.name}」都是一个独立的机器人，有自己的名字和头像。私聊它就是和它说话；把几个 bot 拉进同一个群，它们就在群里一起干活。</div>
      <ul className="integ-list">
        {channels.map((i) => (i.channel && i.channel !== 'app' ? <ImRow key={i.id} i={i} bot={bot} channel={i.channel} /> : null))}
      </ul>

      <h4>外部 agent</h4>
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
  const rt = useStore((s) => s.runtime);
  if (!rt || rt.local) return null;
  const h = rt.agentHost;
  return (
    <div className={cx('integ-lead', h ? 'ok' : 'off')}>
      {h
        ? `这些 agent 装在你的电脑「${h.name}」上，bot 经它调用；电脑开着、EverBot 开着才能用。`
        : '这些 agent 装在你的电脑上。电脑上开着 EverBot，bot 才能借用它们；现在电脑不在线。'}
    </div>
  );
}

/** One IM for this bot: its own account over there, connected from a credentials card in its thread. */
function ImRow({ i, bot, channel }: { i: Integration; bot: Bot; channel: Channel }) {
  const link = bot.im?.[channel];
  const st = link?.status ?? 'off';
  const dot = st === 'ok' ? 'ok' : st === 'error' ? 'error' : st === 'connecting' ? 'connecting' : 'off';
  const note =
    st === 'connecting' ? '连接中…' : st === 'ok' ? `${link?.account ? `那边叫「${link.account}」 · ` : ''}${link?.note ?? ''}` : st === 'error' ? `没接上：${link?.note ?? ''}` : i.note;
  const connect = () => {
    agent.connectChannel(bot.id, channel);
    select(botThread(bot.id));
  };
  const disconnect = () => {
    if (window.confirm(`把「${bot.name}」从${i.name}断开？那边的机器人会停，凭据会删掉。`)) agent.disconnectChannel(bot.id, channel);
  };
  return (
    <li className="integ-row">
      <span className={cx('integ-dot', dot)} />
      <div className="integ-main">
        <div className="integ-name">{i.name}</div>
        <div className="integ-note">{note}</div>
        {st === 'off' && <div className="integ-hint">点「接入」，它的会话里会出现一张卡，写着怎么在{i.name}里给它建机器人、填什么。</div>}
      </div>
      <span className="integ-actions im-actions">
        {st === 'off' && <button className="btn sm" onClick={connect}>接入</button>}
        {st === 'error' && <button className="btn sm" onClick={connect}>重填</button>}
        {(st === 'ok' || st === 'error') && <button className="link quiet-link danger" onClick={disconnect}>断开</button>}
      </span>
    </li>
  );
}

function IntegRow({ i, on, onToggle, hint, removable, disabled }: { i: Integration; on: boolean; onToggle: (v: boolean) => void; hint?: string; removable?: boolean; disabled?: boolean }) {
  const dot = i.status === 'ok' ? 'ok' : i.status === 'error' ? 'error' : i.status === 'connecting' ? 'connecting' : 'off';
  return (
    <li className={cx('integ-row', disabled && 'disabled')}>
      <span className={cx('integ-dot', dot)} />
      <div className="integ-main">
        <div className="integ-name">
          {i.name}
          {i.kind === 'mcp' && i.tools && i.status === 'ok' ? <span className="quiet"> · {i.tools.length} 个工具</span> : null}
          {i.connector ? <span className="chip cn-chip">一键</span> : null}
          {i.viaHost ? <span className="chip cn-chip">在电脑上</span> : null}
        </div>
        <div className="integ-note">{i.status === 'connecting' ? '连接中…' : i.note || (i.kind === 'mcp' ? [i.command, ...(i.args ?? [])].filter(Boolean).join(' ') || i.url : '')}</div>
        {hint && on && <div className="integ-hint">{hint}</div>}
      </div>
      <span className="integ-actions">
        {i.kind === 'mcp' && <button className="link quiet-link" onClick={() => testIntegration(i.id)}>{i.connector ? '检查' : '重连'}</button>}
        {i.kind === 'agent' && !i.available && <button className="link quiet-link" onClick={() => testIntegration(i.id)}>重新检测</button>}
        {removable && <button className="link quiet-link danger" onClick={() => { if (window.confirm(`移除连接「${i.name}」？`)) removeIntegration(i.id); }}>移除</button>}
      </span>
      <button className={cx('tgl', on && 'on')} role="switch" aria-checked={on} disabled={disabled} onClick={() => !disabled && onToggle(!on)} title={disabled ? i.note : on ? '已开' : '关着'}>
        <i />
      </button>
    </li>
  );
}

function AddMcp() {
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
  if (!open) return <button className="link quiet-link add-integ" onClick={() => setOpen(true)}>＋ MCP 连接</button>;
  return (
    <div className="add-integ-form">
      <input className="mem-add" placeholder="名字" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input
        className="mem-add"
        placeholder="启动命令或 URL，如 npx -y @modelcontextprotocol/server-filesystem ~/Documents"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <textarea
        className="mem-add env-add"
        rows={2}
        placeholder={'凭据，每行一个 KEY=VALUE；只存在本机，列表里不显示'}
        value={envText}
        onChange={(e) => setEnvText(e.target.value)}
        spellCheck={false}
      />
      <div className="add-integ-actions">
        <button className="link quiet-link" onClick={() => setOpen(false)}>取消</button>
        <button className="btn sm primary" onClick={submit} disabled={!name.trim() || !target.trim()}>连接</button>
      </div>
    </div>
  );
}
