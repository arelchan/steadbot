import { App } from '@slack/bolt';
import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';

/**
 * One bot's own Slack app over Socket Mode (bot token xoxb-… + app-level token xapp-…; no public URL). Its DM is
 * the bot's thread; a channel it is invited to becomes a 群聊 shared with our other bots in it.
 */
export class SlackBridge implements Bridge {
  readonly channel = 'slack' as const;
  private app: App;
  private userId: string | undefined;

  constructor(
    readonly botId: string,
    botToken: string,
    appToken: string,
    private hub: Hub,
  ) {
    this.app = new App({ token: botToken, appToken, socketMode: true, logLevel: undefined });
  }

  private async channelName(ch: string): Promise<string | undefined> {
    try {
      const r = await this.app.client.conversations.info({ channel: ch });
      return r.channel?.name ? `#${r.channel.name}` : undefined;
    } catch {
      return undefined;
    }
  }

  async start() {
    let me: { user_id?: string; user?: string };
    try {
      me = (await this.app.client.auth.test()) as typeof me;
    } catch (e) {
      throw new Error(/invalid_auth|not_authed/.test((e as Error).message) ? 'Bot Token 不对' : `连不上 Slack：${(e as Error).message.slice(0, 80)}`);
    }
    this.userId = me.user_id;
    if (this.userId) this.hub.register('slack', this.userId, this.botId);
    this.app.message(async ({ message }) => {
      const m = message as { channel: string; channel_type?: string; text?: string; subtype?: string; bot_id?: string; ts: string };
      if (m.subtype || m.bot_id || !m.text) return;
      if (m.channel_type === 'im') return void this.hub.dm(this.botId, 'slack', m.channel, m.text.trim());
      if (!this.hub.first('slack', `${m.channel}:${m.ts}`)) return;
      // <@U…> mentions of our bots become @Name for the group router; other people's are dropped.
      const text = m.text
        .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_s, id: string) => {
          const bot = this.hub.botByIdentity('slack', id);
          return bot ? ` @${bot.name} ` : ' ';
        })
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (!text) return;
      await this.hub.group(this.botId, 'slack', m.channel, text, () => this.channelName(m.channel));
    });
    this.app.event('member_joined_channel', async ({ event }) => {
      if (event.user === this.userId) await this.hub.joined(this.botId, 'slack', event.channel, () => this.channelName(event.channel));
    });
    this.app.event('member_left_channel', async ({ event }) => {
      if (event.user === this.userId) this.hub.left(this.botId, 'slack', event.channel);
    });
    this.app.action(/^pending:/, async ({ ack, action }) => {
      await ack();
      const id = (action as { action_id?: string }).action_id ?? '';
      const [, pendingId, optionId] = id.split(':');
      if (pendingId && optionId) this.hub.choice(pendingId, optionId);
    });
    await this.app.start();
    return { account: me.user ? `@${me.user}` : undefined };
  }

  stop() {
    void this.app.stop();
  }

  async send(ch: string, text: string, pending?: Pending) {
    if (!pending) {
      if (text.trim()) await this.app.client.chat.postMessage({ channel: ch, text });
      return;
    }
    await this.app.client.chat.postMessage({
      channel: ch,
      text: pending.title,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${pending.title}*${pending.detail ? `\n${pending.detail}` : ''}${pending.amount ? `\n¥${pending.amount}` : ''}` } },
        {
          type: 'actions',
          elements: pending.options.map((o) => ({
            type: 'button',
            action_id: `pending:${pending.id}:${o.id}`,
            text: { type: 'plain_text', text: o.hint ? `${o.label} · ${o.hint}` : o.label },
            ...(o.primary ? { style: 'primary' } : {}),
          })),
        },
      ],
    });
  }
}
