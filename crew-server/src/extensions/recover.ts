import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { BotCtx } from './ctx.ts';
import type { McpManager } from './../integrations.ts';
import type { DesktopManager } from '../desktop.ts';

/**
 * Failures the runtime should handle instead of handing to the model.
 *
 * A tool that failed for a reason the machine can fix is not information the bot can use — it is a distraction it
 * has to reason its way around, usually badly (three retries, then improvising a different route). The pi API fires
 * `tool_result` for every call and lets a handler replace the result, so this is one hook with a table of rules
 * rather than a special case wired into each tool: match the failure, put the world back, run the same call again,
 * and give the model the result it would have gotten. Only when the fix does not work does the failure go through.
 *
 * The first rule is the browser: a bot's Playwright process talks to a shared Chrome that may be asleep, restarting,
 * or still bringing up a dozen tabs, and its handshake times out (desktop.ts holds the shape that makes this rare).
 */

interface Deps {
  mcp: McpManager;
  desktops: DesktopManager;
}

interface Rule {
  name: string;
  when: (toolName: string, text: string) => boolean;
  /** put the world back; false means do not bother trying again */
  fix: (botId: string, d: Deps) => Promise<boolean>;
}

const BROWSER_DOWN = /initializeServer|Timeout \d+ms exceeded|browser has been closed|ECONNREFUSED|Target closed|the computer is not running/i;

const RULES: Rule[] = [
  {
    name: 'browser',
    when: (tool, text) => tool.startsWith('computer__') && BROWSER_DOWN.test(text),
    fix: async (botId, d) => {
      // Boots the computer if it sleeps (waiting until a client can actually attach) and rebuilds this bot's own
      // browser process — a timed-out handshake usually leaves it there but useless, so `on` alone would keep it.
      await d.desktops.reattach(botId);
      return true;
    },
  },
];

export function recoverExtension(c: BotCtx, deps: () => Deps): InlineExtension {
  return {
    name: 'crew-recover',
    factory: (pi) => {
      pi.on('tool_result', async (ev) => {
        if (!ev.isError) return;
        const text = ev.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
        const rule = RULES.find((r) => r.when(ev.toolName, text));
        if (!rule) return;
        const d = deps();
        const integ = c.store.data.integrations.find((i) => i.owner === c.botId && ev.toolName.startsWith(`${i.name}__`));
        console.warn(`[crew] ${c.botId}: ${ev.toolName} failed (${rule.name}); repairing and retrying once`);
        const fixed = await rule.fix(c.botId, d).catch(() => false);
        if (!fixed || !integ) return;
        const again = await d.mcp.callTool(integ.id, ev.toolName.slice(integ.name.length + 2), ev.input).catch((e: Error) => ({ content: [{ type: 'text' as const, text: e.message }], isError: true }));
        const failedAgain = 'isError' in again && again.isError;
        if (failedAgain) return;
        return {
          content: [{ type: 'text' as const, text: '(The browser was not connected; it has been reconnected and this step was re-run.)\n' }, ...(again.content as { type: 'text'; text: string }[])],
          isError: false,
        };
      });
    },
  };
}
