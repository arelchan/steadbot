import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RFB from '@novnc/novnc';
import { useStore, select } from '../store';
import { agent } from '../services/agent';
import { httpBase, withToken } from '../services/runtime';
import { cx } from '../utils';
import { useT } from '../i18n';

/**
 * The bots' computer — one, shared by all of them, so every workspace shows this same screen. It is always
 * *there*: the card shows what is on the screen — live while a bot is using it, the last frame dimmed while it
 * sleeps. There is no power to manage: 「打开」 wakes it if it is asleep (about ten seconds), and it dozes off on
 * its own when nobody has touched it for a while. With no computer available (the bots run on the user's own
 * machine) the same frame stays dark, with the one action that would give them one.
 */
type ScreenState = 'on' | 'starting' | 'off' | 'error' | 'none';

export function ScreenCard() {
  const t = useT();
  const rt = useStore((s) => s.runtime);
  const d = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const [big, setBig] = useState(false);
  const st: ScreenState = rt?.desktops ? (d?.state ?? 'off') : 'none';
  const old = !!rt && rt.mode === 'active' && rt.desktops === undefined;
  const idle = !!rt && rt.mode !== 'active';
  const using = (st === 'on' ? (d?.users ?? []) : []).map((id) => bots.find((b) => b.id === id)?.name).filter((n): n is string => !!n);
  // On a screen the App cannot stream (the bots run on this very computer), the window is on the user's desktop:
  // the one action is to bring it up.
  const streamed = rt?.desktopsLive !== false;
  const open = () => {
    if (!streamed) return agent.computerFocus();
    if (st === 'error') agent.computerPower(true);
    setBig(true);
  };
  return (
    <>
      <div className="screen-card">
        <div className={cx('sc-frame', st)}>
          {st !== 'none' ? (
            <>
              <Still live={st === 'on'} epoch={d?.since ?? 0} />
              <button className="sc-open" onClick={open}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2.5H13.5V6.5M13.5 2.5L9 7M6.5 13.5H2.5V9.5M2.5 13.5L7 9" />
                </svg>
                {streamed ? t('screen.open') : t('screen.toWindow')}
              </button>
            </>
          ) : (
            <div className="sc-off">
              <span className="sc-msg">{idle ? t('screen.notHere') : old ? t('screen.oldVersion') : t('screen.noComputer')}</span>
              {!old && !idle && rt?.local && <button className="btn sm" onClick={() => select('runtime')}>{t('screen.install')}</button>}
            </div>
          )}
        </div>
        <div className="sc-cap">
          <span className={cx('sc-dot', st)} />
          {t('screen.computer')}
          {st === 'on' && using.length > 0 && <span className="sc-state"> · {t('screen.usedBy', { names: using.join('、') })}</span>}
          {st === 'off' && <span className="sc-state">{t('screen.idle')}</span>}
          {st === 'starting' && <span className="sc-state">{t('screen.waking')}</span>}
          {st === 'error' && <span className="sc-state err">{t('screen.noResponse')}</span>}
        </div>
        {st === 'error' && <div className="sc-note">{t('screen.retryHint')}</div>}
        {st === 'none' && !old && !idle && !rt?.local && rt?.desktopsNote && <div className="sc-note">{rt.desktopsNote}</div>}
      </div>
      {big && streamed && st !== 'none' && <ScreenModal onClose={() => setBig(false)} />}
    </>
  );
}

/** The still the server keeps: live, refreshed every couple of seconds; asleep, the frame it fell asleep on. */
function stillUrl(tick: number, width = 640) {
  return withToken(`${httpBase || window.location.origin}/screen.jpg?w=${width}&t=${tick}`);
}

/**
 * A JPEG of the screen. An <img>, so a slow link just keeps the last frame. While live it polls; asleep it loads
 * once (the frame does not change), and again when the computer has been up since (`epoch`).
 */
function Still({ live, epoch }: { live: boolean; epoch: number }) {
  const t = useT();
  const [tick, setTick] = useState(() => Date.now());
  const [dead, setDead] = useState(false);
  useEffect(() => {
    setTick(Date.now());
    if (!live) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick(Date.now());
    }, 2500);
    return () => clearInterval(t);
  }, [live, epoch]);
  return (
    <>
      <img className={cx('sc-still', dead && 'hidden')} src={stillUrl(tick)} alt="" draggable={false} onError={() => setDead(true)} onLoad={() => setDead(false)} />
      {dead && live && <span className="sc-msg sc-still-msg">{t('screen.noFrame')}</span>}
    </>
  );
}

/**
 * The live screen, full size. Rendered on <body> (not inside the workspace panel): a modal has to sit above every
 * other layer, and it should not be zoomed with the UI density either — noVNC maps the mouse in real pixels.
 *
 * There is no "take over": the screen is live and the mouse and keyboard on it are simply the user's. The bot
 * drives its browser through a separate channel (CDP), so both can act at once, like two people at one machine.
 * A small tag shows while the user is actively moving or typing, so it is clear whose hands are on it.
 */
function ScreenModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [hands, setHands] = useState(false);
  const d = useStore((s) => s.computer);
  const st = d?.state ?? 'off';
  const on = st === 'on';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the screen only when the keyboard is not on the remote desktop.
      if (e.key === 'Escape' && !document.activeElement?.closest('.vnc')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // The screen being open means someone wants to see it: an asleep computer wakes (also if it dozed off meanwhile).
  useEffect(() => {
    if (st === 'off') agent.computerPower(true);
  }, [st]);
  const placeholder = stillUrl(d?.since ?? 0);
  return createPortal(
    <div className="overlay screen-modal" onClick={onClose}>
      <div className="screen-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span className="sc-title">
            <i className={cx('sc-dot', st)} />
            {t('screen.computer')}
            {on && hands && <span className="chip cn-chip">{t('screen.yourHands')}</span>}
          </span>
          <span className="sc-actions">
            <button className="link quiet-link" onClick={onClose}>{t('common.close')}</button>
          </span>
        </div>
        <div className="sc-big">
          {on ? (
            <Vnc placeholder={placeholder} onHands={setHands} />
          ) : (
            <div className="sc-wait">
              <img className="sc-ghost" src={placeholder} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              {st === 'error' ? (
                <span className="sc-wait-msg">
                  <b>{t('screen.dead')}</b>
                  {d?.note && <small>{d.note}</small>}
                  <button className="btn sm" onClick={() => agent.computerPower(true)}>{t('common.retry')}</button>
                </span>
              ) : (
                <span className="sc-wait-msg pulse">{t('screen.waking2')}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One noVNC connection to the computer's display. The desktop takes the size of this box (SetDesktopSize → Xvnc's
 * RandR), so pixels map 1:1 and text is crisp instead of a fixed frame stretched to fit. The last still sits
 * underneath until the first real frame has been painted, so opening the screen never shows a black box. Tuned
 * for a long link: moderate compression (the machine has two CPUs; heavy zlib costs more than it saves).
 */
function Vnc({ placeholder, onHands }: { placeholder: string; onHands: (v: boolean) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'lost'>('connecting');
  const [painted, setPainted] = useState(false);
  // A dropped link (the machine restarted, the network blinked) reconnects by itself while the screen is open.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setPainted(false);
    setStatus('connecting');
    let retry: ReturnType<typeof setTimeout> | undefined;
    const url = withToken(`${(httpBase || window.location.origin).replace(/^http/, 'ws')}/vnc`);
    const r = new RFB(el, url, { shared: true });
    r.viewOnly = false;
    r.resizeSession = true;
    r.scaleViewport = true;
    r.background = 'transparent';
    r.qualityLevel = 5;
    r.compressionLevel = 2;
    let poll: ReturnType<typeof setInterval> | undefined;
    // Events from an instance that has been torn down (StrictMode re-runs effects) must not touch state.
    r.addEventListener('connect', () => {
      if (rfb.current !== r) return;
      setStatus('connected');
      // noVNC has no "first frame" event; watch the canvas for the first non-dark pixels instead.
      const canvas = el.querySelector('canvas');
      let tries = 0;
      poll = setInterval(() => {
        tries++;
        if (canvas && lit(canvas)) {
          setPainted(true);
          clearInterval(poll);
        } else if (tries > 80) clearInterval(poll);
      }, 100);
    });
    r.addEventListener('disconnect', () => {
      if (rfb.current !== r) return;
      setStatus('lost');
      retry = setTimeout(() => setAttempt((a) => a + 1), 2500);
    });
    rfb.current = r;
    return () => {
      rfb.current = null;
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
      try {
        r.disconnect();
      } catch {
        /* already gone */
      }
    };
  }, [attempt]);
  // "你在操作" while the user's hands are on it: any pointer or key activity, fading out shortly after.
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = () => {
    onHands(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => onHands(false), 2500);
  };
  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    [],
  );
  return (
    <div className={cx('vnc', status, painted && 'painted')} onPointerDown={touch} onPointerMove={touch} onKeyDown={touch} onWheel={touch}>
      <img className="sc-ghost" src={placeholder} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <div className="vnc-screen" ref={box} />
      {!painted && status !== 'lost' && <span className="sc-wait-msg pulse">{t('screen.connecting')}</span>}
      {status === 'lost' && <span className="sc-wait-msg pulse">{t('screen.reconnecting')}</span>}
    </div>
  );
}

/** True once a canvas has a spread of non-dark pixels (a real desktop frame rather than the initial black). */
function lit(canvas: HTMLCanvasElement) {
  if (!canvas.width || !canvas.height) return false;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const y = Math.floor(canvas.height / 2);
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    let n = 0;
    for (let x = 0; x < row.length; x += 4 * 16) if (row[x] + row[x + 1] + row[x + 2] > 90) n++;
    return n > 8;
  } catch {
    return true;
  }
}
