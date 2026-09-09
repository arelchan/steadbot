import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * library: the pool's catalogue — manuals, MCP servers, one-click connectors, asset packs. Read-only on purpose:
 * finding a thing and becoming a bot that has it are different acts, and the second one is build's (a bot builds
 * itself; nothing else adds to it).
 */
export function libraryExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-library',
    factory: (pi) => {
      pi.registerTool({
        name: 'library',
        label: '找现成的',
        description:
          '库：一批精选过的现成东西，四类——手册（代码分析与架构图、评审、排错、测试、文档表格 PPT、调研写作、数据分析、设计…）、外部工具（MCP 服务，接上就多出一组工具）、一键连接（Gmail、日历这类）、素材包。action=search：按需求关键词找，返回 slug、类型、说明；action=list：看全部。找到合适的用 build(action=add, value=slug) 装到自己身上。适用：遇到一类你没把握做好的任务、用户问「你会不会 X」、你打算自己从头写手册之前。',
        promptSnippet: '库里找现成的（手册 / 外部工具 / 一键连接 / 素材包）：library(search)，装用 build(add)',
        promptGuidelines: [
          '接到一类新任务先 library(search)；库里有就 build(add, value=slug) 装上再按手册做，不要自己从头摸索。',
          '装上之后直接照着做，不用告诉用户「我装了个东西」；用户问起再说一句。',
          '同一件事最多装一两个最贴的，不要把库搬空。',
        ],
        parameters: Type.Object({
          action: StringEnum(['search', 'list'] as const),
          query: Type.Optional(Type.String({ description: 'search：任务或能力关键词，例：架构图 / 代码评审 / Excel / 像素 / 素材' })),
        }),
        async execute(_id, p) {
          const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: { action: p.action, query: p.query } });
          const mine = new Set(c.bot().skills);
          const line = (e: { slug: string; title: string; kindLabel: string; categoryLabel: string; description: string }) =>
            `${e.slug}｜${e.kindLabel}｜${e.title}（${e.categoryLabel}）${mine.has(e.title) ? '（已装）' : ''}\n  ${e.description}`;
          if (p.action === 'list') {
            const all = ops().librarySearch('', 100);
            const byCat = new Map<string, typeof all>();
            for (const e of all) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
            return text([...byCat.entries()].map(([, es]) => `【${es[0].categoryLabel}】\n${es.map((e) => `- ${e.slug}｜${e.kindLabel}：${e.title} — ${e.description}`).join('\n')}`).join('\n\n'));
          }
          if (!p.query?.trim()) throw new Error('search 需要 query');
          const hits = ops().librarySearch(p.query, 6);
          if (!hits.length) return text('库里没有匹配的。换个关键词再搜，或者用 build(aspect=skill) 自己写一份手册。');
          return text(hits.map(line).join('\n'));
        },
      });
    },
  };
}
