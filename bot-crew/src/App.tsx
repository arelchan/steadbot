import React, { useEffect, useState } from 'react';
import { useStore, markSeen, clampLayout } from './store';
import type { ThreadId } from './types';
import { agent, hasServer } from './services/agent';
import { Sidebar } from './components/Sidebar';
import { Thread } from './components/Thread';
import { Inbox } from './components/Inbox';
import { Week } from './components/Week';
import { Draft } from './components/Draft';
import { RuntimeView } from './components/RuntimeView';
import { Toasts } from './components/Toasts';
import { PreviewModal } from './components/Preview';
import { UpgradeCurtain } from './components/UpgradeCurtain';
import { SettingsModal } from './components/SettingsModal';
import { useT, useLocale } from './i18n';

export default function App() {
  // A language change re-renders the whole tree from here: nothing below is memoized.
  useLocale();
  const selection = useStore((s) => s.selection);
  const msgCount = useStore((s) => s.messages.length);
  const online = useStore((s) => s.online);
  const needsModel = useStore((s) => s.needsModel);
  const layout = useStore((s) => s.layout);

  useEffect(() => {
    if (!hasServer) return;
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

  if (!hasServer) return <NoServer />;
  return (
    <div className="app no-right" style={{ '--w-sidebar': `${layout.sidebar}px`, '--w-side': `${layout.side}px`, '--w-right': `${layout.right}px` } as React.CSSProperties}>
      <Sidebar />
      {selection === 'week' || selection === 'inbox' ? <Week /> : selection === 'profile' ? <Inbox /> : selection === 'draft-bot' ? <Draft /> : selection === 'runtime' ? <RuntimeView /> : <Thread threadId={selection as ThreadId} />}
      <OfflineBar show={online === false} />
      <NeedsModelBar show={!!needsModel && online !== false} />
      <Toasts />
      <PreviewModal />
      <UpgradeCurtain />
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

/**
 * Nothing here is simulated, so with no model configured there is nothing for the bots to do — and saying that
 * plainly, with the way to fix it one click away, beats a crew that silently never answers.
 */
function NeedsModelBar({ show }: { show: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <>
      {/* Out of the way while the window it points at is open — it has done its job by then. */}
      {!open && (
        <div className="offline-bar setup-bar">
          {t('common.needsModel')}
          <button className="setup-go" onClick={() => setOpen(true)}>{t('common.needsModelGo')}</button>
        </div>
      )}
      {open && <SettingsModal tab="models" onClose={() => setOpen(false)} />}
    </>
  );
}

/** The App was opened without a server address — a development mistake, not a state the product ever ships in. */
function NoServer() {
  const t = useT();
  return (
    <div className="no-server">
      <h1>{t('common.noServerTitle')}</h1>
      <p>{t('common.noServerBody')}</p>
    </div>
  );
}
