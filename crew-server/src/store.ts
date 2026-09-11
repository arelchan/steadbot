import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Computer, CrewEvent, CrewSettings, Action, Bot, Integration, Matter, Message, Pending, Snapshot, ThreadId, Toast, Todo, GrowthEvent, GrowthKind } from './types.ts';
import { uid } from './util.ts';

export type StoreEvent =
  | { type: 'bot'; bot: Bot }
  | { type: 'bot_deleted'; id: string }
  | { type: 'matter_deleted'; id: string }
  | { type: 'integration'; integration: Integration }
  | { type: 'integration_deleted'; id: string }
  | { type: 'thread_cleared'; threadId: ThreadId }
  | { type: 'matter'; matter: Matter }
  | { type: 'todo'; todo: Todo }
  | { type: 'event'; event: CrewEvent }
  | { type: 'event_deleted'; id: string }
  | { type: 'pending'; pending: Pending }
  | { type: 'action'; action: Action }
  | { type: 'message'; message: Message }
  | { type: 'message_patch'; id: string; patch: Partial<Message> }
  | { type: 'shared_profile'; lines: string[] }
  | { type: 'settings'; settings: CrewSettings }
  | { type: 'computer'; computer: Computer }
  | { type: 'typing'; threadId: ThreadId; botId: string; on: boolean }
  | { type: 'toast'; toast: Toast };

/**
 * Product-facing state: bots, matters, todos, pendings, actions and the IM-style transcript.
 * pi keeps the LLM-facing history in its own JSONL session per bot; this is what the UI shows.
 */
export class CrewStore extends EventEmitter {
  data: Snapshot;
  private file: string;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(file: string, seed: () => Snapshot) {
    super();
    this.file = file;
    this.data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Snapshot) : seed();
    this.data.integrations ??= [];
    this.data.events ??= [];
    // 五态并成四态：接下了就是在做，卡住了也是等你。
    for (const t of this.data.todos) {
      if ((t.status as string) === 'open') t.status = 'doing';
      else if ((t.status as string) === 'blocked') t.status = 'waiting';
    }
    for (const b of this.data.bots) {
      b.integrationIds ??= [];
      b.routines ??= [];
      b.skills ??= [];
      b.soul ??= '';
      b.notify ??= true;
      b.pinned ??= false;
      // Bots used to have a computer each; now they share one (desktop.ts).
      delete (b as { desktop?: unknown }).desktop;
    }
    if (!existsSync(file)) this.flush();
  }

  private emitChange(e: StoreEvent) {
    this.emit('change', e);
  }

  private save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 150);
  }

  flush() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  /* ---- bots ---- */
  bot(id: string) {
    return this.data.bots.find((b) => b.id === id);
  }
  addBot(b: Omit<Bot, 'id' | 'createdAt'> & { id?: string }): Bot {
    const bot: Bot = { ...b, id: b.id ?? uid(), createdAt: Date.now() } as Bot;
    this.data.bots.push(bot);
    this.save();
    this.emitChange({ type: 'bot', bot });
    return bot;
  }
  patchBot(id: string, patch: Partial<Bot>, opts?: { growth?: boolean }): Bot | undefined {
    const bot = this.bot(id);
    if (!bot) return undefined;
    // 成长动线：除了明确说不记的（后台归并、诞生时的身份生成），每一处变化都留一笔
    if (opts?.growth !== false && !bot.generating?.identity) this.recordGrowth(bot, patch);
    Object.assign(bot, patch);
    for (const k of Object.keys(patch) as (keyof Bot)[]) if (patch[k] === undefined || patch[k] === null) delete bot[k];
    this.save();
    this.emitChange({ type: 'bot', bot });
    return bot;
  }

  /** Append one line to a bot's 成长动线 (saved + broadcast with the bot). */
  grow(botId: string, kind: GrowthKind, text: string, ts = Date.now()) {
    const bot = this.bot(botId);
    if (!bot) return;
    const ev: GrowthEvent = { id: uid(), ts, kind, text };
    bot.growth = [...(bot.growth ?? []), ev].slice(-500);
    this.save();
    this.emitChange({ type: 'bot', bot });
  }

  private recordGrowth(bot: Bot, patch: Partial<Bot>) {
    const ts = Date.now();
    const push = (kind: GrowthKind, text: string) => {
      bot.growth = [...(bot.growth ?? []), { id: uid(), ts, kind, text }].slice(-500);
    };
    const diff = (a: string[] = [], b: string[] = []) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });
    if (patch.name !== undefined && patch.name !== bot.name && patch.name.trim()) push('renamed', `改名为【${patch.name.trim()}】`);
    if (patch.role !== undefined && patch.role !== bot.role) push('instructions', '调整了工作方式');
    if (patch.soul !== undefined && patch.soul !== bot.soul) push('soul', '调整了人设');
    if (patch.skills) {
      const d = diff(bot.skills, patch.skills);
      for (const x of d.added) push('skill', `沉淀技能【${x}】`);
      for (const x of d.removed) push('skill_removed', `移除技能【${x}】`);
    }
    if (patch.viewOfYou) {
      const d = diff(bot.viewOfYou, patch.viewOfYou);
      for (const x of d.added) push('memory', `新增记忆【${x}】`);
      for (const x of d.removed) push('forgot', `忘掉了【${x}】`);
    }
    if (patch.routines) {
      const before = new Map(bot.routines.map((r) => [r.id, r]));
      const after = new Map(patch.routines.map((r) => [r.id, r]));
      for (const [id, r] of after) if (!before.has(id)) push('routine', `新增例行任务【${r.title}】，${r.schedule}`);
      for (const [id, r] of before) if (!after.has(id)) push('routine_removed', `取消例行任务【${r.title}】`);
    }
    if (patch.integrationIds) {
      const d = diff(bot.integrationIds ?? [], patch.integrationIds);
      const nameOf = (id: string) => this.integration(id)?.name ?? id;
      for (const x of d.added) push('connection', `接入【${nameOf(x)}】`);
      for (const x of d.removed) push('disconnected', `断开【${nameOf(x)}】`);
    }
    if (patch.channels) {
      const label: Record<string, string> = { feishu: '飞书', wechat: '企业微信', telegram: 'Telegram', slack: 'Slack', app: 'App' };
      for (const x of diff(bot.channels, patch.channels).added) push('channel', `住进了【${label[x] ?? x}】`);
    }
  }

  /** Remove a bot and everything that only makes sense with it (its thread, todos, pendings, actions). */
  deleteBot(id: string) {
    const bot = this.bot(id);
    if (!bot) return undefined;
    const thread = `bot:${id}`;
    this.data.bots = this.data.bots.filter((b) => b.id !== id);
    this.data.messages = this.data.messages.filter((m) => m.threadId !== thread && !(m.botId === id && m.threadId.startsWith('bot:')));
    this.data.todos = this.data.todos.filter((t) => t.botId !== id);
    this.data.pendings = this.data.pendings.filter((p) => p.botId !== id);
    this.data.actions = this.data.actions.filter((a) => a.botId !== id);
    for (const m of this.data.matters) {
      if (m.participantBotIds.includes(id)) m.participantBotIds = m.participantBotIds.filter((x) => x !== id);
      if (m.ownerBotId === id) m.ownerBotId = m.participantBotIds.shift() ?? '';
    }
    this.data.matters = this.data.matters.filter((m) => m.ownerBotId);
    this.save();
    this.emitChange({ type: 'bot_deleted', id });
    return bot;
  }
  /** Dissolve a group: its thread, its todos and pendings go; the bots themselves stay. */
  deleteMatter(id: string) {
    const matter = this.matter(id);
    if (!matter) return undefined;
    const thread = `matter:${id}`;
    this.data.matters = this.data.matters.filter((m) => m.id !== id);
    this.data.messages = this.data.messages.filter((m) => m.threadId !== thread);
    this.data.todos = this.data.todos.filter((t) => t.matterId !== id);
    this.data.pendings = this.data.pendings.filter((p) => p.threadId !== thread);
    this.save();
    this.emitChange({ type: 'matter_deleted', id });
    return matter;
  }


  /** Wipe one thread's transcript and its open cards. Todos, actions and memory stay. */
  clearThread(threadId: ThreadId) {
    this.data.messages = this.data.messages.filter((m) => m.threadId !== threadId);
    this.data.pendings = this.data.pendings.filter((p) => p.threadId !== threadId);
    this.save();
    this.emitChange({ type: 'thread_cleared', threadId });
  }

  /* ---- integrations ---- */
  integration(id: string) {
    return this.data.integrations.find((i) => i.id === id);
  }
  addIntegration(i: Omit<Integration, 'id' | 'createdAt'> & { id?: string }): Integration {
    const integ: Integration = { ...i, id: i.id ?? uid(), createdAt: Date.now() } as Integration;
    this.data.integrations.push(integ);
    this.save();
    this.emitChange({ type: 'integration', integration: integ });
    return integ;
  }
  patchIntegration(id: string, patch: Partial<Integration>) {
    const integ = this.integration(id);
    if (!integ) return undefined;
    Object.assign(integ, patch);
    for (const k of Object.keys(patch) as (keyof Integration)[]) if (patch[k] === undefined || patch[k] === null) delete integ[k];
    this.save();
    this.emitChange({ type: 'integration', integration: integ });
    return integ;
  }
  removeIntegration(id: string) {
    const integ = this.integration(id);
    if (!integ) return undefined;
    this.data.integrations = this.data.integrations.filter((i) => i.id !== id);
    for (const b of this.data.bots) if (b.integrationIds?.includes(id)) this.patchBot(b.id, { integrationIds: b.integrationIds.filter((x) => x !== id) });
    this.save();
    this.emitChange({ type: 'integration_deleted', id });
    return integ;
  }

  /* ---- matters ---- */
  matter(id: string) {
    return this.data.matters.find((m) => m.id === id);
  }
  addMatter(m: Omit<Matter, 'id' | 'createdAt'> & { id?: string }): Matter {
    const matter: Matter = { ...m, id: m.id ?? uid(), createdAt: Date.now() } as Matter;
    this.data.matters.push(matter);
    this.save();
    this.emitChange({ type: 'matter', matter });
    return matter;
  }
  patchMatter(id: string, patch: Partial<Matter>) {
    const matter = this.matter(id);
    if (!matter) return undefined;
    Object.assign(matter, patch);
    this.save();
    this.emitChange({ type: 'matter', matter });
    return matter;
  }

  /* ---- todos ---- */
  todo(id: string) {
    return this.data.todos.find((t) => t.id === id);
  }
  todosOf(botId: string, matterId?: string) {
    return this.data.todos.filter((t) => t.botId === botId && (matterId ? t.matterId === matterId : true));
  }
  addTodo(t: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo {
    const todo: Todo = { ...t, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
    this.data.todos.push(todo);
    this.save();
    this.emitChange({ type: 'todo', todo });
    return todo;
  }
  event(id: string) {
    return this.data.events.find((e) => e.id === id);
  }
  eventsOf(botId: string) {
    return this.data.events.filter((e) => e.botId === botId);
  }
  addEvent(e: Omit<CrewEvent, 'id' | 'createdAt'>): CrewEvent {
    const ev: CrewEvent = { ...e, id: uid(), createdAt: Date.now() };
    this.data.events.push(ev);
    this.save();
    this.emitChange({ type: 'event', event: ev });
    return ev;
  }
  patchEvent(id: string, patch: Partial<CrewEvent>) {
    const ev = this.event(id);
    if (!ev) return undefined;
    Object.assign(ev, patch);
    this.save();
    this.emitChange({ type: 'event', event: ev });
    return ev;
  }
  dropEvent(id: string) {
    const before = this.data.events.length;
    this.data.events = this.data.events.filter((e) => e.id !== id);
    if (this.data.events.length === before) return false;
    this.save();
    this.emitChange({ type: 'event_deleted', id });
    return true;
  }
  patchTodo(id: string, patch: Partial<Todo>) {
    const todo = this.todo(id);
    if (!todo) return undefined;
    Object.assign(todo, patch, { updatedAt: Date.now() });
    this.save();
    this.emitChange({ type: 'todo', todo });
    return todo;
  }

  /* ---- pendings ---- */
  pending(id: string) {
    return this.data.pendings.find((p) => p.id === id);
  }
  addPending(p: Omit<Pending, 'id' | 'createdAt'> & { id?: string }): Pending {
    const pending: Pending = { ...p, id: p.id ?? uid(), createdAt: Date.now() } as Pending;
    this.data.pendings.push(pending);
    this.save();
    this.emitChange({ type: 'pending', pending });
    return pending;
  }
  resolvePending(id: string, choice: string) {
    const p = this.pending(id);
    if (!p || p.resolved) return undefined;
    p.resolved = { at: Date.now(), choice };
    this.save();
    this.emitChange({ type: 'pending', pending: p });
    return p;
  }

  /* ---- actions ---- */
  addAction(a: Omit<Action, 'id' | 'ts'>): Action {
    const action: Action = { ...a, id: uid(), ts: Date.now() };
    this.data.actions.push(action);
    this.save();
    this.emitChange({ type: 'action', action });
    return action;
  }
  undoAction(id: string) {
    const a = this.data.actions.find((x) => x.id === id);
    if (!a || !a.undoable || a.undone) return undefined;
    a.undone = true;
    this.save();
    this.emitChange({ type: 'action', action: a });
    return a;
  }

  /* ---- messages ---- */
  message(id: string) {
    return this.data.messages.find((m) => m.id === id);
  }
  addMessage(m: Omit<Message, 'id'> & { id?: string }): Message {
    // Spread first: a caller that passes an explicit `id: undefined` (every IM message does) would
    // otherwise overwrite the generated one, leaving the message unaddressable.
    const message: Message = { ...m, id: m.id ?? uid() } as Message;
    this.data.messages.push(message);
    this.save();
    this.emitChange({ type: 'message', message });
    return message;
  }
  patchMessage(id: string, patch: Partial<Message>) {
    const m = this.message(id);
    if (!m) return undefined;
    Object.assign(m, patch);
    this.save();
    this.emitChange({ type: 'message_patch', id, patch });
    return m;
  }
  lastUserMessage(threadId: ThreadId) {
    for (let i = this.data.messages.length - 1; i >= 0; i--) {
      const m = this.data.messages[i];
      if (m.threadId === threadId && m.author === 'user') return m;
    }
    return undefined;
  }

  setComputer(patch: Partial<Computer>) {
    this.data.computer = { state: 'off', ...(this.data.computer ?? {}), ...patch };
    this.save();
    this.emitChange({ type: 'computer', computer: this.data.computer });
    return this.data.computer;
  }

  setSettings(patch: CrewSettings) {
    this.data.settings = { ...(this.data.settings ?? {}), ...patch };
    this.save();
    this.emitChange({ type: 'settings', settings: this.data.settings });
    return this.data.settings;
  }

  setSharedProfile(lines: string[]) {
    this.data.sharedProfile = lines;
    this.save();
    this.emitChange({ type: 'shared_profile', lines });
  }

  /* ---- ephemeral ---- */
  private typingNow = new Map<ThreadId, Set<string>>();
  typing(threadId: ThreadId, botId: string, on: boolean) {
    const set = this.typingNow.get(threadId) ?? new Set<string>();
    if (on) set.add(botId);
    else set.delete(botId);
    if (set.size) this.typingNow.set(threadId, set);
    else this.typingNow.delete(threadId);
    this.emitChange({ type: 'typing', threadId, botId, on });
  }
  /** Who is mid-turn where, so a client that (re)connects sees the working state immediately. */
  typingSnapshot(): Record<string, string[]> {
    return Object.fromEntries([...this.typingNow.entries()].map(([t, ids]) => [t, [...ids]]));
  }
  toast(toast: Toast) {
    this.emitChange({ type: 'toast', toast });
  }
}

/** First run: nothing. Bots are created by the user's first sentence in the "new bot" window. */
export function seedSnapshot(): Snapshot {
  return { bots: [], matters: [], todos: [], events: [], pendings: [], actions: [], messages: [], sharedProfile: [], integrations: [] };
}
