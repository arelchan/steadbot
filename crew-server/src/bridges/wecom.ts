import { createDecipheriv, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';

export interface WecomConfig {
  corpId: string;
  agentId: string;
  secret: string;
  token: string;
  aesKey: string; // EncodingAESKey (43 chars)
}

/**
 * One bot's own 企业微信 self-built app. WeCom pushes messages to a public callback URL
 * (<publicUrl>/wecom/callback/<botId>; GET = URL verification, POST = encrypted message); replies go through the
 * message/send API. Cards are plain text with numbered options; the user answers with the number. Apps cannot
 * join groups, so this is private chat only; the user id is the chat.
 */
export class WecomBridge implements Bridge {
  readonly channel = 'wechat' as const;
  private token: { value: string; exp: number } | undefined;
  private key: Buffer;
  private lastPending = new Map<string, { id: string; options: string[] }>(); // userId -> the card they can answer by number

  constructor(
    readonly botId: string,
    private cfg: WecomConfig,
    private hub: Hub,
  ) {
    this.key = Buffer.from(cfg.aesKey + '=', 'base64');
  }

  async start() {
    // Credentials are checked by fetching a token; the callback URL itself is verified when the user saves it in WeCom.
    await this.accessToken().catch((e) => {
      throw new Error(/40013|invalid corpid/i.test((e as Error).message) ? '企业 ID 不对' : /40001|invalid credential|secret/i.test((e as Error).message) ? 'Secret 不对' : (e as Error).message);
    });
    return { account: undefined };
  }
  stop() {}

  private signature(timestamp: string, nonce: string, encrypt: string) {
    return createHash('sha1').update([this.cfg.token, timestamp, nonce, encrypt].sort().join('')).digest('hex');
  }

  private decrypt(encrypt: string): string {
    const iv = this.key.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
    decipher.setAutoPadding(false);
    let buf = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
    const pad = buf[buf.length - 1];
    buf = buf.subarray(0, buf.length - pad);
    const len = buf.readUInt32BE(16);
    return buf.subarray(20, 20 + len).toString('utf8');
  }

  /** Mounted by the ChannelManager for this bot's callback path. Returns true when the request was handled. */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const sig = q.get('msg_signature') ?? '';
    const ts = q.get('timestamp') ?? '';
    const nonce = q.get('nonce') ?? '';
    if (req.method === 'GET') {
      const echostr = q.get('echostr') ?? '';
      if (this.signature(ts, nonce, echostr) !== sig) {
        res.writeHead(403);
        res.end();
        return true;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(this.decrypt(echostr));
      return true;
    }
    const body = await new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString()));
      req.on('end', () => resolve(b));
    });
    const encrypt = /<Encrypt><!\[CDATA\[(.+?)\]\]><\/Encrypt>/.exec(body)?.[1] ?? '';
    if (!encrypt || this.signature(ts, nonce, encrypt) !== sig) {
      res.writeHead(403);
      res.end();
      return true;
    }
    res.writeHead(200);
    res.end('success');
    const xml = this.decrypt(encrypt);
    const get = (tag: string) => new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`).exec(xml)?.[1];
    if (get('MsgType') !== 'text') return true;
    const user = get('FromUserName') ?? '';
    const text = (get('Content') ?? '').trim();
    if (user && text) this.inbound(user, text);
    return true;
  }

  private inbound(user: string, text: string) {
    // A bare number answers the last card we sent to this user.
    const last = this.lastPending.get(user);
    if (last && /^\d+$/.test(text)) {
      const opt = last.options[Number(text) - 1];
      if (opt) {
        this.lastPending.delete(user);
        this.hub.choice(last.id, opt);
        return;
      }
    }
    this.hub.dm(this.botId, 'wechat', user, text);
  }

  private async accessToken() {
    if (this.token && this.token.exp > Date.now()) return this.token.value;
    const r = (await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.cfg.corpId}&corpsecret=${this.cfg.secret}`).then((x) => x.json())) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!r.access_token) throw new Error(`${r.errcode ?? ''} ${r.errmsg ?? 'unknown'}`.trim());
    this.token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 7200) - 120) * 1000 };
    return r.access_token;
  }

  private async sendText(user: string, text: string) {
    const token = await this.accessToken();
    await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      body: JSON.stringify({ touser: user, msgtype: 'text', agentid: Number(this.cfg.agentId), text: { content: text } }),
    });
  }

  async send(user: string, text: string, pending?: Pending) {
    if (!pending) {
      if (text.trim()) await this.sendText(user, text);
      return;
    }
    this.lastPending.set(user, { id: pending.id, options: pending.options.map((o) => o.id) });
    const lines = [pending.title, pending.detail ?? '', pending.amount ? `¥${pending.amount}` : '', '', ...pending.options.map((o, i) => `${i + 1}. ${o.label}${o.hint ? `（${o.hint}）` : ''}`), '', '回复序号即可。'].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''));
    await this.sendText(user, lines.join('\n'));
  }
}
