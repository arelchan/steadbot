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
import { BotConfigModal } from './BotConfigModal';
import { ScreenCard } from './Screen';
import { statusLabel } from '../services/agent';
import { cx, fmtTime, shortDay } from '../utils';

const when = (ts: number) => (shortDay(ts) === fmtTime(ts) ? fmtTime(ts) : `${shortDay(ts)} ${fmtTime(ts)}`);

/* =========================================================
   Right column = two independent panels, each collapsible:
   ① 身份（bot 名片 / 事项档案）   ② 事项（看板 / 事项详情）
   ========================================================= */

export function RightColumn({ bot, matter }: { bot?: Bot; matter?: Matter }) {
  const panels = useStore((s) => s.panels);
  if (!panels.identity) return null;
  return (
    <aside className="col right">
      <Resizer col="right" edge="left" />
      <Panel grow>
        {bot ? <BotIdentity bot={bot} /> : matter ? <GroupInfo matter={matter} /> : null}
      </Panel>
    </aside>
  );
}

/**
 * 工作区：对话右侧的一条竖带，从上到下是这个 bot 的电脑屏幕、它手上的事项、它的例行任务。群聊没有电脑，
 * 只有事项。每一段能单独折叠；消息和输入框给这条带子留出宽度。
 */
export function TasksFloat({ bot, matter }: { bot?: Bot; matter?: Matter }) {
  const s = useStore((x) => x);
  if (!s.panels.tasks) return null;
  const todos = s.todos.filter((t) => (bot ? t.botId === bot.id : matter ? t.matterId === matter.id : false));
  const open = todos.filter((t) => t.status !== 'done').length;
  const wait = todos.filter((t) => t.status === 'waiting' || t.status === 'blocked').length;
  const detail = s.panel.mode === 'task';
  const on = bot?.desktop?.state === 'on';
  const routines = bot?.routines ?? [];
  const live = routines.filter((r) => r.enabled).length;
  return (
    <aside className="thread-side">
      <Resizer col="side" edge="left" />
      <div className="workspace">
        {bot && (
          <Section title="电脑" hint={on ? '开着' : undefined} startOpen>
            <ScreenCard bot={bot} />
          </Section>
        )}
        <Section title="事项" hint={`${open} 件${wait ? ` · ${wait} 件等你` : ''}`} startOpen grow lead={detail ? <button className="link" onClick={() => setPanel({ mode: 'board' })}>← 事项</button> : undefined}>
          <TasksPanel bot={bot} matter={matter} />
        </Section>
        {bot && (
          <Section title="例行" hint={routines.length ? `${live} 条在跑` : '还没有'} startOpen={false}>
            <RoutineList bot={bot} />
          </Section>
        )}
      </div>
    </aside>
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

/** The bot's routines, live: toggle one off, or drop it. Adding one is still 「Bot 配置 › 例行」. */
function RoutineList({ bot }: { bot: Bot }) {
  const toggle = (id: string) => patchBot(bot.id, { routines: bot.routines.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) });
  if (!bot.routines.length) return <div className="quiet ws-empty">还没有例行任务。到点自己做的事写在「Bot 配置 › 例行」里。</div>;
  return (
    <ul className="routine-list compact">
      {bot.routines.map((r) => (
        <li key={r.id} className={cx(!r.enabled && 'off')}>
          <div className="rt-main">
            <div className="rt-t">{r.title}</div>
            <div className="rt-s">
              {r.schedule}
              {r.lastRun ? ` · 上次 ${when(r.lastRun)}` : ''}
            </div>
          </div>
          <button className={cx('tgl', r.enabled && 'on')} onClick={() => toggle(r.id)} role="switch" aria-checked={r.enabled} title={r.enabled ? '开着' : '停了'}>
            <i />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Panel({ grow, children }: { grow?: boolean; children: ReactNode }) {
  return (
    <section className={cx('panel', grow && 'grow')}>
      <div className="panel-body">{children}</div>
    </section>
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
      <button className="av-btn" onClick={() => setOpen(!open)} title="换头像">
        <Avatar bot={bot} />
        <span className="av-hover">换图</span>
      </button>
      {open && (
        <div className="menu" style={{ left: 0, right: 'auto', minWidth: 200 }}>
          <button className="menu-item" onClick={() => fileRef.current?.click()}>
            <span className="mi-t">上传图片</span>
            <span className="mi-s">用你自己的图，会裁成圆形</span>
          </button>
          <button className="menu-item" onClick={regenerate}>
            <span className="mi-t">重新生成</span>
            <span className="mi-s">让生图模型再画一张 Q 版</span>
          </button>
          {bot.avatarUrl && (
            <button className="menu-item" onClick={() => { patchBot(bot.id, { avatarUrl: undefined }); setOpen(false); }}>
              <span className="mi-t">恢复生成的头像</span>
            </button>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}

function BotIdentity({ bot }: { bot: Bot }) {
  const [config, setConfig] = useState(false);
  const [ask, setAsk] = useState<'clear' | 'delete' | null>(null);
  const integrations = useStore((s) => s.integrations);
  const bad = integrations.filter((i) => (bot.integrationIds ?? []).includes(i.id) && i.status === 'error').length;
  const gen = !!bot.generating?.identity;
  return (
    <div className="ident">
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
              onBlur={(e) => { if (!e.target.value.trim()) patchBot(bot.id, { name: '未命名 bot' }); }}
              title="名字，直接改"
            />
          )}
        </div>
      </div>
      {gen ? (
        <div className="ident-gen">
          <Sk w="92%" h={11} className="sk-line" />
          <Sk w="78%" h={11} className="sk-line" />
          <Sk w="55%" h={11} className="sk-line" />
          <span className="gen-note">正在根据你的第一句话生成名字、职责和头像…</span>
        </div>
      ) : (
        <textarea
          className="role ident-desc fade-in"
          rows={3}
          placeholder="一句话说清它管什么、什么事必须问你…"
          value={bot.role}
          onChange={(e) => patchBot(bot.id, { role: e.target.value })}
          title="职责与工作方式，直接改；人设在 Bot 配置 › 指令里"
        />
      )}
      <div className="settings">
        <Toggle label="消息通知" on={bot.notify} onChange={(v) => patchBot(bot.id, { notify: v })} />
        <Toggle label="置顶聊天" on={bot.pinned} onChange={(v) => patchBot(bot.id, { pinned: v })} />
        <button className="set-row nav" onClick={() => setConfig(true)}>
          <span>Bot 配置</span>
          <span className="set-right">{bad ? <span className="cfg-warn">{bad} 个连接要修</span> : null}<span className="chev">›</span></span>
        </button>
      </div>
      <div className="settings">
        <button className="set-row" onClick={() => setAsk('clear')}>清空聊天记录</button>
        <button className="set-row danger" onClick={() => setAsk('delete')}>删除 bot</button>
      </div>
      {config && <BotConfigModal bot={bot} onClose={() => setConfig(false)} />}
      {ask === 'clear' && (
        <ConfirmDialog
          title="清空聊天记录"
          message="清空聊天记录会清空当前上下文，是否确认"
          confirmLabel="清空"
          danger
          onCancel={() => setAsk(null)}
          onConfirm={() => { clearThread(botThread(bot.id)); setAsk(null); }}
        />
      )}
      {ask === 'delete' && (
        <ConfirmDialog
          title={`删除「${bot.name}」`}
          message="它的对话、事项、记忆和会话文件都会一起删掉，不可恢复。"
          confirmLabel="删除"
          danger
          onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); removeBot(bot.id); }}
        />
      )}
    </div>
  );
}

function GroupInfo({ matter }: { matter: Matter }) {
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
    if (mine.length === 0) return '空闲';
    return `在做 ${mine.length} 件${wait ? ` · ${wait} 件等你` : ''}`;
  };

  return (
    <div className="ident">
      <div className="ident-top">
        <GroupAvatar bots={members} size="lg" />
        <div className="id-name" style={{ flex: 1 }}>
          <input
            className="name-edit"
            value={matter.title}
            onChange={(e) => patchMatter(matter.id, { title: e.target.value })}
            onBlur={(e) => { if (!e.target.value.trim()) patchMatter(matter.id, { title: '未命名群聊' }); }}
            title="群聊名，直接改"
          />
          <div className="t">{members.length} 个 bot 和你</div>
        </div>
      </div>
      <textarea className="role ident-desc" rows={2} placeholder="群聊描述…" value={matter.summary} onChange={(e) => patchMatter(matter.id, { summary: e.target.value })} />

      <div className="settings">
        <Toggle label="消息通知" on={matter.notify} onChange={(v) => patchMatter(matter.id, { notify: v })} />
        <Toggle label="置顶聊天" on={matter.pinned} onChange={(v) => patchMatter(matter.id, { pinned: v })} />
      </div>
      <div className="settings">
        <button className="set-row" onClick={() => setAskClear(true)}>清空聊天记录</button>
        <button className="set-row danger" onClick={() => setAskDissolve(true)}>解散群聊</button>
      </div>
      {askClear && (
        <ConfirmDialog
          title="清空聊天记录"
          message="清空聊天记录会清空当前上下文，是否确认"
          confirmLabel="清空"
          danger
          onCancel={() => setAskClear(false)}
          onConfirm={() => { clearThread(matterThread(matter.id)); setAskClear(false); }}
        />
      )}
      {askDissolve && (
        <ConfirmDialog
          title={`解散「${matter.title}」`}
          message="群里的对话和事项会一起删掉，不可恢复；群成员 bot 本身不受影响。"
          confirmLabel="解散"
          danger
          onCancel={() => setAskDissolve(false)}
          onConfirm={() => { setAskDissolve(false); removeMatter(matter.id); }}
        />
      )}

      <ul className="members">
        <li className="m-action menu-wrap" ref={ref}>
          <button className="m-row" onClick={() => { setAdding(!adding); setRemoving(false); }}>
            <span className="m-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="8" r="3.6" /><path d="M3.5 19c1-3.6 3.4-5.4 6.5-5.4 1.4 0 2.6.3 3.6 1" /><path d="M18 13v6M15 16h6" /></svg>
            </span>
            <span className="m-t">添加成员</span>
          </button>
          {adding && (
            <div className="menu" style={{ left: 40, right: 'auto', minWidth: 240 }}>
              {candidates.length === 0 && <div className="mi-s" style={{ padding: '8px 12px' }}>所有 bot 都已经在群里了</div>}
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
            <span className="m-t">{removing ? '完成' : '移除群成员'}</span>
          </button>
        </li>
        <li className="m-item">
          <Avatar you className="lg" />
          <span className="m-main">
            <span className="m-name">你 <span className="tag">群主</span></span>
            <span className="m-sub">拍板、付款</span>
          </span>
        </li>
        {members.map((b) => (
          <li key={b.id} className="m-item">
            <button className="m-main-btn" onClick={() => select(botThread(b.id))}>
              <Avatar bot={b} className="lg" />
              <span className="m-main">
                <span className="m-name">{b.name} {b.id === matter.ownerBotId && <span className="tag">牵头</span>}</span>
                <span className="m-sub">{statusOf(b.id)}</span>
              </span>
            </button>
            {removing ? (
              <button className="m-x" title="移出群聊" onClick={() => remove(b.id)}>移除</button>
            ) : b.id !== matter.ownerBotId ? (
              <button className="m-x quiet-btn" title="改为牵头" onClick={() => patchMatter(matter.id, { ownerBotId: b.id })}>设为牵头</button>
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
const GROUP_LABEL: Record<TodoStatus, string> = { blocked: '卡住了', waiting: '等你', doing: '它在做', open: '排队中', done: '做完的' };

export function TaskBoard({ filter, showBot }: { filter: (t: Todo) => boolean; showBot?: boolean }) {
  const s = useStore((x) => x);
  const [showDone, setShowDone] = useState(false);
  const todos = s.todos.filter(filter).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = ORDER.map((st) => ({ st, items: todos.filter((t) => t.status === st) })).filter((g) => g.items.length);

  if (showBot) {
    // Group board: who is doing what. One block per bot, tasks that need the user first, done last.
    const rank = (t: Todo) => (t.status === 'waiting' || t.status === 'blocked' ? 0 : t.status === 'done' ? 2 : 1);
    const byBot = new Map<string, Todo[]>();
    for (const t of todos) byBot.set(t.botId, [...(byBot.get(t.botId) ?? []), t]);
    const blocks = [...byBot.entries()]
      .map(([botId, items]) => ({ bot: s.bots.find((b) => b.id === botId), items: [...items].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt) }))
      .sort((a, b) => Math.min(...a.items.map(rank)) - Math.min(...b.items.map(rank)));
    return (
      <div className="board">
        {todos.length === 0 && <div className="quiet" style={{ padding: '12px 0' }}>还没有事项。在群里交代一句，或让牵头的 bot 分工，会记到这里。</div>}
        {blocks.map(({ bot, items }) => {
          const open = items.filter((t) => t.status !== 'done');
          const shown = showDone ? items : items.filter((t) => t.status !== 'done').concat(items.filter((t) => t.status === 'done').slice(0, 1));
          return (
            <div className="bgroup" key={bot?.id ?? '?'}>
              <div className="bgroup-hd bot">
                <Avatar bot={bot} size="xs" />
                <span className="bg-name">{bot?.name ?? '未知 bot'}</span>
                <span className="cnt">{open.length ? `${open.length} 件在做` : '都办完了'}</span>
                {items.length - shown.length > 0 && <button className="link" onClick={() => setShowDone(true)}>还有 {items.length - shown.length} 件已完成</button>}
              </div>
              {shown.map((t) => <TaskRow key={t.id} t={t} />)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="board">
      {todos.length === 0 && <div className="quiet" style={{ padding: '12px 0' }}>还没有事项。在左边交代一句，它会记到这里。</div>}
      {groups.map(({ st, items }) => (
        <div className="bgroup" key={st}>
          <div className={cx('bgroup-hd', st)}>
            <span>{GROUP_LABEL[st]}</span>
            <span className="cnt">{items.length}</span>
            {st === 'done' && items.length > 2 && (
              <button className="link" onClick={() => setShowDone(!showDone)}>{showDone ? '收起' : '全部'}</button>
            )}
          </div>
          {(st === 'done' && !showDone ? items.slice(0, 2) : items).map((t) => (
            <TaskRow key={t.id} t={t} showBot={showBot} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TaskRow({ t, showBot }: { t: Todo; showBot?: boolean }) {
  const s = useStore((x) => x);
  const bot = s.bots.find((b) => b.id === t.botId);
  const pending = s.pendings.find((p) => !p.resolved && p.todoId === t.id);
  const fresh = Date.now() - t.updatedAt < 4000;
  // In a bot's own board, work born in a group carries the group's name (click = jump to the group).
  const group = !showBot && t.matterId ? s.matters.find((m) => m.id === t.matterId) : undefined;
  return (
    <button className={cx('task', t.status, fresh && 'fresh')} onClick={() => openTask(t.id)} key={t.updatedAt}>
      <div className="task-l1">
        {showBot && <Avatar bot={bot} size="xs" />}
        <span className="task-t">{t.title}</span>
        {group && <span className="chip task-grp" role="link" onClick={(e) => { e.stopPropagation(); select(matterThread(group.id)); }} title="来自群聊，点击跳转">{group.title}</span>}
        <span className={cx('st', t.status)}>{statusLabel(t.status)}</span>
      </div>
      {t.summary && <div className="task-s">{t.summary}</div>}
      <div className="task-m">
        <span>{when(t.updatedAt)}</span>
        {pending && <span className="task-cta">{pending.kind === 'blocked' ? '需要你解锁' : pending.kind === 'confirm' ? `确认 ¥${pending.amount}` : '选一个'} ›</span>}
      </div>
    </button>
  );
}

function TaskDetail({ todoId, onBack }: { todoId: string; onBack: () => void }) {
  // back navigation lives in the float header
  const s = useStore((x) => x);
  const t = s.todos.find((x) => x.id === todoId);
  const bot = s.bots.find((b) => b.id === t?.botId);
  const matter = s.matters.find((m) => m.id === t?.matterId);
  useEffect(() => { if (!t) onBack(); }, [t, onBack]);
  if (!t) return null;

  const pendings = s.pendings.filter((p) => p.todoId === t.id).sort((a, b) => a.createdAt - b.createdAt);
  const openPending = pendings.find((p) => !p.resolved);
  const timeline = [
    ...s.actions.filter((a) => a.todoId === t.id).map((a) => ({ kind: 'action' as const, ts: a.ts, a })),
    ...s.messages.filter((m) => m.todoId === t.id || m.receipt?.todoId === t.id).map((m) => ({ kind: 'msg' as const, ts: m.ts, m })),
  ].sort((x, y) => x.ts - y.ts);

  const jump = (messageId: string, threadId: string) => {
    select(threadId as `bot:${string}`);
    focusMessage(messageId);
  };

  return (
    <div className="detail">
      <div className="d-hd">
        <div className="d-title">{t.title}</div>
        <div className="d-meta">
          <Avatar bot={bot} size="xs" /> {bot?.name}
          {matter && <> · <button className="link" onClick={() => select(matterThread(matter.id))}>{matter.title}</button></>}
          {' · '}<span className={cx('st', t.status)}>{statusLabel(t.status)}</span>
        </div>
      </div>

      <h3>现在</h3>
      {t.status === 'done' ? (
        <div className="d-now done">
          <div className="d-now-t">做完了</div>
          <div>{t.result ?? t.summary ?? '已完成。'}</div>
        </div>
      ) : openPending ? (
        <div className={cx('d-now', openPending.kind)}>
          <div className="d-now-t">
            {openPending.kind === 'blocked' ? '卡住了，需要你' : openPending.kind === 'confirm' ? '停在这一步等你确认' : '需要你选一个'}
            {openPending.amount ? <span className="amt">¥{openPending.amount}</span> : null}
          </div>
          <div>{openPending.title}{openPending.detail ? ` · ${openPending.detail}` : ''}</div>
          <div className="w-a" style={{ marginTop: 8 }}><PendingActions p={openPending} small /></div>
        </div>
      ) : (
        <div className="d-now">
          <div className="d-now-t">{t.status === 'doing' ? '它在推进' : '排队中'}</div>
          <div>{t.summary ?? '还没有进展。'}</div>
        </div>
      )}

      <h3>经过 <span className="quiet">{timeline.length} 步</span></h3>
      {timeline.length === 0 && <p className="quiet">还没有记录。</p>}
      <ul className="tl">
        {timeline.map((e, i) => {
          if (e.kind === 'action') {
            return (
              <li key={'a' + e.a.id} className={cx('tl-a', e.a.undone && 'undone')}>
                <span className="tl-t">{when(e.ts)}</span>
                <span className="tl-x">
                  <span className="tl-dot" />
                  {e.a.text}{e.a.undone ? '（已撤销）' : ''}
                  {e.a.undoable && !e.a.undone && <button className="undo" style={{ marginLeft: 8 }} onClick={() => undoAction(e.a.id)}>撤销</button>}
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
                <span className="tl-who">{isUser ? '你' : bot?.name}：</span>
                {m.text.length > 90 ? m.text.slice(0, 90) + '…' : m.text}
                {m.receipt && isUser && <span className={cx('receipt', m.receipt.kind)} style={{ marginLeft: 6 }}>{m.receipt.text}</span>}
                <button className="link tl-jump" onClick={() => jump(m.id, m.threadId)}>看对话</button>
              </span>
            </li>
          );
        })}
      </ul>

      {pendings.filter((p) => p.resolved).length > 0 && (
        <>
          <h3>你拍过的板</h3>
          <ul className="mem">
            {pendings.filter((p) => p.resolved).map((p) => (
              <li key={p.id}><span>{p.title}</span><span className="quiet">→ {p.resolved!.choice} · {when(p.resolved!.at)}</span></li>
            ))}
          </ul>
        </>
      )}
      <div className="explain" style={{ marginTop: 14 }}>
        这条事项由你在对话里的一句话产生，之后每次你补一句，它会更新而不是新开一条。
      </div>
    </div>
  );
}
