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
import { botThread, matterThread, parseThread, type Bot, type Card, type Channel, type ImLink, type Matter, type Message, type Pending, type ThreadId } from './types.ts';

/*
 * IM model: every bot is its own bot on an IM. 邮件管家 on Feishu is a Feishu app of its own, with its own name,
 * avatar and credentials; the user chats with it directly, and pulls several of them into one Feishu group to
 * have them work together — that group is mirrored as a 群聊 here. Credentials live only in config.json
 * (`imAccounts[botId][channel]`), entered through a credentials card, never in the store or the model context.
 */

export type Im = Exclude<Channel, 'app'>;
export const IMS: Im[] = ['feishu', 'telegram', 'slack', 'wechat'];
export const IM_NAME: Record<Channel, string> = { app: 'App', feishu: '飞书', telegram: 'Telegram', slack: 'Slack', wechat: '企业微信' };

/** Which credential fields each IM needs; the keys are what the credentials card submits. */
export const CHANNEL_KEYS: Record<Im, string[]> = {
  telegram: ['telegramToken'],
  feishu: ['feishuAppId', 'feishuAppSecret'],
  slack: ['slackBotToken', 'slackAppToken'],
  wechat: ['wecomCorpId', 'wecomAgentId', 'wecomSecret', 'wecomToken', 'wecomAesKey'],
};

/** A bot's IM row in the App before it is connected. */
export const CHANNEL_HOWTO: Record<Im, string> = {
  feishu: '还没接。接上后它在飞书里是一个独立的机器人：可以私聊，也能和别的 bot 一起拉进一个群',
  telegram: '还没接。接上后它在 Telegram 里是一个独立的机器人：可以私聊，也能拉进群',
  slack: '还没接。接上后它在 Slack 里是一个独立的机器人：可以私聊，也能邀请进频道',
  wechat: '还没接。接上后它在企业微信里是一个独立的应用，可以私聊（企业微信的应用进不了群）',
};
const CHANNEL_LIVE: Record<Im, string> = {
  feishu: '已接入 · 私聊它，或把它和别的 bot 拉进同一个群',
  telegram: '已接入 · 私聊它，或把它拉进群',
  slack: '已接入 · 私聊它，或邀请它进频道',
  wechat: '已接入 · 在企业微信里找到这个应用私聊',
};

const wecomCallback = (botId: string) => `${config.publicUrl}/wecom/callback/${botId}`;

/** The credentials card for connecting one bot to one IM: what to fill and where to get it. */
export function connectCard(bot: Bot, channel: Im): Extract<Card, { type: 'secrets' }> {
  const n = bot.name;
  switch (channel) {
    case 'feishu':
      return {
        type: 'secrets',
        integrationId: 'ch-feishu',
        title: `把「${n}」接到飞书`,
        fields: [
          { key: 'feishuAppId', label: 'App ID', hint: 'cli_ 开头', secret: false },
          { key: 'feishuAppSecret', label: 'App Secret' },
        ],
        help: {
          url: 'https://open.feishu.cn/app',
          urlLabel: '打开飞书开放平台',
          steps: [
            `创建企业自建应用，名字就叫「${n}」，头像用它的头像`,
            '「添加应用能力」加上机器人；「权限管理」开通 im:message、im:message:send_as_bot、im:chat:readonly',
            '「事件与回调」选「长连接」，添加事件：接收消息、机器人进群、机器人被移出群',
            '「凭证与基础信息」里复制 App ID 和 App Secret 填到这里，然后「版本管理与发布」创建版本并发布',
          ],
        },
      };
    case 'telegram':
      return {
        type: 'secrets',
        integrationId: 'ch-telegram',
        title: `把「${n}」接到 Telegram`,
        fields: [{ key: 'telegramToken', label: 'Bot Token', hint: '数字:字母 的形式' }],
        help: {
          url: 'https://t.me/BotFather',
          urlLabel: '打开 @BotFather',
          steps: [`发 /newbot，显示名填「${n}」，用户名随意但要以 bot 结尾`, '把它回给你的 token 填到这里', '想让几个 bot 一起干活，就建个群把它们都拉进去，@谁谁回'],
        },
      };
    case 'slack':
      return {
        type: 'secrets',
        integrationId: 'ch-slack',
        title: `把「${n}」接到 Slack`,
        fields: [
          { key: 'slackBotToken', label: 'Bot Token', hint: 'xoxb- 开头' },
          { key: 'slackAppToken', label: 'App-Level Token', hint: 'xapp- 开头' },
        ],
        help: {
          url: 'https://api.slack.com/apps',
          urlLabel: '打开 Slack 应用后台',
          steps: [
            `Create New App → From scratch，名字「${n}」`,
            'OAuth & Permissions 的 Bot Token Scopes 加上 chat:write、im:history、channels:history、groups:history、app_mentions:read、channels:read、groups:read、users:read',
            'Socket Mode 开启并生成 App-Level Token（connections:write）；Event Subscriptions 订阅 message.im、message.channels、message.groups、app_mention、member_joined_channel、member_left_channel',
            'Install to Workspace 拿到 Bot Token，两个 token 填到这里',
          ],
        },
      };
    case 'wechat':
      return {
        type: 'secrets',
        integrationId: 'ch-wechat',
        title: `把「${n}」接到企业微信`,
        fields: [
          { key: 'wecomCorpId', label: '企业 ID', secret: false },
          { key: 'wecomAgentId', label: 'AgentId', secret: false },
          { key: 'wecomSecret', label: 'Secret' },
          { key: 'wecomToken', label: 'Token' },
          { key: 'wecomAesKey', label: 'EncodingAESKey' },
        ],
        help: {
          url: 'https://work.weixin.qq.com/wework_admin/frame#apps',
          urlLabel: '打开企业微信管理后台',
          steps: [
            `「我的企业」页复制企业 ID；「应用管理 → 自建应用」创建一个叫「${n}」的应用，拿到 AgentId 和 Secret`,
            `应用详情「接收消息 → 设置 API 接收」：回调 URL 填 ${wecomCallback(bot.id)}，Token 和 EncodingAESKey 点随机生成`,
            '把五项填到这里；接好后再回企业微信点「保存」让它验证 URL',
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
 * several of our bots becomes a 群聊.
 */
export class ChannelManager implements Hub {
  private bridges = new Map<string, Bridge>();
  /** credentials each running bridge was started with, so a config change touches only what changed */
  private running = new Map<string, string>();
  private identities = new Map<string, string>();
  private seen = new Map<Channel, Set<string>>();
  private watcher: FSWatcher | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;

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
      if (bot?.im?.[ch]?.status === 'ok') this.setLink(botId, ch, { ...bot.im[ch]!, status: 'off', note: '这台机器上的 EverBot 停了' });
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
    if (!bot) return { ok: false, note: 'bot 不存在' };
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
    }
    try {
      const { account } = await br.start();
      this.bridges.set(key(botId, channel), br);
      const fresh = !bot.channels.includes(channel);
      this.setLink(botId, channel, { status: 'ok', note: CHANNEL_LIVE[channel], account });
      if (fresh) this.store.grow(botId, 'channel', `接入${IM_NAME[channel]}${account ? `，那边叫「${account}」` : ''}`);
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
    if (bot?.channels.includes(channel)) this.store.grow(botId, 'channel', `断开了${IM_NAME[channel]}`);
  }

  /** Put the credentials card for one IM into the bot's thread; the bot's own words introduce it. */
  sendConnectCard(botId: string, channel: Im, threadId?: ThreadId) {
    const bot = this.store.bot(botId);
    if (!bot) throw new Error('bot 不存在');
    const card = connectCard(bot, channel);
    const text =
      channel === 'wechat'
        ? `把我接到企业微信：按卡片上的步骤建一个自建应用，五项填到卡上。填的内容只进本机配置，我看不到。`
        : `把我接到${IM_NAME[channel]}：按卡片上的步骤给我建一个机器人（那边就是我，名字头像都用我的），凭据填到卡上。填的内容只进本机配置，我看不到。`;
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

  /** 企业微信 pushes to <publicUrl>/wecom/callback/<botId>; the old single path still works while only one bot is on it. */
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> | false {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const m = /^\/wecom\/callback(?:\/([^/]+))?$/.exec(path);
    if (!m) return false;
    const all = Array.from(this.bridges.values()).filter((b): b is WecomBridge => b instanceof WecomBridge);
    const br = m[1] ? all.find((b) => b.botId === m[1]) : all.length === 1 ? all[0] : undefined;
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
    const { kind, id } = parseThread(message.threadId);
    const warn = (e: unknown) => console.warn('[crew] IM delivery failed:', (e as Error).message);
    if (kind === 'matter') {
      const matter = this.store.matter(id);
      if (!matter?.bindings) return;
      for (const ch of IMS) {
        const chatId = matter.bindings[ch];
        if (!chatId || (message.via && message.via !== ch)) continue;
        const own = this.bridges.get(key(message.botId, ch));
        if (own) {
          await own.send(chatId, message.text, pending).catch(warn);
          continue;
        }
        const relay = [matter.ownerBotId, ...matter.participantBotIds].map((b) => this.bridges.get(key(b, ch))).find(Boolean);
        if (relay) await relay.send(chatId, `【${this.store.bot(message.botId)?.name ?? ''}】${message.text}`, pending).catch(warn);
      }
      return;
    }
    const bot = this.store.bot(id);
    if (!bot) return;
    for (const ch of IMS) {
      const br = this.bridges.get(key(bot.id, ch));
      const chatId = bot.bindings?.[ch];
      if (!br || !chatId || (message.via && message.via !== ch)) continue;
      await br.send(chatId, message.text, pending).catch(warn);
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
    if (bot.bindings?.[channel] !== chatId) this.store.patchBot(botId, { bindings: { ...bot.bindings, [channel]: chatId } }, { growth: false });
    this.router.onUserMessage(botThread(botId), text, channel);
  }

  async group(botId: string, channel: Channel, chatId: string, text: string, title: () => Promise<string | undefined>) {
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
    this.store.addMessage({ threadId: matterThread(m.id), author: 'system', text: `${this.store.bot(botId)?.name ?? '一个 bot'} 被移出了${IM_NAME[channel]}群。`, ts: Date.now() });
  }

  choice(pendingId: string, optionId: string) {
    this.router.onPendingChoice(pendingId, optionId);
  }

  /** The 群聊 mirroring an IM group: created on first contact with the bot as lead; later bots join as members. */
  private async matterFor(botId: string, channel: Channel, chatId: string, title: () => Promise<string | undefined>): Promise<Matter> {
    const existing = this.store.data.matters.find((x) => x.bindings?.[channel] === chatId);
    if (!existing) {
      const t = (await title().catch(() => undefined))?.trim() || `${IM_NAME[channel]}群`;
      const m = this.router.createMatter({ title: t, summary: `${IM_NAME[channel]}里的群「${t}」，用户把 bot 拉进去一起干活；这里的消息都在那个群里。`, memberIds: [], leadId: botId });
      return this.store.patchMatter(m.id, { bindings: { [channel]: chatId } }) ?? m;
    }
    if (existing.ownerBotId !== botId && !existing.participantBotIds.includes(botId)) this.router.addMember(existing.id, botId, `从${IM_NAME[channel]}群里拉进来的`);
    return this.store.matter(existing.id) ?? existing;
  }
}
