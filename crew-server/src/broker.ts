import { EventEmitter } from 'node:events';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { Card, Pending, PendingKind, PendingOption, ThreadId, Channel } from './types.ts';
import type { CrewStore } from './store.ts';
import { uid } from './util.ts';

export interface AskSpec {
  botId: string;
  threadId: ThreadId;
  matterId?: string;
  todoId?: string;
  kind: PendingKind;
  title: string;
  detail?: string;
  amount?: number;
  options: PendingOption[];
  /** Text the bot says alongside the card (optional). */
  lead?: string;
  /** Channel the current turn came from; the card goes back there. */
  via?: Channel;
}

interface Waiter {
  resolve: (choice: string | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Turns "the bot needs the user to decide" into a Pending record + card message,
 * and parks the calling tool until the user picks an option (or the wait times out).
 *
 * After a server restart the promise is gone; a late choice is re-injected into the bot
 * as a user message by the router (event `late-choice`).
 */
export class PendingBroker extends EventEmitter {
  private waiters = new Map<string, Waiter>();

  constructor(
    private store: CrewStore,
    private timeoutMs: number,
  ) {
    super();
  }

  cardFor(p: Pending): Card {
    if (p.kind === 'confirm') return { type: 'confirm', pendingId: p.id, title: p.title, sub: p.detail ?? '', amount: p.amount ?? 0 };
    if (p.kind === 'blocked') return { type: 'blocked', pendingId: p.id, title: p.title, sub: p.detail ?? '' };
    return {
      type: 'options',
      pendingId: p.id,
      options: p.options.map((o) => ({ id: o.id, label: o.label, hint: o.hint ?? '', price: undefined })),
    };
  }

  ask(spec: AskSpec, signal?: AbortSignal): Promise<string | undefined> {
    const pendingId = uid();
    const messageId = uid();
    const pending = this.store.addPending({
      id: pendingId,
      botId: spec.botId,
      threadId: spec.threadId,
      via: spec.via,
      matterId: spec.matterId,
      todoId: spec.todoId,
      kind: spec.kind,
      title: spec.title,
      detail: spec.detail,
      amount: spec.amount,
      options: spec.options,
      messageId,
    });
    this.store.addMessage({
      id: messageId,
      threadId: spec.threadId,
      via: spec.via,
      author: 'bot',
      botId: spec.botId,
      text: spec.lead ?? (spec.kind === 'blocked' ? '卡住了，需要你处理一下：' : spec.kind === 'confirm' ? '这一步要你确认：' : '有个选择需要你拍板：'),
      ts: Date.now(),
      card: this.cardFor(pending),
      todoId: spec.todoId,
      status: spec.kind === 'blocked' ? '卡住' : '等你拍板',
    });
    if (spec.todoId) this.store.patchTodo(spec.todoId, { status: 'waiting', summary: spec.title });

    return new Promise<string | undefined>((resolve) => {
      const done = (choice: string | undefined) => {
        const w = this.waiters.get(pendingId);
        if (!w) return;
        clearTimeout(w.timer);
        this.waiters.delete(pendingId);
        resolve(choice);
      };
      const timer = setTimeout(() => done(undefined), this.timeoutMs);
      this.waiters.set(pendingId, { resolve: done, timer });
      signal?.addEventListener('abort', () => done(undefined), { once: true });
    });
  }

  /** User picked an option. Returns the label, or undefined if the pending is unknown/already resolved. */
  resolve(pendingId: string, optionId: string): { pending: Pending; label: string; late: boolean } | undefined {
    const p = this.store.pending(pendingId);
    if (!p || p.resolved) return undefined;
    const opt = p.options.find((o) => o.id === optionId);
    const label = opt?.label ?? optionId;
    this.store.resolvePending(pendingId, label);
    this.store.patchMessage(p.messageId, { status: `你选了：${label}` });
    if (p.todoId) {
      const t = this.store.todo(p.todoId);
      if (t?.status === 'waiting') this.store.patchTodo(p.todoId, { status: 'doing', summary: `你选了：${label}` });
    }
    const w = this.waiters.get(pendingId);
    if (w) {
      w.resolve(optionId);
      return { pending: p, label, late: false };
    }
    this.emit('late-choice', { pending: p, label, optionId });
    return { pending: p, label, late: true };
  }

  /** Drop every parked ask in a thread (the thread is being cleared); tools return "no answer". */
  cancelThread(threadId: ThreadId) {
    for (const p of this.store.data.pendings) {
      if (p.threadId !== threadId) continue;
      const w = this.waiters.get(p.id);
      if (w) w.resolve(undefined);
    }
  }

  hasWaiter(pendingId: string) {
    return this.waiters.has(pendingId);
  }

  /**
   * The user typed a reply instead of tapping an option. If this bot is parked on a card in that
   * thread, the text becomes the answer (prefixed `text:`) so the tool returns and the bot moves on.
   */
  answerWithText(botId: string, threadId: ThreadId, text: string): Pending | undefined {
    const p = this.store.data.pendings.find((x) => x.botId === botId && x.threadId === threadId && !x.resolved && this.waiters.has(x.id));
    if (!p) return undefined;
    const short = text.length > 40 ? text.slice(0, 40) + '…' : text;
    this.store.resolvePending(p.id, short);
    this.store.patchMessage(p.messageId, { status: `你回了：${short}` });
    if (p.todoId) {
      const t = this.store.todo(p.todoId);
      if (t?.status === 'waiting') this.store.patchTodo(p.todoId, { status: 'doing', summary: `你回了：${short}` });
    }
    this.waiters.get(p.id)!.resolve(`text:${text}`);
    return p;
  }
}

/**
 * pi's ExtensionUIContext for a headless bot. Dialogs from any extension (including third-party
 * pi extensions a bot may load) become Pending cards; everything terminal-specific is a no-op.
 */
export function createBotUiContext(
  broker: PendingBroker,
  store: CrewStore,
  botId: string,
  where: () => { threadId: ThreadId; matterId?: string; todoId?: string; via?: Channel },
): ExtensionUIContext {
  const noop = () => {};
  const ui = {
    async select(title: string, options: string[]) {
      const w = where();
      const choice = await broker.ask({
        botId,
        ...w,
        kind: 'clarify',
        title,
        options: options.map((o, i) => ({ id: o, label: o, primary: i === 0 })),
      });
      return choice;
    },
    async confirm(title: string, message: string) {
      const w = where();
      const choice = await broker.ask({
        botId,
        ...w,
        kind: 'confirm',
        title,
        detail: message,
        options: [
          { id: 'yes', label: '确认', primary: true },
          { id: 'no', label: '不要' },
        ],
      });
      return choice === 'yes';
    },
    async input(title: string) {
      const w = where();
      const choice = await broker.ask({
        botId,
        ...w,
        kind: 'clarify',
        title: `${title}（请在对话里直接回复）`,
        options: [{ id: 'later', label: '我在对话里回复', primary: true }],
      });
      return choice ? undefined : undefined;
    },
    async editor() {
      return undefined;
    },
    notify(message: string) {
      const w = where();
      store.toast({ botId, text: message, threadId: w.threadId });
    },
    setStatus(_key: string, text: string | undefined) {
      const bot = store.bot(botId);
      if (bot) store.patchBot(botId, { tagline: text ?? bot.tagline });
    },
    onTerminalInput: () => noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    custom: async () => undefined,
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => '',
    addAutocompleteProvider: noop,
    setEditorComponent: noop,
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'headless' }),
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  };
  return ui as unknown as ExtensionUIContext;
}
