import { useStore, openPendings, select } from '../store';
import type { ThreadId } from '../types';
import { Avatar } from './Avatar';
import { PendingActions } from './Cards';
import { cx, fmtTime, shortDay } from '../utils';
import { useT, tx } from '../i18n';

export function Inbox() {
  const t = useT();
  const s = useStore((x) => x);
  const waiting = openPendings(s).sort((a, b) => (a.kind === 'blocked' ? -1 : 0) - (b.kind === 'blocked' ? -1 : 0) || b.createdAt - a.createdAt);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since = startOfToday.getTime() - 86400000;
  const doneRecently = s.actions.filter((a) => a.ts >= since && !a.undone).sort((a, b) => b.ts - a.ts);
  const activeTodos = s.todos.filter((t) => t.status === 'doing' || t.status === 'open');

  const groups = new Map<string, typeof waiting>();
  for (const p of waiting) {
    const key = p.matterId ? `matter:${p.matterId}` : `bot:${p.botId}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <section className="col thread">
      <header className="hd">
        <div className="who">
          <span className="n">{t('inbox.title')}</span>
        </div>
      </header>
      <div className="inbox">
        <p className="lead">
          {waiting.length > 0 ? tx('inbox.needYou', { n: <b>{waiting.length}</b> }, { n: waiting.length }) : t('inbox.nothing')}
          {activeTodos.length > 0 && <> · {tx('inbox.selfDriving', { n: <b>{activeTodos.length}</b> }, { n: activeTodos.length })}</>}
          {doneRecently.length > 0 && <> · {tx('inbox.doneSince', { n: <b>{doneRecently.length}</b> }, { n: doneRecently.length })}</>}
        </p>

        {Array.from(groups.entries()).map(([key, items]) => {
          const [kind, id] = key.split(':');
          const title = kind === 'matter' ? s.matters.find((m) => m.id === id)?.title : s.bots.find((b) => b.id === id)?.name;
          return (
            <div className="inbox-group" key={key}>
              <h4>
                {kind === 'matter' ? t('inbox.matterPrefix') : ''}{title}
                <button className="link" onClick={() => select(key as ThreadId)}>{t('inbox.openThread')}</button>
              </h4>
              {items.map((p) => {
                const bot = s.bots.find((b) => b.id === p.botId);
                const msg = s.messages.find((m) => m.id === p.messageId);
                return (
                  <div className={cx('ib', p.kind)} key={p.id}>
                    <Avatar bot={bot} />
                    <div>
                      <div className="ib-t">{p.kind === 'blocked' ? t('inbox.stuckPrefix') : ''}{p.title}</div>
                      {(msg?.text || p.detail) && <div className="ib-d">{msg?.text ?? p.detail}</div>}
                      <div className="ib-m">{bot?.name} · {shortDay(p.createdAt) === fmtTime(p.createdAt) ? fmtTime(p.createdAt) : `${shortDay(p.createdAt)} ${fmtTime(p.createdAt)}`}</div>
                      <div className="ib-a"><PendingActions p={p} /></div>
                    </div>
                    {p.amount ? <div className="ib-amt">¥{p.amount}</div> : <span />}
                  </div>
                );
              })}
            </div>
          );
        })}

        {waiting.length === 0 && <div className="empty">{t('side.clear')}</div>}

        {doneRecently.length > 0 && (
          <div className="inbox-group">
            <h4>{t('inbox.quietlyDone')}</h4>
            <ul className="done-list">
              {doneRecently.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <Avatar bot={s.bots.find((b) => b.id === a.botId)} size="xs" />
                  <span>{a.text}</span>
                  <span className="t">{shortDay(a.ts) === fmtTime(a.ts) ? fmtTime(a.ts) : `${shortDay(a.ts)} ${fmtTime(a.ts)}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
