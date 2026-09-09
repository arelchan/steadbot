import type { CSSProperties } from 'react';
import type { Bot } from '../types';
import { cx } from '../utils';

/** Shimmering placeholder bar. */
export function Sk({ w = '60%', h = 12, className, style }: { w?: number | string; h?: number; className?: string; style?: CSSProperties }) {
  return <span className={cx('sk', className)} style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** Bot name, or a shimmer while the model is still naming it. */
export function BotName({ bot, className, w = 72 }: { bot: Bot; className?: string; w?: number }) {
  if (bot.generating?.identity) return <Sk w={w} h={13} className={cx('sk-name', className)} />;
  return <span className={cx(className ?? 'n', 'fade-in')}>{bot.name}</span>;
}
