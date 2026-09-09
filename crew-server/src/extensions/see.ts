import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { imageContent, look, type Eyes } from '../vision.ts';

/**
 * see: one way in for every kind of file a user sends. Pictures go to a vision model (vision.ts); PDFs, decks,
 * documents and sheets are read as text by scripts/extract.py; a PDF or a deck that turns out to be pictures of
 * pages is rendered and looked at instead. The bot never has to know which of those applies.
 */
const IMAGE = /^\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
const CONVERTIBLE = /^\.(pptx?|docx?|odp|odt|rtf)$/i;
const MAX_PAGES = 12;

const run = (cmd: string, args: string[], timeout = 120_000) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr?.toString().trim() || err.message)) : resolve(stdout.toString()),
    );
  });

export function seeExtension(c: BotCtx, eyes: () => Eyes | undefined): InlineExtension {
  return {
    name: 'crew-see',
    factory: (pi) => {
      pi.registerTool({
        name: 'see',
        label: '看文件',
        description:
          '把一个文件读成文字：图片（截图、照片、图表）交给一个能看图的模型描述出来；PDF、PPT、Word、Excel、CSV、纯文本直接抽成文字；扫描件和整页是图的 PPT/PDF 会自动按页渲染再看。用户发来的附件、你自己下载或生成的文件都可以。question 写你想知道什么（「这张报错截图里写了什么」「这份 PPT 第 3 页的数字」），不写就给完整描述。',
        promptSnippet: '看一个文件（图片、PDF、PPT、Word、Excel、CSV…）：see(path, question)',
        promptGuidelines: [
          '用户发来图片、截图、PDF、PPT、Word、Excel 时，先 see 一下再回答，不要问「你能描述一下吗」。',
          'see 之后你拿到的是文字，不是图；要引用具体数字或原文，就在 question 里说清楚要哪一部分，一次问全。',
          '大表格、要计算、要改文件，还是用 bash + python；see 是用来「看懂」的，不是用来处理数据的。',
        ],
        parameters: Type.Object({
          path: Type.String({ description: '文件路径：工作区里的相对路径，或完整路径' }),
          question: Type.Optional(Type.String({ description: '你想从这个文件里知道什么；留空就给完整描述' })),
        }),
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const file = isAbsolute(p.path) ? p.path : join(botDir, p.path);
          if (!file.startsWith(config.botsDir) && !file.startsWith(config.sharedDir)) throw new Error('只能看你自己工作区里的文件');
          if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`没有这个文件：${p.path}`);
          const ext = extname(file).toLowerCase();
          const text = (t: string, how: string) => ({ content: [{ type: 'text' as const, text: t }], details: { how, file: p.path } });

          if (IMAGE.test(ext)) {
            const e = eyes();
            if (!e) throw new Error('这套 bot 没有配能看图的模型（设置 visionModel），暂时看不了图片。');
            return text(await look(e, [imageContent(file, `image/${ext.slice(1)}`)], p.question), 'vision');
          }

          // Decks and documents become a PDF first, so that "render the pages" works for them too.
          let pdfPath = file;
          let cleanup: string | undefined;
          if (CONVERTIBLE.test(ext)) {
            const extracted = await extract(file);
            if (extracted.kind !== 'error' && extracted.text.trim().length > 80) return text(await answer(extracted.text, p.question, eyes()), extracted.kind);
            const { officeBinary, officeToPdf } = await import('../office.ts');
            if (!officeBinary()) throw new Error('这台机器上没装 LibreOffice，这类文件读不出来；用 bash + python 试试。');
            pdfPath = await officeToPdf(file);
          }

          if (extname(pdfPath).toLowerCase() === '.pdf') {
            const doc = await extract(pdfPath);
            if (doc.kind === 'error') throw new Error(doc.note ?? '读不出来');
            if (!doc.thin && doc.text.trim().length > 80) return text(await answer(doc.text, p.question, eyes()), 'pdf');
            // No text layer: it is a scan or a deck of pictures, so look at the pages.
            const e = eyes();
            if (!e) throw new Error('这份文件里没有文字层（扫描件或整页是图），需要一个能看图的模型才能读，但没配 visionModel。');
            const dir = mkdtempSync(join(tmpdir(), 'crew-see-'));
            cleanup = dir;
            try {
              await run('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', String(MAX_PAGES), pdfPath, join(dir, 'p')]);
              const pages = readdirSync(dir).filter((n) => n.endsWith('.png')).sort();
              if (!pages.length) throw new Error('页面渲染不出来');
              const images = pages.map((n) => imageContent(join(dir, n), 'image/png'));
              const note = doc.pages && doc.pages > MAX_PAGES ? `\n\n（共 ${doc.pages} 页，只看了前 ${MAX_PAGES} 页。）` : '';
              return text((await look(e, images, p.question, `这是一份 ${pages.length} 页的文件，按顺序给你。`)) + note, 'pages');
            } finally {
              if (cleanup) rmSync(cleanup, { recursive: true, force: true });
            }
          }

          const got = await extract(file);
          if (got.kind === 'error' || (got.kind === 'binary' && !got.text)) throw new Error(got.note ?? '这个格式读不出来，用 bash 试试');
          return text(await answer(got.text, p.question, eyes()), got.kind);
        },
      });
    },
  };
}

interface Extracted {
  kind: string;
  text: string;
  pages?: number;
  thin?: boolean;
  note?: string;
}

/** scripts/extract.py: text out of a PDF, deck, document, sheet or plain file. */
async function extract(file: string): Promise<Extracted> {
  const script = join(fileURLToPath(new URL('../..', import.meta.url)), 'scripts', 'extract.py');
  try {
    const out = await run('python3', [script, file], 90_000);
    return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Extracted;
  } catch (e) {
    return { kind: 'error', text: '', note: (e as Error).message };
  }
}

/**
 * The extracted text, answered. Short files go back whole (the bot reads them itself); a long one with a question
 * is boiled down first so the answer does not cost the bot its whole context.
 */
async function answer(body: string, question: string | undefined, eyes: Eyes | undefined): Promise<string> {
  if (!question?.trim() || body.length < 6000 || !eyes) return body;
  const res = await eyes.runtime.completeSimple(eyes.model, {
    systemPrompt: '你在帮另一个 agent 从一份文件里找答案。只根据文件内容回答，原样引用关键数字和文字；文件里没有就说没有。不要客套。',
    messages: [{ role: 'user', content: `问题：${question}\n\n文件内容：\n${body.slice(0, 120_000)}`, timestamp: Date.now() }],
  });
  return res.content
    .map((x) => (x.type === 'text' ? x.text : ''))
    .join('')
    .trim();
}
