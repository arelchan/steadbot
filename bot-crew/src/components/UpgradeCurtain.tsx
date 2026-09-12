import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { dismissUpgrade } from '../services/upgrade';
import { useT } from '../i18n';
import { cx } from '../utils';
import type { UpgradePhase } from '../types';

/**
 * 升级 takes the machine away: it restarts, and when the image changed it rebuilds for minutes. Anything the user
 * does in the meantime is either lost or sent to a server that is not there, so the App stops being a place you
 * can act — one curtain over everything, and the machine's own output behind it.
 *
 * There is no honest percentage to show (nobody knows how long a docker build will take), so what moves is what
 * is actually known: which of the four slow things is happening, how long it has been, and the last line the
 * machine printed. No cancel: once the container is coming down, stopping here would not put it back.
 */
const STEPS: UpgradePhase[] = ['fetch', 'wait', 'apply', 'back'];

export function UpgradeCurtain() {
  const run = useStore((s) => s.upgrading);
  const t = useT();
  const [secs, setSecs] = useState(0);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    if (!run) return setSecs(0);
    const tick = () => setSecs(Math.round((Date.now() - run.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [run?.startedAt, !!run]);

  useEffect(() => {
    if (!run) return;
    const eat = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    window.addEventListener('keydown', eat, true);
    return () => window.removeEventListener('keydown', eat, true);
  }, [!!run]);

  if (!run) return null;
  const failed = run.phase === 'error';
  const done = run.phase === 'done';
  const at = STEPS.indexOf(run.phase);
  const mins = Math.floor(secs / 60);
  const elapsed = mins ? t('up.elapsedMin', { m: String(mins), s: String(secs % 60).padStart(2, '0') }) : t('up.elapsedSec', { s: String(secs) });

  return createPortal(
    <div className="curtain" role="dialog" aria-modal aria-label={t('up.title')}>
      <div className={cx('cur-card', failed && 'bad')}>
        <div className="cur-head">
          <span className="cur-t">{failed ? t('up.failed') : done ? t('up.ok') : t('up.title')}</span>
          {run.to && !failed && <span className="cur-to">{run.to}</span>}
        </div>

        {failed ? (
          <>
            <div className="cur-err">{run.err}</div>
            <pre className="up-log">{run.lines.slice(-14).join('\n')}</pre>
            <div className="cur-foot">
              <button className="btn" onClick={dismissUpgrade}>{t('up.close')}</button>
            </div>
          </>
        ) : (
          <>
            <ol className="cur-steps">
              {STEPS.map((s, i) => (
                <li key={s} className={cx(done || i < at ? 'was' : i === at && 'now')}>
                  <span className="cs-dot" />
                  <span className="cs-l">{t(`up.step.${s}`)}</span>
                </li>
              ))}
            </ol>
            <div className={cx('cur-bar', done && 'full')}><i /></div>
            <div className="cur-now">
              <span className="cur-line">{run.line || t(`up.doing.${run.phase}`)}</span>
              <span className="cur-secs">{elapsed}</span>
            </div>
            {run.lines.length > 1 && (
              <button className="link cur-more" onClick={() => setDetails((d) => !d)}>{details ? t('common.collapse') : t('up.details')}</button>
            )}
            {details && <pre className="up-log">{run.lines.slice(-14).join('\n')}</pre>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
