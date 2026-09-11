import { useEffect, useMemo, useState } from 'react';
import { useStore, type MemoryTab } from '../store';
import { memory, type CaseItem, type EpisodeItem, type ProfileDoc, type SkillItem } from '../services/agent';
import { Avatar } from './Avatar';
import { Sk } from './Skeleton';
import { useT } from '../i18n';
import { cx } from '../utils';

/**
 * Memory, the four kinds the engine keeps, as one page with four sibling tabs. Profile and Episode are
 * about the user and shared by every bot; Agent case and Agent skill belong to the bot that earned them,
 * so those two carry a bot filter (preset when a bot's panel hands over here). Real sizes decide the
 * layout: an episode is ~3000 characters, a skill ~1200 across five or six steps, so each tab is a list
 * of clamped cards beside a reading pane rather than expandable rows.
 */
const TABS: MemoryTab[] = ['profile', 'episode', 'case', 'skill'];
const TAB_LABEL: Record<MemoryTab, string> = { profile: 'Profile', episode: 'Episode', case: 'Agent case', skill: 'Agent skill' };

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const day = (iso: string) => when(iso).slice(0, 5);

/** Numbered steps with their `- Key: value` lines, the shape both skills and cases are written in. */
interface Step { title: string; kv: [string, string][] }
function parseSteps(text: string): { steps: Step[]; tail: [string, string][] } {
  const steps: Step[] = [];
  const tail: [string, string][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const st = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (st) { steps.push({ title: st[2].trim(), kv: [] }); continue; }
    const kv = /^\s*-\s*(How|Decision|e\.g\.,?|Check|Tried|Result|Why)\s*:?\s*(.*)$/.exec(line);
    if (kv && steps.length) { steps[steps.length - 1].kv.push([kv[1].replace(/,$/, ''), kv[2].trim()]); continue; }
    const top = /^\s*(Outcome|Result|KeyInsight)\s*:\s*(.*)$/.exec(line);
    if (top) { tail.push([top[1], top[2].trim()]); continue; }
    if (steps.length && line.trim() && !/^#/.test(line.trim())) {
      // a continuation line of the last key
      const last = steps[steps.length - 1];
      if (last.kv.length) last.kv[last.kv.length - 1][1] += ' ' + line.trim();
    }
  }
  return { steps, tail };
}
const stepCount = (text: string) => parseSteps(text).steps.length;

/** Two profile lines that say the same thing: the engine emits these, so the page marks them for a one-click cleanup. */
const norm = (s: string) => s.toLowerCase().replace(/[\s，。、,.;:'"“”‘’()（）\-]/g, '');
function grams(s: string) { const n = norm(s); const g = new Set<string>(); for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2)); return g; }
function similar(a: string, b: string) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / Math.min(A.size, B.size) > 0.75;
}

/**
 * A bot panel's 记忆 tab. Opened on the bot's own kind with the bot preselected; the two shared tabs show the
 * same thing from every bot's panel, which is the point — the user is one person.
 */
export function MemoryView({ focus }: { focus?: { tab: MemoryTab; botId?: string } } = {}) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const [tab, setTab] = useState<MemoryTab>(focus?.tab ?? 'profile');
  const [bot, setBot] = useState<string | undefined>(focus?.botId);
  const [q, setQ] = useState('');
  const botName = (id: string) => (id === 'chen' ? t('mem.you') : bots.find((b) => b.id === id)?.name ?? id);
  const filterBot = bot ? bots.find((b) => b.id === bot) : undefined;
  return (
    <section className="memv embedded">
      <div className="mem-bar">
        <div className="mem-tabs">
          {TABS.map((k) => (
            <button key={k} className={cx('mem-tab', tab === k && 'on')} onClick={() => setTab(k)}>{TAB_LABEL[k]}</button>
          ))}
        </div>
        {(tab === 'case' || tab === 'skill') && (
          <span className="mem-chip">
            {filterBot ? <><Avatar bot={filterBot} size="xs" /> {filterBot.name} <button className="link" onClick={() => setBot(undefined)}>×</button></> : <span className="quiet">{t('mem.allBots')}</span>}
          </span>
        )}
        {tab !== 'profile' && <input className="mem-search" placeholder={tab === 'episode' ? t('mem.searchEpisode') : t('mem.search')} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      <div className="mem-body">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'episode' && <EpisodeTab q={q} botName={botName} />}
        {tab === 'case' && <CaseTab q={q} bot={bot} bots={bots} onBot={setBot} />}
        {tab === 'skill' && <SkillTab q={q} bot={bot} bots={bots} onBot={setBot} />}
      </div>
    </section>
  );
}

/** Waiting on the engine. A search is 0.4–6 seconds, so every tab shows the shape of what is coming. */
function Loading({ doc }: { doc?: boolean }) {
  if (doc) {
    return (
      <div className="mem-doc">
        <Sk w="72%" h={15} style={{ marginBottom: 18 }} />
        {[0, 1, 2].map((g) => (
          <div key={g} style={{ marginTop: 18 }}>
            <Sk w={72} h={9} style={{ marginBottom: 10 }} />
            {[0, 1].map((i) => <Sk key={i} w={i ? '68%' : '90%'} h={12} style={{ display: 'block', marginBottom: 9 }} />)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mem-split">
      <div className="mem-list">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mem-it">
            <Sk w={i % 2 ? '70%' : '85%'} h={13} style={{ display: 'block', marginBottom: 7 }} />
            <Sk w="95%" h={11} style={{ display: 'block', marginBottom: 5 }} />
            <Sk w={90} h={10} />
          </div>
        ))}
      </div>
      <div className="mem-pane">
        <Sk w="60%" h={15} style={{ marginBottom: 14 }} />
        {[0, 1, 2, 3, 4].map((i) => <Sk key={i} w={i === 4 ? '55%' : '100%'} h={12} style={{ display: 'block', marginBottom: 8 }} />)}
      </div>
    </div>
  );
}

/** Nothing of this kind yet: the kind's name and one word, centred in the space the list and pane would take. */
function Empty({ kind, note }: { kind: string; note: string }) {
  return (
    <div className="mem-empty">
      <span className="k">{kind}</span>
      <span>{note}</span>
    </div>
  );
}

/* ---------------- Profile ---------------- */

/**
 * The profile is one document, not a list of rows: a lead sentence, then what the engine has grouped under
 * each heading, then what it has inferred. So it is laid out as one column of reading width — the master /
 * detail split the other three tabs use would be pretending there are two things here.
 *
 * Two things the engine does that the page has to undo: it repeats its own summary as the first fact, and it
 * writes every line with the subject spelled out ("用户chen偏好…") because each one has to stand alone in a
 * retrieval result. On a page titled with his name, both just read as noise.
 */
const SUBJECT = /^\s*(?:用户\s*)?(?:chen|Chen|陈)?\s*[,，:：]?\s*/;
const strip = (s: string) => s.replace(SUBJECT, '').trim() || s.trim();

function ProfileTab() {
  const t = useT();
  const [alive, setAlive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<ProfileDoc | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'explicit' | 'trait'; index: number; text: string } | null>(null);
  const [draft, setDraft] = useState('');
  const load = () => void memory.profile().then((r) => { setAlive(r.alive); setDoc(r.profile); setLoading(false); });
  useEffect(load, []);
  // The engine takes a while to come up after a restart: keep asking until it answers rather than showing "off" for good.
  useEffect(() => {
    if (alive) return;
    const h = setInterval(load, 4000);
    return () => clearInterval(h);
  }, [alive]);
  const groups = useMemo(() => {
    const m = new Map<string, { index: number; description: string; evidence?: string; dup: boolean }[]>();
    const sum = doc?.summary ?? '';
    (doc?.explicit ?? []).forEach((e, index) => {
      // The engine's own summary, repeated as a fact: shown once, at the top, not twice.
      if (sum && similar(sum, e.description)) return;
      const dup = (doc?.explicit ?? []).some((o, j) => j < index && similar(o.description, e.description));
      const k = e.category ?? '';
      (m.get(k) ?? m.set(k, []).get(k)!).push({ index, description: e.description, evidence: e.evidence, dup });
    });
    return [...m.entries()];
  }, [doc]);
  const commit = async () => {
    if (!editing) return;
    await memory.editProfile(editing.kind, editing.index, editing.text);
    setEditing(null);
    load();
  };
  const remove = async (kind: 'explicit' | 'trait', index: number) => { await memory.editProfile(kind, index, null); load(); };
  if (loading) return <Loading doc />;
  if (!alive) return <Empty kind="Profile" note={t('mem.off')} />;
  if (!doc) return <Empty kind="Profile" note={t('common.none')} />;
  const line = (kind: 'explicit' | 'trait', index: number, text: string, fold?: { label: string; body?: string }, extra?: React.ReactNode) => {
    const key = `${kind}:${index}`;
    const isEd = editing?.kind === kind && editing.index === index;
    const shown = strip(text);
    return (
      <div className="mem-pf" key={key}>
        <div className="t">
          {isEd ? (
            <>
              <input className="mem-edit" autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(null); }} />
              <span className="fold">{t('mem.saveHint')}</span>
            </>
          ) : (
            <>
              {/* Editing starts from what is on screen, so the subject stays gone once a line has been touched. */}
              <span className="txt" onClick={() => setEditing({ kind, index, text: shown })}>{extra}{shown}</span>
              {fold?.body && <button className="fold" onClick={() => setOpen(open === key ? null : key)}>{open === key ? '▾' : '▸'} {fold.label}</button>}
              {fold?.body && open === key && <div className="mem-ev">{fold.body}</div>}
            </>
          )}
        </div>
        <button className="del" onClick={() => void remove(kind, index)}>✕</button>
      </div>
    );
  };
  return (
    <div className="mem-doc">
      {doc.summary && <p className="mem-lead">{strip(doc.summary)}</p>}
      {groups.map(([cat, items]) => (
        <section key={cat || '_'}>
          {cat && <div className="mem-grp">{cat}</div>}
          {items.map((e) => line('explicit', e.index, e.description, { label: t('mem.evidence'), body: e.evidence }, e.dup ? <span className="mem-dup">{t('mem.dup')}</span> : null))}
        </section>
      ))}
      {doc.traits.length > 0 && (
        <section className="mem-traits">
          <div className="mem-grp">{t('mem.traits')}</div>
          {doc.traits.map((e, i) => line('trait', i, e.description, { label: t('mem.basis'), body: [e.basis, e.evidence].filter(Boolean).join(' · ') }, e.trait ? <b>{e.trait}</b> : null))}
        </section>
      )}
      <input className="mem-add" placeholder={t('mem.add')} value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={async (e) => { if (e.key === 'Enter' && draft.trim()) { const v = draft.trim(); setDraft(''); await memory.addFact(v); load(); } }} />
    </div>
  );
}

/* ---------------- Episode ---------------- */

function EpisodeTab({ q, botName }: { q: string; botName: (id: string) => string }) {
  const t = useT();
  const [items, setItems] = useState<EpisodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const h = setTimeout(() => void memory.episodes(q).then((r) => { setItems(r.items); setTotal(r.total); setSel((s) => s ?? r.items[0]?.id ?? null); setLoading(false); }), q ? 350 : 0);
    return () => clearTimeout(h);
  }, [q]);
  const cur = items.find((e) => e.id === sel) ?? items[0];
  let lastDay = '';
  if (loading) return <Loading />;
  if (!items.length) return <Empty kind="Episode" note={q ? t('mem.found', { n: '0' }) : t('common.none')} />;
  return (
    <div className={cx('mem-split', !cur && 'solo')}>
      <div className="mem-list">
        {q && <div className="mem-count">{t('mem.found', { n: String(items.length) })}</div>}
        {!q && total > 0 && <div className="mem-count">{total}</div>}
        {items.map((e) => {
          const d = day(e.at); const showDay = d !== lastDay; lastDay = d;
          return (
            <div key={e.id}>
              {showDay && <div className="mem-day">{d}</div>}
              <button className={cx('mem-it', cur?.id === e.id && 'on')} onClick={() => setSel(e.id)}>
                <div className="h"><b>{e.subject}</b><span className="r">{when(e.at).slice(6)}</span></div>
                <div className="s">{e.summary}</div>
                <div className="meta"><span>{e.senders.map(botName).join(' · ')}</span><span>{t('mem.chars', { n: String(e.content.length) })}</span></div>
              </button>
            </div>
          );
        })}
      </div>
      {cur && (
      <div className="mem-pane">
        {cur && (
          <>
            <h4>{cur.subject}</h4>
            <div className="meta"><span>{when(cur.at)}</span><span>{cur.senders.map(botName).join(' · ')}</span><button className="link danger" onClick={() => void memory.correct(`关于「${cur.subject}」这段记录不对`)}>{t('mem.wrong')}</button></div>
            {cur.content.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
          </>
        )}
      </div>
      )}
    </div>
  );
}

/* ---------------- Agent case ---------------- */

function CaseTab({ q, bot, bots, onBot }: { q: string; bot?: string; bots: { id: string; name: string }[]; onBot: (id: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setLoading(true); void memory.cases(bot).then((r) => { setItems(r.items); setSel((s) => s ?? r.items[0]?.id ?? null); setLoading(false); }); }, [bot]);
  const shown = q ? items.filter((k) => (k.intent + k.insight + k.approach).toLowerCase().includes(q.toLowerCase())) : items;
  const cur = shown.find((k) => k.id === sel) ?? shown[0];
  const parsed = cur ? parseSteps(cur.approach) : undefined;
  let lastDay = '';
  if (loading) return <Loading />;
  if (!shown.length) return <Empty kind="Agent case" note={t('common.none')} />;
  return (
    <div className={cx('mem-split', !cur && 'solo')}>
      <div className="mem-list">
        {shown.map((k) => {
          const d = day(k.at); const showDay = d !== lastDay; lastDay = d;
          const b = bots.find((x) => x.id === k.botId);
          return (
            <div key={k.id}>
              {showDay && <div className="mem-day">{d}</div>}
              <button className={cx('mem-it', cur?.id === k.id && 'on')} onClick={() => setSel(k.id)}>
                <div className="h"><b>{k.intent}</b><span className="r">{when(k.at).slice(6)}</span></div>
                {k.insight && <div className="s">{k.insight}</div>}
                <div className="meta">
                  {b && <span className="who" onClick={(e) => { e.stopPropagation(); onBot(b.id); }}><Avatar bot={b as never} size="xs" /> {b.name}</span>}
                  <span>{t('mem.steps', { n: String(stepCount(k.approach)) })}</span>
                  <span>quality {k.quality.toFixed(1)}</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
      {cur && parsed && (
      <div className="mem-pane">
        {cur && parsed && (
          <>
            <h4>{cur.intent}</h4>
            <div className="meta"><span>{when(cur.at)}</span><span>{bots.find((x) => x.id === cur.botId)?.name}</span><span>quality {cur.quality.toFixed(1)}</span></div>
            <Steps steps={parsed.steps} />
            {(parsed.tail.length > 0 || cur.insight) && (
              <div className="mem-ins">
                {parsed.tail.map(([k, v]) => <div key={k}><b>{k}</b> {v}</div>)}
                {cur.insight && <div><b>KeyInsight</b> {cur.insight}</div>}
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

/* ---------------- Agent skill ---------------- */

function SkillTab({ q, bot, bots, onBot }: { q: string; bot?: string; bots: { id: string; name: string }[]; onBot: (id: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [crew, setCrew] = useState<SkillItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'adopt' | 'promote'>>({});
  useEffect(() => { setLoading(true); void memory.skills(bot).then((r) => { setItems(r.items); setCrew(r.crew); setSel((s) => s ?? r.items[0]?.id ?? null); setLoading(false); }); }, [bot]);
  const all = [...items, ...(bot ? [] : crew)];
  const shown = q ? all.filter((k) => (k.name + k.description + k.content).toLowerCase().includes(q.toLowerCase())) : all;
  const cur = shown.find((k) => k.id === sel) ?? shown[0];
  const status = (k: SkillItem) => (k.maturity >= 0.8 ? t('mem.mature') : t('mem.early'));
  // The engine's `name` is a slug (migrated_1); the readable title is the document's own heading. Its description
  // ends in a "Keywords: …" tail meant for retrieval, not for reading.
  const title = (k: SkillItem) => /^#\s+(.+)$/m.exec(k.content)?.[1]?.trim() || k.name;
  const blurb = (k: SkillItem) => k.description.replace(/\s*Keywords?\s*[:：].*$/is, '').trim();
  const isCrew = (k: SkillItem) => crew.includes(k);
  const parsed = cur ? parseSteps(cur.content) : undefined;
  if (loading) return <Loading />;
  if (!shown.length) return <Empty kind="Agent skill" note={t('common.none')} />;
  return (
    <div className={cx('mem-split', !cur && 'solo')}>
      <div className="mem-list">
        {shown.map((k) => {
          const b = bots.find((x) => x.id === k.botId);
          return (
            <button key={k.id} className={cx('mem-it', cur?.id === k.id && 'on')} onClick={() => setSel(k.id)}>
              <div className="h"><b>{title(k)}</b><span className={cx('mem-st', k.maturity >= 0.8 && 'ok')}>{isCrew(k) ? t('mem.promoted') : status(k)}</span></div>
              <div className="s">{blurb(k)}</div>
              <div className="meta">
                {b && <span className="who" onClick={(e) => { e.stopPropagation(); onBot(b.id); }}><Avatar bot={b as never} size="xs" /> {b.name}</span>}
                <span>{t('mem.steps', { n: String(stepCount(k.content)) })}</span>
                {k.sources.length > 0 && <span>{t('mem.fromCases', { n: String(k.sources.length) })}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {cur && parsed && (
      <div className="mem-pane">
        {cur && parsed && (
          <>
            <h4>{title(cur)}</h4>
            <div className="meta"><span className={cx('mem-st', cur.maturity >= 0.8 && 'ok')}>{isCrew(cur) ? t('mem.promoted') : status(cur)}</span><span>confidence {cur.confidence.toFixed(2)}</span>{cur.sources.length > 0 && <span>{t('mem.fromCases', { n: String(cur.sources.length) })}</span>}</div>
            <p>{blurb(cur)}</p>
            {!isCrew(cur) && (
              <div className="mem-acts">
                <button className="link" disabled={done[cur.id] === 'adopt'} onClick={() => { setDone({ ...done, [cur.id]: 'adopt' }); void memory.adopt(cur.botId, cur.name); }}>{t('mem.adopt')}</button>
                <button className="link" disabled={done[cur.id] === 'promote'} onClick={() => { setDone({ ...done, [cur.id]: 'promote' }); void memory.promote(cur.botId, cur.name); }}>{done[cur.id] === 'promote' ? t('mem.promoted') : t('mem.promote')}</button>
                <button className="link danger" onClick={() => void memory.correct(`做法「${cur.name}」不对`)}>{t('mem.correct')}</button>
              </div>
            )}
            <Steps steps={parsed.steps} />
          </>
        )}
      </div>
      )}
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <ol className="mem-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <div>
            <b>{s.title}</b>
            {s.kv.map(([k, v], j) => <div className="kv" key={j}><span>{k}</span><span>{v}</span></div>)}
          </div>
        </li>
      ))}
    </ol>
  );
}
