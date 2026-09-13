import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { authLabel } from '../library.ts';

/**
 * library: the pool's catalogue — manuals, external tool sets, asset packs. Read-only on purpose: finding a thing,
 * using it once, and becoming a bot that carries it are three different acts. The first is this tool's, the second
 * is `read` on the manual's path, and the third is build's (a bot builds itself; nothing else adds to it).
 */
export function libraryExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-library',
    factory: (pi) => {
      pi.registerTool({
        name: 'library',
        label: 'Find something ready-made',
        description:
          'The pool: a curated set of ready-made things in three kinds — manuals (a SKILL.md plus the files it references: code analysis and architecture diagrams, review, debugging, testing, documents and spreadsheets and decks, research and writing, data analysis, design…), external tools (connect one and a set of tools appears: MCP servers, or one-click platforms like Gmail, Calendar, GitHub and Notion), and asset packs. action=search finds candidates by keyword, each with a slug, a kind and a description; a manual also carries a path, so you can read it in full without installing anything. action=list shows everything. This is finding, not installing: follow a manual once and be done. Only what is worth carrying gets build(action=add, value=slug). Use it when a task is a kind you are not confident about, when the user asks whether you can do X, and before you write a manual from scratch.',
        promptSnippet: 'find something ready-made (manuals / tools / asset packs): library(search) for candidates, read the manual in full, and build(add) only what is worth keeping',
        promptGuidelines: [
          'A new kind of task starts with library(search). What comes back is candidates, not a list: read the one or two closest manuals to see how it is actually done, and ignore the rest.',
          'Decide after reading: for a one-off, follow the manual and install nothing. When the user has corrected you, when the same kind of task arrives a second time, or when you genuinely needed it to do this well, build(add, value=slug) and carry it.',
          'The test for installing is whether this is a standing part of your job: what you install is in your context every turn and becomes part of who you are. Install what belongs there, however many. Do not install what you will use once — you will find it here again next time.',
          'Tools and asset packs cannot be read without installing: build(add) when you need one this time, and build(remove) when you no longer do.',
          'Once installed, get on with it. Do not announce that you installed something; mention it only if asked.',
        ],
        parameters: Type.Object({
          action: StringEnum(['search', 'list'] as const),
          query: Type.Optional(Type.String({ description: 'search: keywords for the task or ability — architecture diagram / code review / Excel / pixel art / mail' })),
        }),
        async execute(_id, p) {
          const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: { action: p.action, query: p.query } });
          const b = c.bot();
          const mine = new Set(b.skills);
          const connected = new Set(c.store.data.integrations.filter((i) => (b.integrationIds ?? []).includes(i.id) && i.status === 'ok').map((i) => i.name));
          type Hit = ReturnType<CrewOps['librarySearch']>[number];
          const owned = (e: Hit) => ((e.kind ?? 'skill') === 'skill' ? mine.has(e.title) : e.kind === 'mcp' ? connected.has(e.title) : false);
          const detail = (e: Hit) => {
            if ((e.kind ?? 'skill') === 'skill') return e.path ? `  manual: ${e.path} (read it in full)` : '';
            if (e.kind === 'mcp') return `  auth: ${authLabel(e)}${e.mcp?.tools ? `; tools: ${e.mcp.tools}` : ''}`;
            return e.license ? `  licence: ${e.license}` : '';
          };
          const line = (e: Hit) => [`${e.slug} | ${e.kindLabel} | ${e.title} (${e.categoryLabel})${owned(e) ? ' (already yours)' : ''}`, `  ${e.description}`, detail(e)].filter(Boolean).join('\n');
          if (p.action === 'list') {
            const all = ops().librarySearch('', 200);
            const byCat = new Map<string, typeof all>();
            for (const e of all) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
            return text([...byCat.entries()].map(([, es]) => `[${es[0].categoryLabel}]\n${es.map((e) => `- ${e.slug} | ${e.kindLabel}: ${e.title} — ${e.description}${owned(e) ? ' (already yours)' : ''}`).join('\n')}`).join('\n\n'));
          }
          if (!p.query?.trim()) throw new Error('search needs a query');
          // The words rarely line up with the pool's own ("see whether this PR reads all right" against code-review), so this searches by meaning, not only by spelling.
          const hits = await ops().libraryFind(p.query, 8);
          if (!hits.length) return text('Nothing in the pool matches. Try other keywords, or just do the work; when this kind keeps coming back, write your own manual with build(aspect=skill).');
          return text(`${hits.map(line).join('\n')}\n\nRead the closest manual first to see how it is done. Follow it this time; only what is worth keeping gets build(add).`);
        },
      });
    },
  };
}
