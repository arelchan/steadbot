import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore, markSeen, clampLayout } from './store';
import { parseThread } from './types';
import type { ThreadId } from './types';
import { agent, isLive } from './services/agent';
import { Sidebar } from './components/Sidebar';
import { Thread } from './components/Thread';
import { RightColumn } from './components/RightPanel';
import { Inbox } from './components/Inbox';
import { ProfileView } from './components/ProfileView';
import { Draft } from './components/Draft';
import { RuntimeView } from './components/RuntimeView';
import { Toasts } from './components/Toasts';
import { PreviewModal } from './components/Preview';
import { cx } from './utils';

export default function App() {
  const selection = useStore((s) => s.selection);
  const bots = useStore((s) => s.bots);
  const matters = useStore((s) => s.matters);
  const msgCount = useStore((s) => s.messages.length);
  const panels = useStore((s) => s.panels);
  const online = useStore((s) => s.online);
  const layout = useStore((s) => s.layout);

  useEffect(() => {
    agent.start();
    clampLayout();
    window.addEventListener('resize', clampLayout);
    return () => {
      agent.stop();
      window.removeEventListener('resize', clampLayout);
    };
  }, []);

  useEffect(() => {
    if (selection.includes(':')) markSeen(selection);
  }, [selection, msgCount]);

  const isThread = selection.includes(':');
  let right: ReactNode = null;
  if (isThread) {
    const { kind, id } = parseThread(selection as ThreadId);
    const b = kind === 'bot' ? bots.find((x) => x.id === id) : undefined;
    const m = kind === 'matter' ? matters.find((x) => x.id === id) : undefined;
    if ((b || m) && panels.identity) right = <RightColumn bot={b} matter={m} />;
  }

  return (
    <div className={cx('app', !right && 'no-right')} style={{ '--w-sidebar': `${layout.sidebar}px`, '--w-side': `${layout.side}px`, '--w-right': `${layout.right}px` } as React.CSSProperties}>
      <Sidebar />
      {selection === 'inbox' ? <Inbox /> : selection === 'profile' ? <ProfileView /> : selection === 'draft-bot' ? <Draft /> : selection === 'runtime' ? <RuntimeView /> : <Thread threadId={selection as ThreadId} />}
      {right}
      <OfflineBar show={isLive && online === false} />
      <Toasts />
      <PreviewModal />
    </div>
  );
}

/**
 * 「后端没连上」. Shown only once being offline has lasted a few seconds: restarts and brief network blips
 * reconnect on their own, and flashing a warning for each of them just makes the app look broken.
 */
function OfflineBar({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) return setVisible(false);
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, [show]);
  if (!visible) return null;
  return <div className="offline-bar">后端没连上，正在重试…</div>;
}
