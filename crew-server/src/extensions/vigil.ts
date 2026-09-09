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
        label: '值守',
        description:
          '开始值守一个长程任务：你说清目标和要盯的东西，系统按间隔替你检查，只在有变化或出问题时叫醒你，你再决定继续、解决还是收工。适合「装到云机器上、盯着它起来」「等构建跑完」「等对方回复」这类要持续关注、可能中途出问题的事。检查方式：machine=在已连接的那台机器上跑一条命令看输出（装机时最有用）；http=定时请求一个地址看状态；none=不自动检查，只是到点提醒你把事情往前推。达成目标或不需要再盯了就 action=stop。同一时间每个 bot 只有一个值守，start 会替换掉旧的。',
        promptSnippet: '值守长程任务：定个目标、定时检查（机器命令 / 网址 / 纯循环），出变化或出问题时叫醒你处理',
        promptGuidelines: [
          '真正需要持续关注、可能中途出问题、且你能在被叫醒时动手处理的任务才用；一次性的事直接做完就行。',
          'goal 写你要达成什么，watching 写你在盯什么变化；check_command 给一条幂等的只读命令（看状态、看日志、curl 健康检查），不要在检查里做有副作用的操作。',
          'every_s 按变化快慢定：装机、构建几十秒到两三分钟一次即可，别设太密。',
          '被系统叫醒后：达成就 stop；有问题就解决；没到位就继续等，通常不用对用户说话。',
        ],
        parameters: Type.Object({
          action: StringEnum(['start', 'stop'] as const),
          goal: Type.Optional(Type.String({ description: 'start：你要达成的目标，一句话' })),
          watching: Type.Optional(Type.String({ description: 'start：你在盯的东西 / 期待的变化，一句话' })),
          check_kind: Type.Optional(StringEnum(['machine', 'http', 'none'] as const)),
          check_command: Type.Optional(Type.String({ description: 'check_kind=machine：在那台机器上跑的只读命令；=http：要请求的地址' })),
          every_s: Type.Optional(Type.Number({ description: '多久检查一次，秒；默认 60，最少 20，最多 1800' })),
          reason: Type.Optional(Type.String({ description: 'stop：为什么收工（达成 / 放弃 / 交给用户）' })),
        }),
        async execute(_id, p) {
          const threadId: ThreadId = c.current()?.threadId ?? (`bot:${c.botId}` as const);
          if (p.action === 'stop') {
            mgr().end(c.botId, p.reason ?? '已收工');
            return { content: [{ type: 'text', text: '值守已结束。' }], details: { action: 'stop', everyS: 0, check: 'none' } };
          }
          if (!p.goal || !p.watching) throw new Error('开始值守要给 goal 和 watching');
          const kind = p.check_kind ?? 'none';
          if ((kind === 'machine' || kind === 'http') && !p.check_command?.trim()) throw new Error(`check_kind=${kind} 需要 check_command`);
          const everyMs = Math.min(Math.max(Math.round(p.every_s ?? 60), 20), 1800) * 1000;
          const check: Vigil['check'] = kind === 'none' ? undefined : { kind, target: p.check_command!.trim(), label: kind === 'machine' ? p.check_command!.trim().slice(0, 40) : '健康检查' };
          // A card the user can watch: goal, what's being watched, how often, latest check.
          const msg = c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `开始值守：${p.goal}`, ts: Date.now(), card: { type: 'vigil', goal: p.goal, watching: p.watching, everyS: everyMs / 1000, checkLabel: check?.label, state: 'running', ticks: 0 } });
          const maxTicks = Math.max(6, Math.ceil((2 * 3600 * 1000) / everyMs)); // roughly two hours of watching
          mgr().begin(c.botId, { goal: p.goal, watching: p.watching, check, everyMs, maxTicks, messageId: msg.id });
          return { content: [{ type: 'text', text: `开始值守「${p.goal}」，每 ${everyMs / 1000} 秒${check ? `看一次「${check.label}」` : '提醒你推进一次'}。有变化或出问题我会叫你；这一轮到此为止，不用再做别的。` }], details: { action: 'start', everyS: everyMs / 1000, check: kind } };
        },
      });
    },
  };
}
