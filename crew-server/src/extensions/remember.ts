import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import * as everos from '../everos.ts';
import { botThread } from '../types.ts';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { isCredentialFile, isMemoryFile } from '../config.ts';

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
        name: 'knowledge',
        label: '资料',
        description:
          '查用户交给团队的资料（产品文档、规范、纪要、客户材料），全员共用一份。不带参数或带 query：搜相关主题，回主题名 + 摘要；带 topic：读那个主题的全文；带 file（工作区里的绝对路径）：把这份文件归档进资料库，之后所有 bot 都能查到。\n这是「知道什么」，不是「怎么做」——手册照着做的步骤在你的技能里；外部事实用 web_search；用户以前说过做过的事用 recall。',
        promptSnippet: '查团队资料：搜主题、读全文、把一份文件归档进去',
        promptGuidelines: [
          '每轮开头已经带了最相关的三条摘要，摘要不够用就 knowledge(topic=…) 读全文，别凭摘要猜。',
          '用户发来一份文件并说「以后按它来」「记住这份」，才 knowledge(file=附件路径) 归档；一次性看看的文件用 read / see，不要往资料库里塞。',
          '答案来自资料时说清是哪份文档的哪个主题，用户要能回去核对。',
        ],
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: '要查什么' })),
          topic: Type.Optional(Type.String({ description: '主题 id，读全文' })),
          file: Type.Optional(Type.String({ description: '工作区里的绝对路径，归档这份文件' })),
        }),
        async execute(_id, p) {
          const text = await knowledgeTool(c, p);
          return { content: [{ type: 'text', text }], details: { ...p } };
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

/** One tool, three jobs: search the topics, read one in full, file a document into the shared library. */
async function knowledgeTool(c: BotCtx, p: { query?: string; topic?: string; file?: string }): Promise<string> {
  if (!everos.alive()) return '资料库没在跑（记忆引擎没起来），现在查不了。';
  if (p.file) {
    const f = p.file.trim();
    if (isCredentialFile(f) || isMemoryFile(f)) return '这个文件不能进资料库。';
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      return `找不到 ${f}。`;
    }
    if (size > 50 * 1024 * 1024) return '这份文件超过 50 MB，进不了资料库。';
    const name = basename(f);
    void everos
      .kAdd(name, readFileSync(f), p.query?.trim() || name.replace(/\.[a-z0-9]+$/i, ''))
      .then((r) => {
        if (r) c.store.addMessage({ threadId: c.current()?.threadId ?? botThread(c.botId), author: 'system', botId: c.botId, text: `资料库收了《${p.query?.trim() || name}》，切成 ${r.topics} 个主题。`, ts: Date.now() });
      })
      .catch(() => undefined);
    return `在读《${name}》，切主题要一分钟左右，好了会在对话里说一声。这一轮先做别的。`;
  }
  if (p.topic) {
    const t = await everos.kTopic(p.topic.trim());
    if (!t) return '没有这个主题，先用 query 搜一下。';
    return `${t.path}\n\n${t.content ?? t.summary}`;
  }
  const q = p.query?.trim() ?? '';
  if (!q) {
    const { items } = await everos.kDocs();
    if (!items.length) return '资料库是空的。';
    return `资料库里有 ${items.length} 份：\n${items.map((d) => `- ${d.title}（${d.category}，${d.topics} 个主题）`).join('\n')}`;
  }
  const hits = await everos.kSearch(q, 6);
  if (!hits.length) return '资料里没有相关的内容。';
  return `找到 ${hits.length} 条：\n${hits.map((h) => `- [${h.topic.id}] ${h.doc}｜${h.topic.name}：${h.topic.summary.slice(0, 200)}`).join('\n')}\n要细节就 knowledge(topic=方括号里的 id)。`;
}
