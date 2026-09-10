import { useEffect, useState } from 'react';
import { useStore, setSharedProfile } from '../store';
import { memoryOverview } from '../services/agent';
import { Avatar } from './Avatar';
import { useT } from '../i18n';

export function ProfileView() {
  const t = useT();
  const s = useStore((x) => x);
  const [draft, setDraft] = useState('');
  // What the engine worked out on its own, as opposed to what the user wrote down. One picture for every
  // bot: the user is one person, so his profile is not split per bot (see the memory design).
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void memoryOverview().then((m) => { if (live) setSeen(m.profile); });
    return () => { live = false; };
  }, []);
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

        {seen.length > 0 && (
          <div className="inbox-group">
            <h4>{t('profile.engine')}</h4>
            <ul className="mem readonly">
              {seen.map((v, i) => <li key={i}><span>{v}</span></li>)}
            </ul>
          </div>
        )}

      </div>
    </section>
  );
}
