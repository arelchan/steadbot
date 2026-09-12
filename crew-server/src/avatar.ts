import { recordImages } from './meter.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import { config } from './config.ts';
import type { Bot } from './types.ts';
import { proceduralAvatar } from './util.ts';
import { drawKey, model as drawModel, type DrawTier } from './draw.ts';

/** Which tier a face is drawn at: see the note at AvatarService.generate. */
const AVATAR_TIER: DrawTier = '标准';

/**
 * Avatar generation through pi-ai's image surface (`ImagesModels.generateImages`, one-shot,
 * auth via the provider's product key). Falls back to the deterministic cartoon when no image
 * provider is configured or the call fails, so a bot always has a face immediately.
 */
export class AvatarService {
  private images = builtinImagesModels();

  available(): boolean {
    return !!drawModel('插画', AVATAR_TIER) && !!drawKey();
  }

  prompt(bot: Bot) {
    // The image goes into a 34px circle: the subject must fill the frame. Models otherwise draw a small circle
    // inside a square with margins, and lift brand names / UI out of the role text — both look broken once cropped.
    const duty = bot.role
      .split(/[。\n]/)[0]
      .replace(/[A-Za-z0-9_.@/-]{2,}/g, '')
      .replace(/\s+/g, '')
      .slice(0, 24);
    return [
      `扁平插画风格的角色头像，Q版，暖色纯色背景。`,
      `角色是「${bot.name}」${duty ? `，负责${duty}` : ''}，友善表情。`,
      bot.avatarLook ? `外观要求：${bot.avatarLook}。` : '',
      `构图：头部与肩部特写，正面居中，主体占满整个画面（至少八成），顶部和两侧不要留空白。`,
      `严格禁止：任何文字、字母、数字、logo、品牌标识、界面或屏幕截图；不要画圆形边框、圆环、相框或白色留白边；不要把角色缩小放在画面中央。`,
    ].join('');
  }

  /** Returns the bot's avatar: a server path (/avatars/<id>.png) when generated, else an SVG data URI. The path is
   *  relative on purpose: the client loads it from whichever server it is talking to, with that server's token, so
   *  avatars survive a move to another machine and work behind the token gate. */
  async generate(bot: Bot, seed: string): Promise<string> {
    if (!this.available()) return proceduralAvatar(seed);
    // 标准, not 快: the fast illustration model is 4.7× the price for 2.4× the speed, and nobody is watching a
    // face get drawn in the background (draw.ts has the measurements).
    const model = drawModel('插画', AVATAR_TIER);
    if (!model) return proceduralAvatar(seed);
    try {
      const result = await this.images.generateImages(model, { input: [{ type: 'text', text: this.prompt(bot) }] }, { apiKey: drawKey() });
      recordImages('draw', bot.id, `${model.provider}/${model.id}`, 1, result.usage);
      const img = result.output.find((b) => b.type === 'image');
      if (result.stopReason === 'error' || !img || img.type !== 'image') return proceduralAvatar(seed);
      const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
      const file = join(config.avatarsDir, `${bot.id}.${ext}`);
      writeFileSync(file, Buffer.from(img.data, 'base64'));
      return `/avatars/${bot.id}.${ext}?v=${Date.now()}`;
    } catch (e) {
      console.warn('[crew] avatar generation failed, using placeholder:', (e as Error).message);
      return proceduralAvatar(seed);
    }
  }
}
