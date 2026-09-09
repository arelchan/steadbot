import type { Bot, Matter } from '../types';
import { avatarSrc } from './Avatar';
import { cx } from '../utils';

/** Members of a matter in display order: lead first, then the rest, no duplicates. */
export function membersOf(matter: Matter, bots: Bot[]): Bot[] {
  const ids = Array.from(new Set([matter.ownerBotId, ...matter.participantBotIds]));
  return ids.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b);
}

/**
 * Group avatar: a rounded tile that holds up to four faces in a mosaic; beyond four, the last cell
 * counts the rest. Reads the same at 22px in the list and at 56px on the identity card.
 */
export function GroupAvatar({ bots, size = 'md', className }: { bots: Bot[]; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const shown = bots.length > 4 ? bots.slice(0, 3) : bots.slice(0, 4);
  const extra = bots.length - shown.length;
  const n = shown.length + (extra > 0 ? 1 : 0);
  return (
    <span className={cx('gavatar', `n${Math.min(n, 4)}`, size, className)} title={bots.map((b) => b.name).join('、')}>
      {shown.map((b) => (
        <img key={b.id} src={avatarSrc(b)} alt={b.name} />
      ))}
      {extra > 0 ? <i className="more">+{extra}</i> : null}
      {n === 0 ? <i className="more">?</i> : null}
    </span>
  );
}
