import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { imageContent } from '../vision.ts';
import { DRAW_STYLES, drawImage, extFor } from '../draw.ts';

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
  return {
    name: 'crew-draw',
    factory: (pi) => {
      pi.registerTool({
        name: 'draw',
        label: '画图',
        description: `画一张图，存进你的工作区，返回路径。写清画面内容、风格、构图、配色，越具体越像你要的；不要只写一个词。style 选一档：${styles}。refs 传你工作区里已有的图片路径当参考，用来锁角色、锁风格，或在一张图的基础上改（同一个角色出现在多张图里、把某张图改成别的配色，都靠它）。用于：PPT 和报告的配图、示意图、游戏素材、海报、头像、任何「光有文字不好看」的地方。`,
        promptSnippet: '画一张图存进工作区：draw(prompt, style?, refs?)；配图、示意图、游戏素材都用它',
        promptGuidelines: [
          '视觉交付（PPT、报告、网页、海报、游戏）里凡是该有图的地方就画，不要用色块、emoji、表格凑数。',
          'prompt 写画面本身：画什么、什么风格、什么构图、什么配色、什么背景。不要写「一张好看的图」这类空话；不需要文字的图就明确写「不要出现任何文字」，模型写的字大多是错的。',
          '同一批图要风格统一：第一张画好后，后面每张都把它放进 refs，或者把同一段风格描述原样带上。',
          '画完自己 see 一眼再用：构图不对、多了手指、文字乱码都很常见。不满意就改 prompt 重画，别把第一张直接交出去。',
          '要透明底（游戏素材、贴纸）就在 prompt 里写清楚，出来还有底色就用 bash 跑 rembg 抠一次。',
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: '画什么：内容、风格、构图、配色、背景，一段话写清楚' }),
          style: Type.Optional(StringEnum(Object.keys(DRAW_STYLES) as [string, ...string[]], { description: '哪一档，默认插画' })),
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

          const drawn = await drawImage(p.prompt, refs, p.style);
          const first = drawn[0];
          const wanted = p.path?.trim();
          const file = wanted ? inside(wanted) : join(botDir, 'workspace', 'images', `${slug(p.prompt)}-${Date.now().toString(36)}.${extFor(first.mimeType)}`);
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, Buffer.from(first.data, 'base64'));
          const rel = relative(botDir, file);
          return {
            content: [{ type: 'text', text: `画好了：${rel}\n先 see("${rel}") 看一眼对不对，再决定用不用。回复里写上这个路径，用户就能看到图。` }],
            details: { path: rel, style: p.style ?? '插画', refs: (p.refs ?? []).length },
          };
        },
      });
    },
  };
}
