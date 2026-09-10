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
const GIVE_UP_MS = 10 * 60_000;

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
    await this.desktops.readPage(o.match, async (p) => p.title());
    const id = randomBytes(6).toString('hex');
    const ask: LoginAsk = { id, botId: o.botId, threadId: o.threadId, kind: o.kind, match: o.match, selector: o.selector, fields: o.fields, at: Date.now() };
    this.asks.set(id, ask);
    const title = o.title ?? (o.kind === 'qr' ? '扫一下这个码' : '登录一下');
    this.store.addMessage({
      threadId: o.threadId,
      author: 'bot',
      botId: o.botId,
      text: o.note ?? (o.kind === 'qr' ? '要登录才能往下做，用手机扫这个码就行。' : '要登录才能往下做，填在卡上，我看不到内容。'),
      ts: Date.now(),
      card:
        o.kind === 'qr'
          ? { type: 'login', askId: id, kind: 'qr', title }
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
      ? '二维码卡已经发到对话里了，码是实时的（会自己刷新），用户扫完系统会告诉你。现在不要追问、也不要自己去点屏幕，先结束这一轮或者去做别的。'
      : '登录卡已经发到对话里了，用户填的账号密码由系统直接打进页面，不经过你、也不会存下来。填完系统会告诉你。现在不要追问，先做别的。';
  }

  /** The current picture of what has to be scanned. Cropped to the element when the bot named one. */
  async shot(id: string): Promise<Buffer> {
    const ask = this.asks.get(id);
    if (!ask) throw new Error('这张卡已经过期了');
    return this.desktops.readPage(ask.match, async (page) => {
      if (ask.selector) {
        const el = page.locator(ask.selector).first();
        if (await el.count()) return Buffer.from(await el.screenshot({ type: 'png' }));
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
      this.markDone(ask, '等超时了');
      this.asks.delete(ask.id);
      this.tellBot(ask.botId, '【系统】登录卡等了十分钟没有等到登录成功。看一眼页面现在是什么样子，再决定是重新发一张卡还是换条路。');
    }
  }

  private markDone(ask: LoginAsk, why?: string) {
    const m = this.store.data.messages.findLast((x) => x.card?.type === 'login' && x.card.askId === ask.id);
    // The card outlives the thing it points at: once the ask is gone the image endpoint has nothing to serve, so
    // the card has to stop being a live code and say what happened instead.
    if (m?.card?.type === 'login') this.store.patchMessage(m.id, { card: { ...m.card, done: true, note: why } });
  }
}
