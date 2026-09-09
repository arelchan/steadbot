import type { CrewStore, StoreEvent } from './store.ts';
import { parseThread, type Message } from './types.ts';

/**
 * Turns a bot's messages into notifications. There is no system-level batching or scheduling: deciding whether
 * something is worth the user's attention is the bot's own job (see the 行为准则 in extensions/identity.ts), so a
 * message the bot chose to send is by definition it reaching out, and it gets a toast. The only dials here belong
 * to the user: muting a bot or a group. Cards that need a decision ignore the mute — the bot is blocked on it.
 */
export class Notifier {
  private on = false;

  constructor(private store: CrewStore) {
    store.on('change', (e: StoreEvent) => {
      if (e.type === 'message') this.consider(e.message);
    });
  }

  /** Off while the runtime is paused or the bots live on another machine. */
  start() {
    this.on = true;
  }
  stop() {
    this.on = false;
  }

  private consider(m: Message) {
    if (!this.on || m.author !== 'bot' || !m.botId) return;
    const bot = this.store.bot(m.botId);
    if (!bot) return;
    const needsUser = m.card?.type === 'blocked' || m.card?.type === 'confirm' || m.card?.type === 'options';
    if (!needsUser) {
      if (!bot.notify) return;
      const { kind, id } = parseThread(m.threadId);
      if (kind === 'matter' && this.store.matter(id)?.notify === false) return;
    }
    const text = (m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text) || (m.card ? '有事要你拍板' : '');
    this.store.toast({ botId: bot.id, text, threadId: m.threadId });
  }
}
