import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import type { Bot } from './types.ts';
import { proceduralAvatar } from './util.ts';
import { drawImage, drawKey, model as drawModel, extFor, type DrawTier } from './draw.ts';

/** Which tier a face is drawn at: see the note at AvatarService.generate. */
const AVATAR_TIER: DrawTier = '标准';

/**
 * A face is one `draw` like any other — same model table, same key, same retries, same ledger line — so it also
 * works at whichever vendor the 画图 row is on. Falls back to the deterministic cartoon when there is no image
 * model or the call fails, so a bot always has a face immediately.
 */
export class AvatarService {

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
    try {
      const [img] = await drawImage(this.prompt(bot), [], '插画', AVATAR_TIER, bot.id);
      if (!img) return proceduralAvatar(seed);
      const ext = extFor(img.mimeType);
      const file = join(config.avatarsDir, `${bot.id}.${ext}`);
      writeFileSync(file, Buffer.from(img.data, 'base64'));
      return `/avatars/${bot.id}.${ext}?v=${Date.now()}`;
    } catch (e) {
      console.warn('[crew] avatar generation failed, using placeholder:', (e as Error).message);
      return proceduralAvatar(seed);
    }
  }
}
