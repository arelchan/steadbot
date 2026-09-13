import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config, configPath, readFileConfig, updateConfigFile } from './config.ts';
import type { CrewStore } from './store.ts';
import type { Router } from './router.ts';
import type { Bridge, Hub } from './bridges/types.ts';
import { TelegramBridge } from './bridges/telegram.ts';
import { FeishuBridge } from './bridges/feishu.ts';
import { SlackBridge } from './bridges/slack.ts';
import { WecomBridge } from './bridges/wecom.ts';
import { WeixinBridge } from './bridges/weixin.ts';
import { DiscordBridge } from './bridges/discord.ts';
import { WhatsappBridge } from './bridges/whatsapp.ts';
import { botThread, matterThread, parseThread, CHANNELS, CHANNEL_LABEL, type Bot, type Card, type Channel, type ImLink, type Matter, type Message, type Pending, type ThreadId } from './types.ts';

/*
 * IM model: every bot is its own bot on an IM. A mail bot on Feishu is a Feishu app of its own, with its own name,
 * avatar and credentials; the user chats with it directly, and pulls several of them into one Feishu group to
 * have them work together — that group is mirrored as a group here. Credentials live only in config.json
 * (`imAccounts[botId][channel]`), entered through a credentials card, never in the store or the model context.
 */

export type Im = Exclude<Channel, 'app'>;
export const IMS: Im[] = CHANNELS.filter((c): c is Im => c !== 'app');
/** @deprecated This is CHANNEL_LABEL; the alias exists so old call sites did not all have to change at once. */
export const IM_NAME = CHANNEL_LABEL;

/** Which credential fields each IM needs; the keys are what the credentials card submits. */
export const CHANNEL_KEYS: Record<Im, string[]> = {
  telegram: ['telegramToken'],
  feishu: ['feishuAppId', 'feishuAppSecret'],
  slack: ['slackBotToken', 'slackAppToken'],
  wechat: ['wecomCorpId', 'wecomAgentId', 'wecomSecret', 'wecomToken', 'wecomAesKey'],
  // Not typed by anyone: the token comes back from the QR scan (weixin-pair.ts).
  weixin: ['weixinToken'],
  discord: ['discordToken'],
  whatsapp: ['waPhoneId', 'waToken', 'waVerifyToken'],
};

/** What each credential looks like, so a value read off a page can be checked before it is trusted. */
export const CHANNEL_PATTERNS: Record<string, RegExp> = {
  feishuAppId: /\bcli_[a-z0-9]{16}\b/g,
  feishuAppSecret: /\b[A-Za-z0-9]{32}\b/g,
  telegramToken: /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/g,
  slackBotToken: /\bxoxb-[A-Za-z0-9-]{20,}\b/g,
  slackAppToken: /\bxapp-[A-Za-z0-9-]{20,}\b/g,
  wecomCorpId: /\bww[a-z0-9]{16}\b/g,
  wecomAgentId: /\b1\d{6}\b/g,
  wecomSecret: /\b[A-Za-z0-9_-]{43}\b/g,
  wecomToken: /\b[A-Za-z0-9]{16,32}\b/g,
  wecomAesKey: /\b[A-Za-z0-9]{43}\b/g,
  // three dot-separated base64url parts, the middle one the bot's own id
  discordToken: /\b[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,50}\b/g,
  waPhoneId: /\b\d{15,16}\b/g,
  waToken: /\bEA[A-Za-z0-9]{50,}\b/g,
};
/** Credentials that are identifiers, not secrets: fine to read back to the bot in full. */
export const CHANNEL_PUBLIC_KEYS = new Set(['feishuAppId', 'wecomCorpId', 'wecomAgentId', 'waPhoneId', 'waVerifyToken']);

/** A bot's IM row in the App before it is connected. */
export const CHANNEL_HOWTO: Record<Im, string> = {
  feishu: 'Not connected. Once it is, it is a bot of its own in Feishu: message it directly, or put it in a group with other bots',
  telegram: 'Not connected. Once it is, it is a bot of its own in Telegram: message it directly, or add it to a group',
  slack: 'Not connected. Once it is, it is a bot of its own in Slack: message it directly, or invite it into a channel',
  wechat: 'Not connected. Once it is, it is an app of its own in WeCom, for direct messages (a WeCom app cannot join groups)',
  weixin: 'Not connected. One QR scan in WeChat connects it. It is a bot of its own in your WeChat, direct messages only, and it can only reply to you — never open',
  discord: 'Not connected. Once it is, it is a bot of its own in Discord: message it directly, or add it to a channel on your server',
  whatsapp: 'Not connected. Once it is, it has a WhatsApp number of its own, for direct messages (the business API has no groups)',
};
const CHANNEL_LIVE: Record<Im, string> = {
  feishu: 'Connected · message it, or put it in a group with other bots',
  telegram: 'Connected · message it, or add it to a group',
  slack: 'Connected · message it, or invite it into a channel',
  wechat: 'Connected · find the app in WeCom and message it',
  weixin: 'Connected · message it in WeChat (it cannot open a conversation, so you speak first)',
  discord: 'Connected · message it, or invite it to your server',
  whatsapp: 'Connected · message its number (they speak first, and the window is 24 hours)',
};

export const wecomCallback = (botId: string) => `${config.publicUrl}/wecom/callback/${botId}`;
export const whatsappCallback = (botId: string) => `${config.publicUrl}/whatsapp/callback/${botId}`;

/** The credentials card for connecting one bot to one IM: what to fill and where to get it. */
/** The messengers connected by filling in a form; WeChat is not one of them (a QR is scanned instead). */
export type CardIm = Exclude<Im, 'weixin'>;

export function connectCard(bot: Bot, channel: CardIm): Extract<Card, { type: 'secrets' }> {
  const n = bot.name;
  switch (channel) {
    case 'feishu':
      return {
        type: 'secrets',
        integrationId: 'ch-feishu',
        title: `Connect "${n}" to Feishu`,
        fields: [
          { key: 'feishuAppId', label: 'App ID', hint: 'starts with cli_', secret: false },
          { key: 'feishuAppSecret', label: 'App Secret' },
        ],
        help: {
          url: 'https://open.feishu.cn/app',
          urlLabel: 'Open the Feishu console',
          steps: [
            `Create a custom in-house app called "${n}", using its avatar`,
            'Add the bot capability; under permissions, enable im:message, im:message:send_as_bot and im:chat:readonly',
            'Under events and callbacks choose long connection, and add: receive message, bot added to group, bot removed from group',
            'Copy the App ID and App Secret from the credentials page into this card, then create and publish a version',
          ],
        },
      };
    case 'telegram':
      return {
        type: 'secrets',
        integrationId: 'ch-telegram',
        title: `Connect "${n}" to Telegram`,
        fields: [{ key: 'telegramToken', label: 'Bot Token', hint: 'digits:letters' }],
        help: {
          url: 'https://t.me/BotFather',
          urlLabel: 'Open @BotFather',
          steps: [`Send /newbot, with "${n}" as the display name and any username ending in bot`, 'Paste the token it gives you into this card', 'To have several bots work together, make a group and add them all — @ whoever you need'],
        },
      };
    case 'slack':
      return {
        type: 'secrets',
        integrationId: 'ch-slack',
        title: `Connect "${n}" to Slack`,
        fields: [
          { key: 'slackBotToken', label: 'Bot Token', hint: 'starts with xoxb-' },
          { key: 'slackAppToken', label: 'App-Level Token', hint: 'starts with xapp-' },
        ],
        help: {
          url: 'https://api.slack.com/apps',
          urlLabel: 'Open the Slack app console',
          steps: [
            `Create New App → From scratch, named "${n}"`,
            'Under OAuth & Permissions, add the Bot Token Scopes chat:write, im:history, channels:history, groups:history, app_mentions:read, channels:read, groups:read, users:read',
            'Turn on Socket Mode and generate an App-Level Token (connections:write); under Event Subscriptions subscribe to message.im, message.channels, message.groups, app_mention, member_joined_channel, member_left_channel',
            'Install to Workspace for the Bot Token, and put both tokens in this card',
          ],
        },
      };
    case 'discord':
      return {
        type: 'secrets',
        integrationId: 'ch-discord',
        title: `Connect "${n}" to Discord`,
        fields: [{ key: 'discordToken', label: 'Bot Token' }],
        help: {
          url: 'https://discord.com/developers/applications',
          urlLabel: 'Open the Discord developer console',
          steps: [
            `New Application named "${n}"; on the Bot page, Reset Token and put the Bot Token in this card`,
            'On the Bot page, turn on Message Content Intent (without it, message content never arrives)',
            'OAuth2 → URL Generator: tick bot, then Send Messages and Read Message History, and use the link to invite it to your server',
          ],
        },
      };
    case 'whatsapp':
      return {
        type: 'secrets',
        integrationId: 'ch-whatsapp',
        title: `Connect "${n}" to WhatsApp`,
        fields: [
          { key: 'waPhoneId', label: 'Phone number ID', hint: 'a string of digits', secret: false },
          { key: 'waToken', label: 'Access token', hint: 'starts with EAA…; use a system user\'s permanent token' },
          { key: 'waVerifyToken', label: 'Webhook verify token', hint: 'make one up; the same string goes on both sides', secret: false },
        ],
        help: {
          url: 'https://developers.facebook.com/apps',
          urlLabel: 'Open the Meta developer console',
          steps: [
            'Create a Business app and add the WhatsApp product; the API Setup page has a test number and the Phone number ID',
            'In Business Manager create a system user with whatsapp_business_messaging and generate a permanent access token (the temporary one on the page expires in 24 hours)',
            `Set the webhook callback to ${whatsappCallback(bot.id)}, use the verify token from this card, and subscribe to the messages field`,
            'Going live also needs Meta business verification and your own number; the test number can only message allow-listed numbers',
          ],
        },
      };
    case 'wechat':
      return {
        type: 'secrets',
        integrationId: 'ch-wechat',
        title: `Connect "${n}" to WeCom`,
        fields: [
          { key: 'wecomCorpId', label: 'Corp ID', secret: false },
          { key: 'wecomAgentId', label: 'AgentId', secret: false },
          { key: 'wecomSecret', label: 'Secret' },
          { key: 'wecomToken', label: 'Token' },
          { key: 'wecomAesKey', label: 'EncodingAESKey' },
        ],
        help: {
          url: 'https://work.weixin.qq.com/wework_admin/frame#apps',
          urlLabel: 'Open the WeCom admin console',
          steps: [
            `Copy the Corp ID from My Company; under App management → custom app create one called "${n}" and take its AgentId and Secret`,
            `On the app page, Receive messages → set up API receiving: callback URL ${wecomCallback(bot.id)}, and generate a random Token and EncodingAESKey`,
            'Put all five in this card; once connected, go back to WeCom and press Save so it can verify the URL',
          ],
        },
      };
  }
}

/* ---- credentials: config.json only ---- */

export function botChannelCreds(botId: string, channel: Im): Record<string, string> | undefined {
  const acc = readFileConfig().imAccounts?.[botId]?.[channel];
  if (!acc) return undefined;
  const out: Record<string, string> = {};
  for (const k of CHANNEL_KEYS[channel]) {
    const v = acc[k]?.trim();
    if (!v) return undefined;
    out[k] = v;
  }
  return out;
}

/** One stored value that is not a required credential (WeChat's base url, handed out at pairing). */
export function channelExtra(botId: string, channel: Im, key: string): string | undefined {
  return readFileConfig().imAccounts?.[botId]?.[channel]?.[key]?.trim() || undefined;
}

/** The keys of this IM the bot's account still lacks (all of them when it has none). */
export function missingChannelCreds(botId: string, channel: Im): string[] {
  const acc = readFileConfig().imAccounts?.[botId]?.[channel] ?? {};
  return CHANNEL_KEYS[channel].filter((k) => !acc[k]?.trim());
}

export function saveBotChannelCreds(botId: string, channel: Im, values: Record<string, string>) {
  updateConfigFile((cur) => {
    const all = ((cur.imAccounts as Record<string, Record<string, Record<string, string>>> | undefined) ??= {});
    cur.imAccounts = all;
    const mine = (all[botId] ??= {});
    const acc = { ...(mine[channel] ?? {}) };
    for (const k of CHANNEL_KEYS[channel]) if (values[k]?.trim()) acc[k] = values[k].trim();
    mine[channel] = acc;
  });
}

export function clearBotChannelCreds(botId: string, channel?: Im) {
  updateConfigFile((cur) => {
    const all = cur.imAccounts as Record<string, Record<string, unknown>> | undefined;
    if (!all?.[botId]) return;
    if (channel) delete all[botId][channel];
    if (!channel || !Object.keys(all[botId]).length) delete all[botId];
    if (!Object.keys(all).length) delete cur.imAccounts;
  });
}

/**
 * Older builds had one shared set of credentials per IM (top-level config keys, or a card's env left on the
 * channel row). They become the account of the bot that was using that IM, once.
 */
function migrateSharedCreds(store: CrewStore) {
  const file = readFileConfig() as Record<string, unknown>;
  for (const ch of IMS) {
    const row = store.data.integrations.find((i) => i.kind === 'channel' && i.channel === ch);
    const fromFile: Record<string, string> = {};
    for (const k of CHANNEL_KEYS[ch]) if (typeof file[k] === 'string' && (file[k] as string).trim()) fromFile[k] = (file[k] as string).trim();
    const complete = (c: Record<string, string> | undefined) => !!c && CHANNEL_KEYS[ch].every((k) => c[k]?.trim());
    const creds = complete(fromFile) ? fromFile : complete(row?.env) ? row!.env : undefined;
    if (creds) {
      const owner =
        store.data.bots.find((b) => b.bindings?.[ch]) ?? store.data.bots.find((b) => b.channels.includes(ch)) ?? store.data.bots.find((b) => b.kind === 'steward') ?? store.data.bots[0];
      if (owner && !botChannelCreds(owner.id, ch)) {
        saveBotChannelCreds(owner.id, ch, creds);
        console.log(`[crew] ${IM_NAME[ch]} credentials now belong to ${owner.name} (one bot, one account)`);
      }
    }
    if (Object.keys(fromFile).length) updateConfigFile((cur) => CHANNEL_KEYS[ch].forEach((k) => delete cur[k]));
    if (row?.env) store.patchIntegration(row.id, { env: undefined });
  }
}

const key = (botId: string, channel: Channel) => `${botId}:${channel}`;

/**
 * Owns every bot's IM accounts: starts what has credentials, restarts what changed (a filled card, a hand edit of
 * config.json), and is the Hub the bridges report to — private chats become the bot's thread, an IM group with
 * several of our bots becomes a group here.
 */
export class ChannelManager implements Hub {
  private bridges = new Map<string, Bridge>();
  /** credentials each running bridge was started with, so a config change touches only what changed */
  private running = new Map<string, string>();
  private identities = new Map<string, string>();
  private seen = new Map<Channel, Set<string>>();
  private watcher: FSWatcher | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  /**
   * The round trip that proves an IM is really connected. Credentials that authenticate prove nothing about whether
   * a person can find the bot over there — a Feishu app that was never published starts its websocket happily and
   * then never receives anything. So the bot goes to the shared computer, finds itself in the user's own client and
   * sends itself one line carrying a code; the code arriving here is the proof. Keyed by bot + IM.
   */
  private probes = new Map<string, { code: string; at: number; hitAt?: number }>();

  constructor(
    private store: CrewStore,
    private router: Router,
  ) {}

  /* ---- lifecycle ---- */

  async startAll() {
    migrateSharedCreds(this.store);
    await this.syncFromConfig();
    this.watch();
  }

  stopAll() {
    this.watcher?.close();
    this.watcher = undefined;
    for (const [k, br] of this.bridges) {
      try {
        br.stop();
      } catch {
        /* ignore */
      }
      const [botId, ch] = k.split(':') as [string, Im];
      const bot = this.store.bot(botId);
      if (bot?.im?.[ch]?.status === 'ok') this.setLink(botId, ch, { ...bot.im[ch]!, status: 'off', note: 'Steadbot stopped on this machine' });
    }
    this.bridges.clear();
    this.running.clear();
  }

  /** Bring running bridges in line with config.json and the bot list: start new, restart changed, stop removed. */
  async syncFromConfig() {
    const want = new Map<string, { botId: string; channel: Im; fp: string }>();
    for (const bot of this.store.data.bots)
      for (const ch of IMS) {
        const c = botChannelCreds(bot.id, ch);
        if (c) want.set(key(bot.id, ch), { botId: bot.id, channel: ch, fp: JSON.stringify(c) });
      }
    // A deleted bot's accounts go with it.
    for (const botId of Object.keys(readFileConfig().imAccounts ?? {})) if (!this.store.bot(botId)) clearBotChannelCreds(botId);
    for (const k of Array.from(this.running.keys()))
      if (!want.has(k)) {
        const [botId, ch] = k.split(':') as [string, Im];
        this.stopOne(botId, ch);
        this.setLink(botId, ch, undefined);
      }
    for (const [k, w] of want) if (w.fp !== this.running.get(k)) await this.start(w.botId, w.channel);
  }

  private watch() {
    try {
      // Watch the directory, not the file: atomic saves (rename) replace the inode and would orphan a file watcher.
      const name = basename(configPath);
      this.watcher = watch(dirname(configPath), (_ev, file) => {
        if (file && file !== name && file !== name + '.tmp') return;
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.syncFromConfig(), 300);
      });
    } catch (e) {
      console.warn('[crew] cannot watch config.json:', (e as Error).message);
    }
  }

  private stopOne(botId: string, channel: Im) {
    const k = key(botId, channel);
    try {
      this.bridges.get(k)?.stop();
    } catch {
      /* ignore */
    }
    this.bridges.delete(k);
    this.running.delete(k);
    for (const [id, b] of this.identities) if (b === botId && id.startsWith(`${channel}:`)) this.identities.delete(id);
  }

  /** (Re)start one bot's account on one IM from its current credentials; the result lands on the bot for the App. */
  async start(botId: string, channel: Im): Promise<{ ok: boolean; note: string }> {
    const bot = this.store.bot(botId);
    if (!bot) return { ok: false, note: 'no such bot' };
    this.stopOne(botId, channel);
    const c = botChannelCreds(botId, channel);
    if (!c) {
      this.setLink(botId, channel, undefined);
      return { ok: false, note: CHANNEL_HOWTO[channel] };
    }
    this.running.set(key(botId, channel), JSON.stringify(c));
    this.setLink(botId, channel, { status: 'connecting' });
    let br: Bridge;
    switch (channel) {
      case 'telegram':
        br = new TelegramBridge(botId, c.telegramToken, this);
        break;
      case 'feishu':
        br = new FeishuBridge(botId, c.feishuAppId, c.feishuAppSecret, this);
        break;
      case 'slack':
        br = new SlackBridge(botId, c.slackBotToken, c.slackAppToken, this);
        break;
      case 'wechat':
        br = new WecomBridge(botId, { corpId: c.wecomCorpId, agentId: c.wecomAgentId, secret: c.wecomSecret, token: c.wecomToken, aesKey: c.wecomAesKey }, this);
        break;
      case 'discord':
        br = new DiscordBridge(botId, c.discordToken, this);
        break;
      case 'weixin':
        br = new WeixinBridge(botId, c.weixinToken, this, channelExtra(botId, 'weixin', 'weixinBase'), (note) => {
          this.setLink(botId, 'weixin', { status: 'error', note });
        });
        break;
      case 'whatsapp':
        br = new WhatsappBridge(botId, { phoneId: c.waPhoneId, token: c.waToken, verifyToken: c.waVerifyToken }, this);
        break;
    }
    try {
      const { account } = await br.start();
      this.bridges.set(key(botId, channel), br);
      const fresh = !bot.channels.includes(channel);
      this.setLink(botId, channel, { status: 'ok', note: CHANNEL_LIVE[channel], account });
      if (fresh) {
        this.store.grow(botId, 'channel', `connected to ${IM_NAME[channel]}${account ? `, known there as "${account}"` : ''}`);
        // Connected is not the same as reachable, and the bot has no way to know the difference from here. Send it
        // to close the loop itself before it tells anyone it is on that IM.
        this.router.tellBot(
          botId,
          `[system] The credentials for ${IM_NAME[channel]} connected, but nobody has checked yet whether the user can find you over there. Verify now: channel_check(arm, channel="${IM_NAME[channel]}") for a passphrase → open the ${IM_NAME[channel]} web client on the computer (where the user is logged in), search for your own name and send yourself the passphrase as the user → channel_check(status). Only after it passes do you tell the user it is connected; if it fails, check the publish state, the availability and the event subscriptions as instructed.`,
        );
      }
      console.log(`[crew] ${bot.name} is on ${channel}${account ? ` as ${account}` : ''}`);
      return { ok: true, note: CHANNEL_LIVE[channel] };
    } catch (e) {
      try {
        br.stop();
      } catch {
        /* ignore */
      }
      const note = (e as Error).message.slice(0, 160);
      console.error(`[crew] ${bot.name} ${channel} failed to start:`, note);
      this.setLink(botId, channel, { status: 'error', note });
      return { ok: false, note };
    }
  }

  /* ---- the connected-for-real check ---- */

  /** Hand out a code and wait for it to come back from the other side. Ten minutes is plenty for a browser detour. */
  armProbe(botId: string, channel: Im): string {
    const code = `EB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    this.probes.set(key(botId, channel), { code, at: Date.now() });
    return code;
  }

  probeStatus(botId: string, channel: Im): { state: 'none' | 'waiting' | 'ok' | 'expired'; code?: string } {
    const p = this.probes.get(key(botId, channel));
    if (!p) return { state: 'none' };
    if (p.hitAt) return { state: 'ok', code: p.code };
    return { state: Date.now() - p.at > 10 * 60_000 ? 'expired' : 'waiting', code: p.code };
  }

  /** An inbound line that is the code coming home: mark it and swallow it, so the test is not a conversation. */
  private isProbe(botId: string, channel: Channel, text: string): boolean {
    const p = this.probes.get(key(botId, channel as Im));
    if (!p || p.hitAt || !text.includes(p.code)) return false;
    p.hitAt = Date.now();
    console.log(`[crew] ${this.store.bot(botId)?.name ?? botId}: ${channel} round trip verified (${p.code})`);
    return true;
  }

  /** The user filled the credentials card for a bot's IM: store them and connect. */
  async onSecrets(botId: string, channel: Im, values: Record<string, string>) {
    saveBotChannelCreds(botId, channel, values);
    return this.start(botId, channel);
  }

  /** Take a bot off an IM: stop, forget the credentials, drop its private chat and status. */
  disconnect(botId: string, channel: Im) {
    this.stopOne(botId, channel);
    clearBotChannelCreds(botId, channel);
    const bot = this.store.bot(botId);
    this.setLink(botId, channel, undefined);
    if (bot?.channels.includes(channel)) this.store.grow(botId, 'channel', `disconnected from ${IM_NAME[channel]}`);
  }

  /**
   * WeChat has no credentials to fill: the pairing desk posts a QR instead. Set by index.ts, because the desk needs
   * this manager to bring the bridge up once the scan lands.
   */
  pairWeixin: ((botId: string, threadId?: ThreadId) => Promise<string>) | undefined;

  /** Put the credentials card for one IM into the bot's thread; the bot's own words introduce it. */
  sendConnectCard(botId: string, channel: Im, threadId?: ThreadId) {
    const bot = this.store.bot(botId);
    if (!bot) throw new Error('no such bot');
    if (channel === 'weixin') {
      if (!this.pairWeixin) throw new Error('the WeChat pairing desk is not running');
      void this.pairWeixin(botId, threadId);
      return undefined;
    }
    const card = connectCard(bot, channel);
    const text =
      channel === 'wechat'
        ? `Connect me to WeCom: follow the steps on the card to create a custom app and put all five values on it. What you type goes only into the local config; I cannot see it.`
        : `Connect me to ${IM_NAME[channel]}: follow the steps on the card to create a bot for me (that is me over there — my name, my avatar) and put the credentials on the card. What you type goes only into the local config; I cannot see it.`;
    return this.store.addMessage({ threadId: threadId ?? botThread(botId), author: 'bot', botId, text, ts: Date.now(), card });
  }

  private setLink(botId: string, channel: Im, link: ImLink | undefined) {
    const bot = this.store.bot(botId);
    if (!bot) return;
    const im = { ...(bot.im ?? {}) };
    if (link) im[channel] = link;
    else delete im[channel];
    const patch: Partial<Bot> = { im: Object.keys(im).length ? im : undefined };
    if (link?.status === 'ok' && !bot.channels.includes(channel)) patch.channels = [...bot.channels, channel];
    if (!link && bot.channels.includes(channel)) patch.channels = bot.channels.filter((c) => c !== channel);
    if (!link && bot.bindings?.[channel]) {
      const b = { ...bot.bindings };
      delete b[channel];
      patch.bindings = Object.keys(b).length ? b : undefined;
    }
    this.store.patchBot(botId, patch, { growth: false });
  }

  /**
   * The two messengers that push instead of holding a connection: WeCom at <publicUrl>/wecom/callback/<botId> and
   * WhatsApp at /whatsapp/callback/<botId>. The path without a bot id still works while only one bot is on it.
   */
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> | false {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const m = /^\/(wecom|whatsapp)\/callback(?:\/([^/]+))?$/.exec(path);
    if (!m) return false;
    const kind = m[1] === 'wecom' ? WecomBridge : WhatsappBridge;
    const all = Array.from(this.bridges.values()).filter((b): b is WecomBridge | WhatsappBridge => b instanceof kind);
    const br = m[2] ? all.find((b) => b.botId === m[2]) : all.length === 1 ? all[0] : undefined;
    if (!br) return false;
    return br.handleHttp(req, res);
  }

  /* ---- outbound ---- */

  /**
   * A bot said something: to the IM it came from, or — for something the bot brought up itself (a routine's
   * result, a handoff) — to every IM the bot is on. Inside a mirrored group everything goes to that group; a
   * member that is not itself on that IM speaks through a groupmate, under its own name.
   */
  async deliver(message: Message, pending?: Pending) {
    if (message.author !== 'bot' || !message.botId) return;
    if (message.via === 'app') return;
    // A reply the user cut off mid-sentence goes out as far as it got, marked so.
    const text = message.status === 'interrupted' ? `${message.text}… (interrupted)` : message.text;
    const { kind, id } = parseThread(message.threadId);
    const warn = (e: unknown) => console.warn('[crew] IM delivery failed:', (e as Error).message);
    if (kind === 'matter') {
      const matter = this.store.matter(id);
      if (!matter?.bindings) return;
      for (const ch of IMS) {
        const chatId = matter.bindings[ch];
        if (!chatId || (message.via && message.via !== ch)) continue;
        if (message.to && !message.to.includes(ch)) continue;
        const own = this.bridges.get(key(message.botId, ch));
        if (own) {
          await own.send(chatId, text, pending).catch(warn);
          continue;
        }
        const relay = [matter.ownerBotId, ...matter.participantBotIds].map((b) => this.bridges.get(key(b, ch))).find(Boolean);
        if (relay) await relay.send(chatId, `【${this.store.bot(message.botId)?.name ?? ''}】${text}`, pending).catch(warn);
      }
      return;
    }
    const bot = this.store.bot(id);
    if (!bot) return;
    for (const ch of IMS) {
      const br = this.bridges.get(key(bot.id, ch));
      const chatId = bot.bindings?.[ch];
      if (!br || !chatId || (message.via && message.via !== ch)) continue;
      // A routine can name where its result goes; everything else goes wherever the bot is.
      if (message.to && !message.to.includes(ch)) continue;
      await br.send(chatId, text, pending).catch(warn);
    }
  }

  /* ---- Hub: inbound from the bridges ---- */

  first(channel: Channel, messageId: string) {
    let s = this.seen.get(channel);
    if (!s) this.seen.set(channel, (s = new Set()));
    if (s.has(messageId)) return false;
    s.add(messageId);
    if (s.size > 4000) s.clear();
    return true;
  }

  register(channel: Channel, identity: string, botId: string) {
    this.identities.set(`${channel}:${identity}`, botId);
  }

  botByIdentity(channel: Channel, identity: string) {
    const id = this.identities.get(`${channel}:${identity}`);
    return id ? this.store.bot(id) : undefined;
  }

  dm(botId: string, channel: Channel, chatId: string, text: string) {
    const bot = this.store.bot(botId);
    if (!bot) return;
    if (this.isProbe(botId, channel, text)) return;
    if (bot.bindings?.[channel] !== chatId) this.store.patchBot(botId, { bindings: { ...bot.bindings, [channel]: chatId } }, { growth: false });
    this.router.onUserMessage(botThread(botId), text, channel);
  }

  async group(botId: string, channel: Channel, chatId: string, text: string, title: () => Promise<string | undefined>) {
    if (this.isProbe(botId, channel, text)) return;
    const matter = await this.matterFor(botId, channel, chatId, title);
    this.router.onUserMessage(matterThread(matter.id), text, channel);
  }

  async joined(botId: string, channel: Channel, chatId: string, title: () => Promise<string | undefined>) {
    await this.matterFor(botId, channel, chatId, title);
  }

  left(botId: string, channel: Channel, chatId: string) {
    const m = this.store.data.matters.find((x) => x.bindings?.[channel] === chatId);
    if (!m) return;
    const rest = [m.ownerBotId, ...m.participantBotIds].filter((b) => b !== botId);
    if (!rest.length) {
      const b = { ...m.bindings };
      delete b[channel];
      this.store.patchMatter(m.id, { bindings: Object.keys(b).length ? b : undefined });
    } else if (m.ownerBotId === botId || m.participantBotIds.includes(botId)) this.store.patchMatter(m.id, { ownerBotId: rest[0], participantBotIds: rest.slice(1) });
    this.store.addMessage({ threadId: matterThread(m.id), author: 'system', text: `${this.store.bot(botId)?.name ?? 'A bot'} was removed from the ${IM_NAME[channel]} group.`, ts: Date.now() });
  }

  choice(pendingId: string, optionId: string) {
    this.router.onPendingChoice(pendingId, optionId);
  }

  /** The group mirroring an IM group: created on first contact with the bot as lead; later bots join as members. */
  private async matterFor(botId: string, channel: Channel, chatId: string, title: () => Promise<string | undefined>): Promise<Matter> {
    const existing = this.store.data.matters.find((x) => x.bindings?.[channel] === chatId);
    if (!existing) {
      const t = (await title().catch(() => undefined))?.trim() || `${IM_NAME[channel]} group`;
      const m = this.router.createMatter({ title: t, summary: `The ${IM_NAME[channel]} group "${t}": the user added bots to it to work together, and everything said here is in that group.`, memberIds: [], leadId: botId });
      return this.store.patchMatter(m.id, { bindings: { [channel]: chatId } }) ?? m;
    }
    if (existing.ownerBotId !== botId && !existing.participantBotIds.includes(botId)) this.router.addMember(existing.id, botId, `added from the ${IM_NAME[channel]} group`);
    return this.store.matter(existing.id) ?? existing;
  }
}
