import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { DesktopManager } from '../desktop.ts';

/**
 * computer: the computer all bots share (see desktop.ts). `open` wakes it if it sleeps and hands this bot its
 * browser tools, in a tab of its own; `off` puts the whole computer to sleep; `status` says where things stand.
 * The user watches the screen live in the App and can use it at the same time.
 */
export function computerExtension(c: BotCtx, desktops: () => DesktopManager | undefined): InlineExtension {
  return {
    name: 'crew-computer',
    factory: (pi) => {
      pi.registerTool({
        name: 'computer',
        label: 'Computer',
        description:
          'The computer the bots share: one browser on the machine they run on, with one set of logins shared by all of them. On a cloud machine it has a desktop of its own, and the user watches the screen live in the App and can work on it directly; on the user\'s own computer it is simply a browser window on their desktop. open connects you to it (waking it if asleep), after which you gain a set of computer__browser_* tools — open a URL, read the page as a text snapshot, click, type, switch tabs, screenshot — for browsing, signing in, filling forms and downloading. Whatever anyone signed into, everyone can use. Each bot works in its own tab and does not disturb the others. off puts the whole computer to sleep (logins are kept). status shows where things stand. When a computer cannot run on this machine the tool says so, and you use fetch_url / web_search instead.',
        promptSnippet: 'connect to the shared computer (one browser, visible to the user): computer(open), then the computer__browser_* tools — and only touch your own tab',
        promptGuidelines: [
          'Reading one public page needs nothing more than fetch_url. Signing in, clicking through, filling a form, downloading, doing anything inside a site — that is when you connect: computer(open), then the computer__browser_* tools.',
          'The browser is shared; the tab is yours. One was opened for you when you connected. Work only in tabs you opened, never close or select someone else\'s, and open more with browser_tabs(new). If yours gets closed, open another.',
          'Once connected, browser_navigate to the address. Every action (navigate / click / type) already returns the page snapshot that follows it — the page as text, with refs for what can be clicked — so carry on from those refs rather than calling browser_snapshot separately. To find one button or field, browser_find(text) is far cheaper than a whole snapshot; reach for browser_snapshot only when a large page came back truncated.',
          'When the user has to sign in or click something: browser_tabs(list) to see which is current, browser_tabs(select, that index) to bring your tab to the front, then tell them the screen is on their side and to sign in on it and say when they are done — and stop and wait. Passwords never pass through you. The user may work on the screen at the same time as you, so snapshot before acting to see what is actually there.',
          'You cannot see a screenshot itself: browser_take_screenshot writes a file under _browser/ in your workspace. To see what a page actually looks like (layout, colour, anything misaligned), see that path. To know what the page says and what can be clicked, browser_snapshot is faster.',
          'The user can see the screen, so do not narrate each click — give the result. There is no need to call off when you finish: it sleeps by itself after half an hour unused, and the next open wakes it in about ten seconds.',
        ],
        parameters: Type.Object({
          action: StringEnum(['open', 'off', 'status'] as const),
        }),
        async execute(_id, p) {
          const res = (text: string, details: { state: string; tools?: string[] }) => ({ content: [{ type: 'text' as const, text }], details });
          const d = desktops();
          if (!d) throw new Error('this machine has no desktop');
          const cur = c.store.data.computer;
          if (p.action === 'status') {
            if (!d.capable) return res(`no computer available right now: ${d.capableNote}. Use fetch_url / web_search to read pages.`, { state: 'unavailable' });
            const st = cur?.state ?? 'off';
            const mine = d.attached(c.botId);
            const who = (cur?.users ?? []).filter((id) => id !== c.botId).map((id) => c.store.bot(id)?.name).filter(Boolean);
            const text =
              st === 'on'
                ? `The computer is on (since ${new Date(cur!.since ?? 0).toLocaleTimeString('en-GB')})${who.length ? `, also in use by ${who.join(', ')}` : ''}. ${mine ? 'Your browser tools are available.' : 'You are not connected yet: computer(open).'}`
                : st === 'starting'
                  ? 'The computer is waking up.'
                  : st === 'error'
                    ? `It did not come up last time: ${cur?.note ?? ''}. You can open again.`
                    : `The computer is asleep${cur?.note ? ` (${cur.note})` : ''}. computer(open) wakes it and connects you.`;
            return res(text, { state: st });
          }
          if (p.action === 'off') {
            const others = (cur?.users ?? []).filter((id) => id !== c.botId);
            if (others.length) return res(`${others.map((id) => c.store.bot(id)?.name ?? id).join(', ')} ${others.length > 1 ? 'are' : 'is'} using the computer, so it stays awake. Leave it — it sleeps on its own after half an hour idle.`, { state: cur?.state ?? 'on' });
            await d.off();
            return res('The computer is asleep. The logins are kept, and the next open picks up where this left off.', { state: 'off' });
          }
          if (!d.capable) throw new Error(`no computer available right now: ${d.capableNote}. Use fetch_url / web_search to read pages instead.`);
          const { tools } = await d.on(c.botId);
          return res(`Connected, and the user can see the screen. You have a tab of your own; work only in it. You now have these tools: ${tools.map((t) => `computer__${t}`).join(', ')}. browser_navigate to the address first, then browser_snapshot to read the page.`, { state: 'on', tools });
        },
      });
    },
  };
}
