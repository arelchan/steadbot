import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';

const Params = Type.Object({
  connection: Type.String({ description: '通过哪个连接执行，如 12306 / 报销系统 / 公司邮箱' }),
  action: Type.String({ description: '动作名，如 pay / book / submit / send' }),
  summary: Type.String({ description: '给用户看的一句话，如「支付 G7325 二等座 ¥553」' }),
  amount: Type.Optional(Type.Number({ description: '金额（元）' })),
  todoId: Type.Optional(Type.String()),
  undoable: Type.Optional(Type.Boolean({ description: '2 小时内能否撤销，默认 true' })),
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
        label: '执行动作',
        description:
          '执行会改变外部世界的动作：付款、下单、提交表单、对外发消息、改别人的日程。它按用户给你的自主度决定直接办还是先出确认卡，并留下可撤销记录。凡是会产生这类后果的事都必须走这里；不能只在回复里说「已办好」。',
        promptSnippet: '执行付款、下单、提交、发消息等有后果的动作（自动按自主度确认）',
        promptGuidelines: [
          '只在真的要改变外部状态时用 act。查询、比较、准备方案都不是副作用，直接做。',
          'act 之前把要核对的信息备齐：对象、金额、时间。summary 写成用户一眼能核对的一句话，如「支付 G7325 二等座 ¥553」。',
          'act 返回「未执行」「需要确认」「连接失效」时如实转告用户，不要假装完成。连接失效改用 ask_user(kind=blocked)。',
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
              content: [{ type: 'text', text: `连接「${conn.name}」当前${conn.status === 'error' ? '出错' : '未接入'}，先用 ask_user(kind=blocked) 请用户处理。` }],
              details: { blocked: conn.name } as Details,
            };
          }
          const overBudget = (p.amount ?? 0) > 500;
          if (bot.autonomy === 'tell') {
            return {
              content: [{ type: 'text', text: '你的自主度是「只告诉我」，不能执行。请用 ask_user 把方案交给用户自己办。' }],
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
                detail: `通过 ${p.connection} · ${p.action}${overBudget ? ' · 超过 ¥500 需你确认' : ''}`,
                amount: p.amount,
                options: [
                  { id: 'go', label: p.amount ? `付 ¥${p.amount}` : '去办', primary: true },
                  { id: 'later', label: '先放着' },
                ],
              },
              signal,
            );
            if (choice !== 'go') {
              return {
                content: [{ type: 'text', text: choice === undefined ? '用户暂未确认，动作未执行。' : '用户选择先放着，动作未执行。' }],
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
            content: [{ type: 'text', text: `已执行：${p.summary}。${receipt} 动作 id ${action.id}${action.undoable ? '，2 小时内可撤销' : ''}。` }],
            details: { executed: true, actionId: action.id } as Details,
          };
        },
      });
    },
  };
}
