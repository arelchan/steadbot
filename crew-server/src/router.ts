import type { EventEmitter } from 'node:events';
import type { CrewStore } from './store.ts';
import type { BotManager } from './bots.ts';
import type { PendingBroker } from './broker.ts';
import { config } from './config.ts';
import { botThread, matterThread, parseThread, type Bot, type Channel, type FileRef, type Pending, type ThreadId } from './types.ts';
import { parseMentions, uid } from './util.ts';

/**
 * Decides which bot(s) a message goes to.
 *   bot thread     -> that bot
 *   matter thread  -> @mentioned bots, else the lead; other members get a silent transcript sync
 *   handoff        -> bot A @mentions bot B -> B gets a from-bot message (depth-limited)
 *   late choice    -> user answered a card after the tool already timed out -> bot gets a user message
 */
export class Router {
  constructor(
    private store: CrewStore,
    private bots: BotManager,
    private broker: PendingBroker,
    private events: EventEmitter,
  ) {
    events.on('crew:handoff', (h: { from: string; to: string; text: string; threadId: ThreadId; matterId?: string; depth: number; todoId?: string }) => {
      // An @ only carries the message across; whether it is work is the recipient's call, and if it is
      // work the recipient files its own task. Nothing here creates tasks — except a task that was
      // explicitly assigned (h.todoId), which already exists and rides along.
      // A relay that cannot be delivered must not leave that task silently sitting open.
      const undelivered = (why: string) => {
        if (!h.todoId) return;
        const t = store.todo(h.todoId);
        if (t && t.status !== 'done' && t.status !== 'closed') store.patchTodo(t.id, { status: 'waiting', summary: `没送达：${why}` });
      };
      if (h.depth > config.handoffDepth) return undelivered('转达层数太深，链条在这里断了');
      const from = store.bot(h.from);
      const to = store.bot(h.to);
      if (!from || !to) return undelivered('找不到要转达的 bot');
      if (h.matterId) {
        const m = store.matter(h.matterId);
        if (!m || (m.ownerBotId !== h.to && !m.participantBotIds.includes(h.to))) return undelivered(`${to.name} 不在这个群里`);
      }
      // Inside a matter the handoff stays in the group; otherwise it lands in the target bot's own thread.
      const threadId: ThreadId = h.matterId ? h.threadId : botThread(h.to);
      const group = h.matterId ? store.matter(h.matterId)?.title : undefined;
      void bots.send(h.to, { threadId, kind: 'bot', text: group ? `【群聊「${group}」· 来自 @${from.name}】${h.text}` : `【来自 @${from.name}】${h.text}`, fromBotId: h.from, depth: h.depth, todoId: h.todoId });
    });
    broker.on('late-choice', ({ pending, label }: { pending: Pending; label: string }) => {
      const text = `关于「${pending.title}」，我选了：${label}`;
      const m = store.addMessage({ threadId: pending.threadId, author: 'user', text, ts: Date.now(), todoId: pending.todoId });
      void bots.send(pending.botId, { threadId: pending.threadId, kind: 'user', text, userMessageId: m.id });
    });
  }

  /** A note for a bot's own loop, not for the transcript: the runtime noticed something it has to act on. */
  tellBot(botId: string, text: string) {
    void this.bots.send(botId, { threadId: botThread(botId), kind: 'system', text });
  }

  onUserMessage(threadId: ThreadId, text: string, via?: Channel, id?: string, files?: FileRef[]) {
    const { kind, id: tid } = parseThread(threadId);
    const t = text.trim();
    const attached = files?.length ? files : undefined;
    if (!t && !attached) return;
    if (kind === 'bot') {
      const bot = this.store.bot(tid);
      if (!bot) return;
      // Typing instead of tapping: the text answers the open card and the bot continues from there.
      const answered = this.broker.answerWithText(bot.id, threadId, t);
      this.store.addMessage({ id, threadId, author: 'user', text: t, ts: Date.now(), via, todoId: answered?.todoId, files: attached });
      if (answered) return;
      const m = this.store.message(id ?? '') ?? this.store.lastUserMessage(threadId)!;
      void this.bots.send(bot.id, { threadId, kind: 'user', text: t, via, userMessageId: m.id, files: attached });
      return;
    }
    const matter = this.store.matter(tid);
    if (!matter) return;
    const members = [matter.ownerBotId, ...matter.participantBotIds].map((x) => this.store.bot(x)).filter((b): b is Bot => !!b);
    const mentioned = parseMentions(t, members);
    const targets = mentioned.length ? mentioned : [matter.ownerBotId];
    const m = this.store.addMessage({ id, threadId, author: 'user', text: t, ts: Date.now(), via, mentions: mentioned.length ? mentioned : undefined, files: attached });
    for (const b of members) {
      if (targets.includes(b.id) && this.broker.answerWithText(b.id, threadId, t)) continue;
      if (targets.includes(b.id)) void this.bots.send(b.id, { threadId, kind: 'user', text: t, via, userMessageId: m.id, files: attached });
      else void this.bots.send(b.id, { threadId, kind: 'group', text: `【群聊记录】用户在「${matter.title}」里说：${t}` });
    }
  }

  onPendingChoice(pendingId: string, optionId: string) {
    return this.broker.resolve(pendingId, optionId);
  }

  createMatter(input: { id?: string; title: string; summary?: string; memberIds: string[]; leadId: string }) {
    const ids = Array.from(new Set([input.leadId, ...input.memberIds])).filter((x) => this.store.bot(x));
    const lead = ids[0];
    const others = ids.slice(1);
    const matter = this.store.addMatter({
      id: input.id ?? uid(),
      title: input.title,
      summary: input.summary ?? '',
      ownerBotId: lead,
      participantBotIds: others,
      tools: [],
      status: 'active',
      notify: true,
      pinned: false,
    });
    const names = ids.map((x) => this.store.bot(x)!.name);
    for (const b of ids) this.store.grow(b, 'group', `加入群聊【${matter.title}】${b === lead ? '，牵头' : ''}`);
    this.store.addMessage({ threadId: matterThread(matter.id), author: 'system', text: `群聊创建了。成员：${names.join('、')}；牵头：${names[0]}。`, ts: Date.now() });
    for (const b of ids) void this.bots.send(b, { threadId: matterThread(matter.id), kind: 'group', text: `【群聊记录】你被加入群聊「${matter.title}」，成员：${names.join('、')}，牵头：${names[0]}。${matter.summary}` });
    return matter;
  }

  /** A bot joins an existing 群聊 (the user pulled it into the mirrored IM group); everyone in it hears. */
  addMember(matterId: string, botId: string, why?: string) {
    const matter = this.store.matter(matterId);
    const bot = this.store.bot(botId);
    if (!matter || !bot || matter.ownerBotId === botId || matter.participantBotIds.includes(botId)) return matter;
    const m = this.store.patchMatter(matterId, { participantBotIds: [...matter.participantBotIds, botId] }) ?? matter;
    this.store.grow(botId, 'group', `加入群聊【${m.title}】${why ? `，${why}` : ''}`);
    this.store.addMessage({ threadId: matterThread(m.id), author: 'system', text: `${bot.name} 进群了。`, ts: Date.now() });
    const names = [m.ownerBotId, ...m.participantBotIds].map((x) => this.store.bot(x)?.name).filter(Boolean);
    for (const b of [m.ownerBotId, ...m.participantBotIds])
      void this.bots.send(b, {
        threadId: matterThread(m.id),
        kind: 'group',
        text: b === botId ? `【群聊记录】你被加入群聊「${m.title}」，成员：${names.join('、')}，牵头：${names[0]}。${m.summary}` : `【群聊记录】${bot.name} 加入了群聊「${m.title}」。`,
      });
    return m;
  }

  undoAction(actionId: string) {
    const a = this.store.undoAction(actionId);
    if (!a) return undefined;
    const threadId: ThreadId = a.matterId ? matterThread(a.matterId) : botThread(a.botId);
    this.store.addMessage({ threadId, author: 'system', text: `已撤销：${a.text}`, ts: Date.now(), todoId: a.todoId });
    void this.bots.send(a.botId, { threadId, kind: 'system', text: `【系统】用户撤销了动作「${a.text}」。如有关联事项请更新状态；如需要，简短告知用户。` });
    return a;
  }
}
