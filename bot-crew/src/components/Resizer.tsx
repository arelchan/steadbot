import { useRef } from 'react';
import { useStore, setColumnWidth } from '../store';
import type { Layout } from '../types';
import { DEFAULT_LAYOUT } from '../types';
import { cx } from '../utils';
import { t } from '../i18n';

/**
 * A slim drag grabber on a column edge. `edge` is where it sits; `grow` is which drag direction
 * makes the column wider (defaults to dragging away from the column). Widths persist with the UI state.
 */
export function Resizer({ col, edge, grow }: { col: keyof Layout; edge: 'left' | 'right'; grow?: 'left' | 'right' }) {
  const width = useStore((s) => s.layout[col]);
  const start = useRef<{ x: number; w: number } | null>(null);
  const dir = grow ?? edge;
  return (
    <div
      className={cx('resizer', edge)}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        setColumnWidth(col, start.current.w + (dir === 'right' ? dx : -dx));
      }}
      onPointerUp={(e) => {
        start.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={() => setColumnWidth(col, DEFAULT_LAYOUT[col])}
      title={t('common.resize')}
    >
      <i />
    </div>
  );
}
