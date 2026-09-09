import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { useStore, select } from '../store';
import type { Bot } from '../types';
import { agent } from '../services/agent';
import { httpBase, withToken } from '../services/runtime';
import { cx } from '../utils';

/**
 * The bot's own computer. The card is a still that refreshes every couple of seconds — cheap, and enough to see
 * what it is up to; 「打开」 brings up the live screen (noVNC), where the user can watch or take over. With no
 * computer available (the bots run on the user's own machine) the same frame stays, dark, with the one action that
 * would give the bot one.
 */
export function ScreenCard({ bot }: { bot: Bot }) {
  const rt = useStore((s) => s.runtime);
  const [big, setBig] = useState(false);
  const d = bot.desktop;
  const st = rt?.desktops ? (d?.state ?? 'off') : 'none';
  const old = !!rt && rt.mode === 'active' && rt.desktops === undefined;
  const idle = !!rt && rt.mode !== 'active';
  return (
    <>
      <div className="screen-card">
        <div className={cx('sc-frame', st)}>
          {st === 'on' ? (
            <>
              <Still botId={bot.id} />
              <button className="sc-open" onClick={() => setBig(true)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2.5H13.5V6.5M13.5 2.5L9 7M6.5 13.5H2.5V9.5M2.5 13.5L7 9" />
                </svg>
                打开
              </button>
            </>
          ) : (
            <div className="sc-off">
              {st === 'starting' && <span className="sc-msg pulse">开机中…</span>}
              {st === 'error' && (
                <>
                  <span className="sc-msg err">{d?.note ?? '没开起来'}</span>
                  <button className="btn sm" onClick={() => agent.computerPower(bot.id, true)}>再试一次</button>
                </>
              )}
              {st === 'off' && (
                <>
                  <span className="sc-msg">{d?.note ? d.note : '关着 · 它要上网时会自己开'}</span>
                  <button className="link sc-link" onClick={() => agent.computerPower(bot.id, true)}>我想自己开一下</button>
                </>
              )}
              {st === 'none' && <span className="sc-msg">{idle ? 'bot 不在这台机器' : old ? '这个版本还没有' : '还没有电脑'}</span>}
              {st === 'none' && !old && !idle && rt?.local && <button className="btn sm" onClick={() => select('runtime')}>装配云电脑</button>}
            </div>
          )}
        </div>
        <div className="sc-cap">
          <span className={cx('sc-dot', st)} />
          {bot.name} 的屏幕
        </div>
        {st !== 'on' && <div className="sc-note">{note(st, old, idle, rt?.local, rt?.desktopsNote)}</div>}
      </div>
      {big && st === 'on' && <ScreenModal bot={bot} onClose={() => setBig(false)} />}
    </>
  );
}

function note(st: string, old: boolean, idle: boolean, local?: boolean, serverNote?: string) {
  if (st === 'starting') return '正在开机，几秒钟。';
  if (st !== 'none') return '一台它自己的 Linux 电脑，带浏览器、文件和终端。它要上网时会自己开机，用完两小时没人碰就自己关；登录过的网站下次还在。';
  if (idle) return 'bot 不在这台机器上跑，这里看不到它的电脑。';
  if (old) return `${local ? '这台电脑' : '云机器'}上的 EverBot 还是旧版本，没有 bot 的电脑这个功能；重装后就有。`;
  if (local) return '你的电脑只有一块屏幕，是你的。把 bot 搬到一台云机器上，它就有自己的电脑：带浏览器，能登录网站、填表、下载，你随时看得见它在干什么。';
  return serverNote ?? '这台机器给不了它电脑。';
}

/** A JPEG of the screen, refreshed while the card is visible. An <img>, so a slow link just keeps the last frame. */
function Still({ botId }: { botId: string }) {
  const [tick, setTick] = useState(() => Date.now());
  const [dead, setDead] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick(Date.now());
    }, 2500);
    return () => clearInterval(t);
  }, []);
  const src = withToken(`${httpBase || window.location.origin}/screen/${botId}.jpg?w=640&t=${tick}`);
  return (
    <>
      <img className="sc-still" src={src} alt="" draggable={false} onError={() => setDead(true)} onLoad={() => setDead(false)} />
      {dead && <span className="sc-msg sc-still-msg">拿不到画面，重试中…</span>}
    </>
  );
}

function ScreenModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [control, setControl] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !control) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, onClose]);
  return (
    <div className="overlay screen-modal" onClick={onClose}>
      <div className="screen-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span className="sc-title">
            <i className="sc-dot on" />
            {bot.name} 的电脑
            {control && <span className="chip cn-chip">你在操作</span>}
          </span>
          <span className="sc-actions">
            <button className={cx('btn sm', control && 'primary')} onClick={() => setControl((v) => !v)}>{control ? '交回给它' : '接管'}</button>
            <button className="link quiet-link" onClick={() => { agent.computerPower(bot.id, false); onClose(); }}>关机</button>
            <button className="link quiet-link" onClick={onClose}>关闭</button>
          </span>
        </div>
        <div className="sc-big">
          <Vnc botId={bot.id} viewOnly={!control} />
        </div>
        <div className="sc-note">
          {control
            ? '鼠标键盘现在归你：底部一排是浏览器、它的文件和终端。比如替它登录一个网站，登好点「交回给它」。'
            : '只看不动。要替它操作（比如登录），点「接管」。这是实时画面，网络远会有一点延迟。'}
        </div>
      </div>
    </div>
  );
}

/** One noVNC connection to the bot's display, scaled into its box. Tuned for a long link: smaller frames, more compression. */
function Vnc({ botId, viewOnly }: { botId: string; viewOnly: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'lost'>('connecting');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const url = withToken(`${(httpBase || window.location.origin).replace(/^http/, 'ws')}/vnc/${botId}`);
    const r = new RFB(el, url, { shared: true });
    r.viewOnly = viewOnly;
    r.scaleViewport = true;
    r.background = '#0f1013';
    r.qualityLevel = 4;
    r.compressionLevel = 6;
    r.addEventListener('connect', () => setStatus('connected'));
    r.addEventListener('disconnect', () => setStatus('lost'));
    rfb.current = r;
    return () => {
      rfb.current = null;
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
    <div className={cx('vnc', status)} ref={box}>
      {status !== 'connected' && <span className="sc-msg">{status === 'connecting' ? '连接屏幕…' : '屏幕断开了'}</span>}
    </div>
  );
}
