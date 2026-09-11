import { randomUUID } from 'node:crypto';
import type { Bridge, Hub } from './types.ts';

/**
 * One bot's own bot on personal 微信, over Tencent's iLink gateway (ilinkai.weixin.qq.com).
 *
 * This is the same door OpenClaw's Tencent-maintained plugin and other agent harnesses use: a QR the user scans
 * with 微信 pairs a bot to their account, and from then on it is plain HTTP — long-poll for what came in, POST to
 * reply. No public callback URL (so it works from any container), no Windows client, no reverse-engineered
 * protocol, and nothing to pay for.
 *
 * Two shapes of the wire are load-bearing:
 *   - `get_updates_buf` is the cursor. It comes back on every poll and must be echoed on the next one, or messages
 *     repeat.
 *   - every reply must carry the `context_token` that came with the user's last message. There is no way to open a
 *     conversation from this side: the bot can only answer someone who wrote first.
 * 私聊 only — the gateway has no groups.
 */

const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';
const CLIENT_VERSION = '2.1.1';
const MAX_LEN = 4000;
/** iLink says the session is gone; a new QR is the only fix, so stop rather than hammer it. */
const ERR_SESSION_EXPIRED = -14;

const packVersion = (v: string) => {
  const [a = 0, b = 0, c = 0] = v.split('.').map((x) => Number(x) & 0xff);
  return (a << 16) | (b << 8) | c;
};
const CLIENT_VERSION_INT = String(packVersion(CLIENT_VERSION));

/** X-WECHAT-UIN: a fresh random uint32, decimal, base64'd. One per request, as the gateway expects. */
const uin = () => Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64');

export function ilinkHeaders(token = ''): Record<string, string> {
  const h: Record<string, string> = {
    'X-WECHAT-UIN': uin(),
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': CLIENT_VERSION_INT,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export const ILINK_BASE = DEFAULT_BASE;

interface Item {
  type: number;
  text_item?: { text?: string };
  image_item?: unknown;
  voice_item?: unknown;
  file_item?: { file_name?: string };
  video_item?: unknown;
}
interface Msg {
  message_id?: string;
  seq?: number | string;
  message_type?: number;
  from_user_id?: string;
  context_token?: string;
  create_time_ms?: number | string;
  item_list?: Item[];
}

const ITEM_TEXT = 1;
const ITEM_IMAGE = 2;
const ITEM_VOICE = 3;
const ITEM_FILE = 4;
const ITEM_VIDEO = 5;
const FROM_USER = 1;
const FROM_BOT = 2;

export class WeixinBridge implements Bridge {
  readonly channel = 'weixin' as const;
  private running = false;
  private buf = '';
  private pollS = 35;
  private seen = new Set<string>();
  /** the last context_token per peer: without it a reply is refused */
  private ctx = new Map<string, string>();

  constructor(
    readonly botId: string,
    private token: string,
    private hub: Hub,
    private base = DEFAULT_BASE,
    /** told when the pairing dies, so the App can say so instead of going quiet */
    private onExpired?: (note: string) => void,
  ) {}

  private async call(endpoint: string, body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const ctl = AbortSignal.timeout(timeoutMs);
    const r = await fetch(`${this.base.replace(/\/$/, '')}/${endpoint}`, {
      method: 'POST',
      headers: ilinkHeaders(this.token),
      body: JSON.stringify({ base_info: { channel_version: CLIENT_VERSION }, ...body }),
      signal: ctl,
    });
    if (!r.ok) throw new Error(`${endpoint} HTTP ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }

  async start() {
    // getconfig is the cheapest call that proves the token is live; a dead one fails here rather than in silence.
    const cfg = await this.call('ilink/bot/getconfig', {}, 20_000).catch((e: Error) => {
      throw new Error(`连不上微信：${e.message}`);
    });
    const err = Number(cfg.errcode ?? cfg.ret ?? 0);
    if (err === ERR_SESSION_EXPIRED) throw new Error('这张微信扫码登录过期了，要重新扫一次');
    if (err) throw new Error(`微信拒绝了这个登录：errcode ${err}`);
    this.running = true;
    void this.loop();
    const name = (cfg.bot_name as string) || (cfg.nickname as string) || undefined;
    return { account: name };
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    let fails = 0;
    while (this.running) {
      try {
        const data = await this.call('ilink/bot/getupdates', { get_updates_buf: this.buf }, (this.pollS + 15) * 1000);
        const err = Number(data.errcode ?? 0) || Number(data.ret ?? 0);
        if (err === ERR_SESSION_EXPIRED) {
          this.running = false;
          this.onExpired?.('微信那边的登录过期了，要重新扫码');
          return;
        }
        if (err) throw new Error(`getupdates errcode ${err} ${String(data.errmsg ?? '')}`);
        fails = 0;
        const ms = Number(data.longpolling_timeout_ms ?? 0);
        if (ms > 0) this.pollS = Math.max(5, Math.floor(ms / 1000));
        if (typeof data.get_updates_buf === 'string' && data.get_updates_buf) this.buf = data.get_updates_buf;
        for (const m of (data.msgs as Msg[] | undefined) ?? []) this.take(m);
      } catch (e) {
        if (!this.running) return;
        fails++;
        // A long poll that times out is the normal quiet case, not a failure worth backing off for.
        const quiet = (e as Error).name === 'TimeoutError' || /aborted|timeout/i.test((e as Error).message);
        if (!quiet) console.warn('[crew] weixin poll failed:', (e as Error).message);
        await new Promise((r) => setTimeout(r, quiet ? 200 : Math.min(30_000, 2000 * fails)));
      }
    }
  }

  /** One inbound message: text is delivered, the rest is named so the bot knows something arrived. */
  private take(m: Msg) {
    if (m.message_type === FROM_BOT) return;
    const from = m.from_user_id ?? '';
    if (!from) return;
    const id = String(m.message_id ?? m.seq ?? `${from}_${m.create_time_ms ?? ''}`);
    if (!this.hub.first('weixin', id) || this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
    if (m.context_token) this.ctx.set(from, m.context_token);
    const parts: string[] = [];
    for (const it of m.item_list ?? []) {
      if (it.type === ITEM_TEXT && it.text_item?.text) parts.push(it.text_item.text);
      else if (it.type === ITEM_IMAGE) parts.push('【用户发来一张图片，这个渠道还收不了图，请他把内容说一下或改从 App 发】');
      else if (it.type === ITEM_VOICE) parts.push('【用户发来一段语音，这个渠道还收不了语音，请他打字】');
      else if (it.type === ITEM_VIDEO) parts.push('【用户发来一段视频，这个渠道还收不了视频】');
      else if (it.type === ITEM_FILE) parts.push(`【用户发来一个文件${it.file_item?.file_name ? `：${it.file_item.file_name}` : ''}，这个渠道还收不了文件，请他从 App 发】`);
    }
    const text = parts.join('\n').trim();
    if (!text) return;
    this.hub.register('weixin', from, this.botId);
    this.hub.dm(this.botId, 'weixin', from, text);
  }

  async send(target: string, text: string) {
    const ctx = this.ctx.get(target);
    // Not an error worth throwing: it means the user has not written yet (or this process restarted), and there is
    // nothing the bot can do about it from here.
    if (!ctx) throw new Error('微信只能回复用户发来的消息，现在没有可回复的会话；等他先说一句');
    for (const chunk of split(text, MAX_LEN)) {
      const data = await this.call(
        'ilink/bot/sendmessage',
        {
          msg: {
            from_user_id: '',
            to_user_id: target,
            client_id: `everbot-${randomUUID().slice(0, 12)}`,
            message_type: FROM_BOT,
            message_state: 2,
            context_token: ctx,
            item_list: [{ type: ITEM_TEXT, text_item: { text: chunk } }],
          },
        },
        30_000,
      );
      const err = Number(data.errcode ?? 0) || Number(data.ret ?? 0);
      if (err) throw new Error(`微信没发出去：errcode ${err} ${String(data.errmsg ?? '')}`);
    }
  }
}

/** Cut on line breaks where possible: the gateway takes 4000 characters at a time. */
function split(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    if (line.length > max) {
      if (cur) out.push(cur), (cur = '');
      for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
      continue;
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}
