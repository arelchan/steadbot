import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FileRef } from '../types';
import { CodeBlock, MermaidView, renderText } from './Markdown';
import { fmtSize, kindOf } from './FileCard';
import { cx } from '../utils';
import { fileHref, openHref, authHeaders, httpBase, withToken } from '../services/runtime';
import { useStore } from '../store';
import { t } from '../i18n';

/**
 * One preview surface for everything a bot hands over: deliverable files (image / html / pdf / text / code /
 * markdown / csv / video), inline diagrams, and images in the text. Opened via `openPreview`, mounted once in App.
 */
export type PreviewItem =
  | { kind: 'file'; file: FileRef }
  | { kind: 'svg'; svg: string; title: string; source?: string }
  | { kind: 'image'; url: string; title?: string };

let current: PreviewItem | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const openPreview = (item: PreviewItem) => {
  current = item;
  emit();
};
export const closePreview = () => {
  current = null;
  emit();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const revealLabel = () => t(isMac ? 'pv.reveal.mac' : 'pv.reveal.other');
const TEXT_MAX = 2 * 1024 * 1024;

type Viewer = 'image' | 'html' | 'pdf' | 'office' | 'video' | 'audio' | 'md' | 'csv' | 'mermaid' | 'code' | 'none';
/** PowerPoint / Word / Excel: the server turns them into a PDF (office.ts) and the browser shows that. */
const OFFICE = /^(pptx?|docx?|xlsx?|odp|odt|ods|rtf)$/;
function viewerFor(f: FileRef): Viewer {
  const m = f.mime;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('text/html')) return 'html';
  if (m === 'application/pdf') return 'pdf';
  if (OFFICE.test(ext)) return 'office';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'csv') return 'csv';
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid';
  if (m.startsWith('text/') || m.startsWith('application/json')) return 'code';
  return 'none';
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function PreviewModal() {
  const item = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePreview();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item]);
  if (!item) return null;
  return <PreviewBody key={item.kind === 'file' ? item.file.url : item.kind === 'image' ? item.url : item.svg.slice(0, 64)} item={item} />;
}

function PreviewBody({ item }: { item: PreviewItem }) {
  const rt = useStore((s) => s.runtime);
  const file = item.kind === 'file' ? item.file : undefined;
  const viewer: Viewer = file ? viewerFor(file) : item.kind === 'image' ? 'image' : 'html';
  const zoomable = item.kind !== 'file' || viewer === 'image';
  /** undefined = fit to the pane; a number = an explicit scale. The canvas reports what "fit" currently means. */
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [fitScale, setFitScale] = useState(1);
  const shown = zoom ?? fitScale;
  const [menu, setMenu] = useState(false);
  const [hint, setHint] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(''), 2200);
    return () => clearTimeout(t);
  }, [hint]);

  const title = file ? file.name : item.kind === 'svg' ? item.title : item.kind === 'image' ? item.title || item.url.split('/').pop() || t('file.image') : '';
  const k = file ? kindOf(file) : item.kind === 'svg' ? { icon: '⟁', label: t('file.diagram') } : { icon: '▣', label: t('file.image') };
  const meta = file ? `${k.label} · ${fmtSize(file.size)}` : k.label;

  const step = (dir: 1 | -1) => {
    const cur = shown;
    const next = dir > 0 ? ZOOMS.find((v) => v > cur * 1.02) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((v) => v < cur / 1.02) ?? ZOOMS[0];
    setZoom(next);
  };

  const post = async (url: string, okText: string) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: authHeaders() });
      const j = (await r.json()) as { ok: boolean; error?: string };
      setHint(j.ok ? okText : t('pv.openFailed', { why: j.error ?? '' }));
    } catch {
      setHint(t('pv.noBackend'));
    }
  };
  const download = (href: string, name: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const copy = (text: string, okText: string) => void navigator.clipboard?.writeText(text).then(() => setHint(okText));

  const actions: { label: string; run: () => void; primary?: boolean }[] = [];
  if (file) {
    const href = fileHref(file);
    const openUrl = openHref(file, rt);
    const absPath = rt && file.botId ? `${rt.botsDir}/${file.botId}/${file.path}` : file.path;
    if (openUrl) {
      actions.push(
        { label: t('pv.openSystem'), run: () => void post(openUrl, t('pv.handedToSystem')), primary: true },
        { label: revealLabel(), run: () => void post(openUrl + (openUrl.includes('?') ? '&' : '?') + 'reveal=1', t('pv.revealed')) },
      );
    }
    actions.push(
      { label: t('pv.openTab'), primary: !openUrl, run: () => void window.open(href, '_blank', 'noopener') },
      { label: t('common.download'), run: () => download(href, file.name) },
      { label: rt && !rt.local ? t('pv.copyRemotePath') : t('pv.copyPath'), run: () => copy(absPath, t('pv.pathCopied')) },
    );
  } else if (item.kind === 'svg') {
    actions.push(
      {
        label: t('pv.openTab'),
        primary: true,
        run: () => {
          const w = window.open('', '_blank');
          if (w) w.document.write(`<!doctype html><title>${item.title}</title><body style="margin:24px;background:#fff;font-family:system-ui">${item.svg}</body>`);
        },
      },
      { label: t('pv.downloadSvg'), run: () => download(URL.createObjectURL(new Blob([item.svg], { type: 'image/svg+xml' })), `${item.title}.svg`) },
    );
    if (item.source) actions.push({ label: t('pv.copyMermaid'), run: () => copy(item.source!, t('pv.sourceCopied')) });
  } else if (item.kind === 'image') {
    const url = item.url;
    actions.push(
      { label: t('pv.openTab'), primary: true, run: () => void window.open(url, '_blank', 'noopener') },
      { label: t('pv.copyImageUrl'), run: () => copy(url, t('pv.urlCopied')) },
    );
  }

  return (
    <div className="pv-overlay" onClick={closePreview}>
      <div className="pv" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="pv-hd">
          <span className="pv-ic">{k.icon}</span>
          <div className="pv-title">
            <div className="pv-name" title={file?.path ?? title}>{title}</div>
            <div className="pv-meta">{meta}{file ? <span className="pv-path"> · {file.path}</span> : null}</div>
          </div>
          {hint ? <span className="pv-hint">{hint}</span> : null}
          {zoomable && (
            <div className="pv-zoom">
              <button onClick={() => step(-1)} title={t('pv.zoomOut')}>−</button>
              <button className="pv-zoom-val" onClick={() => setZoom(undefined)} title={t('pv.fitWindow')}>{zoom === undefined ? t('pv.fit') : `${Math.round(zoom * 100)}%`}</button>
              <button onClick={() => step(1)} title={t('pv.zoomIn')}>+</button>
            </div>
          )}
          <div className="menu-wrap" ref={menuRef}>
            <button className={cx('pv-btn', menu && 'on')} onClick={() => setMenu(!menu)}>
              {t('pv.openWith')} <span className="pv-caret">▾</span>
            </button>
            {menu && (
              <div className="menu pv-menu">
                {actions.map((a) => (
                  <button key={a.label} className={cx('menu-item', a.primary && 'primary')} onClick={() => { setMenu(false); a.run(); }}>
                    <span className="mi-t">{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="pv-close" onClick={closePreview} title={t('common.closeEsc')}>×</button>
        </header>
        <div className={cx('pv-body', viewer, zoom !== undefined && 'zoomed')}>
          {item.kind === 'svg' ? (
            <Canvas zoom={zoom} setZoom={setZoom} onFit={setFitScale} maxFit={2} natural={svgSize(item.svg)}>
              <div className="pv-svg" dangerouslySetInnerHTML={{ __html: item.svg }} />
            </Canvas>
          ) : item.kind === 'image' ? (
            <ImageCanvas src={item.url} alt={item.title ?? ''} zoom={zoom} setZoom={setZoom} onFit={setFitScale} />
          ) : (
            <FileViewer file={file!} viewer={viewer} zoom={zoom} setZoom={setZoom} onFit={setFitScale} onOpen={actions[0].run} onDownload={() => download(fileHref(file!), file!.name)} />
          )}
        </div>
      </div>
    </div>
  );
}

const SHEET_PAD = 24;
/** Natural size of a rendered mermaid SVG (its viewBox) plus the white sheet around it. */
function svgSize(svg: string): { w: number; h: number } {
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg);
  const w = vb ? Math.max(1, parseFloat(vb[1])) : 800;
  const h = vb ? Math.max(1, parseFloat(vb[2])) : 600;
  return { w: w + SHEET_PAD * 2, h: h + SHEET_PAD * 2 };
}

type CanvasProps = {
  natural: { w: number; h: number } | undefined;
  zoom: number | undefined;
  setZoom: (z: number | undefined) => void;
  onFit: (scale: number) => void;
  /** Fit never scales content above this (1 = never upscale a bitmap; 2 lets a small diagram grow). */
  maxFit?: number;
  children: React.ReactNode;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Pan/zoom viewport for images and diagrams. Drag to move; trackpad pinch (ctrl+wheel), Safari gesture events, or
 * two fingers on a touchscreen to zoom around the pointer; plain wheel pans; double-click toggles fit ↔ 100%.
 * `zoom` undefined means "fit to the pane", recomputed on resize; the effective fit scale is reported via onFit.
 */
function Canvas({ natural, zoom, setZoom, onFit, maxFit = 1, children }: CanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const cw = natural?.w ?? 0;
  const ch = natural?.h ?? 0;
  const fit = cw && ch && view.w && view.h ? Math.min(view.w / cw, view.h / ch, maxFit) : 1;
  const scale = zoom ?? fit;
  const stateRef = useRef({ scale, off, fit, cw, ch, view });
  stateRef.current = { scale, off, fit, cw, ch, view };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => onFit(fit), [fit, onFit]);
  // Back to "fit" recenters.
  useEffect(() => {
    if (zoom === undefined) setOff({ x: 0, y: 0 });
  }, [zoom]);

  /** Keep the content from being dragged out of the pane; content smaller than the pane stays centered. */
  const clampOff = (o: { x: number; y: number }, s: number) => {
    const { cw, ch, view } = stateRef.current;
    const mx = Math.max(0, (cw * s - view.w) / 2);
    const my = Math.max(0, (ch * s - view.h) / 2);
    return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) };
  };
  /** Zoom to `next` keeping the content point under (px, py) (pane-relative, from the pane's center) fixed. */
  const zoomAt = (next: number, px: number, py: number) => {
    const { scale, off } = stateRef.current;
    const s = clamp(next, MIN_SCALE, MAX_SCALE);
    const k = s / scale;
    const o = clampOff({ x: px - (px - off.x) * k, y: py - (py - off.y) * k }, s);
    setOff(o);
    setZoom(s);
  };
  const center = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { px: e.clientX - r.left - r.width / 2, py: e.clientY - r.top - r.height / 2 };
  };

  // Wheel: pinch (ctrl/meta) zooms, plain wheel pans. Non-passive so the page never scrolls or zooms behind us.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const { px, py } = center(e);
        zoomAt(stateRef.current.scale * Math.exp(-e.deltaY * 0.01), px, py);
      } else {
        const { off, scale } = stateRef.current;
        setOff(clampOff({ x: off.x - e.deltaX, y: off.y - e.deltaY }, scale));
      }
    };
    // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
    let base = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      base = stateRef.current.scale;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const { px, py } = center(g);
      zoomAt(base * g.scale, px, py);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', (e) => e.preventDefault());
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pointers: one drags, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer ids can't be captured */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) setDragging(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: stateRef.current.scale };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const { px, py } = center({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoomAt((pinch.current.scale * dist) / pinch.current.dist, px, py);
      return;
    }
    if (pointers.current.size === 1) {
      const { off, scale } = stateRef.current;
      setOff(clampOff({ x: off.x + e.clientX - prev.x, y: off.y + e.clientY - prev.y }, scale));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  return (
    <div
      ref={box}
      className={cx('pv-canvas', dragging && 'dragging')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const { px, py } = center(e);
        if (zoom === undefined || Math.abs(scale - 1) > 0.01) zoomAt(1, px, py);
        else setZoom(undefined);
      }}
      title={t('pv.canvasHint')}
    >
      {natural && (
        <div
          className="pv-content"
          style={{ width: cw, height: ch, transform: `translate(${off.x - (cw * scale) / 2}px, ${off.y - (ch * scale) / 2}px) scale(${scale})` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Bitmap on the canvas: natural size comes from the loaded image. */
function ImageCanvas({ src, alt, zoom, setZoom, onFit }: { src: string; alt: string; zoom: number | undefined; setZoom: (z: number | undefined) => void; onFit: (s: number) => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | undefined>(undefined);
  return (
    <>
      <img src={src} alt="" className="pv-probe" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })} />
      {!natural && <div className="pv-loading">{t('pv.loading')}</div>}
      <Canvas natural={natural} zoom={zoom} setZoom={setZoom} onFit={onFit}>
        <img src={src} alt={alt} draggable={false} />
      </Canvas>
    </>
  );
}

function FileViewer({ file, viewer, zoom, setZoom, onFit, onOpen, onDownload }: { file: FileRef; viewer: Viewer; zoom: number | undefined; setZoom: (z: number | undefined) => void; onFit: (s: number) => void; onOpen: () => void; onDownload: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const textual = viewer === 'md' || viewer === 'csv' || viewer === 'mermaid' || viewer === 'code';
  useEffect(() => {
    if (!textual) return;
    if (file.size > TEXT_MAX) {
      setErr(t('pv.tooBig'));
      return;
    }
    let alive = true;
    fetch(fileHref(file), { headers: authHeaders() })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setErr(t('pv.unreadable')));
    return () => {
      alive = false;
    };
  }, [file.url, file.size, textual]);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (viewer) {
    case 'image':
      return <ImageCanvas src={fileHref(file)} alt={file.name} zoom={zoom} setZoom={setZoom} onFit={onFit} />;
    case 'html':
      return <iframe className="pv-frame" src={fileHref(file)} title={file.name} sandbox="allow-scripts allow-same-origin allow-popups allow-modals" />;
    case 'pdf':
      return <iframe className="pv-frame" src={fileHref(file)} title={file.name} />;
    case 'office':
      return <OfficeView file={file} onOpen={onOpen} onDownload={onDownload} />;
    case 'video':
      return <video className="pv-media" src={fileHref(file)} controls autoPlay />;
    case 'audio':
      return <audio className="pv-media audio" src={fileHref(file)} controls autoPlay />;
    case 'none':
      return <NoPreview file={file} onOpen={onOpen} onDownload={onDownload} />;
  }
  if (err) return <NoPreview file={file} note={err} onOpen={onOpen} onDownload={onDownload} />;
  if (text === null) return <div className="pv-loading">{t('pv.reading')}</div>;
  if (viewer === 'md') return <article className="pv-doc">{renderText(text, [])}</article>;
  if (viewer === 'mermaid') return <div className="pv-doc"><MermaidView code={text} /></div>;
  if (viewer === 'csv') return <div className="pv-doc"><CsvTable text={text} /></div>;
  let code = text;
  if (ext === 'json') {
    try {
      code = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* show as-is */
    }
  }
  return <div className="pv-doc code"><CodeBlock lang={ext} code={code} /></div>;
}

/**
 * A deck or a document, shown in place: the server converts it to a PDF once (cached per file version) and this is
 * the browser's own PDF viewer on the result. Where LibreOffice is not installed — a plain laptop, say — it falls
 * back to the same card as any other unviewable file, which offers the system app.
 */
function OfficeView({ file, onOpen, onDownload }: { file: FileRef; onOpen: () => void; onDownload: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    let made = '';
    setUrl(null);
    setErr('');
    fetch(withToken(`${httpBase || window.location.origin}${file.url.replace('/files/', '/preview/')}`), { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const why = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(why.error === 'no-libreoffice' ? t('pv.noOffice') : t('pv.convertFailed'));
        }
        return r.blob();
      })
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.url]);
  if (err) return <NoPreview file={file} note={err} onOpen={onOpen} onDownload={onDownload} />;
  if (!url) return <div className="pv-loading">{t('pv.converting')}</div>;
  return <iframe className="pv-frame" src={url} title={file.name} />;
}

function NoPreview({ file, note, onOpen, onDownload }: { file: FileRef; note?: string; onOpen: () => void; onDownload: () => void }) {
  const k = kindOf(file);
  return (
    <div className="pv-none">
      <div className="pv-none-ic">{k.icon}</div>
      <div className="pv-none-name">{file.name}</div>
      <div className="pv-none-note">{note ?? t('pv.noPreview', { kind: k.label })}</div>
      <div className="pv-none-actions">
        <button className="btn primary" onClick={onOpen}>{t('pv.openSystem')}</button>
        <button className="btn" onClick={onDownload}>{t('common.download')}</button>
      </div>
    </div>
  );
}

/** Minimal RFC-4180-ish CSV: quoted fields, escaped quotes, CRLF. Caps rows so a huge export doesn't lock the tab. */
function parseCsv(text: string, maxRows = 2000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text);
  if (!rows.length) return <div className="pv-loading">{t('pv.emptyFile')}</div>;
  const [head, ...body] = rows;
  return (
    <div className="md-table pv-csv">
      <table>
        <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>)}</tbody>
      </table>
      {rows.length >= 2000 && <div className="pv-loading">{t('pv.first2000')}</div>}
    </div>
  );
}
