import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { DesktopManager } from '../desktop.ts';
import { config } from '../config.ts';
import { guiCapability, operate, screenHeldBy, type Hands } from '../gui.ts';

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
        label: '操作屏幕',
        description:
          '把一个屏幕上的任务整体交给「手」：一个能看屏幕的模型，看截图、点鼠标、敲键盘，一步步做到目标为止，本地机器和云机器一样。适合浏览器文字快照搞不定的：画板 / 设计器 / 视频剪辑这类复杂网页应用、拖拽、桌面软件、图片做的界面、在某个产品里走一段长流程。goal 写清做什么和做到什么算完；context 给它需要知道的背景（在哪个页面、用什么名字、注意什么）。它看不到你们的对话，只看屏幕。做完回给你一段话和最后一张截图的路径（用 see 看）。需要登录、验证码、付款、不可逆删除时它会停下来告诉你，让用户在屏幕上接手。',
        promptSnippet: '复杂界面 / 桌面软件 / 拖拽 / 画板类任务：operate(goal) 让能看屏幕的模型替你一步步点完',
        promptGuidelines: [
          '普通网页先用 computer__browser_* 文字快照（便宜、准）；快照里没有你要的元素、要拖拽、要在画板或桌面软件里做事、流程长而复杂，才 operate。',
          '云机器上 operate 前先 computer(open)，把要操作的页面开在自己的标签里并拉到前台（browser_tabs select）；它操作的是整块屏幕，期间别的 browser_* 动作可能被它打断，等它做完再继续。',
          '一次给一个完整的小目标（「把这三个图层对齐并导出 PNG 到桌面」），不要给一整天的活；做完看它的总结和截图，再决定下一步。',
          '它说需要登录 / 验证码 / 付款就停，告诉用户「屏幕在你那边，帮我点一下」，等用户弄好再 operate 一次。密码永远不经过你也不经过它。',
        ],
        parameters: Type.Object({
          goal: Type.String({ description: '做什么、做到什么算完' }),
          context: Type.Optional(Type.String({ description: '背景：当前在哪个页面 / 软件，要用的名字、文件、注意事项' })),
          maxSteps: Type.Optional(Type.Number({ description: '最多几步，默认 25，上限 60' })),
        }),
        async execute(_id, p) {
          const h = hands();
          if (!h) throw new Error('这套 bot 没有配能操作屏幕的模型（config.json 里设 guiModel，或至少 visionModel）。');
          // The same on every machine: the computer is on (its browser window is what there is to operate), and
          // the hands take the screen it is on — an X display of ours, or the machine's own.
          const d = desktops();
          if (!d?.capable) throw new Error(`这台机器没有可操作的屏幕：${d?.capableNote ?? ''}`);
          await d.wake();
          const display = d.display;
          const cap = await guiCapability(display);
          if (!cap.ok) throw new Error(cap.note ?? '现在不能操作屏幕');
          const outDir = join(config.botsDir, c.botId, 'workspace', '_gui');
          mkdirSync(outDir, { recursive: true });
          const holder = screenHeldBy;
          const me = c.bot().name;
          const waited = holder && holder !== me ? `${holder} 正在用屏幕，等它做完才开始。` : '';
          const r = await operate(h, p.goal, { display, outDir, context: p.context, maxSteps: p.maxSteps, holder: me });
          d?.touch(c.botId);
          const text = `${waited}${r.ok ? '做完了' : '没做完'}（${r.steps} 步）：${r.summary}${r.lastShot ? `\n最后一张截图：${r.lastShot}（用 see 看）` : ''}\n过程记录：${r.log}`;
          return { content: [{ type: 'text' as const, text }], details: { ok: r.ok, steps: r.steps, lastShot: r.lastShot } };
        },
      });
    },
  };
}
