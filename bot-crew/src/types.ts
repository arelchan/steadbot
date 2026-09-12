export type Channel = 'app' | 'feishu' | 'wechat' | 'weixin' | 'slack' | 'telegram' | 'discord' | 'whatsapp';
export type Autonomy = 'tell' | 'prepare' | 'do';

export const CHANNEL_LABEL: Record<Channel, string> = {
  app: '这里',
  feishu: '飞书',
  wechat: '企业微信',
  weixin: '微信',
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
};

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  tell: '只告诉我',
  prepare: '备好等我点',
  do: '直接办',
};

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
  /** 到点了让它做什么；空着就照标题和职责办 */
  prompt?: string;
  schedule: string; // human readable, e.g. 每天 20:30
  enabled: boolean;
  /** 处理到哪个时间点了：新建或改了时间表时置为当下，所以一条下午建的「每天 09:00」等明天，不会立刻补跑 */
  lastRun?: number;
  /** 最近几次跑的时间，新的在前，最多十条 */
  runs?: number[];
  /** 结果发到哪几处；不填 = 它在的地方都发 */
  channels?: Channel[];
}

export interface Bot {
  id: string;
  name: string;
  glyph: string;
  tagline: string;
  role: string; // agent.md：职责与工作流程
  /** 产品自带的角色：steward = 管家 */
  kind?: 'steward';
  soul: string; // soul.md：人设、性格、说话风格
  channels: Channel[];
  connections: Connection[];
  autonomy: Autonomy;
  viewOfYou: string[];
  skills: string[];
  routines: Routine[];
  notify: boolean; // 消息通知
  pinned: boolean; // 置顶聊天
  avatarUrl?: string; // 用户上传的图；没有则按 avatarSeed 生成
  avatarSeed?: string;
  avatarLook?: string; // 「重新生成」只是换一个 seed
  createdAt: number;
  /** 身份 / 头像还在由模型生成中：对应位置显示骨架动画 */
  generating?: { identity?: boolean; avatar?: boolean };
  /** 这个 bot 被授权使用的集成 id */
  integrationIds?: string[];
  /** 它在各个 IM 上的账号：每个 bot 在飞书 / Telegram / Slack / 企业微信里都是独立的机器人 */
  im?: Partial<Record<Channel, ImLink>>;
  /** 它自己的电脑（云机器上的桌面，屏幕能实时看）；没有 = 从未开过机 */
  /** 正在进行的自我构建（build 工具）：界面显示 "soul building…" */
  building?: BuildJob[];
  /** 成长动线：从诞生起每一次变化 */
  growth?: GrowthEvent[];
}

export type GrowthKind =
  | 'born' | 'identity' | 'renamed' | 'instructions' | 'soul' | 'evolved'
  | 'skill' | 'skill_removed' | 'library' | 'memory' | 'forgot'
  | 'routine' | 'routine_removed' | 'connection' | 'disconnected' | 'channel' | 'group';
export interface GrowthEvent {
  id: string;
  ts: number;
  kind: GrowthKind;
  /** 一句话，【】里是对象名 */
  text: string;
}

export type BuildAspect = 'soul' | 'instructions' | 'skill' | 'memory';
export interface BuildJob { id: string; aspect: BuildAspect; label: string; since: number; skill?: string }

export type IntegrationKind = 'mcp' | 'channel' | 'agent' | 'shell';
export type IntegrationStatus = 'ok' | 'error' | 'off' | 'connecting';
export interface Integration {
  id: string;
  kind: IntegrationKind;
  name: string;
  status: IntegrationStatus;
  note?: string;
  createdAt: number;
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http transport: request headers, `${KEY}` placeholders filled from env at connect time (e.g. Authorization: Bearer ${FAL_KEY}) */
  headers?: Record<string, string>;
  url?: string;
  tools?: { name: string; description?: string; write?: boolean }[];
  connector?: string;
  account?: string;
  channel?: Channel;
  agent?: 'claude-code' | 'codex' | 'hermes' | 'opencode' | 'openclaw' | 'custom';
  acp?: boolean;
  loginHint?: string;
  available?: boolean;
  /** 装在用户电脑上（电脑名），bot 所在机器经它调用；电脑上的 EverBot 开着才可用 */
  viaHost?: string;
  agentArgs?: string[];
  /** 只属于某个 bot（它自己电脑上的浏览器工具），不在共享连接里列出 */
  owner?: string;
}

/**
 * 事项四态，也是日程右栏那四叠：doing 进行中 ｜ waiting 待确认 ｜ done 已完成 ｜ closed 已关闭。
 * 服务端 `crew-server/src/types.ts` 有同一段说明，改一处要改两处。
 */
export type TodoStatus = 'doing' | 'waiting' | 'done' | 'closed';

/**
 * 这条事项是怎么来的：谁交办的、用户从哪个入口说的、在哪条会话里。建的时候由运行时快照，
 * 模型填不了也改不了；之后不随更新变化（「最近一次从哪推进的」是另一回事，现在不记）。
 */
export interface TodoOrigin {
  /** 谁交办的：用户、群里的同事、例行任务、系统事件 */
  by: 'user' | 'bot' | 'routine' | 'system';
  /** 用户是从哪个入口说的话；by 不是 user 时没有 */
  via?: Channel;
  /** by 是 bot 时，交办的那位同事 */
  fromBotId?: string;
  /** 在哪条会话里交办的：bot:X 私聊 ｜ matter:M 群聊 */
  threadId: ThreadId;
  /** 触发它的那条消息（用户说的话），用来跳回原文 */
  messageId?: string;
  at: number;
}

export interface Todo {
  id: string;
  botId: string;
  matterId?: string;
  title: string;
  status: TodoStatus;
  summary?: string; // latest one-line progress, written by the bot
  result?: string; // outcome once done
  createdAt: number;
  updatedAt: number;
  fromMessageId?: string;
  /** 怎么来的：谁交办、哪个入口、哪条会话。老数据没有。 */
  origin?: TodoOrigin;
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
  threadId: string;
  matterId?: string;
  todoId?: string;
  kind: PendingKind;
  title: string;
  detail?: string;
  amount?: number;
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
  /** 这个群聊对应的 IM 群（用户把 bot 拉进那边的群时自动建的），如 { feishu: '<chat_id>' } */
  bindings?: Partial<Record<Channel, string>>;
}

/** 用量：token 和花费，按 bot / 天 / 模型汇总（服务端从会话日志读出来） */
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
  since?: number;
  total: UsageRow;
  bots: (UsageRow & { botId: string; name: string })[];
  daily: (UsageRow & { day: string })[];
  models: (UsageRow & { model: string })[];
  /** 钱花在什么上（后端 meter.ts 的分类） */
  kinds?: (UsageRow & { kind: UsageKind })[];
}

/* ---------------- 设置 › 模型 ---------------- */

export type SlotId = 'model' | 'lightModel' | 'visionModel' | 'guiModel' | 'imageModel' | 'searchModel' | 'embeddingModel' | 'rerankModel';

/** 这个模型得会什么；也是候选列表按什么筛 */
export type SlotNeeds = 'chat' | 'vision' | 'image' | 'embed' | 'rerank';

export interface ModelSlot {
  id: SlotId;
  needs: SlotNeeds;
  /** 只有这几家能干（画图和联网搜索只有 OpenRouter）；没有就是随便哪家 */
  only?: string[];
  /** 留空就跟着另一行走 */
  inherits?: SlotId;
  /** 留空就用产品自带的 */
  fallback?: string;
  /** 留空就每次自己挑（画图按风格挑） */
  auto?: boolean;
  /** 这一行可以关掉 */
  offable?: boolean;
  /** 用户选的；空表示还在默认上 */
  value?: string;
  /** 这一轮真正会跑的 */
  effective?: string;
  /** 要用的模型背后没有钥匙 */
  blocked?: boolean;
  /** 部署时用环境变量钉死的：能看不能改 */
  pinned?: boolean;
  /** 这一行自己的钥匙（永远是 ••••） */
  key?: string;
  /** 实际用的那把从哪来 */
  keyFrom?: KeySource;
  meta?: ModelMeta;
}

/** pi 的目录里还没有这个模型时，得手工告诉它的那几件事 */
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
  /** 这家的 key 叫什么（「OpenRouter API key」） */
  apiKey?: string;
  oauth?: { label: string; subscription: boolean };
  /** 已经有行给它配了钥匙 */
  keyed?: boolean;
}

/** 这一行用的钥匙是谁的：自己的 / 跟别的行借的 / 环境里本来就有的 */
export type KeySource = { kind: 'own' } | { kind: 'borrowed'; from: SlotId } | { kind: 'ambient' };

export interface ModelChoice {
  id: string;
  name: string;
  vision: boolean;
  context?: number;
  /** 每百万 token 多少钱 */
  costIn?: number;
  costOut?: number;
}

export interface ModelsPage {
  slots: ModelSlot[];
  providers: ModelProvider[];
  /** 对话和看图按 provider id；画图、向量、重排按 `<needs>:<provider>`，没有这个键就是「自己填 id」 */
  models: Record<string, ModelChoice[]>;
}

export interface ModelsPatch {
  slots?: Partial<Record<SlotId, string | null>>;
  keys?: Partial<Record<SlotId, string | null>>;
  meta?: Record<string, ModelMeta | null>;
}

/** 升级：这台电脑上的代码、正在跑的代码，对不对得上 */
export interface UpgradeStatus {
  /** bot 在哪：这台电脑，还是搬去的那台机器 */
  target: 'local' | 'machine';
  /** 跑 bot 的那一端所在的提交 */
  running?: string;
  /** 仓库分支上最新的提交 */
  latest?: string;
  /** 这两个提交的版本名：标签本身（v0.1.0），或标签之后第几个提交（v0.1.0+3） */
  runningName?: string;
  latestName?: string;
  version: string;
  repo: string;
  branch: string;
  /** 这台电脑上有没提交的改动 */
  dirty?: boolean;
  upToDate: boolean;
  /** 现在为什么不能升 */
  blocked?: string;
  machineName?: string;
  busy?: boolean;
}

/** 全局偏好：跟着这套 bot 走，不是某个浏览器的设置 */
export interface CrewSettings {
  /** bot 用什么语言说话和写东西：界面语言的代码（zh、en、ja…），或 auto = 跟着用户当时说的语言 */
  language?: string;
  /** 你所在的时区（IANA 名）。例行任务按它算时间：云机器本身跑在 UTC 上。 */
  timezone?: string;
}

/** bot 自己的电脑：bot 所在机器上的一个虚拟显示器 + 桌面 + 浏览器 */
/** The one computer all bots share on the machine they run on: a desktop with a browser, one tab per bot. */
export interface Computer {
  state: 'off' | 'starting' | 'on' | 'error';
  note?: string;
  since?: number;
  lastUsed?: number;
  /** bots that drove it in the last couple of minutes */
  users?: string[];
}

/** bot 在一个 IM 上的账号状态；account 是它在那边的名字 */
export interface ImLink {
  status: 'ok' | 'off' | 'error' | 'connecting';
  note?: string;
  account?: string;
}

export type Card =
  | {
      type: 'confirm';
      pendingId: string;
      title: string;
      sub: string;
      amount: number;
    }
  | {
      type: 'options';
      pendingId: string;
      options: { id: string; label: string; hint: string; price?: string }[];
    }
  | {
      type: 'blocked';
      pendingId: string;
      title: string;
      sub: string;
    }
  | {
      /** 机器卡（管家发的）：connect = 填 IP / 账号 / 密码，本机连上并存进凭据；run = 管家在那台机器上执行的命令及输出；move = 把 bot 们搬到那台机器 */
      type: 'machine';
      stage: 'connect' | 'run' | 'move';
      title: string;
      user?: string;
      state: 'idle' | 'running' | 'done' | 'error';
      log?: string[];
      error?: string;
      summary?: string[];
      command?: string;
      exit?: number;
      target?: { url: string; name: string; bots: number };
      progress?: { sent: number; total: number };
    }
  /** 外部 agent 执行卡：任务交给了 Claude Code / Codex / Hermes / OpenCode / OpenClaw，实时显示它在做什么 */
  | {
      type: 'agent_run';
      agent: string;
      name: string;
      title: string;
      mode: 'acp' | 'cli';
      state: 'running' | 'done' | 'error';
      log?: string[];
      output?: string;
      error?: string;
      asked?: number;
      /** 在用户的电脑上运行（电脑名）：agent 装在电脑上，经本机转接调用 */
      viaHost?: string;
    }
  /** 值守卡：bot 正在盯一个长程任务（vigil 工具），系统按间隔检查、有变化才叫醒它 */
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
  | {
      /** 登录卡：bot 在电脑上撞到登录墙，把它搬到对话里。qr = 实时二维码，用户手机扫；password = 用户填，服务端直接打进页面 */
      type: 'login';
      askId: string;
      kind: 'qr' | 'password';
      title: string;
      fields?: { key: string; label: string; secret?: boolean }[];
      /** qr：该用哪个 App 的哪个入口扫（服务端按站点给的，不是模型编的） */
      how?: string;
      done?: boolean;
      /** 结束时是成功（扫上了 / 填了）还是作废（过期、服务重启） */
      ok?: boolean;
      /** 结束的原因，正常登录成功时没有 */
      note?: string;
    }
  | {
      /** 凭据卡：用户在这里填授权码 / token，直接进连接的环境变量，不经过对话 */
      type: 'secrets';
      integrationId: string;
      title: string;
      fields: { key: string; label: string; hint?: string; secret?: boolean }[];
      /** 去哪拿：可点的链接 + 三步以内的说明 */
      help?: { url?: string; urlLabel?: string; steps?: string[] };
      done?: boolean;
    }
  | {
      /** 一键授权卡：点开去服务商登录，回来就接好 */
      type: 'connect';
      connector: string;
      name: string;
      blurb: string;
      url: string;
      integrationId: string;
      done?: boolean;
      account?: string;
      /** 授权没完成的原因；expired = 卡片过期，没有明确失败 */
      failed?: string;
      expired?: boolean;
    };

export type ReceiptKind = 'created' | 'updated' | 'closed' | 'reply';

/** A deliverable the bot produced in its workspace, served read-only by the backend at `url`. */
export interface FileRef {
  name: string;
  /** which bot's directory `path` is under */
  botId?: string;
  path: string;
  size: number;
  mime: string;
  url: string;
  mention?: string;
}

export interface Message {
  id: string;
  threadId: string;
  author: 'user' | 'bot' | 'system';
  botId?: string;
  text: string;
  ts: number;
  files?: FileRef[];
  card?: Card;
  todoId?: string;
  receipt?: { kind: ReceiptKind; text: string; todoId?: string };
  via?: Channel;
  /** 只发到这几处（例行任务指定了通道时） */
  to?: Channel[];
  mentions?: string[];
  status?: string;
}

/** A skill document (pi SKILL.md) addressed by display name. */
export interface SkillDoc {
  name: string;
  slug: string;
  /** 这份手册是谁的。产品自带的手册没有这个字段，所有 bot 共用。 */
  botId?: string;
  description: string;
  body: string;
  updatedAt: number;
  generating?: boolean;
  /** Mounted from the skill library: library slug, category, upstream source. */
  library?: string;
  category?: string;
  source?: string;
  /** Pool slugs this manual was written on top of, filled in by the runtime, not by the bot. */
  needs?: string[];
}

/** One entry of the curated skill library. */
export type LibraryKind = 'skill' | 'mcp' | 'assets';

/**
 * One thing a bot can equip itself with. A manual, an external tool set (MCP server or a platform behind the OAuth
 * service), a pack of assets — the differences are in how they are installed, not in how they are found.
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
  /** kind=skill: the manual's SKILL.md on the machine */
  path?: string;
  /** kind=mcp: how to start it and what it needs */
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
  /** kind=mcp behind the product's OAuth service: the toolkit slug; authorization is a click, not a key */
  service?: string;
  /** kind=assets: a pack to download into the workspace */
  assets?: { url: string; howto?: string };
}
/** Library categories the backend tags skills with; their names live in the language catalogs (`lib.<id>`). */
export const LIBRARY_CATEGORY_IDS = ['dev', 'docs', 'writing', 'research', 'productivity', 'business', 'design', 'meta'];

export type ThreadId = `bot:${string}` | `matter:${string}`;
export type Selection = ThreadId | 'week' | 'inbox' | 'profile' | 'draft-bot' | 'runtime';

export interface Toast {
  id: string;
  botId: string;
  text: string;
  threadId: ThreadId;
  ts: number;
}

export type Panel = { mode: 'board' } | { mode: 'task'; todoId: string };
export interface Panels { identity: boolean; tasks: boolean }
/** Column widths in px, user-draggable: bot list / 事项 column / 身份 column. */
export interface Layout { sidebar: number; side: number; right: number }
export const DEFAULT_LAYOUT: Layout = { sidebar: 252, side: 316, right: 312 };
export const LAYOUT_LIMITS: Record<keyof Layout, [number, number]> = { sidebar: [200, 400], side: [260, 480], right: [260, 480] };

/**
 * 日程上我们自己排的一件事：bot 觉得用户需要一个日程时排的。例行任务是反复，这是一次。
 * 到点了服务端把它交回给排它的 bot，由 bot 决定说什么、做什么。
 */
export interface CrewEvent {
  id: string;
  botId: string;
  title: string;
  at: number;
  /** 有时长的才有；没有就是时间轴上的一个点 */
  minutes?: number;
  /** user = 到点提醒用户；bot = 到点它自己做 */
  who: 'user' | 'bot';
  note?: string;
  threadId?: ThreadId;
  createdAt: number;
  firedAt?: number;
}

export interface State {
  /** the server this page is connected to (undefined until the first snapshot) */
  runtime?: RuntimeInfo;
  settings?: CrewSettings;
  /** the bots' shared computer; absent on a runtime that cannot host one */
  computer?: Computer;
  bots: Bot[];
  matters: Matter[];
  todos: Todo[];
  events: CrewEvent[];
  pendings: Pending[];
  actions: Action[];
  messages: Message[];
  sharedProfile: string[];
  skills: SkillDoc[];
  library: LibraryEntry[];
  integrations: Integration[];
  selection: Selection;
  toasts: Toast[];
  typing: Record<string, string[]>; // threadId -> botIds typing
  lastSeen: Record<string, number>; // threadId -> ts
  panel: Panel;
  panels: Panels;
  layout: Layout;
  focusMessageId?: string;
  /** live backend connection state (undefined in mock mode) */
  online?: boolean;
}

export const botThread = (botId: string): ThreadId => `bot:${botId}`;
export const matterThread = (matterId: string): ThreadId => `matter:${matterId}`;
export const parseThread = (t: ThreadId) => {
  const [kind, id] = t.split(':') as ['bot' | 'matter', string];
  return { kind, id };
};

/** What the server says about itself: which machine, whether it is the local one, whether the bots run there. */
export interface RuntimeInfo {
  instanceId: string;
  hostname: string;
  platform: string;
  home: string;
  botsDir: string;
  serverDir?: string;
  publicUrl: string;
  local: boolean;
  desktop: boolean;
  mode: 'active' | 'standby' | 'moved';
  movedTo?: string;
  version: string;
  startedAt: number;
  /** （云端运行时）正在把自己的 agent 借给 bot 用的那台电脑 */
  agentHost?: { name: string; agents: string[]; since: number };
  /** （电脑上的路牌）把本机 agent 借给云端的那条连接的状态 */
  hostLink?: 'connecting' | 'connected' | 'off' | 'no_token';
  /** 这台运行机器能给每个 bot 一台自己的电脑（Linux 桌面 + 浏览器，屏幕可实时看） */
  desktops?: boolean;
  /** 屏幕能不能在 App 里实时看（云机器上能；bot 跑在用户自己电脑上时窗口就在他桌面上，只给静态画面） */
  desktopsLive?: boolean;
  desktopsNote?: string;
  /** 正在跑的代码指纹（用于判断有没有新版本） */
  build?: string;
  /** bots in the middle of a turn right now (an upgrade waits for them) */
  busy?: string[];
}
