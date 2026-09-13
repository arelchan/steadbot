import type { EventEmitter } from 'node:events';
import type { CrewStore } from '../store.ts';
import type { PendingBroker } from '../broker.ts';
import type { Bot, Channel, FileRef, ThreadId } from '../types.ts';

/** What the bot is doing right now: which thread triggered this run and which message it answers. */
export interface CurrentTurn {
  threadId: ThreadId;
  matterId?: string;
  userMessageId?: string;
  todoId?: string;
  via?: Channel;
  /** This turn's words go only to these places (a recurring task named its channels); absent = everywhere it lives. */
  to?: Channel[];
  /** What started this turn: the user, a colleague's handoff, a recurring task, a system event. */
  kind: 'user' | 'bot' | 'routine' | 'group' | 'system';
  /** When kind is bot, the colleague who handed it over. */
  fromBotId?: string;
  /** hops in a bot-to-bot handoff chain */
  depth: number;
  receipt?: 'created' | 'updated' | 'closed';
  /** What this turn delivered, attached to the message when it is sent. */
  files?: FileRef[];
}

/** Everything a crew extension needs, bound to one bot. */
export interface BotCtx {
  botId: string;
  bot(): Bot;
  store: CrewStore;
  broker: PendingBroker;
  events: EventEmitter;
  current(): CurrentTurn | undefined;
  fake: boolean;
}
