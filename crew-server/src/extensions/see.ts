import { noteUsage } from '../meter.ts';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotCtx } from './ctx.ts';
import { config, isCredentialFile, isMemoryFile } from '../config.ts';
import { imageContent, look, type Eyes } from '../vision.ts';

/**
 * see: one way in for every kind of file a user sends. Pictures go to a vision model (vision.ts); PDFs, decks,
 * documents and sheets are read as text by scripts/extract.py; a PDF or a deck that turns out to be pictures of
 * pages is rendered and looked at instead. The bot never has to know which of those applies.
 */
const IMAGE = /^\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
/** Derived from the extension, not guessed: `image/jpg` and `image/tif` are not real types and get rejected. */
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic' };
// svg is here rather than with the pictures: a vision model needs a raster, and LibreOffice draws one.
const CONVERTIBLE = /^\.(pptx?|docx?|odp|odt|rtf|svg)$/i;
/** Slides are layout first: looking at them as pictures is the point, the text is incidental. */
const DECK = /^\.(pptx?|odp)$/i;
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
        label: 'Look at a file',
        description:
          'Look at a file with eyes: images (screenshots, photos, charts) go to a model that can see them; slides are rendered page by page so layout is visible (overflow, overlap, alignment, whitespace); PDF, Word, Excel and CSV are pulled to text by default, or rendered as pages when look=true; scans are always rendered. Any path works. For plain text, read is faster. question says what you want to know ("what does this error screenshot say", "the figures on page 3"); leave it out for a full description.',
        promptSnippet: 'look at a file (images and slides for layout; PDF/Word/Excel to text, look=true for layout): see(path, question?, look?)',
        promptGuidelines: [
          'When the user sends an image, a screenshot, a PDF, slides, Word or Excel, see it before answering. Never ask them to describe it.',
          'What comes back is text, not the image. To quote a number or a line, say in question exactly which part you need — and ask for all of it at once.',
          'Large tables, calculations and edits still go through bash + python. see is for understanding something, not for processing data.',
        ],
        parameters: Type.Object({
          path: Type.String({ description: 'the path: workspace-relative or absolute' }),
          question: Type.Optional(Type.String({ description: 'what you want to know from it; leave empty for a full description' })),
          look: Type.Optional(Type.Boolean({ description: 'look at layout rather than text: files with a text layer (PDF, Word) are rendered page by page too. Slides do this by default and do not need it' })),
        }),
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const file = isAbsolute(p.path) ? p.path : join(botDir, p.path);
          if (isCredentialFile(file)) throw new Error('that is the product credential file; bots do not read it');
          if (isMemoryFile(file)) throw new Error('that is the memory store; it is not looked at as files. Use recall');
          if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`no such file: ${p.path}`);
          const ext = extname(file).toLowerCase();
          const text = (t: string, how: string) => ({ content: [{ type: 'text' as const, text: t }], details: { how, file: p.path } });

          if (IMAGE.test(ext)) {
            const e = eyes();
            if (!e) throw new Error('no model that can see images is configured (visionModel), so images cannot be looked at yet.');
            return text(await look(e, [imageContent(file, IMAGE_MIME[ext] ?? 'image/png')], p.question, undefined, c.botId), 'vision');
          }

          // Decks and documents become a PDF first, so that "render the pages" works for them too. A deck is looked at
          // as pages whenever there is a model that can see; text is what the bot gets when there isn't, or when it
          // asked for a document's words rather than its layout.
          const wantLook = !!eyes() && (p.look === true || DECK.test(ext));
          let pdfPath = file;
          let cleanup: string | undefined;
          if (CONVERTIBLE.test(ext)) {
            if (ext !== '.svg' && !wantLook) {
              const extracted = await extract(file);
              if (extracted.kind !== 'error' && extracted.text.trim().length > 80) return text(await answer(extracted.text, p.question, eyes(), c.botId), extracted.kind);
            }
            const { officeBinary, officeToPdf } = await import('../office.ts');
            if (!officeBinary()) throw new Error('LibreOffice is not installed on this machine, so this kind of file cannot be read; try bash + python.');
            pdfPath = await officeToPdf(file);
          }

          if (extname(pdfPath).toLowerCase() === '.pdf') {
            const doc = await extract(pdfPath);
            if (doc.kind === 'error') throw new Error(doc.note ?? 'could not be read');
            if (!wantLook && !doc.thin && doc.text.trim().length > 80) return text(await answer(doc.text, p.question, eyes(), c.botId), 'pdf');
            // No text layer: it is a scan or a deck of pictures, so look at the pages.
            const e = eyes();
            if (!e) throw new Error('this file has no text layer (a scan, or pages that are images), which needs a model that can see — and visionModel is not configured.');
            const dir = mkdtempSync(join(tmpdir(), 'crew-see-'));
            cleanup = dir;
            try {
              await run('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', String(MAX_PAGES), pdfPath, join(dir, 'p')]);
              const pages = readdirSync(dir).filter((n) => n.endsWith('.png')).sort();
              if (!pages.length) throw new Error('the pages could not be rendered');
              const images = pages.map((n) => imageContent(join(dir, n), 'image/png'));
              const note = doc.pages && doc.pages > MAX_PAGES ? `\n\n(${doc.pages} pages in total; only the first ${MAX_PAGES} were looked at.)` : '';
              const brief = wantLook ? `This is a ${pages.length}-page ${DECK.test(ext) ? 'deck' : 'document'}, in order. Go page by page on layout: text overflowing its container or clipped, elements overlapping, alignment and whitespace even or not, enough contrast, leftover placeholders — then summarise what each page says.` : `This is a ${pages.length}-page document, in order.`;
              return text((await look(e, images, p.question, brief, c.botId)) + note, 'pages');
            } finally {
              if (cleanup) rmSync(cleanup, { recursive: true, force: true });
            }
          }

          const got = await extract(file);
          if (got.kind === 'error' || (got.kind === 'binary' && !got.text)) throw new Error(got.note ?? 'this format cannot be read; try bash');
          return text(await answer(got.text, p.question, eyes(), c.botId), got.kind);
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
async function answer(body: string, question: string | undefined, eyes: Eyes | undefined, who?: string): Promise<string> {
  if (!question?.trim() || body.length < 6000 || !eyes) return body;
  const res = await eyes.runtime.completeSimple(eyes.model, {
    systemPrompt: 'You are helping another agent find an answer in a document. Answer only from its contents, quoting key numbers and wording verbatim; if it is not in there, say so. No pleasantries.',
    messages: [{ role: 'user', content: `Question: ${question}\n\nDocument:\n${body.slice(0, 120_000)}`, timestamp: Date.now() }],
  });
  noteUsage('see', who, res);
  return res.content
    .map((x) => (x.type === 'text' ? x.text : ''))
    .join('')
    .trim();
}
