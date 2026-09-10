import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore, setPanel, openTask, select, focusMessage, undoAction, patchMatter, patchBot, clearThread, removeBot, removeMatter } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import type { Bot, Matter, Todo, TodoStatus } from '../types';
import { botThread, matterThread } from '../types';
import { Resizer } from './Resizer';
import { GroupAvatar, membersOf } from './GroupAvatar';
import { Avatar } from './Avatar';
import { Sk } from './Skeleton';
import { avatarService, fileToAvatar } from '../services/avatar';
import { PendingActions } from './Cards';
import { BotConfigModal, sayWhen } from './BotConfigModal';
import { ScreenCard } from './Screen';
import { statusLabel } from '../services/agent';
import { cx, fmtTime, shortDay } from '../utils';
import { useT, tn, t as tr } from '../i18n';

const when = (ts: number) => (shortDay(ts) === fmtTime(ts) ? fmtTime(ts) : `${shortDay(ts)} ${fmtTime(ts)}`);

/* =========================================================
   The column beside the conversation (store.togglePanel):
   ① 工作区 — its screen, its tasks, its routines. Always there; this is the day-to-day view.
   ② 身份 — the bot's card and settings. Opens as a second column on the outside, pushing 工作区 left; it is
      open by itself only on a bot that was just born, and closes again the moment you go somewhere else.
   ========================================================= */

/**
 * 工作区：对话右侧的一条竖带，从上到下是这个 bot 的电脑屏幕、它手上的事项、它的例行任务。群聊没有电脑，
 * 只有事项。每一段能单独折叠；消息和输入框给这条带子留出宽度。
 */
export function TasksFloat({ bot, matter }: { bot?: Bot; matter?: Matter }) {
  const t = useT();
  const s = useStore((x) => x);
  const identity = s.panels.identity && (bot || matter);
  const todos = s.todos.filter((t) => (bot ? t.botId === bot.id : matter ? t.matterId === matter.id : false));
  const open = todos.filter((t) => t.status !== 'done').length;
  const wait = todos.filter((t) => t.status === 'waiting' || t.status === 'blocked').length;
  const detail = s.panel.mode === 'task';
  const computer = s.computer;
  const using = (computer?.state === 'on' ? (computer.users ?? []) : []).map((id) => s.bots.find((b) => b.id === id)?.name).filter((n): n is string => !!n);
  const routines = bot?.routines ?? [];
  const live = routines.filter((r) => r.enabled).length;
  const [routineCfg, setRoutines] = useState(false);
  return (
    <>
    {identity && (
      <aside className="thread-side identity">
        <Resizer col="right" edge="left" />
        <div className="workspace">{bot ? <BotIdentity bot={bot} /> : <GroupInfo matter={matter!} />}</div>
      </aside>
    )}
    <aside className={cx('thread-side', identity && 'shifted')}>
      <Resizer col="side" edge="left" />
      <div className="workspace">
        {bot && (
          <Section title={t('ws.computer')} hint={using.length ? t('screen.usedBy', { names: using.join('、') }) : undefined} startOpen>
            <ScreenCard />
          </Section>
        )}
        <Section
          title={t('ws.tasks')}
          hint={`${tn('ws.taskCount', open)}${wait ? tn('ws.taskWait', wait) : ''}`}
          startOpen
          grow
          lead={detail ? <button className="link" onClick={() => setPanel({ mode: 'board' })}>{t('ws.backTasks')}</button> : undefined}
        >
          <TasksPanel bot={bot} matter={matter} />
        </Section>
        {bot && (
          <Section
            title={t('ws.routines')}
            hint={routines.length ? tn('ws.routineLive', live) : undefined}
            startOpen={false}
          >
            <RoutineList bot={bot} onOpen={() => setRoutines(true)} />
          </Section>
        )}
      </div>
      {bot && routineCfg && <BotConfigModal bot={bot} tab="routines" onClose={() => setRoutines(false)} />}
    </aside>
    </>
  );
}

/** One collapsible band of the workspace. `grow` gives the section the leftover height (the task list). */
function Section({ title, hint, children, startOpen = true, grow, lead }: { title: string; hint?: string; children: ReactNode; startOpen?: boolean; grow?: boolean; lead?: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={cx('ws-sec', open && 'open', grow && open && 'grow')}>
      <header className="ws-hd" onClick={() => setOpen(!open)}>
        {lead && open ? (
          <span onClick={(e) => e.stopPropagation()}>{lead}</span>
        ) : (
          <span className="ws-t">
            {title}
            {hint && <span className="quiet">{hint}</span>}
          </span>
        )}
        <span className={cx('ws-chev', open && 'open')} aria-hidden>
          ›
        </span>
      </header>
      {open && <div className="ws-body">{children}</div>}
    </section>
  );
}

/** The bot's routines, beside the conversation: name, when, and a switch. One click opens its own page. */
function RoutineList({ bot, onOpen }: { bot: Bot; onOpen: () => void }) {
  const t = useT();
  const toggle = (id: string) => patchBot(bot.id, { routines: bot.routines.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) });
  return (
    <>
    <ul className="routine-list compact">
      {bot.routines.map((r) => (
        <li key={r.id} className={cx(!r.enabled && 'off')}>
          <button className="rt-open" onClick={onOpen}>
            <span className="rt-main">
              <span className="rt-t">{r.title.trim() || t('cfg.rtUntitled')}</span>
              <span className="rt-s">{sayWhen(r.schedule)}</span>
            </span>
          </button>
          <button className={cx('tgl', r.enabled && 'on')} onClick={() => toggle(r.id)} role="switch" aria-checked={r.enabled} title={r.enabled ? t('ws.routineOn') : t('ws.routineOff')}>
            <i />
          </button>
        </li>
      ))}
    </ul>
    <button className="rt-new" onClick={onOpen}>+ {t('cfg.rtNew')}</button>
    </>
  );
}

/* ---------------- ① identity ---------------- */

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button className="tgl-row" onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="tgl-l">
        <span>{label}</span>
        {hint && <span className="tgl-h">{hint}</span>}
      </span>
      <span className={cx('tgl', on && 'on')}><i /></span>
    </button>
  );
}

function AvatarEditor({ bot }: { bot: Bot }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const regenerate = async () => {
    const seed = `${bot.id}:${Date.now()}`;
    const url = await avatarService.generate(seed, `${bot.name} · ${bot.role}`);
    // procedural service returns a URL derived from the seed, so we store the seed and drop any upload
    patchBot(bot.id, { avatarSeed: seed, avatarUrl: url.startsWith('data:image/svg') ? undefined : url });
    setOpen(false);
  };
  const upload = async (f?: File) => {
    if (!f) return;
    const url = await fileToAvatar(f);
    patchBot(bot.id, { avatarUrl: url });
    setOpen(false);
  };
  return (
    <div className="menu-wrap av-edit" ref={ref}>
      <button className="av-btn" onClick={() => setOpen(!open)} title={t('ident.changeAvatar')}>
        <Avatar bot={bot} />
        <span className="av-hover">{t('ident.changeImage')}</span>
      </button>
      {open && (
        <div className="menu" style={{ left: 0, right: 'auto', minWidth: 200 }}>
          <button className="menu-item" onClick={() => fileRef.current?.click()}>
            <span className="mi-t">{t('ident.upload')}</span>
            <span className="mi-s">{t('ident.uploadSub')}</span>
          </button>
          <button className="menu-item" onClick={regenerate}>
            <span className="mi-t">{t('ident.regen')}</span>
            <span className="mi-s">{t('ident.regenSub')}</span>
          </button>
          {bot.avatarUrl && (
            <button className="menu-item" onClick={() => { patchBot(bot.id, { avatarUrl: undefined }); setOpen(false); }}>
              <span className="mi-t">{t('ident.restore')}</span>
            </button>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}

function BotIdentity({ bot }: { bot: Bot }) {
  const t = useT();
  const [config, setConfig] = useState(false);
  const [ask, setAsk] = useState<'clear' | 'delete' | null>(null);
  const integrations = useStore((s) => s.integrations);
  const bad = integrations.filter((i) => (bot.integrationIds ?? []).includes(i.id) && i.status === 'error').length;
  const gen = !!bot.generating?.identity;
  return (
    <div className="ident">
      <section className="ws-sec ident-card">
      <div className="ident-top">
        {gen ? <Avatar bot={bot} size="lg" /> : <AvatarEditor bot={bot} />}
        <div className="id-name" style={{ flex: 1 }}>
          {gen ? (
            <Sk w={96} h={16} className="sk-name" />
          ) : (
            <input
              className="name-edit fade-in"
              value={bot.name}
              onChange={(e) => patchBot(bot.id, { name: e.target.value })}
              onBlur={(e) => { if (!e.target.value.trim()) patchBot(bot.id, { name: t('ident.unnamedBot') }); }}
              title={t('ident.nameTitle')}
            />
          )}
        </div>
      </div>
      {gen ? (
        <div className="ident-gen">
          <Sk w="92%" h={11} className="sk-line" />
          <Sk w="78%" h={11} className="sk-line" />
          <Sk w="55%" h={11} className="sk-line" />
          <span className="gen-note">{t('ident.generating')}</span>
        </div>
      ) : (
        <textarea
          className="role ident-desc fade-in"
          rows={3}
          placeholder={t('ident.rolePlaceholder')}
          value={bot.role}
          onChange={(e) => patchBot(bot.id, { role: e.target.value })}
        />
      )}
      </section>
      <div className="settings ws-sec">
        <Toggle label={t('ident.notify')} on={bot.notify} onChange={(v) => patchBot(bot.id, { notify: v })} />
        <Toggle label={t('ident.pin')} on={bot.pinned} onChange={(v) => patchBot(bot.id, { pinned: v })} />
        <button className="set-row nav" onClick={() => setConfig(true)}>
          <span>{t('ident.botConfig')}</span>
          <span className="set-right">{bad ? <span className="cfg-warn">{tn('ident.fixConn', bad)}</span> : null}<span className="chev">›</span></span>
        </button>
      </div>
      <div className="settings ws-sec">
        <button className="set-row" onClick={() => setAsk('clear')}>{t('ident.clearChat')}</button>
        {/* 助理是产品自带的，没有删除这一项 */}
        {bot.kind !== 'steward' && <button className="set-row danger" onClick={() => setAsk('delete')}>{t('ident.deleteBot')}</button>}
      </div>
      {config && <BotConfigModal bot={bot} onClose={() => setConfig(false)} />}
      {ask === 'clear' && (
        <ConfirmDialog
          title={t('ident.clearChat')}
          message={t('ident.clearChatMsg')}
          confirmLabel={t('ident.clearChatOk')}
          danger
          onCancel={() => setAsk(null)}
          onConfirm={() => { clearThread(botThread(bot.id)); setAsk(null); }}
        />
      )}
      {ask === 'delete' && (
        <ConfirmDialog
          title={t('ident.deleteBotTitle', { name: bot.name })}
          message={t('ident.deleteBotMsg')}
          confirmLabel={t('common.delete')}
          danger
          onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); removeBot(bot.id); }}
        />
      )}
    </div>
  );
}

function GroupInfo({ matter }: { matter: Matter }) {
  const t = useT();
  const [askClear, setAskClear] = useState(false);
  const [askDissolve, setAskDissolve] = useState(false);
  const s = useStore((x) => x);
  const members = membersOf(matter, s.bots);
  const candidates = s.bots.filter((b) => !matter.participantBotIds.includes(b.id));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!adding) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAdding(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [adding]);
  const remove = (id: string) => {
    if (matter.participantBotIds.length <= 1) return;
    const rest = matter.participantBotIds.filter((x) => x !== id);
    patchMatter(matter.id, { participantBotIds: rest, ownerBotId: matter.ownerBotId === id ? rest[0] : matter.ownerBotId });
  };
  const statusOf = (botId: string) => {
    const mine = s.todos.filter((t) => t.botId === botId && t.matterId === matter.id && t.status !== 'done');
    const wait = mine.filter((t) => t.status === 'waiting' || t.status === 'blocked').length;
    if (mine.length === 0) return t('ident.idle');
    return `${tn('ident.doingN', mine.length)}${wait ? tn('ws.taskWait', wait) : ''}`;
  };

  return (
    <div className="ident">
      <section className="ws-sec ident-card">
      <div className="ident-top">
        <GroupAvatar bots={members} size="lg" />
        <div className="id-name" style={{ flex: 1 }}>
          <input
            className="name-edit"
            value={matter.title}
            onChange={(e) => patchMatter(matter.id, { title: e.target.value })}
            onBlur={(e) => { if (!e.target.value.trim()) patchMatter(matter.id, { title: t('ident.unnamedGroup') }); }}
            title={t('ident.groupNameTitle')}
          />
          <div className="t">{tn('ident.groupMembers', members.length)}</div>
        </div>
      </div>
      <textarea className="role ident-desc" rows={2} placeholder={t('ident.groupDesc')} value={matter.summary} onChange={(e) => patchMatter(matter.id, { summary: e.target.value })} />
      </section>

      <div className="settings ws-sec">
        <Toggle label={t('ident.notify')} on={matter.notify} onChange={(v) => patchMatter(matter.id, { notify: v })} />
        <Toggle label={t('ident.pin')} on={matter.pinned} onChange={(v) => patchMatter(matter.id, { pinned: v })} />
      </div>
      <div className="settings ws-sec">
        <button className="set-row" onClick={() => setAskClear(true)}>{t('ident.clearChat')}</button>
        <button className="set-row danger" onClick={() => setAskDissolve(true)}>{t('ident.dissolve')}</button>
      </div>
      {askClear && (
        <ConfirmDialog
          title={t('ident.clearChat')}
          message={t('ident.clearChatMsg')}
          confirmLabel={t('ident.clearChatOk')}
          danger
          onCancel={() => setAskClear(false)}
          onConfirm={() => { clearThread(matterThread(matter.id)); setAskClear(false); }}
        />
      )}
      {askDissolve && (
        <ConfirmDialog
          title={t('ident.dissolveTitle', { title: matter.title })}
          message={t('ident.dissolveMsg')}
          confirmLabel={t('ident.dissolveOk')}
          danger
          onCancel={() => setAskDissolve(false)}
          onConfirm={() => { setAskDissolve(false); removeMatter(matter.id); }}
        />
      )}

      <ul className="members ws-sec">
        <li className="m-action menu-wrap" ref={ref}>
          <button className="m-row" onClick={() => { setAdding(!adding); setRemoving(false); }}>
            <span className="m-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="8" r="3.6" /><path d="M3.5 19c1-3.6 3.4-5.4 6.5-5.4 1.4 0 2.6.3 3.6 1" /><path d="M18 13v6M15 16h6" /></svg>
            </span>
            <span className="m-t">{t('ident.addMember')}</span>
          </button>
          {adding && (
            <div className="menu" style={{ left: 40, right: 'auto', minWidth: 240 }}>
              {candidates.length === 0 && <div className="mi-s" style={{ padding: '8px 12px' }}>{t('ident.allIn')}</div>}
              {candidates.map((b) => (
                <button key={b.id} className="menu-item row" onClick={() => { patchMatter(matter.id, { participantBotIds: [...matter.participantBotIds, b.id] }); setAdding(false); }}>
                  <Avatar bot={b} size="sm" />
                  <span>
                    <span className="mi-t">{b.name}</span>
                    <span className="mi-s">{b.tagline}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </li>
        <li className="m-action">
          <button className={cx('m-row', removing && 'on')} onClick={() => { setRemoving(!removing); setAdding(false); }} disabled={members.length <= 1}>
            <span className="m-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="8" r="3.6" /><path d="M3.5 19c1-3.6 3.4-5.4 6.5-5.4 1.4 0 2.6.3 3.6 1" /><path d="M15 16h6" /></svg>
            </span>
            <span className="m-t">{removing ? t('ident.doneRemoving') : t('ident.removeMember')}</span>
          </button>
        </li>
        <li className="m-item">
          <Avatar you className="lg" />
          <span className="m-main">
            <span className="m-name">{t('common.you')} <span className="tag">{t('ident.owner')}</span></span>
            <span className="m-sub">{t('ident.ownerSub')}</span>
          </span>
        </li>
        {members.map((b) => (
          <li key={b.id} className="m-item">
            <button className="m-main-btn" onClick={() => select(botThread(b.id))}>
              <Avatar bot={b} className="lg" />
              <span className="m-main">
                <span className="m-name">{b.name} {b.id === matter.ownerBotId && <span className="tag">{t('group.lead')}</span>}</span>
                <span className="m-sub">{statusOf(b.id)}</span>
              </span>
            </button>
            {removing ? (
              <button className="m-x" title={t('ident.removeOut')} onClick={() => remove(b.id)}>{t('common.remove')}</button>
            ) : b.id !== matter.ownerBotId ? (
              <button className="m-x quiet-btn" title={t('ident.makeLead')} onClick={() => patchMatter(matter.id, { ownerBotId: b.id })}>{t('ident.setLead')}</button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- ② tasks ---------------- */

function TasksPanel({ bot, matter }: { bot?: Bot; matter?: Matter }) {
  const panel = useStore((s) => s.panel);
  if (panel.mode === 'task') return <TaskDetail todoId={panel.todoId} onBack={() => setPanel({ mode: 'board' })} />;
  if (bot) return <TaskBoard filter={(t) => t.botId === bot.id} />;
  if (matter) return <TaskBoard filter={(t) => t.matterId === matter.id} showBot />;
  return null;
}

const ORDER: TodoStatus[] = ['blocked', 'waiting', 'doing', 'open', 'done'];

export function TaskBoard({ filter, showBot }: { filter: (t: Todo) => boolean; showBot?: boolean }) {
  const t = useT();
  const s = useStore((x) => x);
  const [showDone, setShowDone] = useState(false);
  const todos = s.todos.filter(filter).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = ORDER.map((st) => ({ st, items: todos.filter((t) => t.status === st) })).filter((g) => g.items.length);

  if (showBot) {
    // Group board: who is doing what. One block per bot, tasks that need the user first, done last.
    const rank = (x: Todo) => (x.status === 'waiting' || x.status === 'blocked' ? 0 : x.status === 'done' ? 2 : 1);
    const byBot = new Map<string, Todo[]>();
    for (const x of todos) byBot.set(x.botId, [...(byBot.get(x.botId) ?? []), x]);
    const blocks = [...byBot.entries()]
      .map(([botId, items]) => ({ bot: s.bots.find((b) => b.id === botId), items: [...items].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt) }))
      .sort((a, b) => Math.min(...a.items.map(rank)) - Math.min(...b.items.map(rank)));
    return (
      <div className="board">
        {todos.length === 0 && <div className="quiet" style={{ padding: '12px 0' }}>{t('task.none')}</div>}
        {blocks.map(({ bot, items }) => {
          const open = items.filter((x) => x.status !== 'done');
          const shown = showDone ? items : items.filter((x) => x.status !== 'done').concat(items.filter((x) => x.status === 'done').slice(0, 1));
          return (
            <div className="bgroup" key={bot?.id ?? '?'}>
              <div className="bgroup-hd bot">
                <Avatar bot={bot} size="xs" />
                <span className="bg-name">{bot?.name ?? t('task.unknownBot')}</span>
                <span className="cnt">{open.length ? tn('task.doingCount', open.length) : t('task.allDone')}</span>
                {items.length - shown.length > 0 && <button className="link" onClick={() => setShowDone(true)}>{tn('task.moreDone', items.length - shown.length)}</button>}
              </div>
              {shown.map((x) => <TaskRow key={x.id} t={x} />)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="board">
      {todos.length === 0 && <div className="quiet" style={{ padding: '12px 0' }}>{t('task.none')}</div>}
      {groups.map(({ st, items }) => (
        <div className="bgroup" key={st}>
          <div className={cx('bgroup-hd', st)}>
            <span>{t(`task.group.${st}`)}</span>
            <span className="cnt">{items.length}</span>
            {st === 'done' && items.length > 2 && (
              <button className="link" onClick={() => setShowDone(!showDone)}>{showDone ? t('common.collapse') : t('common.all')}</button>
            )}
          </div>
          {(st === 'done' && !showDone ? items.slice(0, 2) : items).map((x) => (
            <TaskRow key={x.id} t={x} showBot={showBot} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TaskRow({ t: todo, showBot }: { t: Todo; showBot?: boolean }) {
  const t = useT();
  const s = useStore((x) => x);
  const bot = s.bots.find((b) => b.id === todo.botId);
  const pending = s.pendings.find((p) => !p.resolved && p.todoId === todo.id);
  const fresh = Date.now() - todo.updatedAt < 4000;
  // In a bot's own board, work born in a group carries the group's name (click = jump to the group).
  const group = !showBot && todo.matterId ? s.matters.find((m) => m.id === todo.matterId) : undefined;
  // Where the work came from, when it was not the user in the App: a routine, a colleague, an IM.
  const o = todo.origin;
  const origin = !o ? undefined : o.by === 'routine' ? t('task.fromRoutine') : o.by === 'bot' ? `@${s.bots.find((b) => b.id === o.fromBotId)?.name ?? ''}` : o.by === 'user' && o.via && o.via !== 'app' ? tr(`channel.${o.via}`) : undefined;
  return (
    <button className={cx('task', todo.status, fresh && 'fresh')} onClick={() => openTask(todo.id)} key={todo.updatedAt}>
      <div className="task-l1">
        {showBot && <Avatar bot={bot} size="xs" />}
        <span className="task-t">{todo.title}</span>
        {group && <span className="chip task-grp" role="link" onClick={(e) => { e.stopPropagation(); select(matterThread(group.id)); }} title={t('task.fromGroup')}>{group.title}</span>}
        {origin && <span className="chip task-org">{origin}</span>}
        <span className={cx('st', todo.status)}>{statusLabel(todo.status)}</span>
      </div>
      {todo.summary && <div className="task-s">{todo.summary}</div>}
      <div className="task-m">
        <span>{when(todo.updatedAt)}</span>
        {pending && (
          <span className="task-cta">
            {pending.kind === 'blocked' ? t('task.needUnlock') : pending.kind === 'confirm' ? t('task.confirmAmt', { amt: pending.amount ?? '' }) : t('task.pickOne')} ›
          </span>
        )}
      </div>
    </button>
  );
}

function TaskDetail({ todoId, onBack }: { todoId: string; onBack: () => void }) {
  // back navigation lives in the float header
  const t = useT();
  const s = useStore((x) => x);
  const todo = s.todos.find((x) => x.id === todoId);
  const bot = s.bots.find((b) => b.id === todo?.botId);
  const matter = s.matters.find((m) => m.id === todo?.matterId);
  useEffect(() => { if (!todo) onBack(); }, [todo, onBack]);
  if (!todo) return null;

  const pendings = s.pendings.filter((p) => p.todoId === todo.id).sort((a, b) => a.createdAt - b.createdAt);
  const openPending = pendings.find((p) => !p.resolved);
  const timeline = [
    ...s.actions.filter((a) => a.todoId === todo.id).map((a) => ({ kind: 'action' as const, ts: a.ts, a })),
    ...s.messages.filter((m) => m.todoId === todo.id || m.receipt?.todoId === todo.id).map((m) => ({ kind: 'msg' as const, ts: m.ts, m })),
  ].sort((x, y) => x.ts - y.ts);

  const jump = (messageId: string, threadId: string) => {
    select(threadId as `bot:${string}`);
    focusMessage(messageId);
  };

  return (
    <div className="detail">
      <div className="d-hd">
        <div className="d-title">{todo.title}</div>
        <div className="d-meta">
          <Avatar bot={bot} size="xs" /> {bot?.name}
          {matter && <> · <button className="link" onClick={() => select(matterThread(matter.id))}>{matter.title}</button></>}
          {' · '}<span className={cx('st', todo.status)}>{statusLabel(todo.status)}</span>
        </div>
      </div>

      <h3>{t('task.now')}</h3>
      {todo.status === 'done' ? (
        <div className="d-now done">
          <div className="d-now-t">{t('task.finished')}</div>
          <div>{todo.result ?? todo.summary ?? t('task.completed')}</div>
        </div>
      ) : openPending ? (
        <div className={cx('d-now', openPending.kind)}>
          <div className="d-now-t">
            {openPending.kind === 'blocked' ? t('task.stuckNeedYou') : openPending.kind === 'confirm' ? t('task.waitConfirm') : t('task.needPick')}
            {openPending.amount ? <span className="amt">¥{openPending.amount}</span> : null}
          </div>
          <div>{openPending.title}{openPending.detail ? ` · ${openPending.detail}` : ''}</div>
          <div className="w-a" style={{ marginTop: 8 }}><PendingActions p={openPending} small /></div>
        </div>
      ) : (
        <div className="d-now">
          <div className="d-now-t">{todo.status === 'doing' ? t('task.pushing') : t('task.queued')}</div>
          <div>{todo.summary ?? t('task.noProgress')}</div>
        </div>
      )}

      <h3>{t('task.timeline')} <span className="quiet">{tn('task.steps', timeline.length)}</span></h3>
      {timeline.length === 0 && <p className="quiet">{t('task.noRecord')}</p>}
      <ul className="tl">
        {timeline.map((e, i) => {
          if (e.kind === 'action') {
            return (
              <li key={'a' + e.a.id} className={cx('tl-a', e.a.undone && 'undone')}>
                <span className="tl-t">{when(e.ts)}</span>
                <span className="tl-x">
                  <span className="tl-dot" />
                  {e.a.text}{e.a.undone ? t('task.undone') : ''}
                  {e.a.undoable && !e.a.undone && <button className="undo" style={{ marginLeft: 8 }} onClick={() => undoAction(e.a.id)}>{t('task.undo')}</button>}
                </span>
              </li>
            );
          }
          const m = e.m;
          const isUser = m.author === 'user';
          return (
            <li key={'m' + m.id + i} className={cx('tl-m', isUser && 'user')}>
              <span className="tl-t">{when(e.ts)}</span>
              <span className="tl-x">
                <span className="tl-dot" />
                <span className="tl-who">{isUser ? t('common.you') : bot?.name}: </span>
                {m.text.length > 90 ? m.text.slice(0, 90) + '…' : m.text}
                {m.receipt && isUser && <span className={cx('receipt', m.receipt.kind)} style={{ marginLeft: 6 }}>{m.receipt.text}</span>}
                <button className="link tl-jump" onClick={() => jump(m.id, m.threadId)}>{t('task.seeChat')}</button>
              </span>
            </li>
          );
        })}
      </ul>

      {pendings.filter((p) => p.resolved).length > 0 && (
        <>
          <h3>{t('task.decided')}</h3>
          <ul className="mem">
            {pendings.filter((p) => p.resolved).map((p) => (
              <li key={p.id}><span>{p.title}</span><span className="quiet">→ {p.resolved!.choice} · {when(p.resolved!.at)}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
