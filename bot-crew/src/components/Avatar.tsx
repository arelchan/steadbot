import type { Bot } from '../types';
import { procedural } from '../services/avatar';
import { httpBase, withToken } from '../services/runtime';
import { cx } from '../utils';
import { t } from '../i18n';

/** Where to load a bot's face from. Server avatars are addressed by path (older records still carry some server's
 *  origin); load them from the runtime this page talks to, with its token, so they work locally, remotely and after a move. */
export function avatarSrc(bot: Bot) {
  const u = bot.avatarUrl;
  if (!u) return procedural(bot.avatarSeed ?? bot.id);
  if (/^(data:|blob:)/.test(u)) return u;
  const path = u.replace(/^https?:\/\/[^/]+/, '');
  return path.startsWith('/avatars/') ? withToken(`${httpBase}${path}`) : withToken(u);
}

export function Avatar({ bot, size, you, className }: { bot?: Bot; size?: 'sm' | 'xs' | 'lg' | 'xl'; you?: boolean; className?: string }) {
  if (you) return <span className={cx('avatar you', size, className)} title={t('common.you')}><img src={procedural('you')} alt={t('common.you')} /></span>;
  if (!bot) return <span className={cx('avatar', size, className)}>?</span>;
  // Still being painted by the image model: a breathing placeholder instead of a face that will change.
  if (bot.generating?.avatar || bot.generating?.identity) return <span className={cx('avatar gen', size, className)} title={t('common.generating')} aria-busy />;
  const evolving = !!bot.building?.length;
  return (
    <span className={cx('avatar', size, className, evolving && 'evolving')} title={evolving ? `${bot.name} · ${bot.building!.map((j) => j.label).join('、')} building…` : bot.name}>
      <img key={bot.avatarUrl ?? bot.avatarSeed} className="fade-in" src={avatarSrc(bot)} alt={bot.name} />
    </span>
  );
}
