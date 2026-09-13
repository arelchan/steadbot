import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, extname } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { fileRefFor, fileRoots } from '../util.ts';
import { IM_NAME } from '../channels.ts';
import type { FileRef } from '../types.ts';

const Params = Type.Object({
  paths: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 12,
    description: 'the file to hand over. A directory works too and the system picks from it; workspace-relative or absolute paths are both fine',
  }),
  what: Type.Optional(Type.String({ description: 'one line saying what this is; the user sees it' })),
});

/** What goes out first: things that can be opened and looked at, then the raw material. */
const RANK = ['.html', '.pdf', '.pptx', '.docx', '.xlsx', '.md', '.csv', '.png', '.jpg', '.jpeg'];
const rankOf = (p: string) => {
  const i = RANK.indexOf(extname(p).toLowerCase());
  return i < 0 ? RANK.length : i;
};

/** Files in a directory, one level only — good enough, because the entry point of a deliverable is at the top. */
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((n) => join(dir, n))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Delivery: actually putting what was made into the user's hands.
 *
 * It exists because "which machine the thing is on" and "where the user is" are often not the same place. A bot on
 * a cloud machine serves a localhost:8899 the user can never open, and a path in its reply is only its own path.
 * This turns a file into a card the user can open, and tells the model honestly what this turn's channel can
 * actually receive — a messenger that cannot take files means saying it differently, not leaving the user with a
 * link that does not work.
 */
export function deliverExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-deliver',
    factory: (pi) => {
      pi.registerTool({
        name: 'deliver',
        label: 'Deliver',
        description:
          'Hand what you made to the user: give it a path (a directory works too) and a card they can open appears on their side. Use it whenever you finish something. Do not just write a path or a link in your reply — that is a path on your machine, and they cannot open it.',
        promptSnippet: 'hand a finished file to the user (a card they can open)',
        promptGuidelines: [
          'Produced a file, deliver once: pages, decks, reports, graphics, spreadsheets, scripts. Say what it is in your reply as usual, but the actual handing over is deliver\'s job.',
          '**Never give the user a localhost / 127.0.0.1 link** — that is an address on the machine you run on, and their browser cannot open it. To show them a page, deliver the .html file.',
          'Give everything that belongs together in one go (the entry file plus whatever they will edit or use), not one message per file. Raw material — a dozen intermediate images — does not all need handing over; give the finished thing.',
          'The tool tells you whether this turn\'s channel can receive files. When it cannot, do not claim you sent it — say it the way the tool suggests.',
        ],
        parameters: Params,
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const roots = fileRoots(p.paths.join(' '), botDir);
          const picked: string[] = [];
          const missing: string[] = [];
          let trimmed = 0;
          for (const raw of p.paths) {
            const one = raw.replace(/^~\//, `${process.env.HOME ?? ''}/`).trim();
            const abs = isAbsolute(one) ? normalize(one) : (roots.map((d) => normalize(join(d, one.replace(/^\.\//, '')))).find((x) => existsSync(x)) ?? '');
            if (!abs) {
              missing.push(raw);
              continue;
            }
            let st;
            try {
              st = statSync(abs);
            } catch {
              missing.push(raw);
              continue;
            }
            if (st.isDirectory()) {
              // From a directory, take only what can be opened: css, js and intermediates are plumbing, not deliverables. Only if none qualify does everything go.
              const inside = filesIn(abs);
              const openable = inside.filter((f) => rankOf(f) < RANK.length);
              const use = openable.length ? openable : inside;
              picked.push(...use.slice(0, 8));
              trimmed += Math.max(0, use.length - 8);
            } else picked.push(abs);
          }
          const files: FileRef[] = [];
          for (const abs of picked) {
            if (files.length >= 8) {
              trimmed++;
              continue;
            }
            const ref = fileRefFor(abs, botDir, c.botId);
            if (ref && !files.some((f) => f.path === ref.path)) files.push(ref);
          }
          if (!files.length) throw new Error(`nothing deliverable at: ${(missing.length ? missing : p.paths).join(', ')}. Check the file was actually written, and write the path relative to the workspace.`);

          const cur = c.current();
          if (cur) cur.files = [...(cur.files ?? []), ...files.filter((f) => !(cur.files ?? []).some((x) => x.path === f.path))];

          const names = files.map((f) => f.name).join('、');
          const via = cur?.via;
          const im = via && via !== 'app' ? (IM_NAME[via] ?? via) : undefined;
          const where = im
            ? `This turn came from ${im}, which cannot receive files: the card is only in the App. Say what it is in your reply and point them to the App.`
            : 'The user sees a card in the App and can open it.';
          const notes = [
            missing.length ? `Not found: ${missing.join(', ')}.` : '',
            trimmed ? `${trimmed} more did not fit (eight at a time); deliver again if they are wanted.` : '',
            config.authToken ? 'Remember the machine you run on is not the user\'s computer: no localhost links.' : '',
          ].filter(Boolean);
          return {
            content: [{ type: 'text', text: `Delivered: ${names}. ${where}${notes.length ? ' ' + notes.join(' ') : ''}` }],
            details: { files: files.map((f) => f.path) },
          };
        },
      });
    },
  };
}
