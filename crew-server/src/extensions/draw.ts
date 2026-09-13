import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { imageContent } from '../vision.ts';
import { DEFAULT_TIER, DRAW_AT_ONCE, DRAW_STYLES, DRAW_TIERS, TIER_HINT, drawImage, extFor, type DrawTier } from '../draw.ts';

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const slug = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'draw';

/**
 * draw: the other half of `see`. The bot writes what it wants and gets a file in its workspace; every style goes
 * through the same key, so picking "photo" or "vector" is picking a model, not adding a credential.
 */
export function drawExtension(c: BotCtx): InlineExtension {
  const styles = Object.entries(DRAW_STYLES)
    .map(([k, v]) => `${k}（${v.hint}）`)
    .join('；');
  const tiers = DRAW_TIERS.map((t) => `${t}（${TIER_HINT[t]}）`).join('；');
  return {
    name: 'crew-draw',
    factory: (pi) => {
      pi.registerTool({
        name: 'draw',
        label: 'Draw',
        description: `Draw an image, save it into your workspace, and get the path back. Say what is in it, the style, the composition and the colours — the more concrete, the closer it lands. Never a single word. For a set of images, call draw several times in the same turn (up to ${DRAW_AT_ONCE} at once): they draw in parallel, several times faster than one after another. style picks what kind: ${styles}. quality picks how good: ${tiers} — leave it out when unsure and it defaults to ${DEFAULT_TIER}. refs takes paths to images already in your workspace, to hold a character or a style, or to work from an existing picture. For: illustrations in decks and reports, diagrams, game assets, posters, avatars, anywhere text alone looks poor.`,
        promptSnippet: `draw into your workspace: draw(prompt, style?, refs?); for a set, call it several times in one turn, up to ${DRAW_AT_ONCE}`,
        promptGuidelines: [
          'In anything visual (a deck, a report, a page, a poster, a game), draw where a picture belongs. Do not pad it out with coloured blocks, emoji or tables.',
          'Tiers: standard is the default, cheap and good, and right for almost everything. Covers, key visuals, anything the user will stare at or that has fine detail go to fine (same price, stronger model). Take fine when they ask for something better or more polished. Take fast only when they say any old one, a placeholder, or quickly — fast is barely twice the speed and costs more, so it saves nothing.',
          `Several images (illustrations across pages, a set of assets, a few alternatives) means several draw calls in one turn, up to ${DRAW_AT_ONCE}; beyond that, two turns. Drawing them one at a time makes the user wait several times longer for nothing.`,
          'The prompt describes the picture: what is in it, the style, the composition, the colours, the background. Never something empty like "a nice image". When no text belongs in it, say so explicitly — models mostly spell it wrong. When drawing in parallel, write every prompt in full; do not let the later ones get thinner.',
          'A parallel batch is kept consistent with words: copy the same style paragraph (medium, main colours, composition habits, background treatment) verbatim into every prompt. Use refs only to hold one character or one base image — in that case draw the first alone, then use it as refs for the rest in parallel.',
          'see what you drew before using it: wrong composition, extra fingers and garbled text are all common. If it is not right, change the prompt and draw again rather than handing over the first attempt. If only some of a batch are wrong, redraw only those.',
          'For a transparent background (game assets, stickers) say so in the prompt, and if it still comes back with one, run rembg over it in bash.',
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: 'what to draw: content, style, composition, colours, background — one clear paragraph' }),
          style: Type.Optional(StringEnum(Object.keys(DRAW_STYLES) as [string, ...string[]], { description: 'what kind of image; defaults to illustration' })),
          quality: Type.Optional(StringEnum(DRAW_TIERS as [string, ...string[]], { description: `how good; defaults to ${DEFAULT_TIER}` })),
          refs: Type.Optional(Type.Array(Type.String({ description: 'a path to an image in your workspace' }), { description: 'reference images, up to 4: hold a character, hold a style, or work from this picture' })),
          path: Type.Optional(Type.String({ description: 'where to save it, workspace-relative, like images/hero.png; left out, it goes under workspace/images/' })),
        }),
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const inside = (rel: string) => {
            const f = isAbsolute(rel) ? rel : join(botDir, rel);
            if (!f.startsWith(config.botsDir) && !f.startsWith(config.sharedDir)) throw new Error('you can only read and write files in your own workspace');
            return f;
          };
          const refs = (p.refs ?? []).slice(0, 4).map((r) => {
            const f = inside(r);
            if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`no such reference image: ${r}`);
            const mime = IMAGE_MIME[extname(f).toLowerCase()];
            if (!mime) throw new Error(`a reference image has to be png / jpg / gif / webp: ${r}`);
            return imageContent(f, mime);
          });

          const drawn = await drawImage(p.prompt, refs, p.style, p.quality as DrawTier | undefined, c.botId);
          const first = drawn[0];
          const wanted = p.path?.trim();
          const file = wanted ? inside(wanted) : join(botDir, 'workspace', 'images', `${slug(p.prompt)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${extFor(first.mimeType)}`);
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, Buffer.from(first.data, 'base64'));
          const rel = relative(botDir, file);
          return {
            content: [{ type: 'text', text: `Drawn: ${rel}\nsee("${rel}") to check it before using it. Put the path in your reply and the user sees the image.` }],
            details: { path: rel, style: p.style ?? 'illustration', quality: p.quality ?? DEFAULT_TIER, refs: (p.refs ?? []).length },
          };
        },
      });
    },
  };
}
