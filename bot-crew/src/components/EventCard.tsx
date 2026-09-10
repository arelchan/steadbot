import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { select } from '../store';
import { agent } from '../services/agent';
import { botThread, type Bot, type Routine } from '../types';
import { Avatar } from './Avatar';
import { BotConfigModal, sayWhen } from './BotConfigModal';
import { cx, dayLabel, fmtTime } from '../utils';
import { useT } from '../i18n';

/**
 * 日程上点开一件事，先看到的是这张卡——不是直接跳走。
 *
 * 一张卡三段，来源不同只换中间那一段：
 *   1. **是什么**：标题、这一次的时刻、它从哪来（例行 / 事项 / 某本日历）
 *   2. **归谁**：哪个 bot，以及它在这件事上做什么
 *   3. **能做什么**：一两个动作，外加一条回到真源的路——例行是那张表单，事项是对话，
 *      外部事件是它自己的日历
 *
 * 三条规矩：
 * - **状态是主角。** 没跑、卡住、到不了场都用警告色，并且必须带一个能救它的动作；顺利的那些
 *   不着色，不抢注意力。
 * - **只读的字段不给可编辑的样子。** 外部日历来的时间、参与人是纯文本，只有我们自己加上去的
 *   那半（谁到场、到场做什么）才是控件。
 * - **用不上的字段不留位置。** 例行不谈参与人，会议不谈「结果发到哪」。
 */
export type Ev = {
  kind: 'routine';
  bot: Bot;
  r: Routine;
  /** 落在格子上的那一次。常驻型（每 30 分钟）和后台不认的写法没有具体时刻 */
  at?: number;
  /** unknown = 后台不认这个写法，它从来没被触发过 */
  state?: 'todo' | 'done' | 'missed' | 'unknown';
};

export function EventCard({ ev, onClose }: { ev: Ev; onClose: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { bot, r } = ev;
  // 真源就是那张例行任务的表单：卡片本身不是编辑器。
  if (editing) return <BotConfigModal bot={bot} tab="routines" routineId={r.id} onClose={onClose} />;

  const title = r.title.trim() || t('cfg.rtUntitled');
  const lands = (r.channels ?? []).map((ch) => t(`channel.${ch}`)).join(t('common.listSep'));
  const ranAt = r.lastRun ?? ev.at;
  const state =
    ev.state === 'missed' ? t('ev.missed')
    : ev.state === 'unknown' ? t('ev.unknown')
    : ev.state === 'done' && ranAt !== undefined ? t('ev.ran', { time: fmtTime(ranAt) })
    : ev.state === 'todo' ? t('ev.todo')
    : undefined;
  // 救它的那个动作放在主位：没跑的补跑一次，写法不认的去改写法。
  const rescue = ev.state === 'missed' ? 'run' : ev.state === 'unknown' ? 'edit' : undefined;

  const runNow = () => {
    agent.runRoutine(bot.id, r.id);
    select(botThread(bot.id));
    onClose();
  };

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal ev" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={title}>
        <button className="cfg-close" onClick={onClose} title={t('common.closeEsc')}>×</button>
        <h2>{title}</h2>
        <div className="ev-when">
          {ev.at !== undefined && <span>{dayLabel(ev.at)} {fmtTime(ev.at)}</span>}
          <span className="chip">{t('ev.routine')}</span>
        </div>

        {state && <div className={cx('ev-state', ev.state)}>{state}</div>}

        <button className="ev-who" onClick={() => { select(botThread(bot.id)); onClose(); }}>
          <Avatar bot={bot} size="sm" />
          <span className="ev-who-n">{bot.name}</span>
          <span className="chev">›</span>
        </button>

        <dl className="ev-kv">
          <dt>{t('ev.when')}</dt>
          <dd>{sayWhen(r.schedule)}</dd>
          {lands ? <><dt>{t('ev.lands')}</dt><dd>{lands}</dd></> : null}
        </dl>

        <div className="actions">
          <button className={cx('btn', rescue === 'run' && 'primary')} onClick={runNow}>{t('ev.runNow')}</button>
          <button className={cx('btn', rescue === 'edit' && 'primary')} onClick={() => setEditing(true)}>{t('ev.edit')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
