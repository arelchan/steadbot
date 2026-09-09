import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { useStore, select } from '../store';
import type { Bot } from '../types';
import { agent } from '../services/agent';
import { httpBase, withToken } from '../services/runtime';
import { cx } from '../utils';

/**
 * The bot's own computer, live. A VNC view (noVNC) of the desktop it works on, on the machine the bots run on.
 * Watch by default; 「接管」 hands the mouse and keyboard to the user (to log into a site for the bot, say).
 * With no computer yet — the bots run on the user's own machine — the same frame stays, dark, carrying the one
 * action that would give the bot one: fit it out on a cloud machine.
 */
export function ScreenCard({ bot }: { bot: Bot }) {
  const rt = useStore((s) => s.runtime);
  const [big, setBig] = useState(false);
  const d = bot.desktop;
  // 'none' = this machine hosts no computers (the user's own machine, or a server too old to know about them).
  const st = rt?.desktops ? (d?.state ?? 'off') : 'none';
  // 'old' only when a runtime that does run bots says nothing about computers; a signpost simply isn't running any.
  const old = !!rt && rt.mode === 'active' && rt.desktops === undefined;
  const idle = !!rt && rt.mode !== 'active';
  return (
    <>
      <div className="screen-card">
        <div className="sc-head">
          <span className="sc-title">
            <i className={cx('sc-dot', st)} />
            {bot.name} 的电脑
          </span>
          <span className="sc-actions">
            {st === 'on' && <button className="link quiet-link" onClick={() => setBig(true)}>放大</button>}
            {st === 'on' && <button className="link quiet-link" onClick={() => agent.computerPower(bot.id, false)}>关机</button>}
          </span>
        </div>
        <div className="sc-box">
          {st === 'on' ? (
            <Vnc botId={bot.id} viewOnly />
          ) : (
            <div className="sc-off">
              {st === 'starting' && <span className="sc-msg pulse">开机中…</span>}
              {st === 'error' && <span className="sc-msg err">{d?.note ?? '没开起来'}</span>}
              {st === 'off' && <span className="sc-msg">{d?.note ? d.note : d ? '关着' : '还没开过机'}</span>}
              {st === 'none' && <span className="sc-msg">{idle ? 'bot 不在这台机器' : old ? '这个版本还没有' : '还没有电脑'}</span>}
              {(st === 'off' || st === 'error') && (
                <button className="btn sm" onClick={() => agent.computerPower(bot.id, true)}>{st === 'error' ? '再试一次' : '开机'}</button>
              )}
              {st === 'none' && !old && !idle && rt?.local && <button className="btn sm" onClick={() => select('runtime')}>装配云电脑</button>}
            </div>
          )}
        </div>
        <div className="sc-note">{note(st, old, idle, rt?.local, rt?.desktopsNote)}</div>
      </div>
      {big && st === 'on' && <ScreenModal bot={bot} onClose={() => setBig(false)} />}
    </>
  );
}

function note(st: string, old: boolean, idle: boolean, local?: boolean, serverNote?: string) {
  if (st === 'on') return '它在这台电脑上上网、登录、填表；你能实时看到。点「放大」可以接管。';
  if (st !== 'none') return '一台它自己的 Linux 电脑，带浏览器，登录过的网站会记住。它需要时会自己开。';
  if (idle) return 'bot 不在这台机器上跑，这里看不到它的电脑。';
  if (old) return `${local ? '这台电脑' : '云机器'}上的 EverBot 还是旧版本，没有 bot 的电脑这个功能；重装后就有。`;
  if (local) return '你的电脑只有一块屏幕，是你的。把 bot 搬到一台云机器上，它就有自己的电脑：带浏览器，能登录网站、填表、下载，你随时看得见它在干什么。';
  return serverNote ?? '这台机器给不了它电脑。';
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
            <button className="link quiet-link" onClick={onClose}>关闭</button>
          </span>
        </div>
        <div className="sc-big">
          <Vnc botId={bot.id} viewOnly={!control} />
        </div>
        <div className="sc-note">{control ? '鼠标键盘现在归你，比如替它登录一个网站；登好点「交回给它」。' : '只看不动。要替它操作（比如登录），点「接管」。'}</div>
      </div>
    </div>
  );
}

/** One noVNC connection to the bot's display, scaled into its box. */
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
    r.qualityLevel = 6;
    r.compressionLevel = 2;
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
  }, [viewOnly]);
  return (
    <div className={cx('vnc', status)} ref={box}>
      {status !== 'connected' && <span className="sc-msg">{status === 'connecting' ? '连接屏幕…' : '屏幕断开了'}</span>}
    </div>
  );
}
