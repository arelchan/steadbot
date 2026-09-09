import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * library: the curated skill library. A bot searches it when it meets a kind of task it has no manual for,
 * and mounts a skill instead of writing one from scratch (build is for writing / evolving its own).
 */
export function libraryExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-library',
    factory: (pi) => {
      pi.registerTool({
        name: 'library',
        label: '技能库',
        description:
          '技能库：一批精选过的现成技能手册（代码分析与架构图、代码评审、排错、测试、文档表格 PPT、调研写作、数据分析、竞品追踪、设计等），按分类整理。action=search：按需求关键词找现成手册，返回 slug、名称、说明；action=mount：把一份手册挂到你自己身上，立刻可用，之后它就是你的技能，可以用 build 继续改；action=list：看全部分类和技能。适用：遇到一类你没有手册的任务、用户说「你会不会 X」、你打算用 build 新写一份手册之前。先 search，有合适的就 mount，没有再自己写。',
        promptSnippet: '技能库：search 找现成手册，mount 挂到自己身上；写新手册前先查库',
        promptGuidelines: [
          '接到一类新任务先 library(search)；库里有就 mount 再按手册做，不要自己从头摸索。',
          'mount 后手册就在你的技能列表里，直接照着做，不用再告诉用户「我装了个技能」；用户问起再说一句。',
          '同一件事最多 mount 一两份最贴的，不要把库搬空。',
        ],
        parameters: Type.Object({
          action: StringEnum(['search', 'mount', 'list'] as const),
          query: Type.Optional(Type.String({ description: 'search：任务或能力关键词，例：架构图 / 代码评审 / Excel / 竞品' })),
          slug: Type.Optional(Type.String({ description: 'mount：技能的 slug（search 返回的第一列），也接受技能名' })),
        }),
        async execute(_id, p) {
          const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: { action: p.action, query: p.query, slug: p.slug } });
          if (p.action === 'list') {
            const all = ops().librarySearch('', 100);
            const byCat = new Map<string, typeof all>();
            for (const e of all) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
            return text([...byCat.entries()].map(([cat, es]) => `【${es[0].categoryLabel}】\n${es.map((e) => `- ${e.slug}：${e.title} — ${e.description}`).join('\n')}`).join('\n\n'));
          }
          if (p.action === 'search') {
            if (!p.query?.trim()) throw new Error('search 需要 query');
            const hits = ops().librarySearch(p.query, 6);
            if (!hits.length) return text('技能库里没有匹配的手册。可以换个关键词再搜，或者用 build(aspect=skill) 自己写一份。');
            const mine = new Set(c.bot().skills);
            return text(hits.map((e) => `${e.slug}｜${e.title}（${e.categoryLabel}）${mine.has(e.title) ? '（已挂载）' : ''}\n  ${e.description}`).join('\n'));
          }
          if (!p.slug?.trim()) throw new Error('mount 需要 slug');
          const r = await ops().libraryMount(c.botId, p.slug.trim());
          return text(r.already ? `「${r.name}」已经在你的技能里了，直接照着做。` : `已挂载「${r.name}」，手册现在在你的技能列表里，按它的步骤做。`);
        },
      });
    },
  };
}
