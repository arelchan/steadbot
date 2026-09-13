/**
 * AgentService is the seam the backend plugs in at: the UI calls these methods and listens to the store, and
 * WsAgentService is the one implementation. There is no in-browser stand-in — nothing on this screen is ever
 * simulated, so anything the user sees a bot say, a bot really said.
 */
import { wsUrl, httpBase, authHeaders } from './runtime';
import type { Channel, ThreadId, TodoStatus, FileRef } from '../types';
import { WsAgentService } from './ws-agent';
import { t } from '../i18n';

export interface AgentService {
  onUserMessage(threadId: ThreadId, text: string, via?: Channel, files?: FileRef[]): void;
  /** Move this runtime's home to another server (paired by code). Resolves when the other side has it. */
  migrateTo(url: string, token: string, force?: boolean, onProgress?: (sent: number, total: number) => void): Promise<void>;
  /** Have the local server install crew-server on a remote Linux machine over ssh; streams log lines; resolves with the pairing code. */
  remoteInstall(opts: { host: string; user: string; password?: string; domain?: string }, onLog: (line: string) => void): Promise<{ code: string; url: string }>;
  /** Summon the steward (the product's bot for "where do the bots live"); resolves with its bot id after it has been handed the first sentence. */
  startSteward(intent: 'move_out'): Promise<string>;
  /** Connection card submitted: values go to the local server only. */
  machineConnect(messageId: string, o: { host: string; user: string; password: string; port?: number }): void;
  /** Move card clicked. */
  machineMove(messageId: string): void;
  /** 新 bot 空窗口里的第一条消息：由这句话生成 bot，然后照常处理这句话。 */
  onDraftMessage(text: string): void;
  onPendingChoice(pendingId: string, optionId: string): void;
  /** 凭据卡提交：值只发给后端，不进本地状态 */
  submitSecrets(messageId: string, integrationId: string, values: Record<string, string>): void;
  submitLogin(messageId: string, askId: string, values: Record<string, string>): void;
  /** 把一个 bot 接到某个 IM：后端往它的会话里发凭据卡；它在那边会是一个独立的机器人 */
  connectChannel(botId: string, channel: Channel): void;
  /** 把一个 bot 从某个 IM 断开：停掉那边的机器人，删掉凭据 */
  disconnectChannel(botId: string, channel: Channel): void;
  /** 唤醒 / 休眠 bot 们共用的电脑 */
  computerPower(on: boolean): void;
  /** 把电脑的浏览器窗口切到用户面前（bot 跑在用户自己电脑上时） */
  computerFocus(): void;
  /** 例行任务试跑：不等到点，现在就让它跑一次 */
  runRoutine(botId: string, routineId: string): void;
  dropEvent(id: string): void;
  /** 往上翻：把这条线更早的消息要回来。首屏只给最近若干条，够不着的靠它。 */
  loadMore(threadId: ThreadId): void;
  start(): void;
  stop(): void;
}

export const statusLabel = (s: TodoStatus) => t(`status.${s}`);

/** Which server this App talks to: the machine the user paired with, else the one `steadbot` started (VITE_CREW_WS). */
const WS_URL = wsUrl;
/** No address at all means the App was started without a server — see `hasServer` in App.tsx. */
export const hasServer = !!WS_URL;
const HTTP_BASE = httpBase;

/** Upload one attachment for a thread; the backend stores it in the bot's workspace and returns the FileRef. */
export async function uploadFile(threadId: ThreadId, file: File): Promise<FileRef> {
  if (!HTTP_BASE) throw new Error(t('err.noServer'));
  const r = await fetch(`${HTTP_BASE}/upload/${encodeURIComponent(threadId)}?name=${encodeURIComponent(file.name || 'file')}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream', ...authHeaders() } });
  const j = (await r.json()) as FileRef & { error?: string };
  if (!r.ok) throw new Error(j.error || t('err.uploadFailed', { status: String(r.status) }));
  return j;
}
/* ── memory (MemoryView): four kinds the engine keeps, read from it; the few writes go back through it ── */
export interface ProfileEntry { category?: string; description: string; evidence?: string }
export interface TraitEntry { trait?: string; description: string; basis?: string; evidence?: string }
export interface ProfileDoc { summary: string; explicit: ProfileEntry[]; traits: TraitEntry[]; at: number }
export interface EpisodeItem { id: string; subject: string; summary: string; content: string; at: string; senders: string[]; session: string }
export interface CaseItem { id: string; botId: string; intent: string; approach: string; insight: string; quality: number; at: string; session: string }
export interface SkillItem { id: string; botId: string; name: string; description: string; content: string; confidence: number; maturity: number; sources: string[] }

async function memGet<T>(path: string, fallback: T): Promise<T> {
  if (!HTTP_BASE) return fallback;
  try {
    const r = await fetch(`${HTTP_BASE}/memory/${path}`, { headers: authHeaders() });
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function memPost(path: string, body: unknown): Promise<boolean> {
  if (!HTTP_BASE) return false;
  try {
    const r = await fetch(`${HTTP_BASE}/memory/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}
export interface KDoc { docId: string; category: string; title: string; topics: number; at: string }
export interface KTopic { id: string; name: string; path: string; depth: number; summary: string; content?: string }
export interface KDocDetail { docId: string; category: string; title: string; summary: string; source?: string; topics: KTopic[] }

export const knowledge = {
  docs: () => memGet<{ alive: boolean; items: KDoc[]; categories: { id: string; docs: number }[] }>('knowledge', { alive: false, items: [], categories: [] }),
  doc: (id: string) => memGet<{ doc: KDocDetail | null }>(`knowledge/doc?id=${encodeURIComponent(id)}`, { doc: null }),
  topic: (id: string) => memGet<{ topic: KTopic | null }>(`knowledge/topic?id=${encodeURIComponent(id)}`, { topic: null }),
  search: (q: string) => memGet<{ hits: { topic: KTopic; doc: string; score: number }[] }>(`knowledge/search?q=${encodeURIComponent(q)}`, { hits: [] }),
  remove: (docId: string) => memPost('knowledge/remove', { docId }),
  /** Splitting a document takes a minute or more, so this resolves when the engine has taken it, not when it is done. */
  add: async (file: File, title: string): Promise<boolean> => {
    if (!HTTP_BASE) return false;
    try {
      const r = await fetch(`${HTTP_BASE}/memory/knowledge/add?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title || file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream', ...authHeaders() },
        body: file,
      });
      return r.ok;
    } catch {
      return false;
    }
  },
};

export const memory = {
  profile: () => memGet<{ alive: boolean; profile: ProfileDoc | null }>('profile', { alive: false, profile: null }),
  editProfile: (kind: 'explicit' | 'trait', index: number, text: string | null) => memPost('profile', { kind, index, text }),
  addFact: (text: string) => memPost('fact', { text }),
  correct: (text: string) => memPost('correct', { text }),
  episodes: (q: string, page = 1) => memGet<{ items: EpisodeItem[]; total: number }>(`episodes?q=${encodeURIComponent(q)}&page=${page}`, { items: [], total: 0 }),
  cases: (bot?: string) => memGet<{ items: CaseItem[] }>(`cases${bot ? `?bot=${encodeURIComponent(bot)}` : ''}`, { items: [] }),
  skills: (bot?: string) => memGet<{ items: SkillItem[]; crew: SkillItem[] }>(`skills${bot ? `?bot=${encodeURIComponent(bot)}` : ''}`, { items: [], crew: [] }),
  promote: (botId: string, name: string) => memPost('promote', { botId, name }),
  adopt: (botId: string, name: string) => memPost('adopt', { botId, name }),
};

// One instance per page, surviving Vite HMR: a re-evaluated module must not create a second,
// never-started client that swallows clicks.
const g = globalThis as unknown as { __crewAgent?: AgentService };
export const agent: AgentService = g.__crewAgent ?? (g.__crewAgent = new WsAgentService(WS_URL));

// Module-level singletons (state, listeners, the WS client) cannot be hot-swapped safely: a stale
// copy would keep receiving server events while React renders from the new one. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
