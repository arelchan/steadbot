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
  /** 这一轮说的话只发到这几处（例行任务指定了通道）；不填 = 照常发给它在的每个地方 */
  to?: Channel[];
  /** 什么触发了这一轮：用户说话、同事转达、例行任务、系统事件 */
  kind: 'user' | 'bot' | 'routine' | 'group' | 'system';
  /** kind 是 bot 时，转达过来的那位同事 */
  fromBotId?: string;
  /** hops in a bot-to-bot handoff chain */
  depth: number;
  receipt?: 'created' | 'updated' | 'closed';
  /** 这一轮 deliver 交出去的东西，发消息时挂在消息上 */
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
