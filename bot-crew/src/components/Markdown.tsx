import type React from 'react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Bot, FileRef } from '../types';
import { FileChip } from './FileCard';
import { openPreview } from './Preview';
import { cx } from '../utils';
import { t } from '../i18n';

/* ------------------------------------------------------------------ inline ------------------------------------------------------------------ */

/** Plain click opens the big preview; modifier/middle clicks keep the browser's own new-tab behaviour. */
const previewImage = (url: string, title?: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  openPreview({ kind: 'image', url, title });
};

const URL_SRC = String.raw`https?:\/\/[^\s<>()\]}"'，。；！？、）]+[^\s<>()\]}"'，。；！？、）.,:;]`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Decoration models put around a delivered path: a file emoji in front, one opening and one closing quote /
 *  bracket / backtick (not required to pair — `path》 happens). Swallowed together with the path when it becomes a chip. */
const DECO_LEAD = String.raw`(?:[\u{1F4C1}-\u{1F4C4}\u{1F4CE}\u{1F4DD}\u{1F4CA}\u{1F5BC}]\uFE0F?\s*)?`;
const DECO_OPEN = String.raw`[\u0060"'“「『《〈\[(【]?`;
const DECO_CLOSE = String.raw`[\u0060"'”」』》〉\])】]?`;

const IMG_URL = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;

/**
 * One scanner for everything inline, instead of a stack of nested splits. The old shape split by code spans first
 * and looked for **bold** last, so a bold run holding a path or a link never matched
 * either half and the asterisks came out as text. Here every construct is one alternative of one regex: whichever
 * starts earliest wins, and emphasis renders its own content through the same scanner, so anything nests.
 */
interface Ctx {
  re: RegExp;
  names: string[];
  fileOf: (t: string) => FileRef | undefined;
  key: () => string;
}

const groups = (files: FileRef[], names: string[]) => {
  const alts = files.map((f) => esc(f.mention!)).sort((a, b) => b.length - a.length).join('|');
  return [
    // a delivered file's path, with whatever the model wrapped it in
    alts ? `(?<file>${DECO_LEAD}${DECO_OPEN}(?:${alts})${DECO_CLOSE})` : '',
    String.raw`\\(?<esc>[\\\u0060*_~\[\]()#+\-.!>])`,
    String.raw`(?<tick>\u0060+)(?<code>[^\n]+?)\k<tick>`,
    String.raw`!\[(?<imgalt>[^\]\n]*)\]\((?<imgsrc>[^)\s]+)\)`,
    String.raw`\[(?<ltext>[^\]\n]*)\]\((?<lhref>[^)\s]+)\)`,
    String.raw`<(?<auto>(?:https?:\/\/|mailto:)[^>\s]+)>`,
    String.raw`\*\*\*(?<bi>[^\n]+?)\*\*\*`,
    String.raw`(?<bmark>\*\*|__)(?<bold>[^\n]+?)\k<bmark>`,
    String.raw`(?<imark>[*_])(?<ital>[^\s*_][^\n]*?|[^\s*_])\k<imark>`,
    String.raw`~~(?<strike>[^\n]+?)~~`,
    `(?<url>${URL_SRC})`,
    names.length ? `(?<at>@(?:${names.map(esc).join('|')}))` : '',
  ]
    .filter(Boolean)
    .join('|');
};

/** `snake_case`, `2*3*4`: a star or underscore with word characters on both sides is a character, not emphasis. */
const wordAt = (s: string, i: number) => i >= 0 && i < s.length && /[\w一-鿿]/.test(s[i]);

/** Inline: delivered paths (as chips), `code`, bold / italic / strike, links, images, bare urls, @mentions. */
function renderInline(text: string, bots: Bot[], files: FileRef[] = []): ReactNode[] {
  const names = bots.map((b) => b.name);
  const withMention = files.filter((f) => f.mention);
  const stripDeco = (t: string) => t.replace(/^\s*(?:[\u{1F4C1}-\u{1F4C4}\u{1F4CE}\u{1F4DD}\u{1F4CA}\u{1F5BC}]\uFE0F?\s*)?[\u0060"'“「『《〈\[(【]?/u, '').replace(/[\u0060"'”」』》〉\])】]?\s*$/u, '').trim();
  let k = 0;
  const ctx: Ctx = {
    re: new RegExp(groups(withMention, names), 'gu'),
    names,
    fileOf: (t: string) => withMention.find((f) => f.mention === stripDeco(t)),
    key: () => `i${k++}`,
  };
  return scan(text, ctx);
}

function scan(text: string, c: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(c.re.source, c.re.flags);
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (s: string) => {
    if (s) out.push(<span key={c.key()}>{s}</span>);
  };
  while ((m = re.exec(text))) {
    const g = m.groups ?? {};
    // Emphasis wedged inside a word is not emphasis — `some_long_name`, `2*3*4`, a glob. Put the characters back.
    if ((g.imark || g.bmark) && wordAt(text, m.index - 1) && wordAt(text, re.lastIndex)) {
      plain(text.slice(last, re.lastIndex));
      last = re.lastIndex;
      continue;
    }
    plain(text.slice(last, m.index));
    out.push(node(g, m[0], c));
    last = re.lastIndex;
  }
  plain(text.slice(last));
  return out;
}

function node(g: Record<string, string | undefined>, whole: string, c: Ctx): ReactNode {
  const key = c.key();
  if (g.file !== undefined) {
    const f = c.fileOf(g.file);
    return f ? <FileChip file={f} key={key} /> : <span key={key}>{whole}</span>;
  }
  if (g.esc !== undefined) return <span key={key}>{g.esc}</span>;
  if (g.code !== undefined) {
    // A code span holding a delivered path is the file itself.
    const f = c.fileOf(g.code);
    return f ? <FileChip file={f} key={key} /> : <code className="ic" key={key}>{g.code}</code>;
  }
  if (g.imgsrc !== undefined)
    return (
      <a className="md-img" href={g.imgsrc} target="_blank" rel="noopener noreferrer" key={key} onClick={previewImage(g.imgsrc, g.imgalt)}>
        <img src={g.imgsrc} alt={g.imgalt ?? ''} loading="lazy" />
      </a>
    );
  if (g.lhref !== undefined)
    return (
      <a href={g.lhref} target="_blank" rel="noopener noreferrer" key={key}>
        {g.ltext ? scan(g.ltext, c) : g.lhref}
      </a>
    );
  if (g.auto !== undefined)
    return (
      <a href={g.auto} target="_blank" rel="noopener noreferrer" key={key}>
        {g.auto.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      </a>
    );
  if (g.bi !== undefined) return <b key={key}><i>{scan(g.bi, c)}</i></b>;
  if (g.bold !== undefined) return <b key={key}>{scan(g.bold, c)}</b>;
  if (g.ital !== undefined) return <i key={key}>{scan(g.ital, c)}</i>;
  if (g.strike !== undefined) return <s key={key}>{scan(g.strike, c)}</s>;
  if (g.url !== undefined)
    return IMG_URL.test(g.url) ? (
      <a className="md-img" href={g.url} target="_blank" rel="noopener noreferrer" key={key} onClick={previewImage(g.url)}>
        <img src={g.url} alt="" loading="lazy" />
      </a>
    ) : (
      <a href={g.url} target="_blank" rel="noopener noreferrer" key={key}>
        {g.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      </a>
    );
  if (g.at !== undefined) return <span className="mention" key={key}>{g.at}</span>;
  return <span key={key}>{whole}</span>;
}

/* ------------------------------------------------------------------ blocks ------------------------------------------------------------------ */

export function CodeBlock({ lang, code, note }: { lang: string; code: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <div className="cb-hd">
        <span className="cb-lang">{lang || 'text'}{note ? <span className="cb-note"> · {note}</span> : null}</span>
        <button
          className="cb-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
const loadMermaid = () => {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'inherit', themeVariables: { fontSize: '13px' } });
      return m.default;
    });
  }
  return mermaidReady;
};

/**
 * Models make the same mermaid mistakes over and over: unquoted labels with ( ) / : ; < > inside, node ids with
 * spaces. Quote what can be quoted so the diagram renders; anything else falls through to the error fallback.
 */
function repairMermaid(src: string): string {
  const special = /[()（）/:;<>|{}#&,，：；]/;
  const quoteIn = (open: string, close: string) => (line: string) => {
    const re = new RegExp(`(\\b[A-Za-z0-9_\\u4e00-\\u9fff]+)\\${open}(?![\\[(\\/\\\\"'])([^\\${close}\\n]*?)\\${close}`, 'g');
    return line.replace(re, (all, id: string, text: string) => (special.test(text) && !/^".*"$/.test(text) ? `${id}${open}"${text.replace(/"/g, "'")}"${close}` : all));
  };
  const fixes = [quoteIn('[', ']'), quoteIn('{', '}')];
  return src
    .split('\n')
    .map((line) => {
      if (/^\s*(subgraph|classDef|class|style|linkStyle|click|%%)/.test(line)) return line;
      let out = line;
      for (const f of fixes) out = f(out);
      // "A --> Some Name With Spaces": quote the loose target as a label of an id.
      out = out.replace(/(-->|---|-\.->|==>|<-->)(\|[^|]*\|)?\s+([^\s\[\]{}()"|][^\[\]{}()"|\n]*\s[^\[\]{}()"|\n]*?)\s*$/, (all, arrow: string, label: string | undefined, target: string) => {
        const t = target.trim();
        if (/^(subgraph|end)$/.test(t) || /[\[\]{}()]/.test(t)) return all;
        const id = t.replace(/[^A-Za-z0-9_\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '') || 'n';
        return `${arrow}${label ?? ''} ${id}["${t}"]`;
      });
      return out;
    })
    .join('\n');
}

/** A ```mermaid block: rendered to inline SVG; on a syntax error (after auto-repair) the source stays visible with the error. */
export function MermaidView({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSvg(null);
    setErr(null);
    loadMermaid()
      .then(async (m) => {
        let src = code;
        let firstErr = '';
        try {
          await m.parse(src);
        } catch (e) {
          firstErr = (e as Error).message || '';
          src = repairMermaid(code);
          try {
            await m.parse(src);
          } catch {
            throw new Error(firstErr || t('md.badSyntax'));
          }
        }
        const r = await m.render(`mm${id}${Date.now().toString(36)}`, src);
        if (alive) setSvg(r.svg);
      })
      .catch((e: unknown) => alive && setErr((e as Error).message || t('md.renderFailed')));
    return () => {
      alive = false;
    };
  }, [code, id]);
  if (err) {
    const where = /line (\d+)/.exec(err)?.[1];
    return <CodeBlock lang="mermaid" code={code} note={where ? t('md.badSyntaxAt', { line: where }) : t('md.badSyntaxNoLine')} />;
  }
  if (!svg) return <div className="mermaid loading">{t('md.drawing')}</div>;
  return (
    <div className="mermaid">
      <div className="mm-svg" dangerouslySetInnerHTML={{ __html: svg }} onClick={() => openPreview({ kind: 'svg', svg, title: t('file.diagram'), source: code })} title={t('md.zoom')} />
      <button className="mm-open" title={t('md.zoomIn')} onClick={() => openPreview({ kind: 'svg', svg, title: t('file.diagram'), source: code })}>
        ⤢
      </button>
    </div>
  );
}

function Table({ rows, bots, files }: { rows: string[]; bots: Bot[]; files?: FileRef[] }) {
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  // `:---`, `---:`, `:---:` — what the second row says about each column.
  const align = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : undefined));
  const body = rows.slice(2).map(cells);
  return (
    <div className="md-table">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i} style={align[i] ? { textAlign: align[i] } : undefined}>{renderInline(h, bots, files)}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{head.map((_, j) => <td key={j} style={align[j] ? { textAlign: align[j] } : undefined}>{renderInline(r[j] ?? '', bots, files)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** One list item as read off the line, before the indents are turned into nesting. */
interface Item {
  kind: 'ul' | 'ol';
  indent: number;
  text: string;
  /** `- [ ]` / `- [x]`: a checkbox, not a bullet */
  done?: boolean;
  children: Item[];
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,3})[.、)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

/** A run of consecutive list lines becomes a tree: two spaces (or a tab) deeper is a child of the line above. */
function nest(items: Item[]): Item[] {
  const roots: Item[] = [];
  const stack: Item[] = [];
  for (const it of items) {
    while (stack.length && it.indent <= stack[stack.length - 1].indent) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(it);
    else roots.push(it);
    stack.push(it);
  }
  return roots;
}

function List({ items, bots, files }: { items: Item[]; bots: Bot[]; files?: FileRef[] }) {
  const kind = items[0].kind;
  const inner = items.map((it, i) => (
    <li key={i} className={it.done === undefined ? undefined : cx('md-task', it.done && 'done')}>
      {it.done !== undefined && <span className="md-box">{it.done ? '✓' : ''}</span>}
      {renderInline(it.text, bots, files)}
      {it.children.length ? <List items={it.children} bots={bots} files={files} /> : null}
    </li>
  ));
  return kind === 'ul' ? <ul className="md-list">{inner}</ul> : <ol className="md-list">{inner}</ol>;
}

/**
 * Markdown for chat bubbles and skill docs: fenced code (```mermaid renders as a diagram), tables, headings
 * (# … ###### keep their level), bullet / numbered / task lists with nesting, quotes, links, images, inline code,
 * bold / italic / strike, @mentions.
 */
export function renderText(text: string, bots: Bot[], files?: FileRef[]) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  const listLine = (l: string) => {
    const b = BULLET.exec(l);
    const n = b ? null : NUMBER.exec(l);
    if (!b && !n) return undefined;
    const indent = (b ? b[1] : n![1]).replace(/\t/g, '  ').length;
    const body = b ? b[2] : n![3];
    const task = b ? TASK.exec(body) : null;
    return { kind: (b ? 'ul' : 'ol') as 'ul' | 'ol', indent, text: task ? task[2] : body, done: task ? task[1].toLowerCase() === 'x' : undefined, children: [] as Item[] };
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1].toLowerCase();
      const buf: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) buf.push(lines[j++]);
      const code = buf.join('\n');
      blocks.push(lang === 'mermaid' ? <MermaidView code={code} key={`c${i}`} /> : <CodeBlock lang={lang} code={code} key={`c${i}`} />);
      i = j;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) rows.push(lines[j++]);
      blocks.push(<Table rows={rows} bots={bots} files={files} key={`t${i}`} />);
      i = j - 1;
      continue;
    }
    const first = listLine(line);
    if (first) {
      const items: Item[] = [first];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const it = listLine(lines[j].trimEnd());
        if (!it) break;
        items.push(it);
      }
      blocks.push(<List items={nest(items)} bots={bots} files={files} key={`l${i}`} />);
      i = j - 1;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div className={`md-h h${h[1].length}`} key={i}>{renderInline(h[2], bots, files)}</div>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      // Consecutive quoted lines are one quote, not one per line.
      const rows: string[] = [];
      let j = i;
      for (; j < lines.length && /^>\s?/.test(lines[j].trimEnd()); j++) rows.push(lines[j].trimEnd().replace(/^>\s?/, ''));
      blocks.push(
        <blockquote className="md-q" key={i}>
          {rows.map((r, n) => (
            <div key={n}>{renderInline(r, bots, files)}</div>
          ))}
        </blockquote>,
      );
      i = j - 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr className="md-hr" key={i} />);
      continue;
    }
    if (line === '') {
      if (blocks.length) blocks.push(<div className="md-gap" key={i} />);
      continue;
    }
    blocks.push(<div key={i}>{renderInline(line, bots, files)}</div>);
  }
  return blocks.length === 1 ? blocks[0] : blocks;
}

/** Markdown block, shared by chat bubbles and skill documents. */
export function Markdown({ text, bots = [] }: { text: string; bots?: Bot[] }) {
  return <div className="md">{renderText(text, bots)}</div>;
}
