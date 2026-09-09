import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import type { Bot } from '../types.ts';

type Details = { jobId?: string; aspect: string; action: string; label?: string };

/**
 * build: everything about the bot itself — who it is and how it works.
 *   rewrite  (default) the bot rewrites the text itself, asynchronously, from what happened
 *   set      apply an exact value right away (the user dictated it, or it's a routine/skill entry)
 *   remove   drop a skill or routine
 * Product-level settings (notify, autonomy, grants, groups…) are configure's job, not build's.
 */
export function buildExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-build',
    factory: (pi) => {
      pi.registerTool({
        name: 'build',
        label: '进化',
        description:
          '构建你自己：名字(name)、简介(tagline)、人设(soul)、职责与工作方式(instructions)、技能手册(skill)、例行任务(routine)、外部连接(connection)。这些都是「你是谁、你怎么工作、你能连什么」，只有你能改。connection：action=set/add 加一个服务（value 填平台 slug，如 gmail、github、notion；已授权的直接接上，没授权的会给用户发一张授权卡），action=remove 断开（value 填连接名）。action=rewrite（默认）：你根据发生的事自己重写 soul / instructions / skill，后台异步进行，调用后立刻返回，不影响当前对话，完成后用户会看到一条「进化」通知；action=set：把 value 原样写入，立即生效（name、tagline、soul、instructions 的原话；routine 的 {title, schedule}）；action=remove：去掉一个技能或例行任务。适用：用户纠正了你的语气、态度或做法；同一类任务反复出现却没有手册，或手册被证明有漏洞；职责边界和实际发生的事对不上；用户直接要你改名、改简介、加定时任务。不适用：只影响这一次的临时要求（直接照做）；关于用户的事实（remember）；通知、自主度、打扰策略、授权、群聊这类产品设置（configure）。',
        promptSnippet: '构建你自己：名字 / 简介 / 人设 / 工作方式 / 技能 / 例行任务 / 外部连接；rewrite 异步自省重写，set 直接写入',
        promptGuidelines: [
          'rewrite 要有依据：用户明确纠正过，或同类情况至少出现两次。一句夸奖、一次偶然，不足以改。',
          '一次只改一个方面。trigger 写清发生了什么、哪句话；change 写清要变成什么样，具体到能直接落笔。',
          '用户给的是原话（「把人设改成：…」「叫你小张」）用 set 原样写入；给的是方向（「别这么客气」「以后先给结论」）用 rewrite 自己重写。',
          'rewrite 调用后照常继续手上的事，不要等结果；回复里最多带半句「我顺手把自己的…调一下」，用户不问就不展开。',
          'skill：技能名沿用已有的表示改写，新名字表示新建；手册是写给以后的你看的操作步骤。routine 的 schedule 只认「每天 20:30」「每周一 09:00」「工作日 18:00」「每 30 分钟」「每小时」这几种写法。',
        ],
        parameters: Type.Object({
          aspect: StringEnum(['name', 'tagline', 'soul', 'instructions', 'skill', 'routine', 'connection'] as const),
          action: Type.Optional(StringEnum(['rewrite', 'set', 'remove'] as const)),
          trigger: Type.Optional(Type.String({ description: 'rewrite：发生了什么让你想改，引用用户的原话或具体事件' })),
          change: Type.Optional(Type.String({ description: 'rewrite：要变成什么样——保留什么、改掉什么、新增什么' })),
          value: Type.Optional(Type.Any({ description: 'set：新值。name/tagline/soul/instructions 为字符串；routine 为 {title, schedule, enabled?}' })),
          skill: Type.Optional(Type.String({ description: 'aspect=skill 时的技能名；aspect=routine 且 remove 时可用作任务标题' })),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'rewrite';
          const b = c.bot();
          const str = (v: unknown) => {
            if (typeof v !== 'string' || !v.trim()) throw new Error('value 需要是非空字符串');
            return v.trim();
          };
          const done = (text: string, extra: Partial<Details> = {}) => ({ content: [{ type: 'text' as const, text }], details: { aspect: p.aspect, action, ...extra } as Details });

          if (action === 'rewrite') {
            if (!['soul', 'instructions', 'skill'].includes(p.aspect)) throw new Error(`${p.aspect} 不能 rewrite，请用 set${p.aspect === 'connection' ? '（value 填平台 slug）' : '给出具体值'}`);
            if (!p.trigger?.trim() || !p.change?.trim()) throw new Error('rewrite 需要 trigger 和 change');
            if (p.aspect === 'skill' && !p.skill?.trim()) throw new Error('aspect=skill 需要 skill 技能名');
            const job = await ops().build(c.botId, { aspect: p.aspect as 'soul' | 'instructions' | 'skill', trigger: p.trigger, change: p.change, skill: p.skill?.trim() });
            return done(`已开始进化「${job.label}」，后台进行，不影响当前对话；完成后用户会看到通知。你继续手上的事。`, { jobId: job.id, label: job.label });
          }

          if (p.aspect === 'connection') {
            const ref = str(p.value ?? p.skill);
            if (action === 'remove') {
              const i = c.store.data.integrations.find((x) => x.id === ref || x.name === ref || x.connector === ref.toLowerCase());
              if (!i) throw new Error(`没有叫「${ref}」的连接`);
              c.store.patchBot(c.botId, { integrationIds: (b.integrationIds ?? []).filter((x) => x !== i.id) });
              return done(`已断开 ${i.name}，它的工具不再出现在你的列表里。`);
            }
            const cur = c.current();
            const r = await ops().connect(c.botId, cur?.threadId ?? (`bot:${c.botId}` as const), ref, p.trigger);
            return done(r.text, { label: ref });
          }
          const patch: Partial<Bot> = {};
          switch (p.aspect) {
            case 'name':
              if (action === 'remove') throw new Error('名字不能删');
              patch.name = str(p.value).slice(0, 12);
              break;
            case 'tagline':
              patch.tagline = action === 'remove' ? '' : str(p.value).slice(0, 40);
              break;
            case 'soul':
              patch.soul = action === 'remove' ? '' : str(p.value).slice(0, 400);
              break;
            case 'instructions':
              if (action === 'remove') throw new Error('职责不能删空，请改写');
              patch.role = str(p.value).slice(0, 800);
              break;
            case 'skill': {
              const name = (p.skill ?? (typeof p.value === 'string' ? p.value : '')).trim();
              if (!name) throw new Error('需要 skill 技能名');
              if (action === 'remove') patch.skills = b.skills.filter((s) => s !== name);
              else throw new Error('技能手册不能 set 原文，请用 rewrite 让自己写一份');
              break;
            }
            case 'routine': {
              if (action === 'remove') {
                const t = (typeof p.value === 'string' ? p.value : (p.value as { title?: string })?.title) ?? p.skill;
                if (!t) throw new Error('remove routine 需要任务标题');
                patch.routines = b.routines.filter((r) => r.title !== t && r.id !== t);
              } else {
                const v = p.value as { title?: string; schedule?: string; enabled?: boolean } | undefined;
                if (!v?.title || !v?.schedule) throw new Error('set routine 需要 value={title, schedule}，schedule 如「每天 20:30」「每周一 09:00」「工作日 18:00」「每 30 分钟」');
                const existing = b.routines.find((r) => r.title === v.title);
                patch.routines = existing
                  ? b.routines.map((r) => (r.title === v.title ? { ...r, schedule: v.schedule!, enabled: v.enabled ?? r.enabled } : r))
                  : [...b.routines, { id: Math.random().toString(36).slice(2, 10), title: v.title, schedule: v.schedule, enabled: v.enabled ?? true }];
              }
              break;
            }
          }
          c.store.patchBot(c.botId, patch);
          const what = { name: '名字', tagline: '简介', soul: '人设', instructions: '工作方式', skill: '技能', routine: '例行任务', connection: '连接' }[p.aspect];
          return done(`${what}已${action === 'remove' ? '去掉' : '更新'}。界面上已经生效。`);
        },
      });
    },
  };
}
