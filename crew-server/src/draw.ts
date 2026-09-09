/**
 * Drawing. A bot makes pictures the same way it reads them: one call to a model that can do it, saved as a file in
 * its workspace. Without this, a deck, a report or a game has no imagery at all — the bot falls back to coloured
 * boxes and emoji, which is what "no taste" actually looks like.
 *
 * One key for every style: OpenRouter serves Gemini's image models, FLUX and Recraft through the same interface,
 * so switching style is switching a model id, not adding a credential.
 */
import type { ImageContent, ImagesInputContent } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import { config } from './config.ts';

const images = builtinImagesModels();

/** What the bot asks for → which model draws it. Anything else falls back to the configured image model. */
export const DRAW_STYLES: Record<string, { model?: string; label: string; hint: string }> = {
  插画: { label: '插画 / 图示', hint: '默认。配图、示意图、角色、海报底图；也是唯一支持参考图的一档' },
  照片: { model: 'openrouter/black-forest-labs/flux.2-pro', label: '照片级', hint: '要看起来像拍出来的：产品图、场景照、人物照' },
  矢量: { model: 'openrouter/recraft/recraft-v4.1-vector', label: '矢量 / 图标', hint: '图标、logo、扁平插画；线条干净，放大不糊' },
};

function model(style?: string) {
  const id = (style && DRAW_STYLES[style]?.model) || config.imageModel;
  const [provider] = id.split('/');
  try {
    return images.getModel(provider, id.slice(provider.length + 1)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Whether this installation can draw at all (no image model configured = the tool is not offered). */
export const canDraw = () => !!model();

export interface Drawn {
  data: string;
  mimeType: string;
}

/**
 * One picture from a prompt, optionally with reference images (the same call edits a picture or follows a style,
 * which is how "keep the same character across slides" works — only the models that take image input).
 */
export async function drawImage(prompt: string, refs: ImageContent[] = [], style?: string): Promise<Drawn[]> {
  const m = model(style);
  if (!m) throw new Error('这套 bot 没有配画图模型（imageModel），画不了。');
  if (refs.length && !m.input?.includes('image')) throw new Error(`「${style}」这一档不吃参考图，去掉 refs 或换成「插画」。`);
  const input: ImagesInputContent[] = [{ type: 'text', text: prompt }, ...refs];
  const result = await images.generateImages(m, { input });
  if (result.stopReason === 'error') throw new Error(result.errorMessage ?? '画图失败');
  const out = result.output.filter((b): b is ImageContent => b.type === 'image');
  if (!out.length) {
    const said = result.output
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    throw new Error(said ? `模型没有出图：${said.slice(0, 200)}` : '模型没有出图');
  }
  return out.map((b) => ({ data: b.data, mimeType: b.mimeType }));
}

/** The vector models answer with SVG; saving that as .png would give the bot a file nothing can open. */
export const extFor = (mime: string) =>
  mime.includes('svg') ? 'svg' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
