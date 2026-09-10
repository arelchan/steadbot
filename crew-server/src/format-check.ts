/**
 * A mechanical read of what the model is about to say, before anyone sees it.
 *
 * Some formats either work or they don't, and the reader is the one who finds out: a mermaid block with a bad
 * header renders as a red error box, a ```json block that does not parse is a lie about being data, an unclosed
 * fence swallows the rest of the message into a grey box. None of that needs a model to notice — it is a parser's
 * job. So the checks here are deterministic and conservative (nothing that the client's own auto-repair already
 * fixes, nothing that depends on taste), and what they find goes back into the bot's own loop as a note: the
 * message is held, the model gets told which line is wrong, and it says it again properly (bots.ts).
 */

export interface FormatProblem {
  /** where it is, in a form the model can find: "mermaid 图（第 2 段）第 4 行" */
  where: string;
  note: string;
}

/** Diagram kinds mermaid actually has. A block that starts with anything else never renders. */
const MERMAID_TYPES =
  /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart-beta|sankey-beta|requirementDiagram|C4Context|block-beta|packet-beta|architecture-beta)\b/;

const ARROWS = /(?:--+>|--+|-\.-+>?|==+>|<--+>|~~~)\s*$/;

/** Quoted text is free to hold anything; only the syntax around it has to balance. */
const unquoted = (line: string) => line.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');

function checkMermaid(code: string): FormatProblem[] {
  const out: FormatProblem[] = [];
  const at = (n: number) => `mermaid 第 ${n} 行`;
  const lines = code.split('\n');
  const body = lines.map((l, i) => ({ l: l.trim(), n: i + 1 })).filter((x) => x.l && !x.l.startsWith('%%'));
  if (!body.length) return [{ where: 'mermaid', note: '块是空的' }];
  if (!MERMAID_TYPES.test(body[0].l)) return [{ where: at(body[0].n), note: `「${body[0].l.slice(0, 24)}」不是 mermaid 的图类型，第一行必须是 flowchart / sequenceDiagram / classDiagram 这类` }];
  if (body.length === 1) return [{ where: 'mermaid', note: '只有图类型，没有任何节点' }];
  for (const { l, n } of body.slice(1)) {
    const bare = unquoted(l);
    if ((bare.match(/"/g)?.length ?? 0) % 2) out.push({ where: at(n), note: '引号没有成对' });
    for (const [open, close, name] of [
      ['[', ']', '方括号'],
      ['{', '}', '花括号'],
      ['(', ')', '圆括号'],
    ] as const) {
      const a = bare.split(open).length - 1;
      const b = bare.split(close).length - 1;
      if (a !== b) out.push({ where: at(n), note: `${name}没有配对（${a} 个 ${open}，${b} 个 ${close}）` });
    }
    if (ARROWS.test(bare)) out.push({ where: at(n), note: '箭头后面没有节点' });
    if (out.length >= 4) break;
  }
  return out;
}

/** Every fenced block in the text, with the line the fence opened on. */
function blocks(text: string): { lang: string; code: string; at: number }[] {
  const out: { lang: string; code: string; at: number }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*```\s*([\w+-]*)\s*$/.exec(lines[i]);
    if (!open) continue;
    const buf: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) buf.push(lines[j++]);
    out.push({ lang: open[1].toLowerCase(), code: buf.join('\n'), at: i + 1 });
    i = j;
  }
  return out;
}

/** What is mechanically wrong with this message. Empty means nothing to say — the common case. */
export function checkFormats(text: string): FormatProblem[] {
  if (!text.includes('```')) return [];
  const fences = (text.match(/^\s*```/gm) ?? []).length;
  if (fences % 2) return [{ where: '代码块', note: '有一个 ``` 没有闭合，后面的正文都被吞进代码块里了' }];
  const out: FormatProblem[] = [];
  for (const b of blocks(text)) {
    if (b.lang === 'mermaid') out.push(...checkMermaid(b.code).map((p) => ({ ...p, where: `${p.where}（正文第 ${b.at} 行开始的那块）` })));
    else if (b.lang === 'json' && b.code.trim()) {
      try {
        JSON.parse(b.code);
      } catch (e) {
        out.push({ where: `json 块（正文第 ${b.at} 行）`, note: `解析不了：${(e as Error).message.slice(0, 80)}` });
      }
    }
    if (out.length >= 5) break;
  }
  return out;
}
