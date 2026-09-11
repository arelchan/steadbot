import { randomBytes } from 'node:crypto';
import type { CrewStore } from './store.ts';
import { botThread, type ThreadId } from './types.ts';
import { ILINK_BASE, ilinkHeaders } from './bridges/weixin.ts';
import { qrPng } from './qr.ts';

/**
 * Pairing a bot with 微信: the code goes into the conversation, the user scans it, a token comes back.
 *
 * Unlike every other IM here there is nothing for the user to fill in and nothing for the bot to harvest off a
 * page — Tencent's iLink gateway hands out a QR, and whoever scans it with 微信 is the account the bot then talks
 * to. The token that comes back is the credential; it goes straight into config.json like the rest of them.
 */

const QR_TTL_MS = 5 * 60_000;
const POLL_MS = 1500;
/** The code dies after a couple of minutes; fetch a fresh one a few times before giving the card up. */
const MAX_REFRESH = 3;
const HOW = '用手机上的微信——扫一扫，扫这个码。这张卡要在电脑（或另一块屏）上看，手机对着它扫；在同一部手机上是扫不了自己屏幕的。';

interface Ask {
  id: string;
  botId: string;
  qrcode: string;
  scanUrl: string;
  base: string;
  at: number;
  done?: boolean;
}

interface QrStatus {
  status?: string;
  bot_token?: string;
  baseurl?: string;
  redirect_host?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
}

async function getJson(url: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: ilinkHeaders(), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function fetchQr(base: string): Promise<{ qrcode: string; scanUrl: string }> {
  const d = await getJson(`${base.replace(/\/$/, '')}/ilink/bot/get_bot_qrcode?bot_type=3`);
  const qrcode = String(d.qrcode ?? '');
  if (!qrcode) throw new Error('微信没有给出二维码');
  return { qrcode, scanUrl: String(d.qrcode_img_content || qrcode) };
}

export class WeixinPairing {
  private asks = new Map<string, Ask>();

  constructor(
    private store: CrewStore,
    /** save the token and bring the bridge up */
    private connect: (botId: string, values: Record<string, string>) => Promise<{ ok: boolean; note: string }>,
    private tellBot: (botId: string, text: string) => void,
  ) {}

  /** The picture the card shows. Regenerated per request: the code behind it may have been refreshed. */
  png(id: string): Buffer | undefined {
    const ask = this.asks.get(id);
    if (!ask || ask.done) return undefined;
    return qrPng(ask.scanUrl);
  }

  /** Put a pairing code in the bot's thread and watch for the scan. Returns what to tell the bot. */
  async begin(botId: string, threadId?: ThreadId): Promise<string> {
    for (const [id, a] of this.asks) if (a.botId === botId) (a.done = true), this.asks.delete(id);
    const { qrcode, scanUrl } = await fetchQr(ILINK_BASE);
    const id = randomBytes(6).toString('hex');
    const ask: Ask = { id, botId, qrcode, scanUrl, base: ILINK_BASE, at: Date.now() };
    this.asks.set(id, ask);
    this.store.addMessage({
      threadId: threadId ?? botThread(botId),
      author: 'bot',
      botId,
      text: '用微信扫这个码，扫完我就在你的微信里了。',
      ts: Date.now(),
      card: { type: 'login', askId: id, kind: 'qr', title: '用微信扫一下', how: HOW },
    });
    void this.watch(ask);
    return '二维码卡已经发到对话里了，用户用微信扫一扫就行，扫完系统会告诉你。现在不要追问，先结束这一轮或者去做别的。';
  }

  private async watch(ask: Ask) {
    let refreshed = 0;
    let base = ask.base;
    while (!ask.done && this.asks.has(ask.id)) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let st: QrStatus;
      try {
        st = (await getJson(`${base.replace(/\/$/, '')}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(ask.qrcode)}`)) as QrStatus;
      } catch {
        continue; // a poll that failed says nothing about the scan
      }
      if (st.status === 'confirmed') {
        const token = String(st.bot_token ?? '');
        if (!token) return this.fail(ask, '微信说扫码通过了，却没有给出凭据');
        ask.done = true;
        this.asks.delete(ask.id);
        const values: Record<string, string> = { weixinToken: token };
        if (st.baseurl) values.weixinBase = String(st.baseurl);
        const r = await this.connect(ask.botId, values);
        this.markCard(ask, r.ok ? '扫上了' : `扫上了，但连不上：${r.note}`);
        this.tellBot(
          ask.botId,
          r.ok
            ? '【系统】用户扫码成功，你现在在他的微信里了。跟他说一句在微信里找你怎么找；微信这条只能私聊，而且只能回他发来的消息，你主动开口发不出去。'
            : `【系统】用户扫码成功了，但接不上：${r.note}`,
        );
        return;
      }
      if (st.status === 'scaned_but_redirect' && st.redirect_host) {
        const host = String(st.redirect_host).trim();
        base = /^https?:\/\//.test(host) ? host : `https://${host}`;
        continue;
      }
      if (st.status === 'expired' || Date.now() - ask.at > QR_TTL_MS) {
        if (++refreshed > MAX_REFRESH) return this.fail(ask, '二维码过期了，没等到扫码');
        try {
          const fresh = await fetchQr(ILINK_BASE);
          ask.qrcode = fresh.qrcode;
          ask.scanUrl = fresh.scanUrl;
          ask.at = Date.now();
          base = ILINK_BASE;
        } catch {
          return this.fail(ask, '二维码取不到了');
        }
      }
    }
  }

  private fail(ask: Ask, why: string) {
    ask.done = true;
    this.asks.delete(ask.id);
    this.markCard(ask, why);
    this.tellBot(ask.botId, `【系统】微信扫码没成：${why}。要接的话重新发一张码（build(aspect=channel, action=add, value="微信")）。`);
  }

  private markCard(ask: Ask, note: string) {
    const m = this.store.data.messages.findLast((x) => x.card?.type === 'login' && x.card.askId === ask.id);
    if (m?.card?.type === 'login') this.store.patchMessage(m.id, { card: { ...m.card, done: true, note } });
  }
}
