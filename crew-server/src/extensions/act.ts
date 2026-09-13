import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';

const Params = Type.Object({
  connection: Type.String({ description: 'which connection carries it out — a booking site, the expenses system, the company mailbox' }),
  action: Type.String({ description: 'the action, like pay / book / submit / send' }),
  summary: Type.String({ description: 'one line for the user, like "pay for train G7325, standard class, 553"' }),
  amount: Type.Optional(Type.Number({ description: 'the amount' })),
  todoId: Type.Optional(Type.String()),
  undoable: Type.Optional(Type.Boolean({ description: 'whether it can be undone within two hours; defaults to true' })),
});

type Details = { blocked?: string; refused?: string; executed?: boolean; choice?: string; actionId?: string };

/**
 * act: the single gate for side effects. Autonomy decides whether the bot may proceed:
 *   tell     -> never executes; asks the user to do it themselves
 *   prepare  -> confirm via ask card, then execute
 *   do       -> execute, log an undoable action
 * Real connectors (browser, MCP, APIs) plug in behind `perform()`; today it records the intent.
 */
export function actExtension(c: BotCtx, perform: (p: { connection: string; action: string; amount?: number }) => Promise<string>): InlineExtension {
  return {
    name: 'crew-act',
    factory: (pi) => {
      pi.registerTool({
        name: 'act',
        label: 'Carry out an action',
        description:
          'Carry out something that changes the outside world: paying, ordering, submitting a form, sending a message outward, editing someone else\'s calendar. It uses the autonomy the user gave you to decide whether to act or to raise a confirmation card first, and leaves an undoable record. Anything with that kind of consequence must come through here; saying "done" in a reply is not allowed.',
        promptSnippet: 'carry out consequential actions — paying, ordering, submitting, sending (confirmation follows your autonomy)',
        promptGuidelines: [
          'Use act only when outside state really changes. Looking things up, comparing and preparing are not side effects — just do them.',
          'Before act, have what needs checking ready: what, how much, when. Write summary as one line the user can check at a glance, like "pay for train G7325, standard class, 553".',
          'When act comes back as not carried out, needs confirmation, or connection dead, say so plainly rather than pretending it is done. For a dead connection, switch to ask_user(kind=blocked).',
        ],
        parameters: Params,
        executionMode: 'sequential',
        async execute(_id, p, signal) {
          const bot = c.bot();
          const cur = c.current();
          const todoId = p.todoId ?? cur?.todoId;
          const conn = c.store.data.integrations.find((k) => k.name === p.connection && (bot.integrationIds ?? []).includes(k.id));
          if (conn && conn.status !== 'ok') {
            return {
              content: [{ type: 'text', text: `The connection "${conn.name}" is ${conn.status === 'error' ? 'failing' : 'not connected'}. Use ask_user(kind=blocked) and let the user deal with it first.` }],
              details: { blocked: conn.name } as Details,
            };
          }
          const overBudget = (p.amount ?? 0) > 500;
          if (bot.autonomy === 'tell') {
            return {
              content: [{ type: 'text', text: 'Your autonomy is "tell me only", so you cannot carry this out. Use ask_user and hand the plan to them.' }],
              details: { refused: 'tell' } as Details,
            };
          }
          if (bot.autonomy === 'prepare' || overBudget) {
            const choice = await c.broker.ask(
              {
                botId: c.botId,
                threadId: cur?.threadId ?? `bot:${c.botId}`,
                matterId: cur?.matterId,
                via: cur?.via,
                todoId,
                kind: 'confirm',
                title: p.summary,
                detail: `via ${p.connection} · ${p.action}${overBudget ? ' · over the limit, so it needs you' : ''}`,
                amount: p.amount,
                options: [
                  { id: 'go', label: p.amount ? `Pay ${p.amount}` : 'Go ahead', primary: true },
                  { id: 'later', label: 'Leave it' },
                ],
              },
              signal,
            );
            if (choice !== 'go') {
              return {
                content: [{ type: 'text', text: choice === undefined ? 'Not confirmed yet; nothing was carried out.' : 'The user chose to leave it; nothing was carried out.' }],
                details: { executed: false, choice } as Details,
              };
            }
          }
          const receipt = await perform({ connection: p.connection, action: p.action, amount: p.amount });
          const action = c.store.addAction({
            botId: c.botId,
            matterId: cur?.matterId,
            todoId,
            text: `${p.summary}${p.amount ? ` ¥${p.amount}` : ''}`,
            undoable: p.undoable ?? true,
          });
          return {
            content: [{ type: 'text', text: `Done: ${p.summary}. ${receipt} action id ${action.id}${action.undoable ? ', undoable for two hours' : ''}.` }],
            details: { executed: true, actionId: action.id } as Details,
          };
        },
      });
    },
  };
}
