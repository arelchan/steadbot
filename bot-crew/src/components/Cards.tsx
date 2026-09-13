import type { Card, Pending, ThreadId } from '../types';
import { useEffect, useRef, useState } from 'react';
import { useStore, getState } from '../store';
import { agent } from '../services/agent';
import { cx, money } from '../utils';
import { useT, tn } from '../i18n';
import { httpBase, withToken } from '../services/runtime';

export function CardView({ card, messageId }: { card: Card; messageId?: string }) {
  const t = useT();
  const pending = useStore((s) => ('pendingId' in card ? s.pendings.find((p) => p.id === card.pendingId) : undefined));

  if (card.type === 'secrets') return <SecretsCard card={card} messageId={messageId} />;
  if (card.type === 'login') return <LoginCard card={card} messageId={messageId} />;
  if (card.type === 'machine') return <MachineCard card={card} messageId={messageId} />;
  if (card.type === 'vigil') return <VigilCard card={card} />;
  if (card.type === 'agent_run') return <AgentRunCard card={card} />;

  if (card.type === 'connect') {
    const dead = !!card.failed || !!card.expired;
    const retry = () => {
      const sel = getState().selection;
      if (sel.includes(':')) agent.onUserMessage(sel as ThreadId, t('card.retryCard', { name: card.name }));
    };
    const sub = card.done
      ? card.account
        ? t('card.connectedAs', { account: card.account })
        : t('card.connected')
      : card.failed
        ? t('card.notDone', { why: card.failed })
        : card.expired
          ? t('card.expired')
          : t('card.connectBlurb', { blurb: card.blurb });
    return (
      <div className={cx('card connect', card.done && 'resolved', dead && 'dead')}>
        <div className="c-head">
          <div>
            <div className="c-title">{t('card.connect', { name: card.name })}</div>
            <div className="c-sub">{sub}</div>
          </div>
          <span className="cn-mark" aria-hidden>{card.done ? '✓' : dead ? '!' : '↗'}</span>
        </div>
        <div className="c-actions">
          {card.done ? (
            <button className="btn picked" disabled>✓ {t('card.authorized')}</button>
          ) : dead ? (
            <button className="btn" onClick={retry}>{t('common.retry')}</button>
          ) : (
            <a className="btn primary" href={card.url} target="_blank" rel="noopener noreferrer">{t('card.authorize', { name: card.name })}</a>
          )}
        </div>
      </div>
    );
  }

  const resolved = pending?.resolved;
  const choose = (id: string) => agent.onPendingChoice(card.pendingId, id);
  // What came back is the option's label (a free-text reply is the text itself), so match on it both ways.
  const picked = (label: string) => !!resolved && (label === resolved.choice || label.startsWith(resolved.choice) || resolved.choice.startsWith(label));
  const offList = !!resolved && !(pending?.options ?? []).some((o) => picked(o.label));

  if (card.type === 'confirm') {
    return (
      <div className={cx('card', resolved && 'resolved')}>
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            <div className="c-sub">{card.sub}</div>
          </div>
          <div className="c-amt">{money(card.amount, card.currency)}</div>
        </div>
        <div className="c-actions">
          {(pending?.options ?? []).map((o) => (
            <button
              key={o.id}
              className={cx('btn', o.primary && !resolved && 'primary', picked(o.label) && 'picked')}
              disabled={!!resolved}
              onClick={() => choose(o.id)}
            >
              {picked(o.label) ? '✓ ' : ''}{o.label}{o.primary && card.amount ? ` ${money(card.amount, card.currency)}` : ''}
            </button>
          ))}
        </div>
        {offList ? <div className="c-said">{t('card.youSaid', { text: resolved!.choice })}</div> : null}
      </div>
    );
  }

  if (card.type === 'options') {
    return (
      <div className={cx('card', resolved && 'resolved')}>
        <div className="opts">
          {card.options.map((o) => (
            <button
              key={o.id}
              className={cx('opt', picked(o.label) && 'picked')}
              disabled={!!resolved}
              onClick={() => choose(o.id)}
            >
              <div className="o-l">{o.label}</div>
              <div className="o-h">{o.hint}</div>
            </button>
          ))}
        </div>
        {offList ? <div className="c-said">{t('card.youSaid', { text: resolved!.choice })}</div> : null}
      </div>
    );
  }

  if (card.type === 'blocked') {
    return (
      <div className={cx('card blocked', resolved && 'resolved')}>
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            <div className="c-sub">{card.sub}</div>
          </div>
        </div>
        <div className="c-actions">
          {(pending?.options ?? []).map((o) => (
            <button
              key={o.id}
              className={cx('btn', o.primary && !resolved && 'primary', picked(o.label) && 'picked')}
              disabled={!!resolved}
              onClick={() => choose(o.id)}
            >
              {picked(o.label) ? '✓ ' : ''}{o.label}
            </button>
          ))}
        </div>
        {offList ? <div className="c-said">{t('card.youSaid', { text: resolved!.choice })}</div> : null}
      </div>
    );
  }
  return null;
}

/** Credentials go straight to the backend's integration env; nothing is kept in local state or shown afterwards. */
/**
 * 登录卡：bot 在电脑上撞到登录墙时把它搬到这里。二维码是活的——码几十秒就换一次，所以图每 8 秒重新取一遍，
 * 而不是发一张会过期的截图；密码由服务端直接打进那个页面，填完卡就作废。
 */
function LoginCard({ card, messageId }: { card: Extract<Card, { type: 'login' }>; messageId?: string }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  // The code is live only while the page behind it is: once the server stops serving it (scanned, timed out, or the
  // service restarted) the image stops loading — and a stale code is worse than none, so it greys out and says so.
  const [dead, setDead] = useState(false);
  useEffect(() => {
    if (card.kind !== 'qr' || card.done || dead) return;
    const timer = setInterval(() => setTick((n) => n + 1), 8000);
    return () => clearInterval(timer);
  }, [card.kind, card.done, dead]);
  // Three states, one shape: still open, done and it worked, done because it went stale (nothing was filled).
  const done = card.done || sent;
  const stale = card.done && card.ok === false && !sent;
  const over = done && !stale;
  const ready = (card.fields ?? []).every((f) => f.secret === false || (values[f.key] ?? '').trim());
  return (
    <div className={cx('card connect secrets', over && 'resolved', stale && 'dead')}>
      <div className="c-head">
        <div>
          <div className="c-title">{card.title}</div>
          <div className="c-sub">{done ? (card.note ?? t('card.loginDone')) : card.kind === 'qr' ? (dead ? t('card.loginStale') : t('card.loginScan')) : t('card.secretsNote')}</div>
        </div>
        <span className="cn-mark" aria-hidden>{stale ? '!' : over ? '✓' : '⌁'}</span>
      </div>
      {card.kind === 'qr' ? (
        <>
          <div className={cx('login-qr-wrap', (dead || stale) && !over && 'dead', done && 'done')}>
            {done ? (
              <div className={cx('login-ok', stale && 'off')} aria-hidden>{stale ? '⊘' : '✓'}</div>
            ) : (
              <img className="login-qr" src={withToken(`${httpBase || window.location.origin}/login/${card.askId}.png?t=${tick}`)} alt={card.title} onError={() => setDead(true)} />
            )}
            {dead && !done && <span className="login-dead">{t('card.loginStale')}</span>}
          </div>
          {card.how && !dead && !done && <div className="login-how">{card.how}</div>}
        </>
      ) : (
        <>
          <div className="sc-fields">
            {(card.fields ?? []).map((f) => (
              <label key={f.key} className="sc-field">
                <span className="sc-label">{f.label}</span>
                <input
                  type={f.secret === false ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={done}
                  value={done ? '' : (values[f.key] ?? '')}
                  placeholder={over ? '••••••••' : ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="c-actions">
            <button
              className={cx('btn', over ? 'picked' : 'primary')}
              disabled={done || !ready || !messageId}
              onClick={() => {
                if (!messageId) return;
                agent.submitLogin(messageId, card.askId, values);
                setValues({});
                setSent(true);
              }}
            >
              {over ? `✓ ${t('card.loginSubmitted')}` : t('card.loginGo')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SecretsCard({ card, messageId }: { card: Extract<Card, { type: 'secrets' }>; messageId?: string }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const ready = card.fields.every((f) => (values[f.key] ?? '').trim());
  const over = card.done || sent;
  return (
    <div className={cx('card connect secrets', over && 'resolved')}>
      <div className="c-head">
        <div>
          <div className="c-title">{card.title}</div>
          <div className="c-sub">{over ? (card.done ? t('card.secretsFilled') : t('card.secretsSent')) : t('card.secretsNote')}</div>
        </div>
        <span className="cn-mark" aria-hidden>{over ? '✓' : '⌁'}</span>
      </div>
      {card.help && (card.help.steps?.length || card.help.url) ? (
        <div className="sc-help">
          {card.help.steps?.length ? (
            <ol className="sc-steps">
              {card.help.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : null}
          {card.help.url ? (
            <a className="btn sm" href={card.help.url} target="_blank" rel="noopener noreferrer">{card.help.urlLabel ?? t('card.openSettingsPage')} ↗</a>
          ) : null}
        </div>
      ) : null}
      <div className="sc-fields">
        {card.fields.map((f) => (
          <label key={f.key} className="sc-field">
            <span className="sc-label">{f.label}</span>
            <input
              type={f.secret === false ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              disabled={over}
              value={over ? '' : (values[f.key] ?? '')}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={over ? '••••••••' : (f.hint ?? '')}
            />
          </label>
        ))}
      </div>
      <div className="c-actions">
        <button
          className={cx('btn', over ? 'picked' : 'primary')}
          disabled={over || !ready || !messageId}
          onClick={() => {
            if (!messageId) return;
            agent.submitSecrets(messageId, card.integrationId, values);
            setValues({});
            setSent(true);
          }}
        >
          {over ? `✓ ${t('card.secretsDone')}` : t('card.secretsSubmit')}
        </button>
      </div>
    </div>
  );
}

/** Compact action row used by the inbox and the matter panel. */
export function PendingActions({ p, small }: { p: Pending; small?: boolean }) {
  const done = p.resolved;
  const picked = (label: string) => !!done && (label === done.choice || label.startsWith(done.choice) || done.choice.startsWith(label));
  if (done && !p.options.some((o) => picked(o.label))) return <span className="quiet">✓ {done.choice}</span>;
  return (
    <>
      {p.options.map((o) => (
        <button
          key={o.id}
          className={cx('btn', small && 'sm', o.primary && !done && 'primary', picked(o.label) && 'picked')}
          disabled={!!done}
          onClick={() => agent.onPendingChoice(p.id, o.id)}
        >
          {picked(o.label) ? '✓ ' : ''}{o.label}{o.primary && p.kind === 'confirm' && p.amount ? ` ${money(p.amount, p.currency)}` : ''}
        </button>
      ))}
    </>
  );
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/**
 * The steward's cards. connect: the user types the machine's IP / login / password here; the local server logs in,
 * keeps them in its credential file and shows what it found. run: one command the steward runs on the machine, with
 * its output streaming in, so the user can watch what is being done. move: one click ships the bots' home over.
 */
function MachineCard({ card, messageId }: { card: Extract<Card, { type: 'machine' }>; messageId?: string }) {
  const t = useT();
  const [host, setHost] = useState('');
  const [user, setUser] = useState(card.user ?? 'root');
  const [password, setPassword] = useState('');
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [card.log?.length]);
  const running = card.state === 'running';

  if (card.stage === 'connect') {
    const form = card.state === 'idle' || card.state === 'error';
    return (
      <div className={cx('card connect machine', card.state === 'done' && 'resolved')}>
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            <div className="c-sub">{form ? t('card.machineForm') : running ? t('card.machineConnecting') : t('card.machineConnected')}</div>
          </div>
          <span className="cn-mark" aria-hidden>{card.state === 'done' ? '✓' : '⌂'}</span>
        </div>
        {form && (
          <>
            {card.error && <div className="mc-err">{card.error}</div>}
            <div className="sc-fields">
              <label className="sc-field"><span className="sc-label">{t('card.machineIp')}</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('card.machineIpHint')} spellCheck={false} autoComplete="off" /></label>
              <div className="mc-two">
                <label className="sc-field"><span className="sc-label">{t('card.machineUser')}</span><input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoComplete="off" /></label>
                <label className="sc-field"><span className="sc-label">{t('card.machinePass')}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
              </div>
            </div>
            <div className="c-actions">
              <button
                className="btn primary"
                disabled={!messageId || !host.trim() || !password}
                onClick={() => {
                  if (!messageId) return;
                  // "1.2.3.4:2222" → a non-standard ssh port.
                  const mm = /^(.*?)(?::(\d{2,5}))?$/.exec(host.trim());
                  agent.machineConnect(messageId, { host: mm?.[1] ?? host.trim(), user: user.trim() || 'root', password, port: mm?.[2] ? Number(mm[2]) : undefined });
                  setPassword('');
                }}
              >
                {card.state === 'error' ? t('card.machineFix') : t('card.machineConnect')}
              </button>
            </div>
          </>
        )}
        {running && <pre className="wiz-log live mc-log">{(card.log ?? []).join('\n')}{'\n▍'}</pre>}
        {card.state === 'done' && card.summary?.length ? (
          <ul className="mc-summary">{card.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        ) : null}
      </div>
    );
  }

  if (card.stage === 'run') {
    const failed = card.state === 'error';
    const lines = card.log ?? [];
    return (
      <div className={cx('card connect machine run', card.state === 'done' && 'resolved', failed && 'dead')}>
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            {card.command && <div className="mc-cmd">{card.command}</div>}
            {failed && card.error && <div className="c-sub">{card.error}</div>}
          </div>
          <span className="cn-mark" aria-hidden>{running ? '›' : failed ? '✘' : '✓'}</span>
        </div>
        {running ? (
          <pre className="wiz-log live mc-log" ref={logRef}>{lines.join('\n') || '…'}{'\n▍'}</pre>
        ) : lines.length ? (
          <details className="mc-details" open={failed}><summary>{failed ? t('card.outErr') : tn('card.outLines', lines.length)}</summary><pre className="wiz-log mc-log">{lines.join('\n')}</pre></details>
        ) : null}
      </div>
    );
  }

  // move
  const p = card.progress;
  return (
    <div className={cx('card connect machine', card.state === 'done' && 'resolved')}>
      <div className="c-head">
        <div>
          <div className="c-title">{card.title}</div>
          <div className="c-sub">
            {card.state === 'idle' && t('card.moveIdle', { n: card.target?.bots ?? '', name: card.target?.name ?? '' })}
            {running && (!p ? t('card.movePacking') : p.sent < p.total ? t('card.moveSending', { sent: mb(p.sent), total: mb(p.total) }) : t('card.moveSent', { total: mb(p.total) }))}
            {card.state === 'done' && t('card.moveDone')}
            {card.state === 'error' && t('card.moveFailed')}
          </div>
        </div>
        <span className="cn-mark" aria-hidden>{card.state === 'done' ? '✓' : '☁'}</span>
      </div>
      {card.state === 'error' && card.error && <div className="mc-err">{card.error}</div>}
      {(card.state === 'idle' || card.state === 'error') && (
        <div className="c-actions">
          <button className="btn primary" disabled={!messageId} onClick={() => messageId && agent.machineMove(messageId)}>{card.state === 'error' ? t('common.retry') : t('card.moveGo')}</button>
        </div>
      )}
    </div>
  );
}

/** The vigil card: a bot is watching a long task. Shows the goal, what it watches, and the latest check. */
function VigilCard({ card }: { card: Extract<Card, { type: 'vigil' }> }) {
  const t = useT();
  const running = card.state === 'running';
  return (
    <div className={cx('card connect vigil', !running && 'resolved')}>
      <div className="c-head">
        <div>
          <div className="c-title">{running ? t('card.vigilOn') : t('card.vigilOff')}·{card.goal}</div>
          <div className="c-sub">
            {t('card.vigilWatch', { what: card.watching })}
            {card.checkLabel ? t('card.vigilEvery', { s: card.everyS, label: card.checkLabel }) : t('card.vigilPush', { s: card.everyS })}
            {card.ticks ? tn('card.vigilTicks', card.ticks) : ''}
            {!running && card.reason ? ` · ${card.reason}` : ''}
          </div>
        </div>
        <span className="cn-mark vigil-dot" aria-hidden>{running ? '◉' : '✓'}</span>
      </div>
      {running && card.last ? (
        <details className="mc-details"><summary>{card.lastOk === false ? t('card.vigilLastBad') : t('card.vigilLast')}</summary><pre className="wiz-log mc-log">{card.last}</pre></details>
      ) : null}
    </div>
  );
}

/** An external agent at work: what it is doing (tool calls), its running reply, and how it ended. */
function AgentRunCard({ card }: { card: Extract<Card, { type: 'agent_run' }> }) {
  const t = useT();
  const running = card.state === 'running';
  const failed = card.state === 'error';
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [card.log?.length, card.output?.length]);
  const lines = card.log ?? [];
  return (
    <div className={cx('card connect machine run agent', card.state === 'done' && 'resolved', failed && 'dead')}>
      <div className="c-head">
        <div>
          <div className="c-title">{running ? t('card.agentDoing', { name: card.name }) : failed ? t('card.agentFailed', { name: card.name }) : t('card.agentDone', { name: card.name })}</div>
          <div className="mc-cmd">{card.title}</div>
          <div className="c-sub">
            {card.viaHost ? t('card.agentViaHost', { name: card.viaHost }) : card.mode === 'acp' ? t('card.agentAcp') : t('card.agentOnce')}
            {card.asked ? tn('card.agentAsked', card.asked) : ''}
            {failed && card.error ? ` · ${card.error}` : ''}
          </div>
        </div>
        <span className="cn-mark" aria-hidden>{running ? '›' : failed ? '✘' : '✓'}</span>
      </div>
      {running ? (
        <pre className="wiz-log live mc-log" ref={logRef}>{[...lines, ...(card.output ? ['', card.output] : [])].join('\n') || '…'}{'\n▍'}</pre>
      ) : lines.length || card.output ? (
        <details className="mc-details" open={failed}><summary>{failed ? t('card.agentStepsErr') : tn('card.agentSteps', lines.length)}</summary><pre className="wiz-log mc-log">{[...lines, ...(card.output ? ['', card.output] : [])].join('\n')}</pre></details>
      ) : null}
    </div>
  );
}
