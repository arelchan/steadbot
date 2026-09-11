import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Product configuration, in `$CREW_HOME/config.json` (mode 600).
 *
 * Model keys are the user's: they are typed in 设置 › 模型 and land in `providerKeys`, one per pi provider
 * (models.ts). A deployment can still put them in the environment or in the older `keys` map; what the user typed
 * wins, because it is the more recent thing they said. Everything model-shaped is read through a getter so a
 * change on the page takes effect on the next turn instead of the next restart.
 */
/** What pi needs to know about a model it has never heard of. */
export interface ModelInfo {
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  costIn?: number;
  costOut?: number;
}

interface FileConfig {
  model?: string; // "provider/model-id", e.g. "anthropic/claude-sonnet-4-6"
  lightModel?: string; // cheap model for bot inference and summaries
  searchModel?: string; // OpenRouter model used with the web plugin for web_search; defaults to lightModel
  /** Legacy last-resort image model. draw.ts owns the style × tier table now; this is only read if that fails to resolve, so a value left here from an older install no longer pins anything. */
  imageModel?: string;
  visionModel?: string; // "provider/model-id" that can read pictures, for the `see` tool when the main model has no eyes
  guiModel?: string; // "provider/model-id" that can work a screen from screenshots (the `operate` tool), e.g. a GPT-6-class computer-use model; falls back to visionModel
  /** @deprecated one blob for every hand-written model; `modelMeta` keys the same thing by model. */
  modelInfo?: ModelInfo;
  keys?: Record<string, string>; // e.g. { ANTHROPIC_API_KEY: "...", OPENROUTER_API_KEY: "..." }
  /** 模型 › 钥匙: one API key per pi provider id ("anthropic", "openrouter", …), written from the App. */
  providerKeys?: Record<string, string>;
  /** What turns text into vectors (the skill library and the memory engine both search with it). OpenRouter only. */
  embeddingModel?: string;
  /** Reranker for the memory engine; "off" turns it off. OpenRouter only. */
  rerankModel?: string;
  /** Metadata per "provider/model-id", for models pi's catalog does not list yet. Falls back to `modelInfo`. */
  modelMeta?: Record<string, ModelInfo>;
  port?: number;
  /** Access token required by clients. Set → listens on all interfaces; unset → loopback only, no token. */
  authToken?: string;
  /** Override the bind address (default: 127.0.0.1 without token, 0.0.0.0 with). */
  bind?: string;
  /** Base URL clients use to fetch /avatars/*; defaults to http://localhost:<port>. */
  publicUrl?: string;
  askTimeoutMs?: number;
  /**
   * IM accounts, one per bot per IM: each bot is its own bot in Feishu / Telegram / Slack / 企业微信, with its own
   * credentials. `{ [botId]: { feishu: { feishuAppId, feishuAppSecret }, telegram: { telegramToken }, … } }`.
   * Written from the credentials card (channels.ts); never leaves this file.
   */
  imAccounts?: Record<string, Partial<Record<string, Record<string, string>>>>;
  /** @deprecated pre-per-bot shared IM credentials; moved into imAccounts on first start (channels.ts) */
  telegramToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  wecomCorpId?: string;
  wecomAgentId?: string;
  wecomSecret?: string;
  wecomToken?: string;
  wecomAesKey?: string;
  /** Google OAuth client (product-level) for the Gmail / Google 日历 connectors */
  googleClientId?: string;
  googleClientSecret?: string;
  /** Composio API key: connectors authenticate through Composio's managed OAuth apps (no Google registration needed) */
  composioApiKey?: string;
  /** mirrors for machines where the default indexes are slow; empty = official */
  tools?: { pipIndex?: string; npmRegistry?: string };
  fake?: boolean;
}

const home = process.env.CREW_HOME ?? join(homedir(), '.crew');
mkdirSync(home, { recursive: true });

const cfgPath = join(home, 'config.json');
function loadFile(): FileConfig {
  if (!existsSync(cfgPath)) return {};
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf8')) as FileConfig;
  } catch (e) {
    console.warn(`[crew] cannot parse ${cfgPath}:`, e);
    return {};
  }
}
let file: FileConfig = loadFile();

/**
 * Keys reach two places: pi's ModelRuntime (models.ts hands it `providerKeys` directly) and the four calls that go
 * to OpenRouter without pi — drawing, web search, embeddings, the memory engine — which read the environment.
 * A key typed in the App wins over one in the environment: it is the more recent thing the user said.
 */
function applyEnv() {
  for (const [k, v] of Object.entries(file.keys ?? {})) if (v && !process.env[k]) process.env[k] = v;
  const or = file.providerKeys?.openrouter?.trim();
  if (or) process.env.OPENROUTER_API_KEY = or;
}
applyEnv();

/** Re-read the file after it was written (the App changed a key or a model) so every getter below is current. */
export function reloadConfig() {
  file = loadFile();
  applyEnv();
}

/**
 * Run on the user's clock. A cloud machine is on UTC, so without this a bot would think it is the middle of the
 * night and 每天 20:00 would fire eight hours off. The zone is what the App reported (crew.json settings).
 */
if (!process.env.TZ) {
  try {
    const dataFile = join(home, 'crew.json');
    const tz = existsSync(dataFile) ? (JSON.parse(readFileSync(dataFile, 'utf8')) as { settings?: { timezone?: string } }).settings?.timezone : undefined;
    if (tz) process.env.TZ = tz;
  } catch {
    /* no data yet, or unreadable: keep the machine's own zone */
  }
}

/** What each slot falls back to when nobody chose: what the product shipped with. */
export const DEFAULT_EMBEDDING_MODEL = 'baai/bge-m3';
export const DEFAULT_RERANK_MODEL = 'cohere/rerank-v3.5';

export const config = {
  home,
  piAgentDir: join(home, 'pi-agent'), // isolated pi agentDir: our skills/extensions only
  dataFile: join(home, 'crew.json'),
  avatarsDir: join(home, 'avatars'),
  botsDir: join(home, 'bots'),
  sharedDir: join(home, 'shared'),
  /** the bots' shared computer: browser profile (logins), dock config, last frame of the screen */
  computerDir: join(home, 'computer'),
  port: Number(process.env.CREW_PORT ?? file.port ?? 5200),
  authToken: process.env.CREW_AUTH_TOKEN ?? file.authToken,
  bind: process.env.CREW_BIND ?? file.bind ?? ((process.env.CREW_AUTH_TOKEN ?? file.authToken) ? '0.0.0.0' : '127.0.0.1'),
  publicUrl: (process.env.CREW_PUBLIC_URL ?? file.publicUrl ?? `http://localhost:${Number(process.env.CREW_PORT ?? file.port ?? 5200)}`).replace(/\/$/, ''),
  // Live: the App writes config.json and calls reloadConfig(), and the next turn uses the new model.
  get model() {
    return process.env.CREW_MODEL ?? file.model;
  },
  get visionModel() {
    return process.env.CREW_VISION_MODEL ?? file.visionModel;
  },
  get guiModel() {
    return process.env.CREW_GUI_MODEL ?? file.guiModel;
  },
  get lightModel() {
    return process.env.CREW_LIGHT_MODEL ?? file.lightModel;
  },
  get searchModel() {
    return process.env.CREW_SEARCH_MODEL ?? file.searchModel;
  },
  /** Empty on purpose: drawing picks its model from the style × tier table, this only pins it (draw.ts). */
  get imageModel() {
    return process.env.CREW_IMAGE_MODEL ?? file.imageModel;
  },
  get embeddingModel() {
    return process.env.CREW_EMBEDDING_MODEL ?? file.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  },
  get rerankModel() {
    return process.env.CREW_RERANK_MODEL ?? file.rerankModel ?? DEFAULT_RERANK_MODEL;
  },
  get modelInfo() {
    return file.modelInfo;
  },
  get providerKeys(): Record<string, string> {
    return file.providerKeys ?? {};
  },
  get modelMeta(): Record<string, ModelInfo> {
    return file.modelMeta ?? {};
  },
  fake: process.env.CREW_FAKE === '1' || file.fake === true,
  /** whether external agents installed on this machine are used here at all (0 = only borrow the user's computer's; see host.ts) */
  localAgents: process.env.CREW_LOCAL_AGENTS !== '0',
  askTimeoutMs: Number(process.env.CREW_ASK_TIMEOUT_MS ?? file.askTimeoutMs ?? 30 * 60 * 1000),
  google: file.googleClientId && file.googleClientSecret ? { clientId: file.googleClientId, clientSecret: file.googleClientSecret } : undefined,
  composio: (process.env.CREW_COMPOSIO_API_KEY ?? file.composioApiKey) ? { apiKey: (process.env.CREW_COMPOSIO_API_KEY ?? file.composioApiKey)! } : undefined,
  connectionsDir: join(home, 'connections'),
  libraryDir: join(home, 'library'),
  /** the memory engine's root: md files are the truth, the vector index next to them is rebuildable (everos.ts) */
  memoryDir: join(home, 'memory'),
  tools: { pipIndex: process.env.CREW_PIP_INDEX ?? file.tools?.pipIndex, npmRegistry: process.env.CREW_NPM_REGISTRY ?? file.tools?.npmRegistry },
  /**
   * How many bot→bot relays one user turn may chain before the runtime cuts it, the guard against two bots
   * @-ing each other forever. Three was below what one round of group work costs: a lead that fans a task out
   * to two members and collects both answers is already four.
   */
  handoffDepth: 8,
};

for (const d of [config.piAgentDir, config.avatarsDir, config.botsDir, config.sharedDir, join(config.piAgentDir, 'skills')]) {
  mkdirSync(d, { recursive: true });
}

export const configPath = cfgPath;

/**
 * The product's own credential files under $CREW_HOME: model keys, IM credentials, the machine's ssh password, the
 * pairing token. Bots read anything else on the machine; these they never do, whatever tool they reach for.
 */
const CREDENTIAL_FILES = new Set(['config.json', 'moved.json', 'machine.json', 'lease.json', 'instance.json', join('pi-agent', 'auth.json')].map((n) => resolve(home, n)));
export const isCredentialFile = (p: string) => CREDENTIAL_FILES.has(resolve(p)) || /(^|\/)\.env(\.|$)/.test(p);

/**
 * The memory store. A bot reads its own memory through `recall`, which answers for its own owner only;
 * the files underneath hold every bot's memory and the user's whole profile, so they are not readable
 * as files by anyone.
 */
export const isMemoryFile = (p: string) => {
  const r = resolve(config.memoryDir);
  const q = resolve(p);
  return q === r || q.startsWith(r + '/');
};

/** What pi should be told about one hand-written model id ("provider/model-id"). */
export function metaOf(spec: string | undefined): ModelInfo | undefined {
  return (spec ? file.modelMeta?.[spec] : undefined) ?? file.modelInfo;
}

/** The key the four direct-to-OpenRouter calls use (drawing, web search, embeddings, the memory engine). */
export const orKey = () => file.providerKeys?.openrouter?.trim() || process.env.OPENROUTER_API_KEY || undefined;

/** The config file as it is right now (not the startup snapshot): used for values that may change while running, e.g. IM credentials. */
export function readFileConfig(): FileConfig {
  if (!existsSync(cfgPath)) return {};
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf8')) as FileConfig;
  } catch {
    return {};
  }
}

/** Merge keys into config.json (atomic rename, mode 600). Undefined values delete the key. */
export function writeConfigKeys(patch: Record<string, string | undefined>) {
  updateConfigFile((cur) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete cur[k];
      else cur[k] = v;
    }
  });
}

/** Read-modify-write config.json in place (atomic rename, mode 600) for nested values such as per-bot IM accounts. */
export function updateConfigFile(mutate: (cur: Record<string, unknown>) => void) {
  const cur = readFileConfig() as Record<string, unknown>;
  mutate(cur);
  const tmp = cfgPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, cfgPath);
  try {
    chmodSync(cfgPath, 0o600);
  } catch {
    /* ignore */
  }
  reloadConfig();
}
