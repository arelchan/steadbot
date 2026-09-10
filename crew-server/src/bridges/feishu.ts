import * as Lark from '@larksuiteoapi/node-sdk';
import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';
import { toPlain } from './format.ts';

/**
 * One bot's own Feishu app, over the SDK's long connection (no public URL). Its private chat is the bot's
 * thread; a Feishu group it is pulled into becomes a 群聊 shared with the other bots in that group. Pending
 * cards are interactive cards; button taps come back as card.action.trigger events.
 */
export class FeishuBridge implements Bridge {
  readonly channel = 'feishu' as const;
  private client!: Lark.Client;
  private ws!: Lark.WSClient;
  private name: string | undefined;

  constructor(
    readonly botId: string,
    private appId: string,
    private appSecret: string,
    private hub: Hub,
  ) {}

  private async sendText(chatId: string, text: string) {
    // A Feishu text message renders nothing, so markdown markers would be read out as characters.
    await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: toPlain(text) }) } });
  }

  /**
   * 飞书 and Lark are the same product on two clouds, and an app belongs to exactly one of them: the same
   * credentials that work on open.feishu.cn are rejected on open.larksuite.com. The App ID looks identical either
   * way, so instead of asking anyone which one they are on, try the domestic one and fall back to the global one.
   */
  private async pickDomain() {
    let last: Error | undefined;
    for (const domain of [Lark.Domain.Feishu, Lark.Domain.Lark]) {
      this.client = new Lark.Client({ appId: this.appId, appSecret: this.appSecret, domain, appType: Lark.AppType.SelfBuild });
      try {
        await this.checkCredentials();
        this.ws = new Lark.WSClient({ appId: this.appId, appSecret: this.appSecret, domain, loggerLevel: Lark.LoggerLevel.warn });
        return;
      } catch (e) {
        last = e as Error;
      }
    }
    throw last ?? new Error('连不上飞书/Lark');
  }

  /** Fail fast on bad credentials: the long connection would otherwise retry quietly forever. */
  private async checkCredentials() {
    let res: { code?: number; msg?: string; tenant_access_token?: string; data?: { tenant_access_token?: string } };
    try {
      res = (await this.client.auth.tenantAccessToken.internal({ data: { app_id: this.appId, app_secret: this.appSecret } })) as typeof res;
    } catch (e) {
      const msg = (e as Error).message || '';
      throw new Error(/app_secret|10014|10003|invalid/i.test(msg) ? 'App ID 或 App Secret 不对' : `连不上飞书开放平台：${msg.slice(0, 80)}`);
    }
    const token = res.tenant_access_token ?? res.data?.tenant_access_token;
    if ((res.code ?? 0) !== 0 || !token) {
      if (res.code === 10003 || res.code === 10014 || /app_secret|app_id/i.test(res.msg ?? '')) throw new Error('App ID 或 App Secret 不对');
      throw new Error(`飞书拒绝了凭据（${res.code ?? '?'}：${res.msg ?? ''}）`);
    }
  }

  /** Who this app is on Feishu, so mentions of it (and of our other bots) in a group can be recognised. */
  private async whoAmI() {
    try {
      const r = await this.client.request<{ code?: number; bot?: { open_id?: string; app_name?: string } }>({ method: 'GET', url: '/open-apis/bot/v3/info' });
      const openId = r?.bot?.open_id;
      this.name = r?.bot?.app_name?.trim() || undefined;
      if (openId) this.hub.register('feishu', openId, this.botId);
      if (this.name) this.hub.register('feishu', `name:${this.name}`, this.botId);
    } catch {
      /* the app can still chat; mentions will match by name only if we learn it later */
    }
  }

  private async chatName(chatId: string): Promise<string | undefined> {
    try {
      const r = (await this.client.im.chat.get({ path: { chat_id: chatId } })) as { data?: { name?: string } };
      return r?.data?.name;
    } catch {
      return undefined;
    }
  }

  async start() {
    await this.pickDomain();
    await this.whoAmI();
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const msg = data.message;
        if (!msg || msg.message_type !== 'text') return;
        // Every one of our bots in a group gets the same message (each is its own app); the hub takes it once.
        if (!this.hub.first('feishu', msg.message_id)) return;
        let text = '';
        try {
          text = (JSON.parse(msg.content) as { text?: string }).text ?? '';
        } catch {
          return;
        }
        // Mentions of our bots become @Name so the group router can address them; other people's are dropped.
        for (const m of msg.mentions ?? []) {
          const bot = (m.id?.open_id && this.hub.botByIdentity('feishu', m.id.open_id)) || this.hub.botByIdentity('feishu', `name:${m.name}`);
          text = text.split(m.key).join(bot ? ` @${bot.name} ` : ' ');
        }
        text = text
          .replace(/@_user_\d+/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        if (!text) return;
        if (msg.chat_type === 'p2p') return void this.hub.dm(this.botId, 'feishu', msg.chat_id, text);
        await this.hub.group(this.botId, 'feishu', msg.chat_id, text, () => this.chatName(msg.chat_id));
      },
      'im.chat.member.bot.added_v1': async (data) => {
        if (!data.chat_id) return;
        const chatId = data.chat_id;
        await this.hub.joined(this.botId, 'feishu', chatId, async () => data.name ?? (await this.chatName(chatId)));
      },
      'im.chat.member.bot.deleted_v1': async (data) => {
        if (data.chat_id) this.hub.left(this.botId, 'feishu', data.chat_id);
      },
      'card.action.trigger': async (data: { action?: { value?: unknown } }) => {
        const v = data.action?.value as { pendingId?: string; optionId?: string } | undefined;
        if (v?.pendingId && v.optionId) this.hub.choice(v.pendingId, v.optionId);
        return { toast: { type: 'success', content: '收到' } };
      },
    } as Lark.EventHandles);
    await this.ws.start({ eventDispatcher: dispatcher });
    return { account: this.name };
  }

  stop() {
    try {
      (this.ws as unknown as { close?: () => void }).close?.();
    } catch {
      /* ignore */
    }
  }

  async send(chatId: string, text: string, pending?: Pending) {
    if (!pending) {
      if (text.trim()) await this.sendText(chatId, text);
      return;
    }
    const card = {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: pending.title }, template: pending.kind === 'blocked' ? 'orange' : 'turquoise' },
      elements: [
        ...(pending.detail || pending.amount ? [{ tag: 'div', text: { tag: 'lark_md', content: `${pending.detail ?? ''}${pending.amount ? `\n**¥${pending.amount}**` : ''}` } }] : []),
        {
          tag: 'action',
          actions: pending.options.map((o) => ({
            tag: 'button',
            text: { tag: 'plain_text', content: o.hint ? `${o.label} · ${o.hint}` : o.label },
            type: o.primary ? 'primary' : 'default',
            value: { pendingId: pending.id, optionId: o.id },
          })),
        },
      ],
    };
    await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) } });
  }
}
