import { useStore, dismissToast, select } from '../store';
import { Avatar } from './Avatar';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const bots = useStore((s) => s.bots);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const bot = bots.find((b) => b.id === t.botId);
        return (
          <div className="toast" key={t.id} onClick={() => { select(t.threadId); dismissToast(t.id); }}>
            <Avatar bot={bot} />
            <div>
              <div className="t-n">{bot?.name} 找你</div>
              <div>{t.text}</div>
            </div>
            <button className="t-x" onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}
