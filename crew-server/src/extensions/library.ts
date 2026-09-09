import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { authLabel } from '../library.ts';

/**
 * library: the pool's catalogue — manuals, external tool sets, asset packs. Read-only on purpose: finding a thing,
 * using it once, and becoming a bot that carries it are three different acts. The first is this tool's, the second
 * is `read` on the manual's path, and the third is build's (a bot builds itself; nothing else adds to it).
 */
export function libraryExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-library',
    factory: (pi) => {
      pi.registerTool({
        name: 'library',
        label: '找现成的',
        description:
          '库：一批精选过的现成东西，三类——手册（一份 SKILL.md 加它引用的文件：代码分析与架构图、评审、排错、测试、文档表格 PPT、调研写作、数据分析、设计…）、外部工具（接上就多出一组工具：MCP 服务，或 Gmail、日历、GitHub、Notion 这类走一键登录的平台）、素材包。action=search：按需求关键词找候选，每条带 slug、类型、说明；手册还带路径，read 它就能看全文，不用装。action=list：看全部。这只是找：用一次照着手册做即可；值得长在身上的才 build(action=add, value=slug)。适用：遇到一类你没把握做好的任务、用户问「你会不会 X」、你打算自己从头写手册之前。',
        promptSnippet: '库里找现成的（手册 / 外部工具 / 素材包）：library(search) 找候选，read 手册路径看全文；值得留的才 build(add)',
        promptGuidelines: [
          '接到一类新任务先 library(search)。搜出来的是候选，不是清单：read 最像的一两份手册看它到底怎么做，其余当没看见。',
          '看完再判断：这次用一次，就照着手册做完，不装；用户纠正过你、同类任务第二次来、或这次确实靠它才做好，再 build(add, value=slug) 让它长在身上。装上的东西每一轮都占提示词，装一两个最贴的就够。',
          '外部工具和素材包没法只看不装：这次需要就 build(add)，用完不需要可以 build(remove)。',
          '装上之后直接照着做，不用告诉用户「我装了个东西」；用户问起再说一句。',
        ],
        parameters: Type.Object({
          action: StringEnum(['search', 'list'] as const),
          query: Type.Optional(Type.String({ description: 'search：任务或能力关键词，例：架构图 / 代码评审 / Excel / 像素 / 邮件' })),
        }),
        async execute(_id, p) {
          const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: { action: p.action, query: p.query } });
          const b = c.bot();
          const mine = new Set(b.skills);
          const connected = new Set(c.store.data.integrations.filter((i) => (b.integrationIds ?? []).includes(i.id) && i.status === 'ok').map((i) => i.name));
          type Hit = ReturnType<CrewOps['librarySearch']>[number];
          const owned = (e: Hit) => ((e.kind ?? 'skill') === 'skill' ? mine.has(e.title) : e.kind === 'mcp' ? connected.has(e.title) : false);
          const detail = (e: Hit) => {
            if ((e.kind ?? 'skill') === 'skill') return e.path ? `  手册：${e.path}（read 看全文）` : '';
            if (e.kind === 'mcp') return `  授权：${authLabel(e)}${e.mcp?.tools ? `；工具：${e.mcp.tools}` : ''}`;
            return e.license ? `  许可：${e.license}` : '';
          };
          const line = (e: Hit) => [`${e.slug}｜${e.kindLabel}｜${e.title}（${e.categoryLabel}）${owned(e) ? '（已在你身上）' : ''}`, `  ${e.description}`, detail(e)].filter(Boolean).join('\n');
          if (p.action === 'list') {
            const all = ops().librarySearch('', 200);
            const byCat = new Map<string, typeof all>();
            for (const e of all) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
            return text([...byCat.entries()].map(([, es]) => `【${es[0].categoryLabel}】\n${es.map((e) => `- ${e.slug}｜${e.kindLabel}：${e.title} — ${e.description}${owned(e) ? '（已在你身上）' : ''}`).join('\n')}`).join('\n\n'));
          }
          if (!p.query?.trim()) throw new Error('search 需要 query');
          const hits = ops().librarySearch(p.query, 8);
          if (!hits.length) return text('库里没有匹配的。换个关键词再搜，或者直接做；同类活反复来再用 build(aspect=skill) 自己写一份手册。');
          return text(`${hits.map(line).join('\n')}\n\n先 read 最像的手册看怎么做；这次用一次就照着做，值得留的才 build(add)。`);
        },
      });
    },
  };
}
