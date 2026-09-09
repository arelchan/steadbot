import type { Card, Pending, ThreadId } from '../types';
import { useEffect, useRef, useState } from 'react';
import { useStore, getState } from '../store';
import { agent } from '../services/agent';
import { cx } from '../utils';

export function CardView({ card, messageId }: { card: Card; messageId?: string }) {
  const pending = useStore((s) => ('pendingId' in card ? s.pendings.find((p) => p.id === card.pendingId) : undefined));

  if (card.type === 'secrets') return <SecretsCard card={card} messageId={messageId} />;
  if (card.type === 'machine') return <MachineCard card={card} messageId={messageId} />;
  if (card.type === 'vigil') return <VigilCard card={card} />;
  if (card.type === 'agent_run') return <AgentRunCard card={card} />;

  if (card.type === 'connect') {
    const dead = !!card.failed || !!card.expired;
    const retry = () => {
      const sel = getState().selection;
      if (sel.includes(':')) agent.onUserMessage(sel as ThreadId, `再发一张 ${card.name} 的授权卡，我重新试一次`);
    };
    const sub = card.done
      ? `已连接${card.account ? ` · ${card.account}` : ''}`
      : card.failed
        ? `没有完成：${card.failed}`
        : card.expired
          ? '这张卡过期了，重新发一张即可。'
          : `${card.blurb}。点一下，登录并同意，回来就接好了。`;
    return (
      <div className={cx('card connect', card.done && 'resolved', dead && 'dead')}>
        <div className="c-head">
          <div>
            <div className="c-title">连接 {card.name}</div>
            <div className="c-sub">{sub}</div>
          </div>
          <span className="cn-mark" aria-hidden>{card.done ? '✓' : dead ? '!' : '↗'}</span>
        </div>
        {card.done ? null : dead ? (
          <div className="c-actions">
            <button className="btn" onClick={retry}>再试一次</button>
          </div>
        ) : (
          <div className="c-actions">
            <a className="btn primary" href={card.url} target="_blank" rel="noopener noreferrer">去授权 {card.name}</a>
          </div>
        )}
      </div>
    );
  }

  const resolved = pending?.resolved;
  const choose = (id: string) => agent.onPendingChoice(card.pendingId, id);

  if (card.type === 'confirm') {
    return (
      <div className={cx('card', resolved && 'resolved')}>
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            <div className="c-sub">{card.sub}</div>
          </div>
          <div className="c-amt">¥{card.amount}</div>
        </div>
        {resolved ? (
          <div className="c-resolved">✓ {resolved.choice}</div>
        ) : (
          <div className="c-actions">
            {(pending?.options ?? []).map((o) => (
              <button key={o.id} className={cx('btn', o.primary && 'primary')} onClick={() => choose(o.id)}>
                {o.label}{o.primary && card.amount ? ` ¥${card.amount}` : ''}
              </button>
            ))}
          </div>
        )}
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
              className={cx('opt', resolved?.choice && o.label.startsWith(resolved.choice) && 'picked')}
              disabled={!!resolved}
              onClick={() => choose(o.id)}
            >
              <div className="o-l">{o.label}</div>
              <div className="o-h">{o.hint}</div>
            </button>
          ))}
        </div>
        {resolved ? <div className="c-resolved">✓ {resolved.choice}</div> : null}
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
        {resolved ? (
          <div className="c-resolved">✓ {resolved.choice}</div>
        ) : (
          <div className="c-actions">
            {(pending?.options ?? []).map((o) => (
              <button key={o.id} className={cx('btn', o.primary && 'primary')} onClick={() => choose(o.id)}>{o.label}</button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
}

/** Credentials go straight to the backend's integration env; nothing is kept in local state or shown afterwards. */
function SecretsCard({ card, messageId }: { card: Extract<Card, { type: 'secrets' }>; messageId?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const ready = card.fields.every((f) => (values[f.key] ?? '').trim());
  if (card.done || sent) {
    return (
      <div className="card connect resolved">
        <div className="c-head">
          <div>
            <div className="c-title">{card.title}</div>
            <div className="c-sub">{card.done ? '已填好，接没接上看下一条' : '已发送'}</div>
          </div>
          <span className="cn-mark" aria-hidden>✓</span>
        </div>
      </div>
    );
  }
  return (
    <div className="card connect secrets">
      <div className="c-head">
        <div>
          <div className="c-title">{card.title}</div>
          <div className="c-sub">只有连接本身能读到这些值，bot 和聊天记录都看不到。</div>
        </div>
        <span className="cn-mark" aria-hidden>⌁</span>
      </div>
      {card.help && (card.help.steps?.length || card.help.url) ? (
        <div className="sc-help">
          {card.help.steps?.length ? (
            <ol className="sc-steps">
              {card.help.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : null}
          {card.help.url ? (
            <a className="btn sm" href={card.help.url} target="_blank" rel="noopener noreferrer">{card.help.urlLabel ?? '打开设置页'} ↗</a>
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
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.hint ?? ''}
            />
          </label>
        ))}
      </div>
      <div className="c-actions">
        <button
          className="btn primary"
          disabled={!ready || !messageId}
          onClick={() => {
            if (!messageId) return;
            agent.submitSecrets(messageId, card.integrationId, values);
            setValues({});
            setSent(true);
          }}
        >
          填好了
        </button>
      </div>
    </div>
  );
}

/** Compact action row used by the inbox and the matter panel. */
export function PendingActions({ p, small }: { p: Pending; small?: boolean }) {
  if (p.resolved) return <span className="quiet">✓ {p.resolved.choice}</span>;
  return (
    <>
      {p.options.map((o) => (
        <button key={o.id} className={cx('btn', small && 'sm', o.primary && 'primary')} onClick={() => agent.onPendingChoice(p.id, o.id)}>
          {o.label}{o.primary && p.kind === 'confirm' && p.amount ? ` ¥${p.amount}` : ''}
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
            <div className="c-sub">{form ? '密码存在这台电脑的凭据文件里，和其他账号一样；管家看不到。' : running ? '正在连接…' : '已连上。管家接着在那台机器上干活，进展会显示在下面。'}</div>
          </div>
          <span className="cn-mark" aria-hidden>{card.state === 'done' ? '✓' : '⌂'}</span>
        </div>
        {form && (
          <>
            {card.error && <div className="mc-err">{card.error}</div>}
            <div className="sc-fields">
              <label className="sc-field"><span className="sc-label">公网 IP</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="例如 43.153.1.2（非 22 端口写 IP:端口）" spellCheck={false} autoComplete="off" /></label>
              <div className="mc-two">
                <label className="sc-field"><span className="sc-label">登录用户名</span><input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoComplete="off" /></label>
                <label className="sc-field"><span className="sc-label">密码</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
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
                {card.state === 'error' ? '改一下重试' : '连接'}
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
          <details className="mc-details" open={failed}><summary>{failed ? '输出（出错了）' : `输出 · ${lines.length} 行`}</summary><pre className="wiz-log mc-log">{lines.join('\n')}</pre></details>
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
            {card.state === 'idle' && `${card.target?.bots ?? ''} 个 bot，连同聊天记录、记忆、技能一起搬到「${card.target?.name ?? ''}」。搬完这台电脑关机也没关系。`}
            {running && (!p ? '正在打包…' : p.sent < p.total ? `正在送过去 ${mb(p.sent)} / ${mb(p.total)} MB…` : `已送到（${mb(p.total)} MB），对方正在接收…`)}
            {card.state === 'done' && '搬好了，正在切换到那台机器…'}
            {card.state === 'error' && '没搬成，bot 们还在这台电脑上。'}
          </div>
        </div>
        <span className="cn-mark" aria-hidden>{card.state === 'done' ? '✓' : '☁'}</span>
      </div>
      {card.state === 'error' && card.error && <div className="mc-err">{card.error}</div>}
      {(card.state === 'idle' || card.state === 'error') && (
        <div className="c-actions">
          <button className="btn primary" disabled={!messageId} onClick={() => messageId && agent.machineMove(messageId)}>{card.state === 'error' ? '再试一次' : '搬过去'}</button>
        </div>
      )}
    </div>
  );
}

/** The vigil card: a bot is watching a long task. Shows the goal, what it watches, and the latest check. */
function VigilCard({ card }: { card: Extract<Card, { type: 'vigil' }> }) {
  const running = card.state === 'running';
  return (
    <div className={cx('card connect vigil', !running && 'resolved')}>
      <div className="c-head">
        <div>
          <div className="c-title">{running ? '值守中' : '值守结束'}·{card.goal}</div>
          <div className="c-sub">
            盯着：{card.watching}
            {card.checkLabel ? ` · 每 ${card.everyS}s 看一次「${card.checkLabel}」` : ` · 每 ${card.everyS}s 提醒推进`}
            {card.ticks ? ` · 已看 ${card.ticks} 次` : ''}
            {!running && card.reason ? ` · ${card.reason}` : ''}
          </div>
        </div>
        <span className="cn-mark vigil-dot" aria-hidden>{running ? '◉' : '✓'}</span>
      </div>
      {running && card.last ? (
        <details className="mc-details"><summary>{card.lastOk === false ? '最近一次检查（异常）' : '最近一次检查'}</summary><pre className="wiz-log mc-log">{card.last}</pre></details>
      ) : null}
    </div>
  );
}

/** An external agent at work: what it is doing (tool calls), its running reply, and how it ended. */
function AgentRunCard({ card }: { card: Extract<Card, { type: 'agent_run' }> }) {
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
          <div className="c-title">{card.name}{running ? ' 正在做' : failed ? ' 没做完' : ' 做完了'}</div>
          <div className="mc-cmd">{card.title}</div>
          <div className="c-sub">
            {card.viaHost ? `在你的电脑「${card.viaHost}」上运行` : card.mode === 'acp' ? 'ACP 接入，过程可见' : '一次性调用'}
            {card.asked ? ` · 问过你 ${card.asked} 次` : ''}
            {failed && card.error ? ` · ${card.error}` : ''}
          </div>
        </div>
        <span className="cn-mark" aria-hidden>{running ? '›' : failed ? '✘' : '✓'}</span>
      </div>
      {running ? (
        <pre className="wiz-log live mc-log" ref={logRef}>{[...lines, ...(card.output ? ['', card.output] : [])].join('\n') || '…'}{'\n▍'}</pre>
      ) : lines.length || card.output ? (
        <details className="mc-details" open={failed}><summary>{failed ? '过程（出错了）' : `过程 · ${lines.length} 步`}</summary><pre className="wiz-log mc-log">{[...lines, ...(card.output ? ['', card.output] : [])].join('\n')}</pre></details>
      ) : null}
    </div>
  );
}
