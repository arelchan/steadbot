import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * remember: what this bot knows about the user. Writes are asynchronous — the fact is handed to a
 * background consolidation (dedupe, merge, resolve conflicts) and the conversation moves on.
 */
export function rememberExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-remember',
    factory: (pi) => {
      pi.registerTool({
        name: 'remember',
        label: '记忆',
        description:
          '记住或忘掉关于用户的长期事实：偏好、习惯、约束、称呼、常用的人和地方。action=add（默认）记一条，action=forget 忘掉与 fact 相符的那条。scope=private 只有你自己会读；scope=shared 所有 bot 都会读，适合称呼、城市、预算原则这类跨领域事实。后台异步归并进记忆（去重、合并、新旧冲突以新的为准），调用后立刻返回，不影响当前对话。只管关于用户的事——你自己的人设、工作方式用 build。',
        promptSnippet: '异步记住 / 忘掉关于用户的稳定事实（private 自用 / shared 全员）',
        promptGuidelines: [
          '只记稳定、以后还会用到的事实，不记一次性任务的细节。同一事实不用担心重复，后台会归并。',
          '用户明确说「记住」的一定记，说「别记」「忘了它」的用 forget；从对话里推断出的偏好，记之前在回复里带一句「我记下了：…」让他知道。',
          '一条 fact 只说一件事，写成完整短句，如「出差偏好高铁二等座」，不要写「喜欢高铁」这种缺主语的。',
        ],
        parameters: Type.Object({
          fact: Type.String({ description: '一句话事实；forget 时写要忘掉的那条大意即可' }),
          scope: StringEnum(['private', 'shared'] as const),
          action: Type.Optional(StringEnum(['add', 'forget'] as const)),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'add';
          const job = await ops().remember(c.botId, { action, fact: p.fact, scope: p.scope });
          return {
            content: [{ type: 'text', text: action === 'add' ? '记下了，后台归并进记忆。继续。' : '好，后台从记忆里去掉。继续。' }],
            details: { jobId: job.id, action, scope: p.scope, fact: p.fact },
          };
        },
      });
    },
  };
}
