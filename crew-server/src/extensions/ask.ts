import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';

const Params = Type.Object({
  kind: StringEnum(['confirm', 'clarify', 'blocked'] as const),
  title: Type.String({ description: 'one line saying what needs deciding' }),
  detail: Type.Optional(Type.String({ description: 'supporting detail — the train, the price, the reason' })),
  amount: Type.Optional(Type.Number({ description: 'the amount involved in a confirm' })),
  todoId: Type.Optional(Type.String({ description: 'the matter this belongs to' })),
  options: Type.Array(
    Type.Object({
      id: Type.String({ description: 'a short id, like pay / later / a / b' }),
      label: Type.String({ description: 'the button text' }),
      hint: Type.Optional(Type.String({ description: 'small print under the button — price, time' })),
      primary: Type.Optional(Type.Boolean()),
    }),
    { minItems: 1, maxItems: 5 },
  ),
});

type Details = { title: string; options: string[]; choice: string | null };

/**
 * ask_user: the only way a bot interrupts the user for a decision.
 * The tool blocks until the user taps an option in the app or in an IM, then returns the choice.
 */
export function askExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-ask',
    factory: (pi) => {
      pi.registerTool({
        name: 'ask_user',
        label: 'Ask the user to decide',
        description:
          'Ask the user something and wait for the answer; on screen it is a card with buttons. Three uses: confirm — the last check before spending money, sending something outward, or anything irreversible, with an amount; clarify — several options for them to pick from; blocked — you are stuck behind something outside your reach (an expired login, a missing permission) and need them to do one thing. It blocks until they press an option, or simply write back (that is an answer too).',
        promptSnippet: 'ask and wait when the user has to confirm, choose, or unblock you',
        promptGuidelines: [
          'Do not ask what you can decide. Use ask_user in three cases only: money or irreversibility; a choice that genuinely turns on their preference; something outside your reach has blocked you.',
          'One question at a time. Two to four options, a label of a few words, the hint carrying what the decision turns on (price, time), and mark the one you recommend as primary.',
          'Having used ask_user, do not ask again in the body; one line of lead-in at most. While waiting, do not repeat the question.',
          'If the user writes instead of pressing an option, take what they wrote as the answer and carry on. Do not raise the same card again.',
        ],
        parameters: Params,
        executionMode: 'sequential',
        async execute(_id, p, signal) {
          const cur = c.current();
          const threadId = cur?.threadId ?? (`bot:${c.botId}` as const);
          const todoId = p.todoId ?? cur?.todoId;
          const choice = await c.broker.ask(
            {
              botId: c.botId,
              threadId,
              matterId: cur?.matterId,
              via: cur?.via,
              todoId,
              kind: p.kind,
              title: p.title,
              detail: p.detail,
              amount: p.amount,
              options: p.options,
            },
            signal,
          );
          if (choice === undefined) {
            if (todoId) c.store.parkTodo(todoId, `waiting on you: ${p.title}`);
            return {
              content: [{ type: 'text', text: 'No answer yet. Do not ask again; the matter is marked as waiting, and whatever they choose later arrives as a new message.' }],
              details: { title: p.title, options: p.options.map((o) => o.id), choice: null } as Details,
            };
          }
          if (choice.startsWith('text:')) {
            const said = choice.slice(5);
            return {
              content: [{ type: 'text', text: `The user did not press an option; they said: "${said}". Carry on from that, and do not ask the same question again.` }],
              details: { title: p.title, options: p.options.map((o) => o.id), choice: 'text', said } as Details & { said: string },
            };
          }
          const label = p.options.find((o) => o.id === choice)?.label ?? choice;
          return {
            content: [{ type: 'text', text: `The user chose: ${choice} (${label})` }],
            details: { title: p.title, options: p.options.map((o) => o.id), choice } as Details,
          };
        },
      });
    },
  };
}
