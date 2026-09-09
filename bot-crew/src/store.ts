import { useSyncExternalStore } from 'react';
import type { Action, Bot, Integration, Layout, Matter, Message, Panel, Panels, Pending, Selection, SkillDoc, State, ThreadId, Todo, Toast } from './types';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS } from './types';
import { seedState } from './data/seed';

const KEY = 'bot-crew:v1';

let state: State = load();
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      const bots: Bot[] = parsed.bots.map((b) => ({ ...({ routines: [], notify: true, pinned: false, skills: [] } as Partial<Bot>), ...b }));
      const matters: Matter[] = parsed.matters.map((m) => ({ ...({ notify: true, pinned: false } as Partial<Matter>), ...m }));
      return {
        ...parsed,
        bots,
        matters,
        skills: parsed.skills ?? [],
        library: parsed.library ?? [],
        integrations: parsed.integrations ?? [],
        toasts: [],
        typing: {},
        lastSeen: parsed.lastSeen ?? {},
        panel: { mode: 'board' },
        panels: parsed.panels ?? { identity: true, tasks: true },
        layout: { ...DEFAULT_LAYOUT, ...(parsed.layout ?? {}) },
        focusMessageId: undefined,
        online: undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return seedState();
}

function persist() {
  try {
    const { toasts: _t, typing: _y, panel: _p, focusMessageId: _f, online: _o, ...rest } = state;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  persist();
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
    () => selector(state),
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- remote sink: config edits made in the UI are forwarded to the backend ---------- */

export interface RemoteSink {
  patchBot(id: string, patch: Partial<Bot>): void;
  patchMatter(id: string, patch: Partial<Matter>): void;
  addMatter(m: Matter): void;
  setSharedProfile(lines: string[]): void;
  undoAction(id: string): void;
  deleteBot(id: string): void;
  deleteMatter(id: string): void;
  patchSkill(name: string, patch: { description?: string; body?: string }): void;
  mountLibrarySkill(botId: string, slug: string): void;
  addIntegration(i: Partial<Integration> & { kind: Integration['kind']; name: string; id: string }): void;
  patchIntegration(id: string, patch: Partial<Integration>): void;
  removeIntegration(id: string): void;
  testIntegration(id: string): void;
  clearThread(threadId: ThreadId): void;
}
let remote: RemoteSink | null = null;
let applyingRemote = 0;
export const setRemoteSink = (sink: RemoteSink | null) => {
  remote = sink;
};
/** Run a state change that came from the backend without echoing it back. */
export function remoteApply(fn: () => void) {
  applyingRemote += 1;
  try {
    fn();
  } finally {
    applyingRemote -= 1;
  }
}
const forward = () => (applyingRemote ? null : remote);

/* ---------- mutations ---------- */

export const select = (selection: Selection) => setState((s) => ({ selection, panel: s.selection === selection ? s.panel : { mode: 'board' } }));
export const setPanel = (panel: Panel) => setState({ panel });
export const togglePanel = (k: keyof Panels) => {
  setState((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } }));
  clampLayout();
};
/** Re-apply the width limits (window resized, a panel opened): the side columns give way first. */
export const clampLayout = () => {
  for (const k of ['side', 'right', 'sidebar'] as const) setColumnWidth(k, getState().layout[k]);
};
export const setColumnWidth = (k: keyof Layout, px: number) =>
  setState((s) => {
    const [lo, hi0] = LAYOUT_LIMITS[k];
    // whatever gets dragged, the conversation keeps at least 360px
    const others = (k === 'sidebar' ? 0 : s.layout.sidebar) + (k === 'right' || !s.panels.identity ? 0 : s.layout.right) + (k === 'side' || !s.panels.tasks ? 0 : s.layout.side);
    const hi = Math.max(lo, Math.min(hi0, (typeof window === 'undefined' ? 1e9 : window.innerWidth) - others - 360));
    return { layout: { ...s.layout, [k]: Math.round(Math.min(hi, Math.max(lo, px))) } };
  });
export const openTask = (todoId: string) => setState({ panel: { mode: 'task', todoId } });
export const focusMessage = (id?: string) => setState({ focusMessageId: id });

export const addMessage = (m: Omit<Message, 'id'> & { id?: string }): Message => {
  const msg: Message = { id: m.id ?? uid(), ...m } as Message;
  setState((s) => ({ messages: [...s.messages, msg] }));
  return msg;
};

export const patchMessage = (id: string, patch: Partial<Message>) =>
  setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

export const addTodo = (t: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo => {
  const todo: Todo = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), ...t };
  setState((s) => ({ todos: [...s.todos, todo] }));
  return todo;
};

export const patchTodo = (id: string, patch: Partial<Todo>) =>
  setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));

export const addPending = (p: Omit<Pending, 'id' | 'createdAt'>): Pending => {
  const pending: Pending = { id: uid(), createdAt: Date.now(), ...p };
  setState((s) => ({ pendings: [...s.pendings, pending] }));
  return pending;
};

export const resolvePending = (id: string, choice: string) =>
  setState((s) => ({
    pendings: s.pendings.map((p) => (p.id === id ? { ...p, resolved: { at: Date.now(), choice } } : p)),
  }));

export const addAction = (a: Omit<Action, 'id' | 'ts'>): Action => {
  const action: Action = { id: uid(), ts: Date.now(), ...a };
  setState((s) => ({ actions: [...s.actions, action] }));
  return action;
};

export const undoAction = (id: string) => {
  setState((s) => ({ actions: s.actions.map((a) => (a.id === id ? { ...a, undone: true } : a)) }));
  forward()?.undoAction(id);
};

export const patchBot = (id: string, patch: Partial<Bot>) => {
  setState((s) => ({ bots: s.bots.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  forward()?.patchBot(id, patch);
};

export const addBot = (b: Omit<Bot, 'id' | 'createdAt'>): Bot => {
  const bot: Bot = { id: uid(), createdAt: Date.now(), ...b };
  setState((s) => ({ bots: [...s.bots, bot] }));
  return bot;
};

/** Remove a bot locally (its thread, todos, pendings, actions go with it) and tell the backend. */
export const removeBot = (id: string) => {
  const thread = `bot:${id}`;
  setState((s) => ({
    bots: s.bots.filter((b) => b.id !== id),
    messages: s.messages.filter((m) => m.threadId !== thread),
    todos: s.todos.filter((t) => t.botId !== id),
    pendings: s.pendings.filter((p) => p.botId !== id),
    actions: s.actions.filter((a) => a.botId !== id),
    matters: s.matters
      .map((m) => (m.participantBotIds.includes(id) || m.ownerBotId === id ? { ...m, participantBotIds: m.participantBotIds.filter((x) => x !== id), ownerBotId: m.ownerBotId === id ? m.participantBotIds.filter((x) => x !== id)[0] ?? '' : m.ownerBotId } : m))
      .filter((m) => m.ownerBotId),
    selection: s.selection === thread ? (s.bots.find((b) => b.id !== id) ? (`bot:${s.bots.find((b) => b.id !== id)!.id}` as Selection) : 'draft-bot') : s.selection,
  }));
  forward()?.deleteBot(id);
};

/** Dissolve a group locally (thread, todos, pendings) and tell the backend. Bots are untouched. */
export const removeMatter = (id: string) => {
  const thread = `matter:${id}`;
  setState((s) => ({
    matters: s.matters.filter((m) => m.id !== id),
    messages: s.messages.filter((m) => m.threadId !== thread),
    todos: s.todos.filter((t) => t.matterId !== id),
    pendings: s.pendings.filter((p) => p.threadId !== thread),
    selection: s.selection === thread ? (s.bots[0] ? (`bot:${s.bots[0].id}` as Selection) : 'draft-bot') : s.selection,
  }));
  forward()?.deleteMatter(id);
};

export const addMatter = (m: Omit<Matter, 'id' | 'createdAt'>): Matter => {
  const matter: Matter = { id: uid(), createdAt: Date.now(), ...m };
  setState((s) => ({ matters: [...s.matters, matter] }));
  forward()?.addMatter(matter);
  return matter;
};

export const patchMatter = (id: string, patch: Partial<Matter>) => {
  setState((s) => ({ matters: s.matters.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  forward()?.patchMatter(id, patch);
};

export const upsertSkill = (doc: SkillDoc) =>
  setState((s) => {
    const i = s.skills.findIndex((k) => k.name === doc.name);
    const skills = s.skills.slice();
    if (i < 0) skills.push(doc);
    else skills[i] = doc;
    return { skills };
  });

export const patchSkill = (name: string, patch: { description?: string; body?: string }) => {
  setState((s) => ({ skills: s.skills.map((k) => (k.name === name ? { ...k, ...patch, updatedAt: Date.now() } : k)) }));
  forward()?.patchSkill(name, patch);
};

/** Mount a library skill on a bot. Live mode: the backend copies the document and patches the bot; local mode: just the name. */
export const mountLibrarySkill = (botId: string, slug: string) => {
  const s = getState();
  const entry = s.library.find((e) => e.slug === slug);
  if (!entry) return;
  const bot = s.bots.find((b) => b.id === botId);
  if (bot && !bot.skills.includes(entry.title)) setState({ bots: s.bots.map((b) => (b.id === botId ? { ...b, skills: [...b.skills, entry.title] } : b)) });
  forward()?.mountLibrarySkill(botId, slug);
};

export const upsertIntegration = (i: Integration) =>
  setState((s) => {
    const idx = s.integrations.findIndex((x) => x.id === i.id);
    const integrations = s.integrations.slice();
    if (idx < 0) integrations.push(i);
    else integrations[idx] = i;
    return { integrations };
  });
export const addIntegration = (i: Partial<Integration> & { kind: Integration['kind']; name: string }) => {
  const full: Integration = { id: uid(), createdAt: Date.now(), status: i.kind === 'mcp' ? 'connecting' : 'off', ...i } as Integration;
  upsertIntegration(full);
  forward()?.addIntegration({ ...i, id: full.id });
  return full;
};
export const patchIntegration = (id: string, patch: Partial<Integration>) => {
  setState((s) => ({ integrations: s.integrations.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  forward()?.patchIntegration(id, patch);
};
export const removeIntegration = (id: string) => {
  setState((s) => ({ integrations: s.integrations.filter((x) => x.id !== id), bots: s.bots.map((b) => ({ ...b, integrationIds: (b.integrationIds ?? []).filter((x) => x !== id) })) }));
  forward()?.removeIntegration(id);
};
export const testIntegration = (id: string) => {
  setState((s) => ({ integrations: s.integrations.map((x) => (x.id === id && x.kind === 'mcp' ? { ...x, status: 'connecting' } : x)) }));
  forward()?.testIntegration(id);
};

/** Clear one thread's transcript and open cards (todos, actions, memory stay); the bot's context is reset server-side. */
export const clearThread = (threadId: ThreadId) => {
  setState((s) => ({
    messages: s.messages.filter((m) => m.threadId !== threadId),
    pendings: s.pendings.filter((p) => p.threadId !== threadId),
    typing: { ...s.typing, [threadId]: [] },
  }));
  forward()?.clearThread(threadId);
};

export const setSharedProfile = (sharedProfile: string[]) => {
  setState({ sharedProfile });
  forward()?.setSharedProfile(sharedProfile);
};

export const setTyping = (threadId: string, botId: string, on: boolean) =>
  setState((s) => {
    const cur = s.typing[threadId] ?? [];
    const next = on ? Array.from(new Set([...cur, botId])) : cur.filter((b) => b !== botId);
    return { typing: { ...s.typing, [threadId]: next } };
  });

export const pushToast = (t: Omit<Toast, 'id' | 'ts'>) => {
  const toast: Toast = { id: uid(), ts: Date.now(), ...t };
  setState((s) => ({ toasts: [...s.toasts, toast] }));
  setTimeout(() => dismissToast(toast.id), 7000);
};

export const dismissToast = (id: string) => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

export const markSeen = (threadId: string) =>
  setState((s) => ({ lastSeen: { ...s.lastSeen, [threadId]: Date.now() } }));

export const unreadCount = (s: State, threadId: string) =>
  s.messages.filter((m) => m.threadId === threadId && m.author === 'bot' && m.ts > (s.lastSeen[threadId] ?? 0)).length;

export const resetAll = () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem('bot-crew:demo-ran');
  state = seedState();
  listeners.forEach((l) => l());
};

/* ---------- derived helpers ---------- */

export const openPendings = (s: State) => s.pendings.filter((p) => !p.resolved);

export const pendingCountFor = (s: State, threadId: string) => openPendings(s).filter((p) => p.threadId === threadId).length;

export const lastMessageOf = (s: State, threadId: string) => {
  const list = s.messages.filter((m) => m.threadId === threadId);
  return list[list.length - 1];
};

// Module-level singletons (state, listeners, the WS client) cannot be hot-swapped safely: a stale
// copy would keep receiving server events while React renders from the new one. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// hmr: reload on update
