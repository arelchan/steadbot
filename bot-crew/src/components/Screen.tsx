import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RFB from '@novnc/novnc';
import { useStore, select } from '../store';
import type { Bot } from '../types';
import { agent } from '../services/agent';
import { httpBase, withToken } from '../services/runtime';
import { cx } from '../utils';

/**
 * The bot's own computer. It is always *there*: the card shows what is on the screen — live while the bot is
 * using it, the last frame dimmed while it sleeps. There is no power to manage: 「打开」 wakes it if it is asleep
 * (about ten seconds), and it dozes off on its own when nobody has touched it for a while. With no computer
 * available (the bots run on the user's own machine) the same frame stays dark, with the one action that would
 * give the bot one.
 */
type ScreenState = 'on' | 'starting' | 'off' | 'error' | 'none';

export function ScreenCard({ bot }: { bot: Bot }) {
  const rt = useStore((s) => s.runtime);
  const [big, setBig] = useState(false);
  const d = bot.desktop;
  const st: ScreenState = rt?.desktops ? (d?.state ?? 'off') : 'none';
  const old = !!rt && rt.mode === 'active' && rt.desktops === undefined;
  const idle = !!rt && rt.mode !== 'active';
  const open = () => {
    if (st === 'error') agent.computerPower(bot.id, true);
    setBig(true);
  };
  return (
    <>
      <div className="screen-card">
        <div className={cx('sc-frame', st)}>
          {st !== 'none' ? (
            <>
              <Still botId={bot.id} live={st === 'on'} epoch={d?.since ?? 0} />
              <button className="sc-open" onClick={open}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2.5H13.5V6.5M13.5 2.5L9 7M6.5 13.5H2.5V9.5M2.5 13.5L7 9" />
                </svg>
                打开
              </button>
            </>
          ) : (
            <div className="sc-off">
              <span className="sc-msg">{idle ? 'bot 不在这台机器' : old ? '这个版本还没有' : '还没有电脑'}</span>
              {!old && !idle && rt?.local && <button className="btn sm" onClick={() => select('runtime')}>装配云电脑</button>}
            </div>
          )}
        </div>
        <div className="sc-cap">
          <span className={cx('sc-dot', st)} />
          {bot.name} 的屏幕
          {st === 'off' && <span className="sc-state">· 闲着</span>}
          {st === 'starting' && <span className="sc-state">· 正在醒来</span>}
          {st === 'error' && <span className="sc-state err">· 没响应</span>}
        </div>
        {(st === 'none' || st === 'error') && <div className="sc-note">{note(st, old, idle, rt?.local, rt?.desktopsNote)}</div>}
      </div>
      {big && st !== 'none' && <ScreenModal bot={bot} onClose={() => setBig(false)} />}
    </>
  );
}

function note(st: ScreenState, old: boolean, idle: boolean, local?: boolean, serverNote?: string) {
  if (st === 'error') return '电脑没响应。点「打开」它会再试一次。';
  if (idle) return 'bot 不在这台机器上跑，这里看不到它的电脑。';
  if (old) return `${local ? '这台电脑' : '云机器'}上的 EverBot 还是旧版本，没有 bot 的电脑这个功能；重装后就有。`;
  if (local) return '你的电脑只有一块屏幕，是你的。把 bot 搬到一台云机器上，它就有自己的电脑：带浏览器，能登录网站、填表、下载，你随时看得见它在干什么。';
  return serverNote ?? '这台机器给不了它电脑。';
}

/** The still the server keeps: live, refreshed every couple of seconds; asleep, the frame it fell asleep on. */
function stillUrl(botId: string, tick: number, width = 640) {
  return withToken(`${httpBase || window.location.origin}/screen/${botId}.jpg?w=${width}&t=${tick}`);
}

/**
 * A JPEG of the screen. An <img>, so a slow link just keeps the last frame. While live it polls; asleep it loads
 * once (the frame does not change), and again when the computer has been up since (`epoch`).
 */
function Still({ botId, live, epoch }: { botId: string; live: boolean; epoch: number }) {
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
      <img className={cx('sc-still', dead && 'hidden')} src={stillUrl(botId, tick)} alt="" draggable={false} onError={() => setDead(true)} onLoad={() => setDead(false)} />
      {dead && live && <span className="sc-msg sc-still-msg">拿不到画面，重试中…</span>}
    </>
  );
}

/**
 * The live screen, full size. Rendered on <body> (not inside the workspace panel): a modal has to sit above every
 * other layer, and it should not be zoomed with the UI density either — noVNC maps the mouse in real pixels.
 */
function ScreenModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [control, setControl] = useState(false);
  const st = bot.desktop?.state ?? 'off';
  const on = st === 'on';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !control) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, onClose]);
  useEffect(() => {
    if (!on) setControl(false);
  }, [on]);
  // The screen being open means someone wants to see it: an asleep computer wakes (also if it dozed off meanwhile).
  useEffect(() => {
    if (st === 'off') agent.computerPower(bot.id, true);
  }, [st, bot.id]);
  const placeholder = stillUrl(bot.id, bot.desktop?.since ?? 0);
  return createPortal(
    <div className="overlay screen-modal" onClick={onClose}>
      <div className="screen-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span className="sc-title">
            <i className={cx('sc-dot', st)} />
            {bot.name} 的电脑
            {control && <span className="chip cn-chip">你在操作</span>}
          </span>
          <span className="sc-actions">
            {on && <button className={cx('btn sm', control && 'primary')} onClick={() => setControl((v) => !v)}>{control ? '交回给它' : '接管'}</button>}
            <button className="link quiet-link" onClick={onClose}>关闭</button>
          </span>
        </div>
        <div className="sc-big">
          {on ? (
            <Vnc botId={bot.id} viewOnly={!control} placeholder={placeholder} />
          ) : (
            <div className="sc-wait">
              <img className="sc-ghost" src={placeholder} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              {st === 'error' ? (
                <span className="sc-wait-msg">
                  <b>电脑没响应</b>
                  {bot.desktop?.note && <small>{bot.desktop.note}</small>}
                  <button className="btn sm" onClick={() => agent.computerPower(bot.id, true)}>再试一次</button>
                </span>
              ) : (
                <span className="sc-wait-msg pulse">正在唤醒它的电脑，十秒左右…</span>
              )}
            </div>
          )}
        </div>
        <div className="sc-note">
          {!on
            ? '它的电脑闲着时会休眠，省下云机器的内存；打开就醒，登录过的网站都还在。'
            : control
              ? '鼠标键盘现在归你：底部一排是浏览器、它的文件和终端。比如替它登录一个网站，登好点「交回给它」。'
              : '只看不动。要替它操作（比如登录），点「接管」。这是实时画面，网络远会有一点延迟。'}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One noVNC connection to the bot's display, scaled into its box. The last still sits underneath until the first
 * real frame has been painted, so opening the screen never shows a black box. Tuned for a long link: smaller
 * frames, moderate compression (the machine has two CPUs; heavy zlib costs more than it saves).
 */
function Vnc({ botId, viewOnly, placeholder }: { botId: string; viewOnly: boolean; placeholder: string }) {
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'lost'>('connecting');
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const url = withToken(`${(httpBase || window.location.origin).replace(/^http/, 'ws')}/vnc/${botId}`);
    const r = new RFB(el, url, { shared: true });
    r.viewOnly = viewOnly;
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
      if (rfb.current === r) setStatus('lost');
    });
    rfb.current = r;
    return () => {
      rfb.current = null;
      if (poll) clearInterval(poll);
      try {
        r.disconnect();
      } catch {
        /* already gone */
      }
    };
  }, [botId]);
  useEffect(() => {
    if (rfb.current) rfb.current.viewOnly = viewOnly;
    if (!viewOnly) rfb.current?.focus();
  }, [viewOnly]);
  return (
    <div className={cx('vnc', status, painted && 'painted')}>
      <img className="sc-ghost" src={placeholder} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <div className="vnc-screen" ref={box} />
      {!painted && status !== 'lost' && <span className="sc-wait-msg pulse">连接屏幕…</span>}
      {status === 'lost' && <span className="sc-wait-msg">屏幕断开了</span>}
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
