import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import * as everos from '../everos.ts';
import { botThread } from '../types.ts';

/**
 * remember / recall: the two ends of memory.
 *
 * `remember` pins a fact by hand — it stays a plain line the user can read and edit (memory.ts), and
 * is repeated to the engine as something the user said, so the two halves of "what we know about him"
 * do not drift apart. `recall` is the bot going back through what it and the crew have actually done;
 * the turn already arrives with the relevant few (identity.ts), so this is for what that missed.
 */
export function rememberExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-remember',
    factory: (pi) => {
      pi.registerTool({
        name: 'remember',
        label: '记忆',
        description:
          '记住或忘掉关于用户的长期事实：偏好、习惯、约束、称呼、常用的人和地方。action=add（默认）记一条，action=forget 声明某条不再成立。用户是同一个人，记下的事实全体 bot 都会读——没有只属于你的那份。它作为用户说的一句话进记忆引擎，由引擎归并进画像，调用后立刻返回。只管关于用户的事——你自己的人设、工作方式用 build。',
        promptSnippet: '异步记住 / 忘掉关于用户的稳定事实（全员共用）',
        promptGuidelines: [
          '只记稳定、以后还会用到的事实，不记一次性任务的细节。同一事实不用担心重复，后台会归并。',
          '用户明确说「记住」的一定记，说「别记」「忘了它」的用 forget；从对话里推断出的偏好，记之前在回复里带一句「我记下了：…」让他知道。',
          '一条 fact 只说一件事，写成完整短句，如「出差偏好高铁二等座」，不要写「喜欢高铁」这种缺主语的。',
        ],
        parameters: Type.Object({
          fact: Type.String({ description: '一句话事实；forget 时写要忘掉的那条大意即可' }),
          action: Type.Optional(StringEnum(['add', 'forget'] as const)),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'add';
          // Said to the engine as the user saying it; a "forget" is a correction, since a conversation that happened
          // is not unsaid — the engine resolves conflicts in favour of the newer statement.
          const thread = c.current()?.threadId ?? botThread(c.botId);
          void (action === 'add' ? everos.statedFact(thread, p.fact) : everos.correct(p.fact));
          return {
            content: [{ type: 'text', text: everos.alive() ? (action === 'add' ? '记下了。继续。' : '好，记为不再成立。继续。') : '记忆引擎没在跑，这条没处落；先继续。' }],
            details: { action, fact: p.fact },
          };
        },
      });

      pi.registerTool({
        name: 'recall',
        label: '回想',
        description:
          '翻自己的记忆。scope=user：用户以前说过、做过的事（他提起「上次那个…」而你不知道是哪件时用）；scope=self：你自己干过的同类活和从中学到的做法；scope=crew：团队定下来的通用做法。这是回想经历，不是搜索引擎——查外部事实、新闻、价格用 web_search，查手册用 library。每轮开头已经自动带了最相关的几条，这里只用来找那些没带上的。',
        promptSnippet: '翻记忆：用户的往事 / 自己干过的活 / 团队共识',
        promptGuidelines: [
          '用户说「上次那个」「还是按之前的来」而你不确定指哪件事时，先 recall(scope=user) 再问；能自己找到就不要问。',
          '接手一类活之前 recall(scope=self)，看自己上次在哪儿栽过；找不到就正常做，不要因此多话。',
          '找不到记录是常态（只有出过岔子的活才会留下记录），不要反复换词重试，也不要跟用户汇报「我查了记忆」。',
        ],
        parameters: Type.Object({
          query: Type.String({ description: '要找什么，一句话；用当时可能出现过的词' }),
          scope: StringEnum(['user', 'self', 'crew'] as const),
          k: Type.Optional(Type.Number({ description: '最多几条，默认 5' })),
        }),
        async execute(_id, p) {
          const text = await everos.recall(c.botId, p.query, p.scope, p.k ?? 5);
          return { content: [{ type: 'text', text }], details: { scope: p.scope, query: p.query } };
        },
      });
    },
  };
}
