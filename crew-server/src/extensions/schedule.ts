import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { botThread, type CrewEvent } from '../types.ts';

const Params = Type.Object({
  action: StringEnum(['add', 'list', 'move', 'drop'] as const),
  eventId: Type.Optional(Type.String({ description: 'move / drop 时必填' })),
  title: Type.Optional(Type.String({ description: 'add 时的一句话，用户一眼能认出来是什么，如「交 Q3 复盘」' })),
  at: Type.Optional(Type.String({ description: '绝对时刻，写成 2026-09-12 10:00（用户所在时区）。不要写「明天」「下周」，自己换算成日期' })),
  minutes: Type.Optional(Type.Number({ description: '要占一段时间就填分钟数；不填就是时间轴上的一个点' })),
  who: Type.Optional(StringEnum(['user', 'me'] as const, { description: 'user = 到点提醒用户（默认）；me = 到点你自己做这件事' })),
  note: Type.Optional(Type.String({ description: '到点要说的话 / 要做的事，越具体越好——到点了系统把这段原样交回给你' })),
});

/** 'YYYY-MM-DD HH:MM'（也认 T 和秒）。服务端的 TZ 就是用户的时区，所以本地时间直接算。 */
function parseAt(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) throw new Error(`时间要写成「2026-09-12 10:00」这样的绝对时刻，收到的是「${s}」`);
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  if (Number.isNaN(at.getTime())) throw new Error(`这个时间不存在：${s}`);
  return at.getTime();
}

const say = (e: CrewEvent) =>
  `[${e.id}] ${new Date(e.at).toLocaleString('sv-SE', { hour12: false }).slice(0, 16)} ${e.title}${e.minutes ? ` · ${e.minutes} 分钟` : ''} · ${e.who === 'user' ? '提醒用户' : '你自己做'}${e.firedAt ? ' · 已到点' : ''}`;

/**
 * 日程：把一件事放在某个时刻。
 *
 * 和例行任务的分工是「一次」和「反复」：每天/每周重复的用 build(aspect=routine)，只发生一次的用这个。
 * 到点了 scheduler 把它交回给排它的 bot（和例行任务同一条路），由 bot 决定说什么、做什么——提醒就是
 * 它的一条消息，不另起一套通知通道。
 */
export function scheduleExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-schedule',
    factory: (pi) => {
      pi.registerTool({
        name: 'schedule',
        label: '日程',
        description:
          '把一件事放到用户的日程上：add 排一条、list 看你排过的、move 改时间、drop 撤掉。who=user 是到点提醒用户，who=me 是到点你自己做。到点了系统会把这条连同 note 交回给你，那时你再决定说什么、做什么。',
        promptSnippet: '把一件事排到某个时刻（add / list / move / drop）',
        promptGuidelines: [
          '用户说了具体时间的事就排上：「下周三提醒我交报告」「三点开会」「明早八点叫我」。含糊的「有空再说」不排。',
          '你自己判断出用户会需要的也可以排——但要排得住脚：他刚答应别人的事、有明确截止的东西、会前要准备的材料。拿不准就在回复里问一句，别默默排一堆。',
          '只发生一次的用 schedule；每天/每周反复的是例行任务，用 build(aspect=routine)——不要用 schedule 排一串重复的。',
          '时间写绝对时刻（2026-09-12 10:00），自己把「明天」「下周三」换算成日期。排完在回复里把时间复述给用户一句，他才知道你放在了哪天。',
          'note 写「到点了要说什么/做什么」，不是重复标题——到点系统把这段原样交回给你，那时你手上只有它。',
          '马上就能做的事直接做，不要给自己排一条一分钟后的日程。',
        ],
        parameters: Params,
        async execute(_id, p) {
          const mine = () => c.store.eventsOf(c.botId).sort((a, b) => a.at - b.at);
          if (p.action === 'list') {
            const list = mine().filter((e) => !e.firedAt);
            return { content: [{ type: 'text', text: list.map(say).join('\n') || '（日程上没有你排的事）' }], details: { events: list } };
          }
          if (p.action === 'add') {
            const title = (p.title ?? '').trim();
            if (!title) throw new Error('add 需要 title');
            if (!p.at) throw new Error('add 需要 at');
            const at = parseAt(p.at);
            const ev = c.store.addEvent({
              botId: c.botId,
              title,
              at,
              ...(p.minutes ? { minutes: p.minutes } : {}),
              who: p.who === 'me' ? 'bot' : 'user',
              ...(p.note?.trim() ? { note: p.note.trim() } : {}),
              threadId: c.current()?.threadId ?? botThread(c.botId),
            });
            return { content: [{ type: 'text', text: `已排上：${say(ev)}。用户在日程里看得见这条。` }], details: { events: mine() } };
          }
          const ev = p.eventId ? c.store.event(p.eventId) : undefined;
          if (!ev || ev.botId !== c.botId) throw new Error(`日程上没有你排的 ${p.eventId ?? ''}；先 list 看看`);
          if (p.action === 'drop') {
            c.store.dropEvent(ev.id);
            return { content: [{ type: 'text', text: `已撤掉：${ev.title}` }], details: { events: mine() } };
          }
          if (!p.at) throw new Error('move 需要 at');
          // 挪过的重新算一次到点：已经触发过的也能往后挪。
          const moved = c.store.patchEvent(ev.id, { at: parseAt(p.at), firedAt: undefined, ...(p.minutes ? { minutes: p.minutes } : {}) })!;
          return { content: [{ type: 'text', text: `已改时间：${say(moved)}` }], details: { events: mine() } };
        },
      });
    },
  };
}
