import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import type { BotCtx } from './ctx.ts';
import type { VigilManager } from '../vigil.ts';
import type { Vigil, ThreadId } from '../types.ts';

/**
 * The `vigil` tool: for a task that plays out over time (an install coming up, a build finishing, a reply arriving).
 * The bot declares its goal and what to watch; the server polls and wakes it only when something changes or breaks,
 * so it can fix problems itself instead of blocking or forgetting. No check = a plain loop the bot drives forward.
 */
export function vigilExtension(c: BotCtx, mgr: () => VigilManager): InlineExtension {
  return {
    name: 'crew-vigil',
    factory: (pi) => {
      pi.registerTool({
        name: 'vigil',
        label: 'Stand watch',
        description:
          'Stand watch over something long-running: you state the goal and what to watch, the system checks at an interval on your behalf, and it wakes you only when something changed or went wrong — then you decide whether to wait, fix it, or finish. Right for installing onto a cloud machine and watching it come up, waiting for a build, waiting for someone to reply: things that need attention over time and can go wrong halfway. Check kinds: machine runs one command on the connected machine and reads the output (most useful during an install); http polls an address for its status; none does not check at all and simply nudges you to push things along. When the goal is met, or there is nothing left to watch, action=stop. Each bot has one watch at a time, and start replaces the old one.',
        promptSnippet: 'stand watch over long work: a goal and a periodic check (a machine command, a URL, or nothing), waking you on change or trouble',
        promptGuidelines: [
          'Only for work that genuinely needs watching, can go wrong halfway, and that you could act on when woken. Anything one-shot you simply finish.',
          'goal is what you are trying to reach; watching is the change you are looking for. check_command has to be idempotent and read-only (a status, a log tail, a curl health check) — never put something with side effects in a check.',
          'Set every_s to how fast things actually change: an install or a build wants tens of seconds to a couple of minutes, not tighter.',
          'When the system wakes you: stop if you got there, fix it if something broke, keep waiting if it is not there yet — usually without saying anything to the user.',
        ],
        parameters: Type.Object({
          action: StringEnum(['start', 'stop'] as const),
          goal: Type.Optional(Type.String({ description: 'start: the goal you are trying to reach, in one line' })),
          watching: Type.Optional(Type.String({ description: 'start: what you are watching for, in one line' })),
          check_kind: Type.Optional(StringEnum(['machine', 'http', 'none'] as const)),
          check_command: Type.Optional(Type.String({ description: 'check_kind=machine: a read-only command to run on that machine; =http: the address to poll' })),
          every_s: Type.Optional(Type.Number({ description: 'how often to check, in seconds; defaults to 60, minimum 20, maximum 1800' })),
          reason: Type.Optional(Type.String({ description: 'stop: why you are finishing (reached it / giving up / handing it to the user)' })),
        }),
        async execute(_id, p) {
          const threadId: ThreadId = c.current()?.threadId ?? (`bot:${c.botId}` as const);
          if (p.action === 'stop') {
            mgr().end(c.botId, p.reason ?? 'finished');
            return { content: [{ type: 'text', text: 'The watch has ended.' }], details: { action: 'stop', everyS: 0, check: 'none' } };
          }
          if (!p.goal || !p.watching) throw new Error('starting a watch needs goal and watching');
          const kind = p.check_kind ?? 'none';
          if ((kind === 'machine' || kind === 'http') && !p.check_command?.trim()) throw new Error(`check_kind=${kind} needs check_command`);
          const everyMs = Math.min(Math.max(Math.round(p.every_s ?? 60), 20), 1800) * 1000;
          const check: Vigil['check'] = kind === 'none' ? undefined : { kind, target: p.check_command!.trim(), label: kind === 'machine' ? p.check_command!.trim().slice(0, 40) : 'health check' };
          // A card the user can watch: goal, what's being watched, how often, latest check.
          const msg = c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `Watching: ${p.goal}`, ts: Date.now(), card: { type: 'vigil', goal: p.goal, watching: p.watching, everyS: everyMs / 1000, checkLabel: check?.label, state: 'running', ticks: 0 } });
          const maxTicks = Math.max(6, Math.ceil((2 * 3600 * 1000) / everyMs)); // roughly two hours of watching
          mgr().begin(c.botId, { goal: p.goal, watching: p.watching, check, everyMs, maxTicks, messageId: msg.id });
          return { content: [{ type: 'text', text: `Watching "${p.goal}", every ${everyMs / 1000} seconds${check ? `, checking "${check.label}"` : ', nudging you to push it along'}. You will be woken on a change or a problem. End the turn here; there is nothing else to do.` }], details: { action: 'start', everyS: everyMs / 1000, check: kind } };
        },
      });
    },
  };
}
