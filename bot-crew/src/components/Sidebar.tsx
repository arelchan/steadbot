import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore, select, lastMessageOf, pendingCountFor, openPendings, unreadCount } from '../store';
import { botThread, matterThread } from '../types';
import type { Bot, Matter, State, ThreadId } from '../types';
import { Avatar } from './Avatar';
import { BotName, Sk } from './Skeleton';
import { Resizer } from './Resizer';
import { GroupAvatar, membersOf } from './GroupAvatar';
import { cx, shortDay } from '../utils';
import { NewGroupModal } from './NewGroupModal';
import { getRuntime } from '../services/runtime';
import { fetchUpgradeStatus } from '../services/upgrade';
import { SettingsModal } from './SettingsModal';
import { useT, tn } from '../i18n';

/** Most recent message in a thread (falls back to creation time): pinned first, then newest activity on top. */
function lastActivity(s: State, tid: ThreadId, fallback?: number) {
  return lastMessageOf(s, tid)?.ts ?? fallback ?? 0;
}

export function Sidebar() {
  const t = useT();
  const s = useStore((x) => x);
  const [menu, setMenu] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);
  const totalWaiting = openPendings(s).length;

  const renderThread = (threadId: ThreadId, node: ReactNode, state?: { typing?: boolean; unread?: boolean }) => {
    const active = s.selection === threadId;
    return (
      <button key={threadId} className={cx('item', active && 'active', state?.typing && 'typing', state?.unread && 'unread')} onClick={() => select(threadId)}>
        {node}
      </button>
    );
  };
  /** Which bots are mid-reply in a thread (empty when none). */
  const typingIn = (tid: ThreadId) => (s.typing[tid] ?? []).map((id) => s.bots.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);

  const renderBotRow = (b: Bot) => {
          const tid = botThread(b.id);
          const last = lastMessageOf(s, tid);
          const waiting = pendingCountFor(s, tid);
          const unread = s.selection === tid ? 0 : unreadCount(s, tid);
          const blocked = openPendings(s).some((p) => p.threadId === tid && p.kind === 'blocked');
          const typing = typingIn(tid).length > 0;
          const fresh = unread > 0 && !waiting;
          return renderThread(
            tid,
            <>
              <Avatar bot={b} />
              <div style={{ minWidth: 0 }}>
                <div className="row">
                  <BotName bot={b} className="name" />
                  {b.pinned && <span className="pin" title={t('side.pinned')}>⌃</span>}
                  {!b.notify && <span className="muted-ic" title={t('side.muted')}>◌</span>}
                  {waiting > 0 ? <span className={cx('wait')} style={blocked ? { color: 'var(--warn)' } : undefined}>{blocked ? t('side.stuck') : tn('side.waiting', waiting)}</span> : null}
                  {fresh ? <span className="fresh" title={t('side.fresh')} /> : last ? <span className="time">{shortDay(last.ts)}</span> : null}
                </div>
                <div className="prev">
                  {typing ? (
                    <span className="typing-line">{t('side.typing')}</span>
                  ) : b.building?.length ? (
                    <span className="evolving"><i className="ev-orb" />{Array.from(new Set(b.building.map((j) => j.aspect))).map((a) => `${a} building…`).join(' ')}</span>
                  ) : last ? last.text : b.generating?.identity ? <Sk w="70%" h={10} /> : b.tagline}
                </div>
              </div>
            </>,
            { typing, unread: fresh },
          );
  };

  const renderMatterRow = (m: Matter) => {
          const tid = matterThread(m.id);
          const last = lastMessageOf(s, tid);
          const waiting = pendingCountFor(s, tid);
          const unread = s.selection === tid ? 0 : unreadCount(s, tid);
          const bots = membersOf(m, s.bots);
          const typers = typingIn(tid);
          const fresh = unread > 0 && !waiting;
          return renderThread(
            tid,
            <>
              <GroupAvatar bots={bots} />
              <div style={{ minWidth: 0 }}>
                <div className="row">
                  <span className="name">{m.title}{m.date ? ` · ${m.date}` : ''}</span>
                  {m.pinned && <span className="pin" title={t('side.pinned')}>⌃</span>}
                  {!m.notify && <span className="muted-ic" title={t('side.muted')}>◌</span>}
                  {waiting > 0 ? <span className="wait">{tn('side.waiting', waiting)}</span> : null}
                  {fresh ? <span className="fresh" title={t('side.fresh')} /> : last ? <span className="time">{shortDay(last.ts)}</span> : null}
                </div>
                <div className="prev">
                  {typers.length ? (
                    <span className="typing-line">{t('side.typingWho', { who: typers.map((b) => b.name).join(t('common.listSep')) })}</span>
                  ) : last ? `${last.author === 'user' ? t('common.you') : s.bots.find((b) => b.id === last.botId)?.name}: ${last.text}` : m.summary}
                </div>
              </div>
            </>,
            { typing: typers.length > 0, unread: fresh },
          );
  };

  // One list: bots and groups together, pinned first, then whoever spoke last on top.
  const rows = [
    ...s.bots.map((bot) => ({ kind: 'bot' as const, bot, pinned: bot.pinned, ts: lastActivity(s, botThread(bot.id), bot.createdAt) })),
    ...s.matters.map((matter) => ({ kind: 'matter' as const, matter, pinned: matter.pinned, ts: lastActivity(s, matterThread(matter.id), matter.createdAt) })),
  ].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts);

  return (
    <aside className="col sidebar">
      <Resizer col="sidebar" edge="right" />
      <div className="hd">
        <h1>EverBot</h1>
        <div className="menu-wrap" ref={menuRef}>
          <button className={cx('iconbtn', menu && 'on')} title={t('side.new')} onClick={() => setMenu(!menu)}>＋</button>
          {menu && (
            <div className="menu">
              <button className="menu-item" onClick={() => { setMenu(false); select('draft-bot'); }}>
                <span className="mi-t">{t('side.newBot')}</span>
                <span className="mi-s">{t('side.newBotSub')}</span>
              </button>
              <button className="menu-item" onClick={() => { setMenu(false); setNewGroup(true); }}>
                <span className="mi-t">{t('side.newGroup')}</span>
                <span className="mi-s">{t('side.newGroupSub')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="side-body">
        <button className={cx('filter', s.selection === 'week' && 'active')} onClick={() => select('week')}>
          <span>{t('side.week')}</span>
        </button>
        <button className={cx('filter', s.selection === 'inbox' && 'active')} onClick={() => select('inbox')}>
          <span>{t('side.inbox')}</span>
          {totalWaiting > 0 ? <span className="badge">{totalWaiting}</span> : <span className="quiet" style={{ color: 'var(--muted)', fontSize: 11 }}>{t('side.clear')}</span>}
        </button>

        {rows.map((r) => (r.kind === 'bot' ? renderBotRow(r.bot) : renderMatterRow(r.matter)))}
      </div>
      <RuntimeFoot />
      {newGroup && <NewGroupModal onClose={() => setNewGroup(false)} />}
    </aside>
  );
}

/**
 * 设置：one entry at the bottom of the list. It doubles as the status line — where the bots run — and carries the
 * badge when there is a newer version to upgrade to.
 */
function RuntimeFoot() {
  const t = useT();
  const rt = useStore((s) => s.runtime);
  const online = useStore((s) => s.online);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => void fetchUpgradeStatus().then((s) => alive && setStale(!!s && !s.upToDate && !s.blocked));
    check();
    const t = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const remote = getRuntime().kind === 'remote';
  const label = remote ? (getRuntime() as { name?: string }).name || rt?.hostname || t('side.cloudMachine') : t('side.thisComputer');
  const tone = online === false ? 'off' : rt?.mode === 'active' ? 'ok' : rt ? 'warn' : 'off';
  return (
    <>
      <button className={cx('rt-foot', open && 'active')} onClick={() => setOpen(true)} title={t('side.settings')}>
        <span className={cx('rt-dot', tone)} />
        <span className="rt-foot-t">
          {t('side.settings')}<span className="quiet">{t('side.botsOn', { where: label })}</span>
        </span>
        {stale ? <span className="up-dot" title={t('side.newVersion')} /> : <span className="chev">›</span>}
      </button>
      {open && <SettingsModal tab={stale ? 'about' : 'general'} onClose={() => setOpen(false)} />}
    </>
  );
}
