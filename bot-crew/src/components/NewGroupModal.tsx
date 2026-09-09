import { useEffect, useState } from 'react';
import { useStore, addMatter, select } from '../store';
import { matterThread } from '../types';
import { Avatar } from './Avatar';
import { cx } from '../utils';
import { useT } from '../i18n';

export function NewGroupModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const names = picked.map((id) => bots.find((b) => b.id === id)?.name).filter(Boolean);
  const joined = names.slice(0, 2).join(t('common.listSep'));
  const autoTitle = names.length ? (names.length > 2 ? t('group.autoTitleMore', { names: joined, n: names.length }) : t('group.autoTitle', { names: joined })) : '';

  const create = () => {
    if (!picked.length) return;
    const m = addMatter({
      title: title.trim() || autoTitle,
      summary: '',
      ownerBotId: picked[0],
      participantBotIds: picked,
      tools: [],
      status: 'active',
      notify: true,
      pinned: false,
    });
    select(matterThread(m.id));
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal grp" onClick={(e) => e.stopPropagation()}>
        <h2>{t('group.new')}</h2>
        <ul className="pick-list">
          {bots.map((b) => {
            const on = picked.includes(b.id);
            const idx = picked.indexOf(b.id);
            return (
              <li key={b.id}>
                <button className={cx('pick-row', on && 'on')} onClick={() => toggle(b.id)}>
                  <span className={cx('check', on && 'on')}>{on ? '✓' : ''}</span>
                  <Avatar bot={b} className="lg" />
                  <span className="pick-main">
                    <span className="pick-name">{b.name}{idx === 0 && <span className="tag">{t('group.lead')}</span>}</span>
                    <span className="pick-sub">{b.tagline}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('group.nameLabel')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || t('group.namePlaceholder')} />
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>{t('group.giveUp')}</button>
          <button className="btn primary" onClick={create} disabled={!picked.length}>{picked.length ? t('group.createN', { n: picked.length }) : t('group.create')}</button>
        </div>
      </div>
    </div>
  );
}
