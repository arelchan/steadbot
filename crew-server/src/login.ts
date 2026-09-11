import { randomBytes } from 'node:crypto';
import type { CrewStore } from './store.ts';
import type { DesktopManager } from './desktop.ts';
import type { ThreadId } from './types.ts';

/**
 * The login wall, brought to where the user already is.
 *
 * A bot driving the shared computer gets stopped by the same two things every time: a QR code to scan, or a
 * password to type. Both used to mean "open the computer, the screen is yours" — the user has to find the panel,
 * wait for the frame, scan a code that is 300 px wide inside a scaled-down screenshot. So instead the page comes to
 * the conversation: the QR is cropped out of the live page and posted as a card that refreshes itself (the codes
 * expire in under a minute, so a still would be useless), and a password is a card the server types into the page
 * — the value goes from the card to the browser and is not stored, not logged, and never in the model's context.
 *
 * Success is not something the bot has to ask about: the same element is watched until it is gone, and the bot's
 * own loop is told to carry on.
 */

export interface LoginAsk {
  id: string;
  botId: string;
  threadId: ThreadId;
  kind: 'qr' | 'password';
  /** which tab of the shared browser: a piece of its url or title */
  match: { url?: string; title?: string };
  /** qr: the element to crop. password: the field to watch for going away. */
  selector?: string;
  fields?: { account?: string; password: string; submit?: string };
  at: number;
  done?: boolean;
}

const POLL_MS = 3000;
const GIVE_UP_MS = 30 * 60_000;

/**
 * How the code on the card is actually scanned, per site.
 *
 * Every IM's login QR carries a deep link that only its own app will act on, and each of them refuses a scan that
 * did not come from its own scanner — Telegram answers a camera scan with "go to Settings > Devices > Add Device"
 * and nothing else. So "扫一下" is never enough, the path differs per platform, and the model guesses it wrong
 * (it told the user twice that the popup was normal). The card says it instead, from this table.
 */
const HOW: { at: RegExp; how: string }[] = [
  { at: /telegram\./i, how: '手机上打开 Telegram → Settings → Devices → Add Device，用那里的扫码器扫。系统相机扫不了这个码（只会弹一句让你去 Add Device）。' },
  { at: /web\.whatsapp\./i, how: '手机上打开 WhatsApp → 设置 → 已链接的设备 → 链接设备，用那里的扫码器扫。' },
  { at: /feishu\.|larksuite\./i, how: '用手机上的飞书/Lark App——扫一扫，扫这个码。' },
  { at: /wechat\.|weixin\.|qq\.com/i, how: '用手机上的微信——扫一扫，扫这个码。' },
  { at: /slack\./i, how: '用手机上的 Slack App 里的扫码入口扫。' },
];
const howFor = (url: string) => HOW.find((h) => h.at.test(url))?.how;
/** The card is scanned by a phone, so it has to be on some other screen than that phone. */
const TWO_SCREENS = '这张卡要在电脑（或另一块屏）上看，手机对着它扫；在同一部手机上是扫不了自己屏幕的。';

export class LoginDesk {
  private asks = new Map<string, LoginAsk>();

  constructor(
    private store: CrewStore,
    private desktops: DesktopManager,
    private tellBot: (botId: string, text: string) => void,
  ) {}

  get(id: string) {
    return this.asks.get(id);
  }

  /** Put the login in front of the user and watch the page until it is past it. Returns what to tell the bot. */
  async ask(o: Omit<LoginAsk, 'id' | 'at'> & { note?: string; title?: string }): Promise<string> {
    // Fail here rather than after the card is posted: a card pointing at a tab that is not there is worse than a no.
    const at = await this.desktops.readPage(o.match, async (p) => p.url());
    const id = randomBytes(6).toString('hex');
    const ask: LoginAsk = { id, botId: o.botId, threadId: o.threadId, kind: o.kind, match: o.match, selector: o.selector, fields: o.fields, at: Date.now() };
    this.asks.set(id, ask);
    const title = o.title ?? (o.kind === 'qr' ? '扫一下这个码' : '登录一下');
    const how = o.kind === 'qr' ? [howFor(at), TWO_SCREENS].filter(Boolean).join('') : undefined;
    this.store.addMessage({
      threadId: o.threadId,
      author: 'bot',
      botId: o.botId,
      text: o.note ?? (o.kind === 'qr' ? '要登录才能往下做，用手机扫这个码就行。' : '要登录才能往下做，填在卡上，我看不到内容。'),
      ts: Date.now(),
      card:
        o.kind === 'qr'
          ? { type: 'login', askId: id, kind: 'qr', title, how }
          : {
              type: 'login',
              askId: id,
              kind: 'password',
              title,
              fields: [...(o.fields?.account ? [{ key: 'account', label: '账号', secret: false }] : []), { key: 'password', label: '密码', secret: true }],
            },
    });
    void this.watch(ask);
    return o.kind === 'qr'
      ? `二维码卡已经发到对话里了，码是实时的（会自己刷新），用户扫完系统会告诉你。卡上已经写了该怎么扫（${how ?? TWO_SCREENS}）——你不要再自己编一套扫码步骤，也不要向用户要手机号、验证码或登录码。现在不要追问、也不要自己去点屏幕，先结束这一轮或者去做别的。`
      : '登录卡已经发到对话里了，用户填的账号密码由系统直接打进页面，不经过你、也不会存下来。填完系统会告诉你。现在不要追问，先做别的。';
  }

  /**
   * The current picture of what has to be scanned. A whole login page is useless on a phone — the code ends up
   * fifty pixels wide in the card — so the crop matters: the element the bot named, else the squarish box that a
   * QR always is, else the page.
   */
  async shot(id: string): Promise<Buffer> {
    const ask = this.asks.get(id);
    if (!ask) throw new Error('这张卡已经过期了');
    return this.desktops.readPage(ask.match, async (page) => {
      const crop = async (sel: string) => {
        const el = page.locator(sel).first();
        if (!(await el.count())) return undefined;
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 100 || box.height < 100) return undefined;
        return Buffer.from(await el.screenshot({ type: 'png' }));
      };
      if (ask.selector) {
        const named = await crop(ask.selector).catch(() => undefined);
        if (named) return named;
      }
      if (ask.kind === 'qr') {
        // A QR is a square, and every site draws it as a canvas, an svg or an image — that is enough to find it.
        const found = await page
          .evaluate(() => {
            const els = Array.from(document.querySelectorAll('canvas, svg, img'));
            const fit = els
              .map((e) => ({ e, r: e.getBoundingClientRect() }))
              .filter(({ r }) => r.width >= 120 && r.width <= 640 && Math.abs(r.width - r.height) / Math.max(r.width, r.height) < 0.2)
              .sort((a, b) => b.r.width - a.r.width)[0];
            if (!fit) return null;
            fit.e.setAttribute('data-everbot-qr', '1');
            return true;
          })
          .catch(() => null);
        if (found) {
          const auto = await crop('[data-everbot-qr="1"]').catch(() => undefined);
          if (auto) return auto;
        }
      }
      return Buffer.from(await page.screenshot({ type: 'png' }));
    });
  }

  /**
   * Type what the user filled into the page and submit. The values are used once, here, and go no further: not to
   * the store, not to the log, not to the bot.
   */
  async fill(id: string, values: Record<string, string>): Promise<void> {
    const ask = this.asks.get(id);
    if (!ask || ask.kind !== 'password') throw new Error('这张卡已经过期了');
    const f = ask.fields;
    if (!f?.password) throw new Error('这张卡没说密码填在哪');
    await this.desktops.readPage(ask.match, async (page) => {
      if (f.account && values.account) await page.locator(f.account).first().fill(values.account);
      await page.locator(f.password).first().fill(values.password ?? '');
      if (f.submit) await page.locator(f.submit).first().click();
      else await page.locator(f.password).first().press('Enter');
    });
  }

  /** Watch the thing the user was asked about until it is gone, then wake the bot. */
  private async watch(ask: LoginAsk) {
    const watched = ask.selector ?? ask.fields?.password;
    const deadline = Date.now() + GIVE_UP_MS;
    while (!ask.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!this.asks.has(ask.id)) return;
      // The page under the card is the bot's own tab, and an idle bot's tab gets closed (desktop.ts). A user
      // fumbling with their phone for twenty minutes is idle by that measure — so an open card counts as use.
      this.desktops.touch(ask.botId);
      const gone = await this.desktops
        .readPage(ask.match, async (page) => (watched ? (await page.locator(watched).first().count()) === 0 : false))
        .catch(() => false);
      if (!gone) continue;
      ask.done = true;
      this.markDone(ask);
      this.tellBot(ask.botId, `【系统】${ask.kind === 'qr' ? '用户扫码登录好了' : '用户填的账号密码已经打进页面并提交了'}，那个标签页已经过了登录这一步。回去接着做，先看一眼当前页面。`);
      this.asks.delete(ask.id);
      return;
    }
    if (!ask.done) {
      this.markDone(ask, '等了半小时，没等到登录成功');
      this.asks.delete(ask.id);
      this.tellBot(ask.botId, '【系统】登录卡等了半小时没有等到登录成功。看一眼页面现在是什么样子，再决定是重新发一张卡还是换条路。');
    }
  }

  private markDone(ask: LoginAsk, why?: string) {
    const m = this.store.data.messages.findLast((x) => x.card?.type === 'login' && x.card.askId === ask.id);
    // The card outlives the thing it points at: once the ask is gone the image endpoint has nothing to serve, so
    // the card has to stop being a live code and say what happened instead.
    if (m?.card?.type === 'login') this.store.patchMessage(m.id, { card: { ...m.card, done: true, ok: !why, note: why } });
  }
}
