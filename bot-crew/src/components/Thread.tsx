import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, select, focusMessage, togglePanel, uid } from '../store';
import { parseThread } from '../types';
import type { Bot, FileRef, Message, ThreadId } from '../types';
import { agent, uploadFile } from '../services/agent';
import { Avatar } from './Avatar';
import { BotName, Sk } from './Skeleton';
import { renderText } from './Markdown';
import { CardView } from './Cards';
import { FileCards, fmtSize, kindOf } from './FileCard';
import { GroupAvatar, membersOf } from './GroupAvatar';
import { TasksFloat } from './RightPanel';
import { cx, dayKey, dayLabel, msgTime } from '../utils';
import { useT } from '../i18n';

/** "soul building…" — the bot is rebuilding part of itself in the background. */
function Evolving({ jobs }: { jobs: NonNullable<Bot['building']> }) {
  return (
    <span className="t evolving">
      <i className="ev-orb" />
      {Array.from(new Set(jobs.map((j) => j.aspect))).map((a) => `${a} building…`).join('  ')}
    </span>
  );
}

/**
 * One button in the conversation's top-right corner: 身份. The workspace (screen, tasks, routines) is simply
 * there; opening 身份 borrows its slot, closing it gives the slot straight back.
 */
function PanelToggles({ bot }: { bot?: Bot }) {
  const t = useT();
  const panels = useStore((s) => s.panels);
  return (
    <span className="hd-tools corner">
      <button className={cx('iconbtn', panels.identity && 'on')} title={bot ? t('thread.identity') : t('thread.matterInfo')} onClick={() => togglePanel('identity')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5.5" r="2.6" /><path d="M2.8 13.5c.9-2.6 2.7-3.8 5.2-3.8s4.3 1.2 5.2 3.8" /></svg>
      </button>
    </span>
  );
}

export function Thread({ threadId }: { threadId: ThreadId }) {
  const t = useT();
  const s = useStore((x) => x);
  const { kind, id } = parseThread(threadId);
  const bot = kind === 'bot' ? s.bots.find((b) => b.id === id) : undefined;
  const matter = kind === 'matter' ? s.matters.find((m) => m.id === id) : undefined;
  const participants = matter ? membersOf(matter, s.bots) : bot ? [bot] : [];
  const messages = useMemo(() => s.messages.filter((m) => m.threadId === threadId), [s.messages, threadId]);
  const typing = s.typing[threadId] ?? [];
  const scroller = useRef<HTMLDivElement>(null);

  const focusId = s.focusMessageId;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (focusId) {
      const target = el.querySelector(`[data-mid="${focusId}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        const timer = setTimeout(() => focusMessage(undefined), 1800);
        return () => clearTimeout(timer);
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [messages.length, typing.length, threadId, focusId]);

  if (!bot && !matter) return <div className="col thread"><div className="empty">{t('thread.gone')}</div></div>;

  return (
    <section className="col thread with-side">
      <div className="thread-main">
      <header className="hd">
        {bot ? <Avatar bot={bot} /> : <GroupAvatar bots={participants} />}
        <div className="who">
          {bot ? <BotName bot={bot} /> : <span className="n">{`${matter!.title}${matter!.date ? ` · ${matter!.date}` : ''}`}</span>}
          {bot?.building?.length ? <Evolving jobs={bot.building} /> : null}
        </div>
      </header>

      <div className="msgs" ref={scroller}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
          return (
            <div key={m.id} data-mid={m.id} className={cx(focusId === m.id && 'flash')}>
              {showDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
              <MessageRow m={m} bots={s.bots} showName={kind === 'matter'} />
            </div>
          );
        })}
        {typing.map((bid) => {
          const b = s.bots.find((x) => x.id === bid);
          return (
            <div className="msg bot" key={'typing-' + bid}>
              <Avatar bot={b} size="sm" />
              <div className="body"><div className="bubble typing"><i /><i /><i /></div></div>
            </div>
          );
        })}
      </div>

      <Composer threadId={threadId} bot={bot} />
      </div>
      <PanelToggles bot={bot} />
      <TasksFloat bot={bot} matter={matter} />
    </section>
  );
}

/** Files whose path text is not in the bubble (so they weren't rendered in place) still get a card below. */
const leftoverFiles = (m: Message) => (m.files ?? []).filter((f) => !f.mention || !m.text.includes(f.mention));

function MessageRow({ m, bots, showName }: { m: Message; bots: Bot[]; showName: boolean }) {
  const t = useT();
  const bot = bots.find((b) => b.id === m.botId);
  if (m.author === 'system') {
    // Centered notice, not a bubble. `born` = a bot was just generated from the user's first sentence.
    if (m.status === 'born' && bot) {
      const gen = !!bot.generating?.identity;
      return (
        <div className="msg sys">
          <div className={cx('notice born', gen && 'gen')}>
            <Avatar bot={bot} size="sm" />
            <div className="nb">
              {gen ? (
                <>
                  <Sk w={64} h={12} className="sk-name" /> <span className="quiet">{t('thread.born')}</span>
                </>
              ) : (
                <>
                  <b className="fade-in">{bot.name}</b>
                  <div className="nb-role fade-in">{m.text}</div>
                </>
              )}
            </div>
            <span className="t">{msgTime(m.ts)}</span>
          </div>
        </div>
      );
    }
    if (m.status === 'evolved' && bot) {
      const i = m.text.indexOf('：');
      const label = i > 0 ? m.text.slice(0, i) : '';
      const summary = i > 0 ? m.text.slice(i + 1) : m.text;
      return (
        <div className="msg sys">
          <div className="notice evolved fade-in">
            <span className="ev-ic">✦</span>
            <div className="nb">
              <b>{bot.name}</b> <span className="quiet">{t('thread.evolved')}{label ? ` · ${label}` : ''}</span>
              <div className="nb-role">{summary}</div>
            </div>
            <span className="t">{msgTime(m.ts)}</span>
          </div>
        </div>
      );
    }
    return (
      <div className="msg sys">
        <div className="notice">
          <span>{renderText(m.text, bots)}</span>
          <span className="t">{msgTime(m.ts)}</span>
        </div>
      </div>
    );
  }
  if (m.author === 'user') {
    return (
      <div className="msg user">
        <div className="body">
          <div className="bubble">{renderText(m.text, bots, m.files)}</div>
          {leftoverFiles(m).length ? <FileCards files={leftoverFiles(m)} /> : null}
          <div className="foot">
            {m.receipt && <span className={cx('receipt', m.receipt.kind)}>{m.receipt.text}</span>}
            <span>{msgTime(m.ts)}{m.via && m.via !== 'app' ? t('thread.via', { ch: t(`channel.${m.via}`) }) : ''}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="msg bot">
      <Avatar bot={bot} size="sm" />
      <div className="body">
        {showName && <div className="by">{bot?.name}</div>}
        <div className="bubble">{renderText(m.text, bots, m.files)}</div>
        {leftoverFiles(m).length ? <FileCards files={leftoverFiles(m)} /> : null}
        {m.card && <CardView card={m.card} messageId={m.id} />}
        <div className="foot">
          <span>{msgTime(m.ts)}{m.status ? ` · ${m.status}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

export function Composer({ threadId, bot, onSend, placeholder }: { threadId: string; bot?: Bot; onSend?: (text: string) => void; placeholder?: string }) {
  const t = useT();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canAttach = !onSend;

  useEffect(() => {
    setText('');
    setFiles([]);
    setErr('');
    ref.current?.focus();
  }, [threadId]);
  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  const addFiles = (list: Iterable<File>) => {
    if (!canAttach) return;
    const next: Attachment[] = [];
    for (const f of list) {
      if (f.size > 50 * 1024 * 1024) {
        setErr(t('thread.tooBig', { name: f.name }));
        continue;
      }
      // Pasted screenshots arrive as "image.png": give them a name that still sorts and reads.
      const name = f.name && f.name !== 'image.png' ? f.name : `${t('thread.screenshot')} ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      next.push({ id: uid(), file: f, name, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
    }
    if (next.length) setFiles((cur) => [...cur, ...next].slice(0, 12));
  };

  const send = async () => {
    const body = text.trim();
    if (sending || (!body && !files.length)) return;
    if (onSend) {
      if (!body) return;
      onSend(body);
      setText('');
      return;
    }
    setSending(true);
    setErr('');
    try {
      const refs = [];
      for (const a of files) refs.push(await uploadFile(threadId as ThreadId, new File([a.file], a.name, { type: a.file.type })));
      agent.onUserMessage(threadId as ThreadId, body, undefined, refs);
      select(threadId as ThreadId);
      setText('');
      setFiles([]);
    } catch (e) {
      setErr((e as Error).message || t('thread.uploadFail'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={cx('composer', drag && 'drag')}
      onDragOver={(e) => { if (canAttach && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { if (!canAttach) return; e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
    >
      <div className="box">
        {files.length > 0 && (
          <div className="attach-row">
            {files.map((a) => (
              <div key={a.id} className={cx('attach', a.preview && 'img')} title={a.name}>
                {a.preview ? <img src={a.preview} alt="" /> : <span className="at-ic">{kindOf({ name: a.name, mime: a.file.type } as FileRef).icon}</span>}
                <span className="at-name">{a.name}</span>
                <span className="at-size">{fmtSize(a.file.size)}</span>
                <button className="at-x" title={t('thread.removeAttach')} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== a.id))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="box-row">
          {canAttach && (
            <>
              <button className="attach-btn" title={t('thread.attach')} onClick={() => fileRef.current?.click()}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.6-4.6a3.2 3.2 0 0 0-4.5-4.5L3.9 8.1a4.4 4.4 0 0 0 6.2 6.2l3.4-3.4" /></svg>
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = ''; }} />
            </>
          )}
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={placeholder ?? (bot ? t('thread.composer') : t('thread.composerMatter'))}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData.files);
              if (fs.length && canAttach) {
                e.preventDefault();
                addFiles(fs);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className={cx('send', sending && 'busy')} onClick={() => void send()} title={t('thread.send')} disabled={sending}>{sending ? '…' : '↵'}</button>
        </div>
        {err && <div className="attach-err">{err}</div>}
        {drag && <div className="drop-hint">{t('thread.dropHint')}</div>}
      </div>
    </div>
  );
}

interface Attachment {
  id: string;
  file: File;
  name: string;
  preview?: string;
}
