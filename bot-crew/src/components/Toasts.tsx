import { useStore, dismissToast, select } from '../store';
import { Avatar } from './Avatar';
import { useT } from '../i18n';

export function Toasts() {
  const t = useT();
  const toasts = useStore((s) => s.toasts);
  const bots = useStore((s) => s.bots);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((n) => {
        const bot = bots.find((b) => b.id === n.botId);
        return (
          <div className="toast" key={n.id} onClick={() => { select(n.threadId); dismissToast(n.id); }}>
            <Avatar bot={bot} />
            <div>
              <div className="t-n">{t('toast.wants', { name: bot?.name ?? '' })}</div>
              <div>{n.text}</div>
            </div>
            <button className="t-x" onClick={(e) => { e.stopPropagation(); dismissToast(n.id); }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}
