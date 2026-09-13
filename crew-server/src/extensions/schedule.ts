import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { botThread, type CrewEvent } from '../types.ts';

const Params = Type.Object({
  action: StringEnum(['add', 'list', 'move', 'drop'] as const),
  eventId: Type.Optional(Type.String({ description: 'required for move / drop' })),
  title: Type.Optional(Type.String({ description: 'one line for add, recognisable at a glance — "submit the Q3 review"' })),
  at: Type.Optional(Type.String({ description: 'an absolute moment, written 2026-09-12 10:00, in the user\'s timezone. Never "tomorrow" or "next week" — work out the date yourself' })),
  minutes: Type.Optional(Type.Number({ description: 'minutes, if it takes a span of time; leave it out for a point on the timeline' })),
  who: Type.Optional(StringEnum(['user', 'me'] as const, { description: 'user = remind the user when it fires (default); me = you do it yourself when it fires' })),
  note: Type.Optional(Type.String({ description: 'With who=user, what you intend to say to them when it fires. With who=me, what you will do. The system hands this back to you verbatim at the time, and it is all you will have, so do not write it as a report about what someone wanted' })),
});

/** 'YYYY-MM-DD HH:MM' (T and seconds are accepted too). The server's TZ is the user's, so local time is the answer. */
function parseAt(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) throw new Error(`the time has to be an absolute moment like "2026-09-12 10:00"; got "${s}"`);
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  if (Number.isNaN(at.getTime())) throw new Error(`no such time: ${s}`);
  return at.getTime();
}

const say = (e: CrewEvent) =>
  `[${e.id}] ${new Date(e.at).toLocaleString('sv-SE', { hour12: false }).slice(0, 16)} ${e.title}${e.minutes ? ` · ${e.minutes} min` : ''} · ${e.who === 'user' ? 'remind the user' : 'you do it'}${e.firedAt ? ' · fired' : ''}`;

/**
 * Schedule: putting one thing at one moment.
 *
 * The split with recurring tasks is once versus repeatedly: daily or weekly goes through build(aspect=routine),
 * and something that happens once goes here. When it fires, the scheduler hands it back to the bot that set it
 * (the same path recurring tasks take) and the bot decides what to say and do — a reminder is simply a message
 * from it, not a second notification system.
 */
export function scheduleExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-schedule',
    factory: (pi) => {
      pi.registerTool({
        name: 'schedule',
        label: 'Schedule',
        description:
          'Put something on the user\'s schedule: add one, list what you have set, move the time, drop it. who=user reminds them when it fires; who=me means you do it. When it fires the system hands the entry and its note back to you, and you decide then what to say or do.',
        promptSnippet: 'put something at a given moment (add / list / move / drop)',
        promptGuidelines: [
          'When the user names a time, put it on: "remind me to file the report on Wednesday", "meeting at three", "wake me at eight". Vague things like "sometime when I am free" do not go on.',
          'You may also schedule what you judge they will need, but only with grounds: something they just promised someone, something with a stated deadline, material needed before a meeting. When unsure, ask in your reply rather than quietly filling their schedule.',
          'Once means schedule; daily or weekly is a recurring task and goes through build(aspect=routine). Never schedule a string of repeats.',
          'Write the absolute moment (2026-09-12 10:00) and convert "tomorrow" or "next Wednesday" yourself. After setting it, repeat the time in your reply so they know which day it landed on.',
          'note says what to say or do when it fires. It is not a copy of the title, and not a report about what someone asked — it comes back to you verbatim and is all you will have, so write what you would actually say.',
          'If you can do it now, do it. Do not schedule yourself something a minute from now.',
        ],
        parameters: Params,
        async execute(_id, p) {
          const mine = () => c.store.eventsOf(c.botId).sort((a, b) => a.at - b.at);
          if (p.action === 'list') {
            const list = mine().filter((e) => !e.firedAt);
            return { content: [{ type: 'text', text: list.map(say).join('\n') || '(nothing of yours on the schedule)' }], details: { events: list } };
          }
          if (p.action === 'add') {
            const title = (p.title ?? '').trim();
            if (!title) throw new Error('add needs a title');
            if (!p.at) throw new Error('add needs at');
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
            return { content: [{ type: 'text', text: `Scheduled: ${say(ev)}. The user can see it on their schedule.` }], details: { events: mine() } };
          }
          const ev = p.eventId ? c.store.event(p.eventId) : undefined;
          if (!ev || ev.botId !== c.botId) throw new Error(`nothing of yours on the schedule with id ${p.eventId ?? ''}; list them first`);
          if (p.action === 'drop') {
            c.store.dropEvent(ev.id);
            return { content: [{ type: 'text', text: `Dropped: ${ev.title}` }], details: { events: mine() } };
          }
          if (!p.at) throw new Error('move needs at');
          // A moved entry is re-armed: even one that already fired can be pushed later.
          const moved = c.store.patchEvent(ev.id, { at: parseAt(p.at), firedAt: undefined, ...(p.minutes ? { minutes: p.minutes } : {}) })!;
          return { content: [{ type: 'text', text: `Moved: ${say(moved)}` }], details: { events: mine() } };
        },
      });
    },
  };
}
