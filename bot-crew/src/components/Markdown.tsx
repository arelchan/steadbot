import type React from 'react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Bot, FileRef } from '../types';
import { FileChip } from './FileCard';
import { openPreview } from './Preview';

/* ------------------------------------------------------------------ inline ------------------------------------------------------------------ */

/** Plain click opens the big preview; modifier/middle clicks keep the browser's own new-tab behaviour. */
const previewImage = (url: string, title?: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  openPreview({ kind: 'image', url, title });
};

const URL_RE = /(https?:\/\/[^\s<>()\]}"'，。；！？、）]+[^\s<>()\]}"'，。；！？、）.,:;])/g;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Decoration models put around a delivered path: a file emoji in front, one opening and one closing quote /
 *  bracket / backtick (not required to pair — `path》 happens). Swallowed together with the path when it becomes a chip. */
const DECO_LEAD = String.raw`(?:[\u{1F4C1}-\u{1F4C4}\u{1F4CE}\u{1F4DD}\u{1F4CA}\u{1F5BC}]\uFE0F?\s*)?`;
const DECO_OPEN = String.raw`[\u0060"'“「『《〈\[(【]?`;
const DECO_CLOSE = String.raw`[\u0060"'”」』》〉\])】]?`;

/** Inline: file paths the bot delivered (rendered as chips), `code`, **bold**, [text](url), bare urls, @mentions. */
function renderInline(text: string, bots: Bot[], files: FileRef[] = []): ReactNode[] {
  const names = bots.map((b) => b.name);
  const mention = names.length ? new RegExp(`(@(?:${names.map(esc).join('|')}))`) : null;
  const out: ReactNode[] = [];
  let k = 0;
  const key = () => `i${k++}`;
  const withMention = files.filter((f) => f.mention);
  // Models dress a delivered path up: `path`, "path", 《path》, a leading 📄 — and sometimes mismatch the pair
  // (`path》). The chip carries its own icon, so the decoration is swallowed with the path, one char each side,
  // without requiring it to pair up.
  const stripDeco = (t: string) => t.replace(/^\s*(?:[\u{1F4C1}-\u{1F4C4}\u{1F4CE}\u{1F4DD}\u{1F4CA}\u{1F5BC}]\uFE0F?\s*)?[`"'“「『《〈\[(【]?/u, '').replace(/[`"'”」』》〉\])】]?\s*$/u, '').trim();
  const fileOf = (t: string) => withMention.find((f) => f.mention === stripDeco(t));
  const alts = withMention.map((f) => esc(f.mention!)).sort((a, b) => b.length - a.length).join('|');
  // Built from String.raw so the regex escapes survive: a template literal would eat \s and \[ before RegExp saw them.
  const fileRe = withMention.length ? new RegExp('(' + DECO_LEAD + DECO_OPEN + '(?:' + alts + ')' + DECO_CLOSE + ')', 'u') : null;
  // 0. delivered files: the path text (with whatever the model wrapped it in) becomes the file itself
  const pieces = fileRe ? text.split(fileRe) : [text];
  for (const piece of pieces) {
    if (!piece) continue;
    const hit = fileOf(piece);
    if (hit) {
      out.push(<FileChip file={hit} key={key()} />);
      continue;
    }
  // 1. code spans are opaque (a code span holding a delivered path is the file too)
  const segs = piece.split(/(`[^`\n]+`)/g);
  for (const seg of segs) {
    if (/^`[^`\n]+`$/.test(seg)) {
      const f = fileOf(seg.slice(1, -1));
      out.push(f ? <FileChip file={f} key={key()} /> : <code className="ic" key={key()}>{seg.slice(1, -1)}</code>);
      continue;
    }
    // 2. images and links
    const linkParts = seg.split(/(!?\[[^\]\n]*\]\([^)\s]+\))/g);
    for (const lp of linkParts) {
      const ml = /^(!?)\[([^\]\n]*)\]\(([^)\s]+)\)$/.exec(lp);
      if (ml) {
        if (ml[1] === '!') out.push(<a className="md-img" href={ml[3]} target="_blank" rel="noopener noreferrer" key={key()} onClick={previewImage(ml[3], ml[2])}><img src={ml[3]} alt={ml[2]} loading="lazy" /></a>);
        else out.push(<a href={ml[3]} target="_blank" rel="noopener noreferrer" key={key()}>{ml[2] || ml[3]}</a>);
        continue;
      }
      // 3. bare urls
      const urlParts = lp.split(URL_RE);
      urlParts.forEach((up, idx) => {
        if (!up) return;
        if (idx % 2 === 1) {
          if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(up)) out.push(<a className="md-img" href={up} target="_blank" rel="noopener noreferrer" key={key()} onClick={previewImage(up)}><img src={up} alt="" loading="lazy" /></a>);
          else out.push(<a href={up} target="_blank" rel="noopener noreferrer" key={key()}>{up.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>);
          return;
        }
        // 4. bold + mentions
        const bold = up.split(/(\*\*[^*\n]+\*\*)/g);
        for (const b of bold) {
          if (/^\*\*[^*\n]+\*\*$/.test(b)) {
            out.push(<b key={key()}>{b.slice(2, -2)}</b>);
            continue;
          }
          const parts = mention ? b.split(mention) : [b];
          for (const p of parts) {
            if (!p) continue;
            out.push(p.startsWith('@') && names.includes(p.slice(1)) ? <span className="mention" key={key()}>{p}</span> : <span key={key()}>{p}</span>);
          }
        }
      });
    }
  }
  }
  return out;
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
          {copied ? '已复制' : '复制'}
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
            throw new Error(firstErr || '图的语法有问题');
          }
        }
        const r = await m.render(`mm${id}${Date.now().toString(36)}`, src);
        if (alive) setSvg(r.svg);
      })
      .catch((e: unknown) => alive && setErr((e as Error).message || '渲染失败'));
    return () => {
      alive = false;
    };
  }, [code, id]);
  if (err) {
    const where = /line (\d+)/.exec(err)?.[1];
    return <CodeBlock lang="mermaid" code={code} note={`图的语法有错${where ? `（第 ${where} 行）` : ''}，显示源码`} />;
  }
  if (!svg) return <div className="mermaid loading">正在画图…</div>;
  return (
    <div className="mermaid">
      <div className="mm-svg" dangerouslySetInnerHTML={{ __html: svg }} onClick={() => openPreview({ kind: 'svg', svg, title: '图', source: code })} title="点击放大" />
      <button className="mm-open" title="放大查看" onClick={() => openPreview({ kind: 'svg', svg, title: '图', source: code })}>
        ⤢
      </button>
    </div>
  );
}

function Table({ rows, bots, files }: { rows: string[]; bots: Bot[]; files?: FileRef[] }) {
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return (
    <div className="md-table">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{renderInline(h, bots, files)}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{head.map((_, j) => <td key={j}>{renderInline(r[j] ?? '', bots, files)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Markdown for chat bubbles and skill docs: fenced code (```mermaid renders as a diagram), tables, headings,
 * bullet / numbered lists, quotes, links (open in a new tab), images, inline code, bold, @mentions.
 */
export function renderText(text: string, bots: Bot[], files?: FileRef[]) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let listKind: 'ul' | 'ol' = 'ul';
  const flush = () => {
    if (list.length) blocks.push(listKind === 'ul' ? <ul className="md-list" key={`l${blocks.length}`}>{list}</ul> : <ol className="md-list" key={`l${blocks.length}`}>{list}</ol>);
    list = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
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
      flush();
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) rows.push(lines[j++]);
      blocks.push(<Table rows={rows} bots={bots} files={files} key={`t${i}`} />);
      i = j - 1;
      continue;
    }
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    const oli = /^\s*(\d+)[.、)]\s+(.*)$/.exec(line);
    if (li || (oli && (list.length || (i + 1 < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i + 1]))))) {
      const kind = li ? 'ul' : 'ol';
      if (list.length && kind !== listKind) flush();
      listKind = kind;
      list.push(<li key={i}>{renderInline(li ? li[1] : oli![2], bots, files)}</li>);
      continue;
    }
    flush();
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div className="md-h" key={i}>{renderInline(h[1], bots, files)}</div>);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push(<blockquote className="md-q" key={i}>{renderInline(q[1], bots, files)}</blockquote>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr className="md-hr" key={i} />);
      continue;
    }
    if (line === '') {
      if (blocks.length) blocks.push(<div className="md-gap" key={i} />);
      continue;
    }
    blocks.push(<div key={i}>{renderInline(line, bots, files)}</div>);
  }
  flush();
  return blocks.length === 1 ? blocks[0] : blocks;
}

/** Markdown block, shared by chat bubbles and skill documents. */
export function Markdown({ text, bots = [] }: { text: string; bots?: Bot[] }) {
  return <div className="md">{renderText(text, bots)}</div>;
}
