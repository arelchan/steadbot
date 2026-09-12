import { setRuntime, healRuntimeTarget } from './runtime';
import type { AgentService } from './agent';
import { showIdentity, getState, setState, select, setTyping, pushToast, resolvePending, removeBot, removeMatter, upsertSkill, upsertIntegration, clearThread, uid, setRemoteSink, remoteApply } from '../store';
import { botThread, type Channel, type FileRef, type ThreadId } from '../types';
import type { ClientMessage, ServerMessage } from '../types';
import { t } from '../i18n';
import { absorbModels } from './models';


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
  private timer: ReturnType<typeof setTimeout> | undefined;
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
      dropEvent: (id) => this.send({ type: 'drop_event', id }),
      deleteMatter: (id) => this.send({ type: 'delete_matter', id }),
      patchSkill: (botId, name, patch) => this.send({ type: 'patch_skill', botId, name, patch }),
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
    clearTimeout(this.timer);
    setRemoteSink(null);
    this.ws?.close();
  }

  /**
   * 同一时刻只留一条连接。
   *
   * 掉线后会排一个重连定时器；这期间用户随手做点什么（改个设置、发条消息）都会走 send()，
   * 它看到 socket 已经 CLOSED 就立刻补连一条——然后那个定时器又连了一条。两条都开着、
   * 两个 onmessage 都在收，每一帧都被处理两遍。消息、事项按 id 覆盖，看不出来；通知是每次新建
   * 一条，于是右下角同一句话弹两次。所以：连之前先把上一条拆干净，回调也认自己那条 socket。
   */
  private connect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const prev = this.ws;
    if (prev) {
      prev.onopen = prev.onmessage = prev.onclose = prev.onerror = null;
      if (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING) prev.close();
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      remoteApply(() => setState({ online: true }));
      for (const m of this.outbox) ws.send(m);
      this.outbox = [];
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
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
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  /** 出向这条线以前是 send(o: object)——35 种消息全靠字面量拼，打错 type、漏个必填全都编译通过。 */
  private send(o: ClientMessage) {
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

  submitLogin(messageId: string, askId: string, values: Record<string, string>) {
    this.send({ type: 'submit_login', messageId, askId, values });
  }

  connectChannel(botId: string, channel: Channel) {
    this.send({ type: 'connect_channel', botId, channel });
  }

  disconnectChannel(botId: string, channel: Channel) {
    this.send({ type: 'disconnect_channel', botId, channel });
  }

  computerPower(on: boolean) {
    this.send({ type: 'computer_power', on });
  }

  dropEvent(id: string) {
    this.send({ type: 'drop_event', id });
  }

  runRoutine(botId: string, routineId: string) {
    this.send({ type: 'run_routine', botId, routineId });
  }

  computerFocus() {
    this.send({ type: 'computer_focus' });
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
          setState({ ...m.state, events: m.state.events ?? [], skills: m.state.skills ?? [], library: m.state.library ?? [], integrations: m.state.integrations ?? [], typing: m.state.typing ?? {}, runtime: m.state.runtime, settings: m.state.settings, computer: m.state.computer, selection: valid(s.selection) ? s.selection : first ? 'week' : 'draft-bot' });
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
        case 'event':
          setState((s) => ({ events: upsert(s.events, m.event) }));
          break;
        case 'event_deleted':
          setState((s) => ({ events: s.events.filter((e) => e.id !== m.id) }));
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
          // The only time 身份 opens by itself: a bot that was just born, so its name, role and avatar can be
          // watched as they arrive. Walking into the same bot tomorrow shows the workspace alone.
          showIdentity();
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
        case 'computer':
          setState({ computer: m.computer });
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
        // 设置 的两页：连上就送过来，之后变了再送一次，所以打开设置不用再去问一趟。
        case 'models':
          setState({ models: absorbModels(m.page) });
          break;
        case 'usage':
          setState({ usage: m.report });
          break;
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
        // 升级那三种不走这条线：它们来自 services/upgrade.ts 单独连的那条 socket——
        // 升级永远由**本机**的 EverBot 执行，哪怕 App 正指着云上的 runtime（见那个文件的注释）。
        // 这里列出来不是摆设：少列一个，下面的 never 就会报错。
        case 'upgrade_status':
        case 'upgrade_log':
        case 'upgrade_done':
          break;
        default: {
          // 协议对不上就是编译错误，不是运行时的沉默：服务端加了一种消息，这里没接，这一行会红。
          const unhandled: never = m;
          console.warn('[crew] 收到不认识的消息', unhandled);
        }
      }
    });
  }
}

// Module-level singletons (state, listeners, the WS client) cannot be hot-swapped safely: a stale
// copy would keep receiving server events while React renders from the new one. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
