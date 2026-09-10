import React, { useEffect, useState } from 'react';
import { useStore, markSeen, clampLayout } from './store';
import type { ThreadId } from './types';
import { agent, isLive } from './services/agent';
import { Sidebar } from './components/Sidebar';
import { Thread } from './components/Thread';
import { Inbox } from './components/Inbox';
import { MemoryView } from './components/MemoryView';
import { Draft } from './components/Draft';
import { RuntimeView } from './components/RuntimeView';
import { Toasts } from './components/Toasts';
import { PreviewModal } from './components/Preview';
import { useT, useLocale } from './i18n';

export default function App() {
  // A language change re-renders the whole tree from here: nothing below is memoized.
  useLocale();
  const selection = useStore((s) => s.selection);
  const msgCount = useStore((s) => s.messages.length);
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

  return (
    <div className="app no-right" style={{ '--w-sidebar': `${layout.sidebar}px`, '--w-side': `${layout.side}px`, '--w-right': `${layout.right}px` } as React.CSSProperties}>
      <Sidebar />
      {selection === 'inbox' ? <Inbox /> : selection === 'profile' ? <MemoryView /> : selection === 'draft-bot' ? <Draft /> : selection === 'runtime' ? <RuntimeView /> : <Thread threadId={selection as ThreadId} />}
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
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) return setVisible(false);
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, [show]);
  if (!visible) return null;
  return <div className="offline-bar">{t('common.offline')}</div>;
}
