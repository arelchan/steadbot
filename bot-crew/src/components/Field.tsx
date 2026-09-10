import type { ReactNode } from 'react';
import { cx } from '../utils';

/**
 * The two shapes every settings-like surface is built from: a row (what it is on the left, the control on the
 * right) and a select that looks like the rest of the app rather than like the operating system.
 */

export function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-r">
      <div className="set-rl">
        <span>{label}</span>
        {note ? <span className="set-rn">{note}</span> : null}
      </div>
      <div className="set-rc">{children}</div>
    </div>
  );
}

export function Pick({ value, onChange, children, wide }: { value: string; onChange: (v: string) => void; children: ReactNode; wide?: boolean }) {
  return (
    <span className={cx('pick', wide && 'wide')}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </span>
  );
}
