import { setRuntime, healRuntimeTarget } from './runtime';
import type { AgentService } from './agent';
import { getState, setState, select, setTyping, pushToast, resolvePending, removeBot, removeMatter, upsertSkill, upsertIntegration, clearThread, uid, setRemoteSink, remoteApply } from '../store';
import { botThread, type Action, type Bot, type Channel, type CrewSettings, type FileRef, type Integration, type LibraryEntry, type Matter, type Message, type Pending, type RuntimeInfo, type SkillDoc, type ThreadId, type Todo } from '../types';
import { t } from '../i18n';

type Snapshot = Pick<ReturnType<typeof getState>, 'bots' | 'matters' | 'todos' | 'pendings' | 'actions' | 'messages' | 'sharedProfile'> & { skills?: SkillDoc[]; library?: LibraryEntry[]; integrations?: Integration[]; typing?: Record<string, string[]>; runtime?: RuntimeInfo; settings?: CrewSettings };

type ServerMessage =
  | { type: 'migrate_progress'; sent: number; total: number }
  | { type: 'steward'; botId: string }
  | { type: 'switch_runtime'; url: string; token: string; name?: string }
  | { type: 'snapshot'; state: Snapshot; mode: 'live' | 'fake' }
  | { type: 'message'; message: Message }
  | { type: 'message_patch'; id: string; patch: Partial<Message> }
  | { type: 'typing'; threadId: ThreadId; botId: string; on: boolean }
  | { type: 'todo'; todo: Todo }
  | { type: 'pending'; pending: Pending }
  | { type: 'action'; action: Action }
  | { type: 'bot'; bot: Bot }
  | { type: 'matter'; matter: Matter }
  | { type: 'shared_profile'; lines: string[] }
  | { type: 'settings'; settings: CrewSettings }
  | { type: 'toast'; toast: { botId: string; text: string; threadId: ThreadId } }
  | { type: 'bot_created'; bot: Bot; draftId?: string }
  | { type: 'bot_deleted'; id: string }
  | { type: 'matter_deleted'; id: string }
  | { type: 'skill'; skill: SkillDoc }
  | { type: 'integration'; integration: Integration }
  | { type: 'integration_deleted'; id: string }
  | { type: 'thread_cleared'; threadId: ThreadId }
  | { type: 'remote_install_log'; line: string }
  | { type: 'remote_install_done'; code?: string; url?: string; error?: string }
  | { type: 'runtime'; runtime: RuntimeInfo }
  | { type: 'migrated'; direction: 'to' | 'from'; url: string; bots: number }
  | { type: 'error'; error: string };

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

/** Strip undefined so "delete this field" survives JSON (server treats null as delete). */
const nullify = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

/**
 * The live backend: crew-server over WebSocket. The server owns state; every change arrives as an
 * event and is applied to the local store. Config edits made in the UI are forwarded back.
 */
export class WsAgentService implements AgentService {
  private ws: WebSocket | undefined;
  private outbox: string[] = [];
  private retry = 0;
  private stopped = false;
  mode: 'live' | 'fake' | 'offline' = 'offline';
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  start() {
    this.stopped = false;
    setRemoteSink({
      patchBot: (id, patch) => this.send({ type: 'patch_bot', id, patch: nullify(patch) }),
      patchMatter: (id, patch) => this.send({ type: 'patch_matter', id, patch: nullify(patch) }),
      addMatter: (m) => this.send({ type: 'create_matter', id: m.id, title: m.title, summary: m.summary, memberIds: [m.ownerBotId, ...m.participantBotIds], leadId: m.ownerBotId }),
      setSharedProfile: (lines) => this.send({ type: 'set_shared_profile', lines }),
      undoAction: (actionId) => this.send({ type: 'undo_action', actionId }),
      deleteBot: (id) => this.send({ type: 'delete_bot', id }),
      deleteMatter: (id) => this.send({ type: 'delete_matter', id }),
      patchSkill: (name, patch) => this.send({ type: 'patch_skill', name, patch }),
      mountLibrarySkill: (botId, slug) => this.send({ type: 'mount_library_skill', botId, slug }),
      addIntegration: (i) => this.send({ type: 'add_integration', integration: i }),
      patchIntegration: (id, patch) => this.send({ type: 'patch_integration', id, patch: nullify(patch) }),
      setSettings: (patch) => this.send({ type: 'set_settings', patch }),
      removeIntegration: (id) => this.send({ type: 'remove_integration', id }),
      testIntegration: (id) => this.send({ type: 'test_integration', id }),
      clearThread: (threadId) => this.send({ type: 'clear_thread', threadId }),
    });
    this.connect();
  }

  stop() {
    this.stopped = true;
    setRemoteSink(null);
    this.ws?.close();
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      remoteApply(() => setState({ online: true }));
      for (const m of this.outbox) ws.send(m);
      this.outbox = [];
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      this.mode = 'offline';
      if (this.installWaiter) {
        this.installWaiter.reject(new Error(t('err.installLinkLost')));
        this.installWaiter = null;
      }
      remoteApply(() => setState({ online: false }));
      if (this.stopped) return;
      // A few failures in a row usually means the stored pairing is stale (the machine was reinstalled); the
      // EverBot on this computer knows the current one, so ask it and follow before retrying forever.
      if (this.retry === 3) void healRuntimeTarget().then((changed) => changed && window.location.reload());
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private send(o: object) {
    const data = JSON.stringify(o);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else {
      this.outbox.push(data);
      // Not started yet (or torn down): connect lazily so nothing waits in the queue forever.
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.stopped = false;
        this.connect();
      }
    }
  }

  /* ---- AgentService ---- */

  onUserMessage(threadId: ThreadId, text: string, via?: Channel, files?: FileRef[]) {
    const id = uid();
    const attached = files?.length ? files : undefined;
    remoteApply(() => setState((s) => ({ messages: [...s.messages, { id, threadId, author: 'user', text, ts: Date.now(), via, files: attached }] })));
    this.send({ type: 'user_message', id, threadId, text, via, files: attached });
  }

  private migrateWaiters: { resolve: () => void; reject: (e: Error) => void; onProgress?: (sent: number, total: number) => void }[] = [];
  migrateTo(url: string, token: string, force?: boolean, onProgress?: (sent: number, total: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.migrateWaiters.push({ resolve, reject, onProgress });
      this.send({ type: 'migrate_to', url, token, force });
    });
  }

  private stewardWaiters: { resolve: (botId: string) => void; reject: (e: Error) => void }[] = [];
  startSteward(intent: 'move_out'): Promise<string> {
    return new Promise((resolve, reject) => {
      this.stewardWaiters.push({ resolve, reject });
      this.send({ type: 'steward', intent });
    });
  }
  /** Connection card submitted: the values go to the local server only (it keeps them in its credential file), never into local state. */
  machineConnect(messageId: string, o: { host: string; user: string; password: string; port?: number }) {
    this.send({ type: 'machine_connect', messageId, ...o });
  }
  machineMove(messageId: string) {
    this.send({ type: 'machine_move', messageId });
  }

  private installWaiter: { resolve: (r: { code: string; url: string }) => void; reject: (e: Error) => void; onLog: (l: string) => void } | null = null;
  remoteInstall(opts: { host: string; user: string; password?: string; domain?: string }, onLog: (line: string) => void): Promise<{ code: string; url: string }> {
    return new Promise((resolve, reject) => {
      this.installWaiter = { resolve, reject, onLog };
      this.send({ type: 'remote_install', ...opts });
    });
  }

  onDraftMessage(text: string) {
    this.send({ type: 'draft_message', id: uid(), text });
  }

  submitSecrets(messageId: string, integrationId: string, values: Record<string, string>) {
    this.send({ type: 'submit_secrets', messageId, integrationId, values });
  }

  connectChannel(botId: string, channel: Channel) {
    this.send({ type: 'connect_channel', botId, channel });
  }

  disconnectChannel(botId: string, channel: Channel) {
    this.send({ type: 'disconnect_channel', botId, channel });
  }

  computerPower(botId: string, on: boolean) {
    this.send({ type: 'computer_power', botId, on });
  }

  onPendingChoice(pendingId: string, optionId: string) {
    const p = getState().pendings.find((x) => x.id === pendingId);
    const label = p?.options.find((o) => o.id === optionId)?.label ?? optionId;
    remoteApply(() => resolvePending(pendingId, label));
    this.send({ type: 'pending_choice', pendingId, optionId });
  }

  /* ---- inbound ---- */

  private handle(m: ServerMessage) {
    remoteApply(() => {
      switch (m.type) {
        case 'snapshot': {
          this.mode = m.mode;
          const s = getState();
          const valid = (sel: string) => {
            if (!sel.includes(':')) return true;
            const [k, id] = sel.split(':');
            return k === 'bot' ? m.state.bots.some((b) => b.id === id) : m.state.matters.some((x) => x.id === id);
          };
          const first = m.state.bots.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned))[0];
          // Times are the user's: tell the machine which zone this browser is in (it may run on UTC).
          {
            // Only seed it: once the user has a zone (theirs, or one they picked), never overwrite it from a browser.
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz && !m.state.settings?.timezone) this.send({ type: 'set_settings', patch: { timezone: tz } });
          }
          setState({ ...m.state, skills: m.state.skills ?? [], library: m.state.library ?? [], integrations: m.state.integrations ?? [], typing: m.state.typing ?? {}, runtime: m.state.runtime, settings: m.state.settings, selection: valid(s.selection) ? s.selection : first ? botThread(first.id) : 'draft-bot' });
          break;
        }
        case 'message':
          setState((s) => ({ messages: upsert(s.messages, m.message) }));
          break;
        case 'message_patch':
          setState((s) => ({ messages: s.messages.map((x) => (x.id === m.id ? { ...x, ...m.patch } : x)) }));
          break;
        case 'typing':
          setTyping(m.threadId, m.botId, m.on);
          break;
        case 'todo':
          setState((s) => ({ todos: upsert(s.todos, m.todo) }));
          break;
        case 'pending':
          setState((s) => ({ pendings: upsert(s.pendings, m.pending) }));
          break;
        case 'action':
          setState((s) => ({ actions: upsert(s.actions, m.action) }));
          break;
        case 'bot':
          setState((s) => ({ bots: upsert(s.bots, m.bot) }));
          break;
        case 'bot_created':
          setState((s) => ({ bots: upsert(s.bots, m.bot) }));
          select(botThread(m.bot.id));
          break;
        case 'skill':
          upsertSkill(m.skill);
          break;
        case 'integration':
          upsertIntegration(m.integration);
          break;
        case 'thread_cleared':
          clearThread(m.threadId);
          break;
        case 'integration_deleted':
          setState((s) => ({ integrations: s.integrations.filter((x) => x.id !== m.id) }));
          break;
        case 'bot_deleted':
          if (getState().bots.some((b) => b.id === m.id)) removeBot(m.id);
          break;
        case 'matter_deleted':
          if (getState().matters.some((x) => x.id === m.id)) remoteApply(() => removeMatter(m.id));
          break;
        case 'matter':
          setState((s) => ({ matters: upsert(s.matters, m.matter) }));
          break;
        case 'shared_profile':
          setState({ sharedProfile: m.lines });
          break;
        case 'settings':
          remoteApply(() => setState({ settings: m.settings }));
          break;
        case 'toast':
          // The bot already decided this was worth saying; we only skip it when the user is already looking.
          if (getState().selection !== m.toast.threadId) pushToast(m.toast);
          break;
        case 'remote_install_log':
          this.installWaiter?.onLog(m.line);
          break;
        case 'remote_install_done': {
          const w = this.installWaiter;
          this.installWaiter = null;
          if (!w) break;
          if (m.error || !m.code) w.reject(new Error(m.error ?? t('err.noPairingCode')));
          else w.resolve({ code: m.code, url: m.url ?? '' });
          break;
        }
        case 'runtime':
          setState({ runtime: m.runtime });
          break;
        case 'steward':
          this.stewardWaiters.splice(0).forEach((w) => w.resolve(m.botId));
          break;
        case 'switch_runtime':
          // The bots now live on another machine: follow them (the token is what this browser needs to talk to it).
          setRuntime({ kind: 'remote', url: m.url, token: m.token, name: m.name, provider: 'byo' });
          setTimeout(() => window.location.reload(), 800);
          break;
        case 'migrate_progress':
          this.migrateWaiters.forEach((x) => x.onProgress?.(m.sent, m.total));
          break;
        case 'migrated': {
          const w = this.migrateWaiters.splice(0);
          w.forEach((x) => x.resolve());
          break;
        }
        case 'error': {
          const w = this.migrateWaiters.splice(0);
          w.forEach((x) => x.reject(new Error(m.error)));
          this.stewardWaiters.splice(0).forEach((x) => x.reject(new Error(m.error)));
          console.warn('[crew]', m.error);
          break;
        }
      }
    });
  }
}

// Module-level singletons (state, listeners, the WS client) cannot be hot-swapped safely: a stale
// copy would keep receiving server events while React renders from the new one. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
