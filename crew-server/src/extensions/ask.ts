import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';

const Params = Type.Object({
  kind: StringEnum(['confirm', 'clarify', 'blocked'] as const),
  title: Type.String({ description: '一句话说明要拍板的事' }),
  detail: Type.Optional(Type.String({ description: '补充信息，如车次、价格、原因' })),
  amount: Type.Optional(Type.Number({ description: 'confirm 涉及的金额（元）' })),
  todoId: Type.Optional(Type.String({ description: '关联的事项 id' })),
  options: Type.Array(
    Type.Object({
      id: Type.String({ description: '短 id，如 pay / later / a / b' }),
      label: Type.String({ description: '按钮文字' }),
      hint: Type.Optional(Type.String({ description: '按钮下的小字，如价格、时间' })),
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
        label: '请用户拍板',
        description:
          '向用户提问并等他答复，界面上是一张带按钮的卡片。三种用法：confirm，花钱、对外发消息、不可逆动作前的最后确认，带 amount；clarify，几个方案让用户选一个；blocked，你被外部条件卡住（登录过期、缺权限），需要用户做一件事才能继续。会阻塞到用户点选项，或直接打字回话（那也是答案）。',
        promptSnippet: '需要用户确认、选择或解卡时提问并等待',
        promptGuidelines: [
          '能自己判断的不要问。只在三种情况用 ask_user：要花钱或不可逆；几个方案确实取决于用户偏好；你被外部条件卡住。',
          '一次只问一个问题。选项 2 到 4 个，label 2 到 6 个字，hint 放价格、时间这类决策依据，把你推荐的那个设为 primary。',
          '用了 ask_user 就不要在正文里再问一遍；正文最多一句铺垫。等待期间不要重复提问。',
          '用户没点选项而是说了话，把那句话当答案继续办，不要再弹同一张卡。',
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
            if (todoId) c.store.parkTodo(todoId, `等你拍板：${p.title}`);
            return {
              content: [{ type: 'text', text: '用户暂未回应。不要重复提问；把事项标为等待，用户之后的选择会作为新消息告诉你。' }],
              details: { title: p.title, options: p.options.map((o) => o.id), choice: null } as Details,
            };
          }
          if (choice.startsWith('text:')) {
            const said = choice.slice(5);
            return {
              content: [{ type: 'text', text: `用户没有点选项，而是直接说：「${said}」。按这句话继续，不要再问同一个问题。` }],
              details: { title: p.title, options: p.options.map((o) => o.id), choice: 'text', said } as Details & { said: string },
            };
          }
          const label = p.options.find((o) => o.id === choice)?.label ?? choice;
          return {
            content: [{ type: 'text', text: `用户选择了：${choice}（${label}）` }],
            details: { title: p.title, options: p.options.map((o) => o.id), choice } as Details,
          };
        },
      });
    },
  };
}
