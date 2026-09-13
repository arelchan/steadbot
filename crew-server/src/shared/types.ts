/**
 * Domain types, **one copy** shared by both packages. There used to be two hand-written ones, 661 lines against
 * 665, and they had already drifted: nine kinds of Card on the server against seven in the App, and a Snapshot
 * missing events. Adding a field meant editing two packages, and forgetting was silent.
 *
 * Only what holds on both sides goes here: no Buffer, no NodeJS.*, no DOM types (the two libs differ), and no
 * enum, namespace or parameter properties (the App runs with erasableSyntaxOnly).
 *
 * Types are not what keeps credentials in. Integration.env and Bot.bindings are declared here because they exist
 * on both sides; what actually stops them leaving is toWire / redact in ws.ts, which strips fields at runtime.
 * Fixing a runtime leak with a type declaration only makes the boundary look guarded.
 */
/* Shared domain types. Mirrors bot-crew/src/types.ts; the wire protocol lives at the bottom. */

export type Channel = 'app' | 'feishu' | 'wechat' | 'weixin' | 'slack' | 'telegram' | 'discord' | 'whatsapp';
export type Autonomy = 'tell' | 'prepare' | 'do';
/**
 * Channels are these three tables and nothing else. They used to be written out wherever they were needed: two
 * inline name maps that between them missed half the channels (the growth log announced "moved into [weixin]",
 * and the self-description fed to the model told a bot connected to WeChat that it lived on "weixin"), two
 * different alias tables, and an IM_NAME on top. Add a channel here and the rest follows.
 */
export const CHANNELS: Channel[] = ['app', 'telegram', 'discord', 'whatsapp', 'slack', 'feishu', 'wechat', 'weixin'];
/** What a channel is called. One copy, used by the interface, the prompts and anything a bot reads. */
export const CHANNEL_LABEL: Record<Channel, string> = { app: 'In-app', feishu: 'Feishu', wechat: 'WeCom', weixin: 'WeChat', slack: 'Slack', telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp' };
/** Every name a user or a model might use. Matching is lower-cased, so these are lower-case; Chinese has no case and is written as it is. */
const CHANNEL_ALIASES: Record<Channel, string[]> = {
  app: ['app', 'in-app', 'here', '应用', '应用内', '这里'],
  feishu: ['feishu', 'lark', '飞书'],
  wechat: ['wecom', 'wechat work', 'wechat_work', '企业微信', '企微'],
  weixin: ['weixin', 'wechat', '微信'],
  slack: ['slack'],
  telegram: ['telegram', 'tg', '电报'],
  discord: ['discord', 'dc'],
  whatsapp: ['whatsapp', 'wa'],
};
const ALIAS_TO_CHANNEL = new Map<string, Channel>(
  CHANNELS.flatMap((c) => [[c, c] as [string, Channel], [CHANNEL_LABEL[c].toLowerCase(), c] as [string, Channel], ...CHANNEL_ALIASES[c].map((a) => [a, c] as [string, Channel])]),
);
// Both sides want "wechat": it is the id of the wechat channel and the English name of WeChat. It has always
// resolved to WeChat, and saying so here keeps it from depending on the order of the array above — WeCom is wecom.
ALIAS_TO_CHANNEL.set('wechat', 'weixin');
/** "Feishu", "lark" and 「飞书」 all resolve. Unrecognised returns undefined — never guess. */
export const channelFromName = (s: string): Channel | undefined => ALIAS_TO_CHANNEL.get(s.trim().toLowerCase());
export type ConnectionKind = 'browser' | 'mcp' | 'api' | 'pay' | 'calendar' | 'mail';

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  status: 'ok' | 'expired' | 'error';
  note?: string;
}

export interface Routine {
  id: string;
  title: string;
  /** What it should do when this fires; empty means go by the title and its remit. */
  prompt?: string;
  schedule: string;
  enabled: boolean;
  /** How far it has been processed. Set to now when created or rescheduled, so a "daily 09:00" made in the afternoon waits for tomorrow rather than firing immediately. */
  lastRun?: number;
  /** When it last ran, newest first, up to ten. */
  runs?: number[];
  /** Where the result goes: 'app' is an in-app notification, the rest are messengers this bot lives on. Absent = everywhere it lives. */
  channels?: Channel[];
}

export interface Bot {
  id: string;
  name: string;
  glyph: string;
  tagline: string;
  /** agent.md: its remit and how the work goes — what it does, how, and what to ask about first. */
  role: string;
  /** soul.md: character — temperament, how it talks, how it treats people. */
  soul: string;
  channels: Channel[];
  connections: Connection[];
  autonomy: Autonomy;
  viewOfYou: string[];
  skills: string[];
  routines: Routine[];
  notify: boolean;
  pinned: boolean;
  avatarUrl?: string;
  avatarSeed?: string;
  /** A description of how it looks (given when a bot changes its own avatar with configure), carried into the prompt that draws it. */
  avatarLook?: string;
  createdAt: number;
  /** server-only: the bot's private chat with the user on each IM it is connected to, e.g. { telegram: '<chatId>' }; learned from the first message there */
  bindings?: Partial<Record<Channel, string>>;
  /** this bot's own account on each IM (it is its own bot there, with its own credentials in config.json): live status for the App */
  im?: Partial<Record<Channel, ImLink>>;
  /** parts of the identity still being generated by models; UI shows placeholders */
  generating?: { identity?: boolean; avatar?: boolean };
  /** integrations (by id) this bot is allowed to use */
  integrationIds?: string[];
  /** self-builds in progress (build tool) */
  building?: BuildJob[];
  /** Growth: every change this bot has been through since birth, in order. */
  growth?: GrowthEvent[];
  /** A role that comes with the product: steward = the assistant that settles the bots onto another machine and looks after it. */
  kind?: 'steward';
  /** The long-running thing it is watching (the vigil tool); persisted, and resumed after a restart. */
  vigil?: Vigil;
  /** Its own computer (a desktop on the cloud machine, whose screen the user watches live in the App). Absent = never started. */
}

/** A bot's own computer: a virtual display on the machine the bots run on, with a browser the bot drives. */
/** The one computer all bots share on the machine they run on (desktop.ts): a desktop with a browser, one tab per bot. */
export interface Computer {
  state: 'off' | 'starting' | 'on' | 'error';
  note?: string;
  since?: number;
  /** last time any bot drove it or someone watched it */
  lastUsed?: number;
  /** bots that drove it in the last couple of minutes */
  users?: string[];
}

export interface Vigil {
  goal: string;
  watching: string;
  /** how to observe; absent = a plain loop that just nudges the bot each interval */
  check?: { kind: 'machine' | 'http'; target: string; label: string };
  everyMs: number;
  startedAt: number;
  ticks: number;
  maxTicks: number;
  nextAt: number;
  /** signature of the last check result, to notice changes */
  lastSig?: string;
  /** the vigil card in the thread */
  messageId?: string;
}

export type GrowthKind =
  | 'born' | 'identity' | 'renamed' | 'instructions' | 'soul' | 'evolved'
  | 'skill' | 'skill_removed' | 'library' | 'memory' | 'forgot'
  | 'routine' | 'routine_removed' | 'connection' | 'disconnected' | 'channel' | 'group';
export interface GrowthEvent {
  id: string;
  ts: number;
  kind: GrowthKind;
  /** One line, with the subject wrapped in 【】 so the interface can highlight it. */
  text: string;
}

/** What a bot can rebuild about itself with the build tool. */
export type BuildAspect = 'soul' | 'instructions' | 'skill' | 'memory';
/** An in-flight self-build; shown in the UI as "<aspect> building…" while it runs. */
export interface BuildJob {
  id: string;
  aspect: BuildAspect;
  label: string;
  since: number;
  skill?: string;
}

export type IntegrationKind = 'mcp' | 'channel' | 'agent' | 'shell';
/** External coding / general agents a bot can delegate to. */
export type AgentId = 'claude-code' | 'codex' | 'hermes' | 'opencode' | 'openclaw';
export const AGENT_IDS: AgentId[] = ['claude-code', 'codex', 'hermes', 'opencode', 'openclaw'];
export type IntegrationStatus = 'ok' | 'error' | 'off' | 'connecting';

/**
 * Something a bot can be granted:
 *   mcp      an MCP server (data, platforms, canvases…); its tools are registered on the bot
 *   channel  an IM the bot can live in
 *   agent    an external coding agent (Claude Code, Codex…) the bot can delegate to as a tool
 *   shell    pi's bash tool, confined to the bot's workspace
 */
export interface Integration {
  id: string;
  kind: IntegrationKind;
  name: string;
  status: IntegrationStatus;
  note?: string;
  createdAt: number;
  // mcp
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http transport: request headers, `${KEY}` placeholders filled from env at connect time (e.g. Authorization: Bearer ${FAL_KEY}) */
  headers?: Record<string, string>;
  url?: string;
  tools?: { name: string; description?: string; write?: boolean }[];
  /** built-in connector id (gmail, google-calendar…); tools come from connectors.ts, not an MCP process */
  connector?: string;
  /** the signed-in account, e.g. an email */
  account?: string;
  // channel
  channel?: Channel;
  // agent
  agent?: AgentId | 'custom';
  available?: boolean;
  /** the agent can be driven over ACP (streaming, permissions, persistent session); else one-shot CLI */
  acp?: boolean;
  /** how to sign in when the agent reports it is not authenticated */
  loginHint?: string;
  /** the agent is not on this machine but on the user's computer (its name), which lends it while its Steadbot is open */
  viaHost?: string;
  /** extra CLI args for the agent runner */
  agentArgs?: string[];
  /** private to one bot (its own computer's browser tools): not offered to other bots, not listed as a shared connection */
  owner?: string;
}

/**
 * The four states of a matter — the same four piles the user sees down the right of the schedule:
 * doing | waiting (cannot move until something arrives) | done (it worked) | closed (it is not happening).
 *
 * There used to be five, with open and blocked as well. To a user, open was indistinguishable from doing — a bot
 * that took the work is doing it — and blocked was indistinguishable from waiting, since both mean "this stays
 * here until you deal with it", and the interface always showed the pair together anyway. The urgency of being
 * stuck is carried by the kind of card (confirm / clarify / blocked, all unchanged), not by a matter state.
 */
export type TodoStatus = 'doing' | 'waiting' | 'done' | 'closed';

/**
 * Where a matter came from: who assigned it, which entry point the user spoke through, which thread it was in.
 * Snapshotted by the runtime at creation — the model can neither set nor change it — and not touched by later
 * updates ("where it was last pushed along" is a different thing, and is not recorded).
 */
export interface TodoOrigin {
  /** Who assigned it: the user, a colleague in a group, a recurring task, a system event. */
  by: 'user' | 'bot' | 'routine' | 'system';
  /** Which entry point the user spoke through; absent unless by is user. */
  via?: Channel;
  /** When by is bot, the colleague who assigned it. */
  fromBotId?: string;
  /** Which thread it was assigned in: bot:X for a direct thread, matter:M for a group. */
  threadId: ThreadId;
  /** The message that triggered it (what the user said), so the original can be jumped to. */
  messageId?: string;
  at: number;
}

export interface Todo {
  id: string;
  botId: string;
  matterId?: string;
  title: string;
  status: TodoStatus;
  summary?: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
  fromMessageId?: string;
  /** Where it came from: who, which entry point, which thread. Absent on older data. */
  origin?: TodoOrigin;
}

/**
 * One thing we put on the schedule ourselves.
 *
 * A recurring task repeats daily or weekly; this is once, at one moment — set when a bot decides the user needs
 * something on their schedule: a reminder for them, or something it will do itself. When it fires, the system
 * hands it back to the bot that set it (the same path recurring tasks take) and the bot decides what to say and
 * do. A reminder is simply a message from it, not a second notification system.
 */
export interface CrewEvent {
  id: string;
  /** Who set it; it comes back to them when it fires. */
  botId: string;
  title: string;
  /** When it starts. */
  at: number;
  /** Only when it has a duration; without it, a point on the timeline. */
  minutes?: number;
  /** user = remind the user when it fires; bot = it does the thing itself. */
  who: 'user' | 'bot';
  /** What to say or do when it fires; the more concrete the better. */
  note?: string;
  /** Which thread it was set from, so the original can be jumped to. */
  threadId?: ThreadId;
  createdAt: number;
  /** Already fired and handed back to the bot. */
  firedAt?: number;
}

export type PendingKind = 'confirm' | 'clarify' | 'blocked';

export interface PendingOption {
  id: string;
  label: string;
  hint?: string;
  primary?: boolean;
}

export interface Pending {
  id: string;
  botId: string;
  threadId: ThreadId;
  /** Which messenger it came from; when set and not app, the reply goes only there and not into the App window. */
  via?: Channel;
  matterId?: string;
  todoId?: string;
  kind: PendingKind;
  title: string;
  detail?: string;
  amount?: number;
  /** ISO 4217 for `amount`. Absent means the runtime did not say; the UI then shows the number with the
   *  product's historical default rather than inventing a currency from the interface language. */
  currency?: string;
  options: PendingOption[];
  messageId: string;
  createdAt: number;
  resolved?: { at: number; choice: string };
}

export interface Action {
  id: string;
  botId: string;
  matterId?: string;
  todoId?: string;
  ts: number;
  text: string;
  undoable?: boolean;
  undone?: boolean;
}

export interface Matter {
  id: string;
  title: string;
  date?: string;
  summary: string;
  ownerBotId: string;
  participantBotIds: string[];
  tools: string[];
  status: 'active' | 'done';
  notify: boolean;
  pinned: boolean;
  createdAt: number;
  /** the IM group this group mirrors, e.g. { feishu: '<chat_id>' }: created when the user pulls one of our bots into a group there */
  bindings?: Partial<Record<Channel, string>>;
}

/** A bot's connection to one IM. `account` is what the bot is called over there. */
export interface ImLink {
  status: 'ok' | 'off' | 'error' | 'connecting';
  note?: string;
  account?: string;
}

export type Card =
  | { type: 'confirm'; pendingId: string; title: string; sub: string; amount: number; currency?: string }
  | { type: 'options'; pendingId: string; options: { id: string; label: string; hint: string; price?: string }[] }
  | { type: 'blocked'; pendingId: string; title: string; sub: string }
  /** A login card: the bot hit a login wall on the computer and brought it into the thread. qr is a live QR code for the user's phone; password is filled in by the user and typed into the page by the server — never stored, never shown to the model. */
  | { type: 'login'; askId: string; kind: 'qr' | 'password'; title: string; fields?: { key: string; label: string; secret?: boolean }[]; how?: string; done?: boolean; /** done and it worked (scanned / filled) vs done because it went stale */ ok?: boolean; note?: string }
  | { type: 'secrets'; integrationId: string; title: string; fields: { key: string; label: string; hint?: string; secret?: boolean }[]; help?: { url?: string; urlLabel?: string; steps?: string[] }; done?: boolean }
  /** A machine card, sent by the assistant. connect: the user fills in IP / account / password, this computer connects and stores it in the credential file. run: one command the assistant ran on that machine, with its output. move: move the bots onto that machine. The password only ever reaches the server; the bot never sees it. */
  | {
      type: 'machine';
      stage: 'connect' | 'run' | 'move';
      title: string;
      /** connect: the default username. */
      user?: string;
      state: 'idle' | 'running' | 'done' | 'error';
      log?: string[];
      error?: string;
      /** The machine health report, once connect succeeded. */
      summary?: string[];
      /** run: the command and its exit code. */
      command?: string;
      exit?: number;
      /** move: where they are going. */
      target?: { url: string; name: string; bots: number };
      progress?: { sent: number; total: number };
    }
  /** An external agent run: the bot handed a task to Claude Code / Codex / Hermes / OpenCode / OpenClaw, and this shows what it is doing, live. */
  | {
      type: 'agent_run';
      agent: string;
      name: string;
      title: string;
      mode: 'acp' | 'cli';
      state: 'running' | 'done' | 'error';
      /** Tool calls and interim output, one per line. */
      log?: string[];
      /** The final reply (truncated). */
      output?: string;
      error?: string;
      /** How many permission requests are waiting on the user. */
      asked?: number;
      /** Running on the user's computer (its name): the agent is installed there and called through it. */
      viaHost?: string;
    }
  /** A watch: the bot is watching something long-running (the vigil tool); the system checks at an interval and wakes it only on a change. */
  | {
      type: 'vigil';
      goal: string;
      watching: string;
      everyS: number;
      checkLabel?: string;
      state: 'running' | 'stopped';
      ticks: number;
      lastAt?: number;
      lastOk?: boolean;
      last?: string;
      reason?: string;
    }
  | { type: 'connect'; connector: string; name: string; blurb: string; url: string; integrationId: string; done?: boolean; account?: string; failed?: string; expired?: boolean };

export type ReceiptKind = 'created' | 'updated' | 'closed' | 'reply';

/** A deliverable the bot produced in its workspace, served read-only at `url`. */
export interface FileRef {
  name: string;
  /** path relative to the bot's directory, e.g. workspace/report.html */
  path: string;
  /** which bot's directory `path` is under */
  botId?: string;
  size: number;
  mime: string;
  /** server-relative: /files/<botId>/<path>; the client prefixes the runtime it is connected to */
  url: string;
  /** the exact text the bot used to refer to it, so the client can render the file in place */
  mention?: string;
}

export interface Message {
  id: string;
  threadId: ThreadId;
  author: 'user' | 'bot' | 'system';
  botId?: string;
  text: string;
  ts: number;
  files?: FileRef[];
  card?: Card;
  todoId?: string;
  receipt?: { kind: ReceiptKind; text: string; todoId?: string };
  via?: Channel;
  /** This one goes only to these places (when a recurring task named its channels). Absent = as usual: the App plus every messenger this bot lives on. */
  to?: Channel[];
  mentions?: string[];
  status?: string;
}

export type ThreadId = `bot:${string}` | `matter:${string}`;
export const botThread = (botId: string): ThreadId => `bot:${botId}`;
export const matterThread = (matterId: string): ThreadId => `matter:${matterId}`;
export const parseThread = (t: ThreadId) => {
  const i = t.indexOf(':');
  return { kind: t.slice(0, i) as 'bot' | 'matter', id: t.slice(i + 1) };
};

export interface Toast {
  botId: string;
  text: string;
  threadId: ThreadId;
}

/** A skill document: pi SKILL.md (frontmatter + markdown), addressed by its display name. */
export interface SkillDoc {
  name: string;
  slug: string;
  /** Whose manual this is. Absent on the product's own built-in manuals, which every bot shares. */
  botId?: string;
  description: string;
  body: string;
  updatedAt: number;
  generating?: boolean;
  /** Set when the skill was mounted from the library: library slug, category and upstream source. */
  library?: string;
  category?: string;
  source?: string;
  /** Pool slugs this manual was written on top of, filled in by the runtime, not by the bot. */
  needs?: string[];
}

/** What a bot can equip itself with, from the pool (crew-server/library + manifest, mirrored to ~/.crew/library). */
export type LibraryKind = 'skill' | 'mcp' | 'assets';

/**
 * One thing a bot can equip itself with. A manual, an external tool set (an MCP server, or a platform behind the
 * product's OAuth service — both end up as tools on the bot; only the authorization differs), a pack of assets.
 * The differences are in how they are installed, not in how they are found, so they share one index and one search.
 */
export interface LibraryEntry {
  slug: string;
  title: string;
  category: string;
  description: string;
  tags: string[];
  source?: string;
  license?: string;
  /** what kind of thing this is; absent in old data means a skill */
  kind?: LibraryKind;
  /** kind=skill: the manual's SKILL.md on this machine — readable (read tool) without mounting it */
  path?: string;
  /** kind=mcp: how to start it and what it needs. Absent when the tools come through `service`. */
  mcp?: {
    transport: 'stdio' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    /** package to install into the product's own prefix first, so the server does not download itself on every start */
    npm?: string;
    pip?: string;
    /** credentials the user has to bring; asked for with a card, never through the conversation */
    env?: { key: string; label: string; hint?: string; secret?: boolean }[];
    help?: { url?: string; urlLabel?: string; steps?: string[] };
    /** one line about what its tools do, for search and for the bot */
    tools?: string;
    /** http: headers to send, with `${ENV_KEY}` placeholders for the card's values */
    headers?: Record<string, string>;
  };
  /** kind=mcp, hosted behind the product's OAuth connector service: the toolkit slug. Authorization is a click on a card, not a key. */
  service?: string;
  /** kind=assets: a pack to download into the workspace */
  assets?: { url: string; howto?: string };
}

/** Global preferences: they belong to this set of bots, not to one browser. */
export interface CrewSettings {
  /** What language the bots speak and write in: an interface language code (en, zh, ja…), or auto to follow whatever the user just used. */
  /** The user's timezone (an IANA name, reported by the App). Recurring tasks are computed in it, because a cloud machine itself runs on UTC. */
  timezone?: string;
}

/** What a client needs to know about the server it is talking to (see runtime.ts). */
export interface RuntimeInfo {
  instanceId: string;
  hostname: string;
  platform: string;
  home: string;
  botsDir: string;
  /** where the server code is installed (for commands the client tells the user to run) */
  serverDir: string;
  publicUrl: string;
  local: boolean;
  desktop: boolean;
  /** How much memory this machine (or its container) has, in MB — what the computer's own budgets come from. */
  memMb?: number;
  mode: 'active' | 'standby' | 'moved';
  movedTo?: string;
  version: string;
  startedAt: number;
  /** (remote runtime) the user's computer currently lending its agents: name and which agents it has */
  agentHost?: { name: string; agents: string[]; since: number };
  /** (signpost on the computer) the link that lends this computer's agents to the machine the bots moved to */
  hostLink?: 'connecting' | 'connected' | 'off' | 'no_token';
  /** this runtime can give each bot its own computer (a Linux desktop with a browser, watchable from the App) */
  desktops?: boolean;
  /** Whether that screen is actually painting right now (index.ts has always sent this field; only the App's copy of the type ever declared it). */
  desktopsLive?: boolean;
  /** why not, when it cannot */
  desktopsNote?: string;
  /** fingerprint of the code this process is running (see version.ts) */
  build?: string;
  /** bots in the middle of a turn right now (an upgrade waits for them) */
  busy?: string[];
}

/** Usage: tokens and cost, summed by bot, day and model, read out of each bot's session log (see usage.ts). */
export interface UsageRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
}
export type UsageKind = 'chat' | 'see' | 'operate' | 'draw' | 'search' | 'memory' | 'library' | 'build' | 'birth' | 'other';

export interface UsageReport {
  days: number;
  /** the earliest call counted, if any */
  since?: number;
  total: UsageRow;
  bots: (UsageRow & { botId: string; name: string })[];
  daily: (UsageRow & { day: string })[];
  models: (UsageRow & { model: string })[];
  /** What the money went on: conversation, seeing, operating a screen, drawing, search, memory, finding manuals, building, being born. */
  kinds: (UsageRow & { kind: UsageKind })[];
}

/** Upgrades: whether the code on this computer, the code running, and the code on the machine holding the bots all line up (see upgrade.ts). */
export interface UpgradeStatus {
  /** Where the bots are: this computer, or the machine they moved to. */
  target: 'local' | 'machine';
  /** The commit the end running the bots is on. */
  running?: string;
  /** The newest commit on the branch. */
  latest?: string;
  /** The version names of those two commits: the tag itself (v0.1.0), or how many commits past it (v0.1.0+3). */
  runningName?: string;
  latestName?: string;
  version: string;
  repo: string;
  branch: string;
  /** Whether this computer has uncommitted changes. */
  dirty?: boolean;
  upToDate: boolean;
  /** Why it cannot upgrade right now. */
  blocked?: string;
  machineName?: string;
  busy?: boolean;
}

/* ---------------- Settings › Models ---------------- */

export type SlotId = 'model' | 'lightModel' | 'visionModel' | 'guiModel' | 'imageModel' | 'searchModel' | 'embeddingModel' | 'rerankModel';

/** What this model has to be able to do; also what the candidate list is filtered by. */
export type SlotNeeds = 'chat' | 'vision' | 'image' | 'embed' | 'rerank';

export interface ModelSlot {
  id: SlotId;
  needs: SlotNeeds;
  /** Only these providers can do it (drawing and web search are OpenRouter only); absent means any of them. */
  only?: string[];
  /** Left empty, it follows another row. */
  inherits?: SlotId;
  /** Left empty, the product's own is used. */
  fallback?: string;
  /** Left empty, one is chosen per call (for drawing, by style). */
  auto?: boolean;
  /** What the user picked; empty means still on the default. */
  value?: string;
  /** What will actually run this turn. */
  effective?: string;
  /** The model this wants has no key behind it. */
  blocked?: boolean;
  /** Pinned by an environment variable at deploy time: visible, not editable. */
  pinned?: boolean;
  /** This row's own key (always ••••). */
  key?: string;
  /** Where the key actually in use came from. */
  keyFrom?: KeySource;
  meta?: ModelMeta;
}

/** The few things that have to be said by hand when pi's catalogue does not know a model yet. */
export interface ModelMeta {
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  costIn?: number;
  costOut?: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  chat: boolean;
  /** What this provider calls its key ("OpenRouter API key"). */
  apiKey?: string;
  oauth?: { label: string; subscription: boolean };
  /** A key for this provider already exists, in the environment or in pi. */
  keyed?: boolean;
}

/** Whose key this row uses: one entered here, or one left in the environment at deploy time. */
export type KeySource = { kind: 'own' } | { kind: 'ambient' };

export interface ModelChoice {
  id: string;
  name: string;
  vision: boolean;
  context?: number;
  /** Price per million tokens. */
  costIn?: number;
  costOut?: number;
}

export interface ModelsPage {
  slots: ModelSlot[];
  providers: ModelProvider[];
  /** Conversation and vision are keyed by provider id; drawing, embedding and reranking by `<needs>:<provider>`. No key means "type the id yourself". */
  models: Record<string, ModelChoice[]>;
}

export interface ModelsPatch {
  slots?: Partial<Record<SlotId, string | null>>;
  keys?: Partial<Record<SlotId, string | null>>;
  meta?: Record<string, ModelMeta | null>;
}
