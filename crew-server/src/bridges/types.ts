import type { Bot, Channel, Pending } from '../types.ts';

/**
 * A Bridge is one bot's own account on one IM (its own Feishu app, Telegram bot, Slack app, 企业微信 self-built app).
 * Inbound it reports to the Hub (channels.ts), which knows every bot on that IM and turns chats into threads;
 * outbound it delivers a bot's text and cards to a chat it was given.
 */
export interface Bridge {
  readonly botId: string;
  readonly channel: Channel;
  /** Connect. Resolves with what the bot is called on the IM, when the IM tells us. */
  start(): Promise<{ account?: string }>;
  stop(): void;
  /** Send a message (and its card as native buttons, if any) to one chat on the IM. */
  send(target: string, text: string, pending?: Pending): Promise<void>;
}

/** What a bridge can ask of the crew: the ChannelManager implements it. */
export interface Hub {
  /** True the first time this IM message is seen: several of our bots in one group all receive the same message. */
  first(channel: Channel, messageId: string): boolean;
  /** Remember which of our bots an IM-side identity (open_id, @username, user id) is. */
  register(channel: Channel, identity: string, botId: string): void;
  botByIdentity(channel: Channel, identity: string): Bot | undefined;
  /** The user wrote to a bot in its private chat. */
  dm(botId: string, channel: Channel, chatId: string, text: string): void;
  /** The user wrote in a group one of our bots is in. Mentions of our bots are already `@Name`. */
  group(botId: string, channel: Channel, chatId: string, text: string, title: () => Promise<string | undefined>): Promise<void>;
  /** The user pulled the bot into a group / removed it. */
  joined(botId: string, channel: Channel, chatId: string, title: () => Promise<string | undefined>): Promise<void>;
  left(botId: string, channel: Channel, chatId: string): void;
  /** The user tapped an option on a card. */
  choice(pendingId: string, optionId: string): void;
}
