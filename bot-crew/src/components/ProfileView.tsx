import { useState } from 'react';
import { useStore, setSharedProfile, patchBot, select } from '../store';
import { botThread } from '../types';
import { Avatar } from './Avatar';
import { useT } from '../i18n';

export function ProfileView() {
  const t = useT();
  const s = useStore((x) => x);
  const [draft, setDraft] = useState('');
  return (
    <section className="col thread">
      <header className="hd">
        <Avatar you />
        <div className="who">
          <span className="n">{t('profile.title')}</span>
          <span className="t">{t('profile.sub')}</span>
        </div>
      </header>
      <div className="inbox" style={{ maxWidth: 720 }}>
        <div className="inbox-group">
          <h4>{t('profile.shared')}</h4>
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
            placeholder={t('profile.addShared')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                setSharedProfile([...s.sharedProfile, draft.trim()]);
                setDraft('');
              }
            }}
          />
        </div>

        {s.bots.map((b) => (
          <div className="inbox-group" key={b.id}>
            <h4>
              <Avatar bot={b} size="xs" /> {t('profile.own', { name: b.name })}
              <button className="link" onClick={() => select(botThread(b.id))}>{t('profile.goSee')}</button>
            </h4>
            {b.viewOfYou.length === 0 ? <p className="quiet" style={{ color: 'var(--muted)' }}>{t('common.none')}</p> : (
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
