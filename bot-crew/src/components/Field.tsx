import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils';
import { useT } from '../i18n';

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

/**
 * A block standing in for something that has not arrived yet — the shape of the answer, not a stale copy of it.
 * `w` is a width (px or any CSS length); rows are as tall as the text they replace.
 */
export function Skel({ w, h = 13 }: { w: number | string; h?: number }) {
  return <span className="skel" style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }} />;
}

type Item = { value: string; label: string; group?: string; disabled?: boolean };

/** Everything inside an <option>, flattened to the one line it shows as. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Callers write <option> and <optgroup> as if this were a native select; this is where that is read back. */
function itemsOf(children: ReactNode, group?: string, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string; label?: string; disabled?: boolean; children?: ReactNode };
    if (child.type === 'optgroup') itemsOf(props.children, props.label, out);
    else if (child.type === 'option') out.push({ value: String(props.value ?? ''), label: textOf(props.children), group, disabled: props.disabled });
    else itemsOf(props.children, group, out);
  });
  return out;
}

/** Long enough that reading it beats scrolling it. */
const FILTER_FROM = 12;
const POP_MAX = 320;

/**
 * The app's only select.
 *
 * A native <select> hands the list to the operating system, which for a provider's three hundred models means a
 * menu the height of the screen, drawn in the OS's own style, over everything. So the list is ours: a panel the
 * width of the field, never taller than 320px, with a filter box once there is more in it than anyone wants to
 * scroll. It is portalled to the body and positioned in viewport coordinates, so no modal's overflow can clip it,
 * and flips above the field when there is more room up there.
 */
export function Pick({
  value,
  onChange,
  children,
  wide,
  placeholder,
  onClear,
  clearTitle,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  wide?: boolean;
  /** What the field reads before anything is chosen. It is a state, not a choice, so it is never in the list. */
  placeholder?: string;
  /** Given when there is something to undo: an ✕ in the field that puts it back to that state. */
  onClear?: () => void;
  clearTitle?: string;
}) {
  const t = useT();
  const items = useMemo(() => itemsOf(children), [children]);
  const current = items.find((i) => i.value === value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ left: number; width: number; maxH: number; top?: number; bottom?: number }>({ left: 0, width: 0, maxH: POP_MAX });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.value.toLowerCase().includes(s)) : items;
  }, [items, q]);
  const filtering = items.length >= FILTER_FROM;

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    const maxH = Math.max(140, Math.min(POP_MAX, up ? above : below));
    // Opening upwards pins the panel's *bottom* to the field. Working out a top from the maximum height instead
    // would leave a short list floating a whole panel's height above the field it belongs to.
    setAt({
      left: r.left,
      width: r.width,
      maxH,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const shut = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    // Follow the field rather than closing: focusing the filter box can itself scroll an ancestor, and a panel
    // that vanishes the moment it opens is worse than one that has to keep up.
    window.addEventListener('mousedown', shut);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', shut);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Open on the current answer, and keep whatever is being keyed to in sight.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(Math.max(0, items.findIndex((i) => i.value === value)));
  }, [open]);
  useEffect(() => {
    // Opening: put the current answer in the middle, where it reads as "this is where you are in the list".
    if (open) pop.current?.querySelector('.pp-i.on')?.scrollIntoView({ block: 'center' });
  }, [open]);
  useEffect(() => {
    if (open) pop.current?.querySelector('.pp-i.at')?.scrollIntoView({ block: 'nearest' });
  }, [active, q]);

  const take = (i: Item) => {
    setOpen(false);
    if (i.value !== value) onChange(i.value);
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'Enter' || (e.key === ' ' && !filtering)) {
      e.preventDefault();
      if (!open) return setOpen(true);
      const hit = shown[active];
      if (hit && !hit.disabled) take(hit);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!open) return setOpen(true);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    setActive((a) => {
      for (let n = a + step; n >= 0 && n < shown.length; n += step) if (!shown[n].disabled) return n;
      return a;
    });
  };

  return (
    <span className={cx('pick', wide && 'wide', open && 'open', onClear && 'clearable')}>
      <button
        type="button"
        ref={btn}
        className="pick-face"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={keys}
      >
        <span className={cx('pf-t', !current && 'ph')}>{current?.label ?? placeholder ?? items[0]?.label ?? ''}</span>
      </button>
      {onClear && (
        <button
          type="button"
          className="pick-x"
          title={clearTitle}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onClear();
          }}
        >
          ✕
        </button>
      )}
      {open &&
        createPortal(
          <div className="pick-pop" ref={pop} style={{ left: at.left, top: at.top, bottom: at.bottom, width: at.width, maxHeight: at.maxH }} onKeyDown={keys}>
            {filtering && (
              <input className="pp-q" autoFocus value={q} placeholder={t('common.filter')} onChange={(e) => (setQ(e.target.value), setActive(0))} />
            )}
            <div className="pp-list" role="listbox">
              {shown.map((i, n) => (
                <div key={`${i.group ?? ''}/${i.value}/${n}`}>
                  {i.group && i.group !== shown[n - 1]?.group && <div className="pp-g">{i.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i.value === value}
                    disabled={i.disabled}
                    className={cx('pp-i', i.value === value && 'on', n === active && 'at')}
                    onMouseEnter={() => setActive(n)}
                    onClick={() => take(i)}
                  >
                    {i.label}
                  </button>
                </div>
              ))}
              {!shown.length && <div className="pp-none">{t('common.noMatch')}</div>}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
