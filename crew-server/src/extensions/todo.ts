import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { botThread, type Todo, type TodoOrigin, type TodoStatus } from '../types.ts';
import * as everos from '../everos.ts';

const Params = Type.Object({
  action: StringEnum(['create', 'update', 'close', 'drop', 'list'] as const),
  todoId: Type.Optional(Type.String({ description: 'update/close 时必填' })),
  title: Type.Optional(Type.String({ description: 'create 时的一句话任务名' })),
  status: Type.Optional(StringEnum(['doing', 'waiting'] as const, { description: 'doing 你在推进；waiting 不给东西就动不了（等用户拍板、等他给材料、等他去改权限）' })),
  summary: Type.Optional(Type.String({ description: '最新一句进展' })),
  result: Type.Optional(Type.String({ description: 'close 时写做出来的结果；drop 时写为什么不做了' })),
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
          '你的事项本，也是用户在界面上看到的「你在做什么」。凡是要你动手做出点什么、或者要在未来发生的，动手前先 create 一条：做 PPT、做网页、做图、写报告、写脚本、查一圈给结论、订票、定日程、盯着某个东西、改上次那份文件——都算。有进展或用户改了要求 update；做成了 close；不做了（取消、过期、重复、做不了）drop；list 查看。标题写成任务名（如「杭州 9/15 高铁票」「Q3 复盘 PPT」），summary 写成一句能读懂的最新进展。',
        promptSnippet: '记录并更新你手上的事项（create / update / close / list）',
        promptGuidelines: [
          '**默认要建**：用户让你动手做点什么，就先 create 再动手——做 PPT、做网页、做图、写报告、写脚本、查一圈给结论、订票、定日程、盯着某个东西、改上次那份东西，都是事项。一件活要跑好几步、或者会产出一个文件，就一定有一条。宁可多记一条，也别让用户对着一个不知道在干嘛的 bot 干等。',
          '**不建的只有三类**：一句话就答完的问题、闲聊寒暄、问进展。这三类正常说话就行，别为了记而记。',
          '**先建后做**，不是做完了补一条：事项一建出来，用户界面上立刻看得到你在做什么。活干到一半有了阶段性结果，update 一次 summary。',
          '**每一轮都先扫一眼「你手上的事项」**，判断用户这句话是不是在动其中某一条：改要求、加需求、催进度、把你等的材料给你了、说先别做了、问的就是那件事——是就先 update / close / drop 那一条，再接着做。别把同一件事重新 create 一遍。',
          '一件事只 create 一次；后续变化都是 update。update 的 summary 写「现在到哪一步」，不要重复标题。用户改了要求就顺手改 title，别让标题停在旧要求上。',
          '事项只有四态：doing 在推进、waiting 不给东西就动不了、done 做成了（close）、closed 不做了（drop）。做完用 close 并在 result 写结果；取消、过期、重复、做不了用 drop 并在 result 写原因——别拿 close 糊弄过去，用户那边这两叠是分开的。等的东西到手了，把 waiting 改回 doing 再动手。',
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
              status: p.status ?? 'doing',
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
          } else if (p.action === 'update' || p.action === 'close' || p.action === 'drop') {
            const t = p.todoId ? c.store.todo(p.todoId) : undefined;
            if (!t || (t.botId !== c.botId && !(t.matterId && t.matterId === matterId))) throw new Error(`未知事项 ${p.todoId ?? ''}`);
            const patch: Partial<Todo> = {};
            if (p.action === 'close' || p.action === 'drop') {
              patch.status = p.action === 'close' ? 'done' : 'closed';
              patch.result = p.result ?? p.summary ?? t.summary;
              patch.summary = p.summary ?? p.result ?? t.summary;
            } else {
              if (p.status) patch.status = p.status as TodoStatus;
              if (p.summary) patch.summary = p.summary;
              if (p.title) patch.title = p.title;
            }
            changed = c.store.patchTodo(t.id, patch);
            text = p.action === 'close' ? `已完成事项 ${t.id}` : p.action === 'drop' ? `已关掉事项 ${t.id}` : `已更新事项 ${t.id}`;
            if (cur) {
              cur.todoId = t.id;
              if (p.action === 'close' || p.action === 'drop') cur.receipt = 'closed';
              else cur.receipt ??= 'updated';
            }
            // A closed matter is a finished story: cut the memory here rather than waiting for the thread to
            // go quiet, so what gets extracted is one whole task instead of a task plus whatever came next.
            if ((p.action === 'close' || p.action === 'drop') && cur?.threadId) void everos.flush(cur.threadId);
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
            .filter((t) => t.status !== 'done' && t.status !== 'closed')
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
