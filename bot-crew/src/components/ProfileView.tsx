import { useState } from 'react';
import { useStore, setSharedProfile, patchBot, select } from '../store';
import { botThread } from '../types';
import { Avatar } from './Avatar';

export function ProfileView() {
  const s = useStore((x) => x);
  const [draft, setDraft] = useState('');
  return (
    <section className="col thread">
      <header className="hd">
        <Avatar you />
        <div className="who">
          <span className="n">它们眼中的你</span>
          <span className="t">共享的一层所有 bot 都看得到，每个 bot 自己的那层只影响它</span>
        </div>
      </header>
      <div className="inbox" style={{ maxWidth: 720 }}>
        <div className="inbox-group">
          <h4>所有 bot 共享</h4>
          <ul className="mem">
            {s.sharedProfile.map((v, i) => (
              <li key={i}>
                <span>{v}</span>
                <button className="del" onClick={() => setSharedProfile(s.sharedProfile.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ul>
          <input
            className="mem-add"
            placeholder="加一条所有 bot 都该知道的事…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                setSharedProfile([...s.sharedProfile, draft.trim()]);
                setDraft('');
              }
            }}
          />
          <p className="explain" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
            两个 bot 对你的认识冲突时（比如行程助理知道你喜欢一等座，账单管家知道公司只报二等），以这里为准。
          </p>
        </div>

        {s.bots.map((b) => (
          <div className="inbox-group" key={b.id}>
            <h4>
              <Avatar bot={b} size="xs" /> {b.name} 自己记的
              <button className="link" onClick={() => select(botThread(b.id))}>去看它</button>
            </h4>
            {b.viewOfYou.length === 0 ? <p className="quiet" style={{ color: 'var(--muted)' }}>还没记什么。</p> : (
              <ul className="mem">
                {b.viewOfYou.map((v, i) => (
                  <li key={i}>
                    <span>{v}</span>
                    <button className="del" onClick={() => patchBot(b.id, { viewOfYou: b.viewOfYou.filter((_, j) => j !== i) })}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
