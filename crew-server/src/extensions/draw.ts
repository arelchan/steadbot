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
 * through the same key, so picking "照片" or "矢量" is picking a model, not adding a credential.
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
        label: '画图',
        description: `画一张图，存进你的工作区，返回路径。写清画面内容、风格、构图、配色，越具体越像你要的；不要只写一个词。要一套图就在同一轮里并发调多次 draw（一次最多 ${DRAW_AT_ONCE} 个），它们同时画，比一张画完再画下一张快好几倍。style 选画什么：${styles}。quality 选要多好：${tiers}——不确定就不填，默认${DEFAULT_TIER}。refs 传你工作区里已有的图片路径当参考，用来锁角色、锁风格，或在一张图的基础上改。用于：PPT 和报告的配图、示意图、游戏素材、海报、头像、任何「光有文字不好看」的地方。`,
        promptSnippet: `画图存进工作区：draw(prompt, style?, refs?)；一套图就同一轮并发调多次，一次最多 ${DRAW_AT_ONCE} 张`,
        promptGuidelines: [
          '视觉交付（PPT、报告、网页、海报、游戏）里凡是该有图的地方就画，不要用色块、emoji、表格凑数。',
          '档位：默认 标准，它又便宜又好，绝大多数图用它。封面、主视觉、用户会盯着看、细节复杂的图用 精（同价，模型更强）。用户明确说「画好点」「要精致」「用最好的模型」就上 精；说「随便来一张」「先占个位」「快点」才用 快——快只快一倍多，反而更贵，别拿它省钱。',
          `要好几张图（多页配图、一组素材、几个备选）就在同一轮里一口气并发调多次 draw，一次最多 ${DRAW_AT_ONCE} 张；超过就分两轮。一张一张画会让用户白等好几倍的时间。`,
          'prompt 写画面本身：画什么、什么风格、什么构图、什么配色、什么背景。不要写「一张好看的图」这类空话；不需要文字的图就明确写「不要出现任何文字」，模型写的字大多是错的。并发时每一个 prompt 都要单独写足，不要后面几张越写越敷衍。',
          '并发一批图靠文字统一风格：把同一段风格描述（画风、主色、构图习惯、背景处理）原样抄进每一个 prompt。只有要锁死同一个角色、同一张底图时才用 refs——那种情况先单独画第一张，再把它当 refs 并发画其余的。',
          '画完自己 see 一眼再用：构图不对、多了手指、文字乱码都很常见。不满意就改 prompt 重画，别把第一张直接交出去。一批图里只有某几张不行，就只重画那几张。',
          '要透明底（游戏素材、贴纸）就在 prompt 里写清楚，出来还有底色就用 bash 跑 rembg 抠一次。',
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: '画什么：内容、风格、构图、配色、背景，一段话写清楚' }),
          style: Type.Optional(StringEnum(Object.keys(DRAW_STYLES) as [string, ...string[]], { description: '画什么类型的图，默认插画' })),
          quality: Type.Optional(StringEnum(DRAW_TIERS as [string, ...string[]], { description: `要多好，默认${DEFAULT_TIER}` })),
          refs: Type.Optional(Type.Array(Type.String({ description: '工作区里的图片路径' }), { description: '参考图，最多 4 张：锁角色、锁风格，或在这张图基础上改' })),
          path: Type.Optional(Type.String({ description: '存到哪，工作区里的相对路径，如 images/hero.png；不写自动放 workspace/images/ 下' })),
        }),
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const inside = (rel: string) => {
            const f = isAbsolute(rel) ? rel : join(botDir, rel);
            if (!f.startsWith(config.botsDir) && !f.startsWith(config.sharedDir)) throw new Error('只能读写你自己工作区里的文件');
            return f;
          };
          const refs = (p.refs ?? []).slice(0, 4).map((r) => {
            const f = inside(r);
            if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`参考图不存在：${r}`);
            const mime = IMAGE_MIME[extname(f).toLowerCase()];
            if (!mime) throw new Error(`参考图得是 png / jpg / gif / webp：${r}`);
            return imageContent(f, mime);
          });

          const drawn = await drawImage(p.prompt, refs, p.style, p.quality as DrawTier | undefined);
          const first = drawn[0];
          const wanted = p.path?.trim();
          const file = wanted ? inside(wanted) : join(botDir, 'workspace', 'images', `${slug(p.prompt)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${extFor(first.mimeType)}`);
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, Buffer.from(first.data, 'base64'));
          const rel = relative(botDir, file);
          return {
            content: [{ type: 'text', text: `画好了：${rel}\n先 see("${rel}") 看一眼对不对，再决定用不用。回复里写上这个路径，用户就能看到图。` }],
            details: { path: rel, style: p.style ?? '插画', quality: p.quality ?? DEFAULT_TIER, refs: (p.refs ?? []).length },
          };
        },
      });
    },
  };
}
