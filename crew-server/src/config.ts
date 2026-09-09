import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Product configuration. Model keys are bundled with the product, not entered by end users:
 * put them in `$CREW_HOME/config.json` under `keys` (or in the environment) and they are
 * exported to process.env before pi's ModelRuntime resolves provider auth.
 */
interface FileConfig {
  model?: string; // "provider/model-id", e.g. "anthropic/claude-sonnet-4-6"
  lightModel?: string; // cheap model for bot inference and summaries
  searchModel?: string; // OpenRouter model used with the web plugin for web_search; defaults to lightModel
  imageModel?: string; // "provider/model-id" for avatars, e.g. "openrouter/google/gemini-2.5-flash-image"
  /** Metadata for a model pi's catalog does not know yet (registered on top of the provider). */
  modelInfo?: { contextWindow?: number; maxTokens?: number; reasoning?: boolean; vision?: boolean; costIn?: number; costOut?: number };
  keys?: Record<string, string>; // e.g. { ANTHROPIC_API_KEY: "...", OPENROUTER_API_KEY: "..." }
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
  fake?: boolean;
}

const home = process.env.CREW_HOME ?? join(homedir(), '.crew');
mkdirSync(home, { recursive: true });

let file: FileConfig = {};
const cfgPath = join(home, 'config.json');
if (existsSync(cfgPath)) {
  try {
    file = JSON.parse(readFileSync(cfgPath, 'utf8')) as FileConfig;
  } catch (e) {
    console.warn(`[crew] cannot parse ${cfgPath}:`, e);
  }
}
for (const [k, v] of Object.entries(file.keys ?? {})) if (!process.env[k]) process.env[k] = v;

export const config = {
  home,
  piAgentDir: join(home, 'pi-agent'), // isolated pi agentDir: our skills/extensions only
  dataFile: join(home, 'crew.json'),
  avatarsDir: join(home, 'avatars'),
  botsDir: join(home, 'bots'),
  sharedDir: join(home, 'shared'),
  port: Number(process.env.CREW_PORT ?? file.port ?? 5200),
  authToken: process.env.CREW_AUTH_TOKEN ?? file.authToken,
  bind: process.env.CREW_BIND ?? file.bind ?? ((process.env.CREW_AUTH_TOKEN ?? file.authToken) ? '0.0.0.0' : '127.0.0.1'),
  publicUrl: (process.env.CREW_PUBLIC_URL ?? file.publicUrl ?? `http://localhost:${Number(process.env.CREW_PORT ?? file.port ?? 5200)}`).replace(/\/$/, ''),
  model: process.env.CREW_MODEL ?? file.model,
  lightModel: process.env.CREW_LIGHT_MODEL ?? file.lightModel,
  searchModel: process.env.CREW_SEARCH_MODEL ?? file.searchModel,
  imageModel: process.env.CREW_IMAGE_MODEL ?? file.imageModel ?? 'openrouter/google/gemini-2.5-flash-image',
  modelInfo: file.modelInfo,
  fake: process.env.CREW_FAKE === '1' || file.fake === true,
  /** whether external agents installed on this machine are used here at all (0 = only borrow the user's computer's; see host.ts) */
  localAgents: process.env.CREW_LOCAL_AGENTS !== '0',
  askTimeoutMs: Number(process.env.CREW_ASK_TIMEOUT_MS ?? file.askTimeoutMs ?? 30 * 60 * 1000),
  google: file.googleClientId && file.googleClientSecret ? { clientId: file.googleClientId, clientSecret: file.googleClientSecret } : undefined,
  composio: (process.env.CREW_COMPOSIO_API_KEY ?? file.composioApiKey) ? { apiKey: (process.env.CREW_COMPOSIO_API_KEY ?? file.composioApiKey)! } : undefined,
  connectionsDir: join(home, 'connections'),
  libraryDir: join(home, 'library'),
  handoffDepth: 3,
};

for (const d of [config.piAgentDir, config.avatarsDir, config.botsDir, config.sharedDir, join(config.piAgentDir, 'skills')]) {
  mkdirSync(d, { recursive: true });
}

export const configPath = cfgPath;

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
}
