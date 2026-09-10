import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';
import { toTelegramHtml } from './format.ts';

interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}
interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: TgChat;
    text?: string;
    entities?: { type: string; offset: number; length: number }[];
    reply_to_message?: { from?: { username?: string } };
  };
  callback_query?: { id: string; data?: string; message?: { chat: TgChat } };
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}

/**
 * One bot's own Telegram bot, via long polling (no SDK, no public URL). Its private chat is the bot's thread;
 * a group it is added to becomes a 群聊 shared with our other bots in it. Cards are inline keyboards.
 */
export class TelegramBridge implements Bridge {
  readonly channel = 'telegram' as const;
  private running = false;
  private offset = 0;
  private username: string | undefined;

  constructor(
    readonly botId: string,
    private token: string,
    private hub: Hub,
  ) {}

  private api(method: string, body: unknown) {
    return fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>);
  }

  async start() {
    const me = await this.api('getMe', {}).catch(() => undefined);
    if (!me?.ok) throw new Error(me?.description?.includes('Unauthorized') ? 'Bot Token 不对' : `连不上 Telegram：${me?.description ?? '网络不通'}`);
    const r = me.result as { username?: string; first_name?: string };
    this.username = r.username;
    if (this.username) this.hub.register('telegram', this.username.toLowerCase(), this.botId);
    this.running = true;
    void this.loop();
    return { account: this.username ? `@${this.username}` : r.first_name };
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        const res = await this.api('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
        for (const u of (res.result as TgUpdate[] | undefined) ?? []) {
          this.offset = u.update_id + 1;
          await this.handle(u).catch((e) => console.warn('[crew] telegram update failed:', (e as Error).message));
        }
      } catch (e) {
        console.warn('[crew] telegram poll error:', (e as Error).message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handle(u: TgUpdate) {
    if (u.callback_query?.data?.startsWith('pending:')) {
      const [, pendingId, optionId] = u.callback_query.data.split(':');
      this.hub.choice(pendingId, optionId);
      await this.api('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: '收到' });
      return;
    }
    if (u.my_chat_member) {
      const { chat, new_chat_member } = u.my_chat_member;
      if (chat.type !== 'group' && chat.type !== 'supergroup') return;
      if (['member', 'administrator'].includes(new_chat_member.status)) await this.hub.joined(this.botId, 'telegram', String(chat.id), async () => chat.title);
      else if (['left', 'kicked'].includes(new_chat_member.status)) this.hub.left(this.botId, 'telegram', String(chat.id));
      return;
    }
    const msg = u.message;
    if (!msg?.text) return;
    const chatId = String(msg.chat.id);
    if (msg.chat.type === 'private') return void this.hub.dm(this.botId, 'telegram', chatId, msg.text);
    if (msg.chat.type === 'channel') return;
    // Each of our bots in the group polls its own updates for the same message: the hub takes it once.
    if (!this.hub.first('telegram', `${chatId}:${msg.message_id}`)) return;
    // @username mentions of our bots become @Name for the group router (Telegram offsets are UTF-16, as JS strings are).
    let text = msg.text;
    const ents = (msg.entities ?? []).filter((e) => e.type === 'mention').sort((a, b) => b.offset - a.offset);
    for (const e of ents) {
      const handle = msg.text.slice(e.offset + 1, e.offset + e.length);
      const bot = this.hub.botByIdentity('telegram', handle.toLowerCase());
      if (bot) text = `${text.slice(0, e.offset)}@${bot.name} ${text.slice(e.offset + e.length)}`;
    }
    const replied = msg.reply_to_message?.from?.username;
    const target = replied ? this.hub.botByIdentity('telegram', replied.toLowerCase()) : undefined;
    if (target && !text.includes(`@${target.name}`)) text = `@${target.name} ${text}`;
    await this.hub.group(this.botId, 'telegram', chatId, text.replace(/[ \t]+/g, ' ').trim(), async () => msg.chat.title);
  }

  async send(chatId: string, text: string, pending?: Pending) {
    const keyboard = pending
      ? { inline_keyboard: [pending.options.map((o) => ({ text: o.hint ? `${o.label} · ${o.hint}` : o.label, callback_data: `pending:${pending.id}:${o.id}` }))] }
      : undefined;
    const body = text.trim() || pending?.title || '';
    if (!body) return;
    // HTML, not Markdown: Telegram's Markdown parser rejects the whole message over one stray character.
    await this.api('sendMessage', { chat_id: Number(chatId), text: toTelegramHtml(body), parse_mode: 'HTML', reply_markup: keyboard });
  }
}
