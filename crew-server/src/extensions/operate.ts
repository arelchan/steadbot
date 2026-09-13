import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { DesktopManager } from '../desktop.ts';
import { config } from '../config.ts';
import { guiCapability, handsBins, operate, screenHeldBy, type Hands } from '../gui.ts';
import { ready as depsReady } from '../deps.ts';

/**
 * operate: hand a goal to the hands (gui.ts) — a vision model that looks at the screen and works it click by
 * click, like a person. For what the browser's text snapshots cannot reach: canvas editors, drag-and-drop,
 * desktop software, pages made of pictures, long fiddly flows in a product's UI. The bot states the goal and gets
 * back what happened; the user watches it live on the screen.
 */
export function operateExtension(c: BotCtx, hands: () => Hands | undefined, desktops: () => DesktopManager | undefined): InlineExtension {
  return {
    name: 'crew-operate',
    factory: (pi) => {
      pi.registerTool({
        name: 'operate',
        label: 'Operate the screen',
        description:
          'Hand a whole on-screen task to the hands: a model that can see the screen, looks at a screenshot, moves the mouse and types, step after step, until the goal is met — the same on a local machine and a cloud one. Right for what text snapshots cannot reach: canvases, design tools, video editors and other heavy web apps, drag-and-drop, desktop software, interfaces made of pictures, a long flow inside some product. goal says what to do and what counts as finished; context gives the background it needs (which page, which name to use, what to watch out for). It cannot see your conversation, only the screen. When it finishes you get a paragraph and the path of the last screenshot (look at it with see). It stops and tells you when a login, a captcha, a payment or an irreversible deletion is needed, so the user can take the screen.',
        promptSnippet: 'heavy interfaces, desktop software, drag-and-drop, canvases: operate(goal) hands it to a model that can see the screen',
        promptGuidelines: [
          'Ordinary pages go through the computer__browser_* text snapshots first — cheap and precise. Reach for operate when the element you need is not in the snapshot, when something has to be dragged, when the work is in a canvas or a desktop app, or when the flow is long and involved.',
          'On a cloud machine, computer(open) first, open the page in your own tab and bring it to the front (browser_tabs select). operate drives the whole screen, so other browser_* actions may be interrupted while it runs — wait for it to finish.',
          'One whole small goal at a time ("align these three layers and export a PNG to the desktop"), never a day\'s work. Read its summary and look at the screenshot before deciding the next step.',
          'When it reports a login, a captcha or a payment, stop and tell the user the screen is on their side and ask them to do that one thing, then operate again once they have. Passwords pass through neither you nor it.',
        ],
        parameters: Type.Object({
          goal: Type.String({ description: 'what to do, and what counts as finished' }),
          context: Type.Optional(Type.String({ description: 'background: which page or program it is on, the names and files to use, what to watch out for' })),
          maxSteps: Type.Optional(Type.Number({ description: 'how many steps at most; defaults to 25, capped at 60' })),
        }),
        async execute(_id, p) {
          const h = hands();
          if (!h) throw new Error('no model that can operate a screen is configured (set guiModel in config.json, or at least visionModel).');
          // The same on every machine: the computer is on (its browser window is what there is to operate), and
          // the hands take the screen it is on — an X display of ours, or the machine's own.
          const d = desktops();
          if (!d?.capable) throw new Error(`this machine has no screen to operate: ${d?.capableNote ?? ''}`);
          await d.wake();
          const display = d.display;
          // The hands' OS tools are a machine dependency (deps.ts keeps them installed); a first use waits a little for them.
          const dep = await depsReady({ bin: handsBins() }, 'computer:hands');
          if (!dep.ok) throw new Error(dep.note ?? 'the tools for operating a screen are not installed yet');
          const cap = await guiCapability(display);
          if (!cap.ok) throw new Error(cap.note ?? 'the screen cannot be operated right now');
          const outDir = join(config.botsDir, c.botId, 'workspace', '_gui');
          mkdirSync(outDir, { recursive: true });
          const holder = screenHeldBy;
          const me = c.bot().name;
          const waited = holder && holder !== me ? `${holder} has the screen; this waited for it to finish. ` : '';
          const r = await operate(h, p.goal, { display, outDir, context: p.context, maxSteps: p.maxSteps, holder: me, who: c.botId });
          d?.touch(c.botId);
          const text = `${waited}${r.ok ? 'Finished' : 'Did not finish'} (${r.steps} steps): ${r.summary}${r.lastShot ? `\nLast screenshot: ${r.lastShot} (look at it with see)` : ''}\nLog: ${r.log}`;
          return { content: [{ type: 'text' as const, text }], details: { ok: r.ok, steps: r.steps, lastShot: r.lastShot } };
        },
      });
    },
  };
}
