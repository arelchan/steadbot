import type { EventEmitter } from 'node:events';
import type { CrewStore } from '../store.ts';
import type { PendingBroker } from '../broker.ts';
import type { MemoryStore } from '../memory.ts';
import type { Bot, Channel, ThreadId } from '../types.ts';

/** What the bot is doing right now: which thread triggered this run and which message it answers. */
export interface CurrentTurn {
  threadId: ThreadId;
  matterId?: string;
  userMessageId?: string;
  todoId?: string;
  via?: Channel;
  /** hops in a bot-to-bot handoff chain */
  depth: number;
  receipt?: 'created' | 'updated' | 'closed';
}

/** Everything a crew extension needs, bound to one bot. */
export interface BotCtx {
  botId: string;
  bot(): Bot;
  store: CrewStore;
  broker: PendingBroker;
  memory: MemoryStore;
  events: EventEmitter;
  current(): CurrentTurn | undefined;
  fake: boolean;
}
