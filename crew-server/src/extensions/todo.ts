import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { botThread, type Todo, type TodoOrigin, type TodoStatus } from '../types.ts';
import * as everos from '../everos.ts';

const Params = Type.Object({
  action: StringEnum(['create', 'update', 'close', 'list'] as const),
  todoId: Type.Optional(Type.String({ description: 'update/close 时必填' })),
  title: Type.Optional(Type.String({ description: 'create 时的一句话任务名' })),
  status: Type.Optional(StringEnum(['open', 'doing', 'waiting', 'blocked'] as const)),
  summary: Type.Optional(Type.String({ description: '最新一句进展' })),
  result: Type.Optional(Type.String({ description: 'close 时的结果' })),
  assignee: Type.Optional(Type.String({ description: 'create 时指派给群里的另一位 bot（名字）；只能在群聊里用，对方会收到带这条事项的转达' })),
  brief: Type.Optional(Type.String({ description: '有 assignee 时必填：交代给对方的完整说明——背景、要它做什么、做到什么程度、什么时候要。对方只看得到这段话，看不到你这条回复的其余部分' })),
});

/**
 * The bot's own task list. State lives in the crew store (so the UI and other bots can read it)
 * and is echoed into tool-result details for pi's branch-safe reconstruction.
 */
export function todoExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-todo',
    factory: (pi) => {
      pi.registerTool({
        name: 'todo',
        label: '事项',
        description:
          '你的事项本，也是用户在界面上看到的「你在做什么」。用户交给你的每件事都要在这里有一条：新任务 create；有进展、状态变化或用户改了要求 update；办完或取消 close；list 查看。标题写成任务名（如「杭州 9/15 高铁票」），summary 写成一句能读懂的最新进展。',
        promptSnippet: '记录并更新你手上的事项（create / update / close / list）',
        promptGuidelines: [
          '收到用户消息先判断它对事项的影响：新建、更新、关闭，还是只是聊天或提问。只有前三种才调 todo；闲聊、问进展、寒暄不建事项。',
          '一件事只 create 一次；后续变化都是 update。update 的 summary 写「现在到哪一步」，不要重复标题。',
          '事项状态：doing 在推进；waiting 等用户拍板；blocked 被外部条件卡住；done 关闭时用 result 写结果。',
          '不要向用户复述你对 todo 的操作，界面会自动显示回执。',
          '群里被 @ 交代的活和用户直接交代的一样：接下就先 create，再回复。转达里如果已经带了事项编号（【事项 xxx】），那条就是你的，直接 update，不要再建。',
          '被 @ 不等于有活：同事只是点你的名、道谢、同步进度、抄送结论，或者你出现在它列的表格里，都不要建事项，正常说话就行。只有真的要你动手做点什么，才 create。',
          '你是牵头人、要把活分给群里的同事时，用 create + assignee 直接建在它名下，同时用 brief 把这件事交代清楚，系统会连同事项一起转达给它，你不用再单独 @。对方看不到你这条回复的其余部分，只看得到 brief，所以别在 brief 之外交代关键信息。要分给不在群里的人，先 configure 拉进群。',
          '事项归谁、属于哪个群、谁交办的，都由系统按你当前所在的会话自动记，你不用也没法指定。',
        ],
        parameters: Params,
        async execute(_id, p) {
          const cur = c.current();
          const matterId = cur?.matterId;
          // Where this task came from, snapshotted by the runtime: the model cannot state it or fake it.
          const originHere = (): TodoOrigin => {
            const by: TodoOrigin['by'] = cur?.kind === 'bot' ? 'bot' : cur?.kind === 'routine' ? 'routine' : cur?.kind === 'system' ? 'system' : 'user';
            return {
              by,
              ...(by === 'user' && cur?.via ? { via: cur.via } : {}),
              ...(by === 'bot' && cur?.fromBotId ? { fromBotId: cur.fromBotId } : {}),
              threadId: cur?.threadId ?? botThread(c.botId),
              ...(by === 'user' && cur?.userMessageId ? { messageId: cur.userMessageId } : {}),
              at: Date.now(),
            };
          };
          let changed: Todo | undefined;
          let text = 'ok';
          if (p.action === 'create') {
            const title = (p.title ?? '').trim();
            if (!title) throw new Error('create 需要 title');
            const brief = (p.brief ?? '').trim();
            let owner = c.botId;
            if (p.assignee?.trim()) {
              const matter = matterId ? c.store.matter(matterId) : undefined;
              if (!matter) throw new Error('assignee 只能在群聊里用；私聊里要找同事就在回复里 @它');
              const ref = p.assignee.trim().replace(/^@/, '');
              const target = c.store.data.bots.find((b) => b.id === ref || b.name === ref);
              if (!target) throw new Error(`找不到 bot「${ref}」`);
              if (target.id !== matter.ownerBotId && !matter.participantBotIds.includes(target.id)) throw new Error(`「${target.name}」不在这个群里，先 configure(target=matter, field=members, action=add, value="${target.name}") 拉进群`);
              owner = target.id;
            }
            const assigned = owner !== c.botId;
            if (assigned && !brief) throw new Error('指派给别人时必须写 brief：背景、要它做什么、做到什么程度、什么时候要。对方看不到你这条回复的其余部分，只看得到这段话。');
            changed = c.store.addTodo({
              botId: owner,
              matterId,
              title,
              status: p.status ?? (assigned ? 'open' : 'doing'),
              summary: p.summary,
              // The message that triggered *me* is not what the assignee's task came from.
              ...(assigned ? {} : { fromMessageId: cur?.userMessageId }),
              origin: assigned ? { by: 'bot', fromBotId: c.botId, threadId: cur!.threadId, at: Date.now() } : originHere(),
            });
            if (assigned) {
              const me = c.bot();
              c.events.emit('crew:handoff', { from: c.botId, to: owner, text: `【事项 ${changed.id}】${title}\n${brief}\n（由 @${me.name} 指派）`, threadId: cur!.threadId, matterId, depth: (cur?.depth ?? 0) + 1, todoId: changed.id });
              text = `已在 @${c.store.bot(owner)?.name} 名下新建事项 ${changed.id}：${title}，并已转达给它。你不用再 @。`;
            } else {
              text = `已新建事项 ${changed.id}：${title}`;
              if (cur) {
                cur.todoId = changed.id;
                cur.receipt ??= 'created';
              }
            }
          } else if (p.action === 'update' || p.action === 'close') {
            const t = p.todoId ? c.store.todo(p.todoId) : undefined;
            if (!t || (t.botId !== c.botId && !(t.matterId && t.matterId === matterId))) throw new Error(`未知事项 ${p.todoId ?? ''}`);
            const patch: Partial<Todo> = {};
            if (p.action === 'close') {
              patch.status = 'done';
              patch.result = p.result ?? p.summary ?? t.summary;
              patch.summary = p.summary ?? p.result ?? t.summary;
            } else {
              if (p.status) patch.status = p.status as TodoStatus;
              if (p.summary) patch.summary = p.summary;
              if (p.title) patch.title = p.title;
            }
            changed = c.store.patchTodo(t.id, patch);
            text = p.action === 'close' ? `已关闭事项 ${t.id}` : `已更新事项 ${t.id}`;
            if (cur) {
              cur.todoId = t.id;
              if (p.action === 'close') cur.receipt = 'closed';
              else cur.receipt ??= 'updated';
            }
            // A closed matter is a finished story: cut the memory here rather than waiting for the thread to
            // go quiet, so what gets extracted is one whole task instead of a task plus whatever came next.
            if (p.action === 'close' && cur?.threadId) void everos.flush(cur.threadId);
          }
          if (cur?.userMessageId && cur.receipt && changed) {
            const kind = cur.receipt;
            const label = kind === 'created' ? '记下了' : kind === 'closed' ? '关掉了' : '更新了';
            c.store.patchMessage(cur.userMessageId, {
              todoId: changed.id,
              receipt: { kind, text: `${label}：${changed.title}${kind === 'updated' && changed.summary ? ` · ${changed.summary}` : ''}`, todoId: changed.id },
            });
          }
          const mine = c.store.todosOf(c.botId);
          const listing = mine
            .filter((t) => t.status !== 'done')
            .map((t) => `[${t.id}] ${t.title} · ${t.status}${t.summary ? ` · ${t.summary}` : ''}`)
            .join('\n');
          return {
            content: [{ type: 'text', text: p.action === 'list' ? listing || '（没有进行中的事项）' : text }],
            details: { todos: mine, changed: changed?.id },
          };
        },
      });
    },
  };
}
