import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { botThread, type Todo, type TodoOrigin, type TodoStatus } from '../types.ts';
import * as everos from '../everos.ts';

const Params = Type.Object({
  action: StringEnum(['create', 'update', 'close', 'drop', 'list'] as const),
  todoId: Type.Optional(Type.String({ description: 'required for update / close' })),
  title: Type.Optional(Type.String({ description: 'the one-line name of the task, for create' })),
  status: Type.Optional(StringEnum(['doing', 'waiting'] as const, { description: 'doing: you are moving it forward. waiting: it cannot move until something arrives (a decision, material, a permission change).' })),
  summary: Type.Optional(Type.String({ description: 'the latest line of progress' })),
  result: Type.Optional(Type.String({ description: 'for close, what came out of it; for drop, why it is not happening' })),
  assignee: Type.Optional(Type.String({ description: 'on create, assign it to another bot in the group (by name). Groups only; they receive a handoff carrying this matter.' })),
  brief: Type.Optional(Type.String({ description: 'required with assignee: the whole briefing — background, what you want done, how far, by when. They see this and nothing else of your reply.' })),
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
        label: 'Matters',
        description:
          'Your list of matters, and what the user sees as "what you are doing". Anything you have to make, or that happens later, gets a create before you start: a deck, a page, a graphic, a report, a script, a round of research with a conclusion, a booking, a schedule, keeping an eye on something, editing that file from last time. update on progress or a changed requirement; close when it is done; drop when it is not happening (cancelled, expired, duplicate, impossible); list to see them. The title is a task name ("train to Seattle, 9/15", "Q3 review deck"); summary is one readable line of where it stands.',
        promptSnippet: 'record and update the matters you hold (create / update / close / list)',
        promptGuidelines: [
          '**Create by default**: when the user asks you to make or do something, create first and start second — a deck, a page, a graphic, a report, a script, research with a conclusion, a booking, a schedule, watching something, editing that thing from last time. Anything that takes several steps or produces a file has one. Better one matter too many than a user staring at a bot with no idea what it is doing.',
          '**Only three things do not**: a question answered in one line, small talk, and asking how it is going. Just talk; do not record for the sake of recording.',
          '**Create first, then work** — not a note afterwards. The moment it exists the user can see what you are doing. When you reach a milestone, update the summary.',
          '**Every turn, glance at "matters you hold"** and decide whether what the user just said moves one of them: changing the requirement, adding to it, chasing progress, handing over what you were waiting for, calling it off, or simply asking about it. If so, update / close / drop that one before carrying on. Never create the same thing twice.',
          'One create per thing; everything after is an update. An update summary says where it stands now, and does not restate the title. When the requirement changes, change the title too rather than leaving it describing the old one.',
          'There are four states: doing (moving), waiting (stuck until something arrives), done (close), closed (drop). Finished means close with the result. Cancelled, expired, duplicate or impossible means drop with the reason — do not paper over those with a close; on the user\'s side they are two separate piles. When what you were waiting for arrives, put it back to doing before you start.',
          'Do not narrate your todo calls back to the user; the interface shows the receipt itself.',
          'Work handed to you by @-mention in a group counts exactly as work from the user: create, then reply. If the handoff already carries a matter id ([matter xxx]), that one is yours — update it rather than creating another.',
          'Being @-mentioned is not the same as being given work: a colleague naming you, thanking you, sharing progress, copying you a conclusion, or listing you in a table — none of those create a matter. Only something you actually have to do does.',
          'As the lead, assign work with create + assignee so it lands under their name, and put the whole briefing in brief. The system hands it over along with the matter, so you do not also @ them. They see brief and nothing else of your reply, so do not put anything essential outside it. To assign to someone not in the group, configure them in first.',
          'Who owns a matter, which group it belongs to and who assigned it are recorded by the system from the thread you are in. You neither need to nor can specify them.',
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
            if (!title) throw new Error('create needs a title');
            const brief = (p.brief ?? '').trim();
            let owner = c.botId;
            if (p.assignee?.trim()) {
              const matter = matterId ? c.store.matter(matterId) : undefined;
              if (!matter) throw new Error('assignee only works in a group; in a direct thread, @ the colleague in your reply instead');
              const ref = p.assignee.trim().replace(/^@/, '');
              const target = c.store.data.bots.find((b) => b.id === ref || b.name === ref);
              if (!target) throw new Error(`no bot called "${ref}"`);
              if (target.id !== matter.ownerBotId && !matter.participantBotIds.includes(target.id)) throw new Error(`"${target.name}" is not in this group. Use configure(target=matter, field=members, action=add, value="${target.name}") first`);
              owner = target.id;
            }
            const assigned = owner !== c.botId;
            if (assigned && !brief) throw new Error('assigning to someone needs a brief: background, what you want done, how far, by when. They see this and nothing else of your reply.');
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
              c.events.emit('crew:handoff', { from: c.botId, to: owner, text: `[matter ${changed.id}] ${title}\n${brief}\n(assigned by @${me.name})`, threadId: cur!.threadId, matterId, depth: (cur?.depth ?? 0) + 1, todoId: changed.id });
              text = `Created matter ${changed.id} under @${c.store.bot(owner)?.name}: ${title}, and handed it over. No need to @ them as well.`;
            } else {
              text = `Created matter ${changed.id}: ${title}`;
              if (cur) {
                cur.todoId = changed.id;
                cur.receipt ??= 'created';
              }
            }
          } else if (p.action === 'update' || p.action === 'close' || p.action === 'drop') {
            const t = p.todoId ? c.store.todo(p.todoId) : undefined;
            if (!t || (t.botId !== c.botId && !(t.matterId && t.matterId === matterId))) throw new Error(`unknown matter ${p.todoId ?? ''}`);
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
            text = p.action === 'close' ? `Closed matter ${t.id} as done` : p.action === 'drop' ? `Dropped matter ${t.id}` : `Updated matter ${t.id}`;
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
            const label = kind === 'created' ? 'noted' : kind === 'closed' ? 'closed' : 'updated';
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
            content: [{ type: 'text', text: p.action === 'list' ? listing || '(nothing in progress)' : text }],
            details: { todos: mine, changed: changed?.id },
          };
        },
      });
    },
  };
}
