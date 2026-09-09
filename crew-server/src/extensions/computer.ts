import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { DesktopManager } from '../desktop.ts';

/**
 * computer: the bot's own computer (see desktop.ts). `open` powers it on and hands the bot its browser tools;
 * `off` powers it down; `status` says where things stand. The user watches the screen live in the App.
 */
export function computerExtension(c: BotCtx, desktops: () => DesktopManager | undefined): InlineExtension {
  return {
    name: 'crew-computer',
    factory: (pi) => {
      pi.registerTool({
        name: 'computer',
        label: '我的电脑',
        description:
          '你自己的电脑：bot 所在机器上的一个 Linux 桌面，带浏览器，用户在 App 里能实时看到屏幕、也能接管。open = 开机，开好后你会多出一组 computer__browser_* 工具（打开网址、把页面读成文字快照、点击、输入、切标签、截图…），用它们上网、登录网站、填表、下载文件；你登录过的网站下次还在。off = 关机（登录态保留）。status = 看现在的状态。bot 在用户自己的电脑上跑时没有这台电脑，工具会告诉你，那就用 fetch_url / web_search。',
        promptSnippet: '开你自己的电脑（云机器上的桌面 + 浏览器，用户能实时看屏幕）：computer(open) 后用 computer__browser_* 工具上网、登录、填表',
        promptGuidelines: [
          '只读一个公开网页用 fetch_url 就够；要登录、要点来点去、要填表、要下载、要在网站里操作，才开电脑：computer(open)，然后用 computer__browser_* 工具。',
          '开机后先 browser_navigate 到目标网址，再 browser_snapshot 读页面（是文字版的页面结构，带可点的元素编号），按编号 click / type。每一步做完再 snapshot 确认，不要盲操作。',
          '需要用户登录的网站：navigate 到登录页后告诉用户「我的电脑屏幕在你那边能看到，点「接管」登录一下，登好告诉我」，然后停下等他。密码永远不经过你。',
          '用户看得见你的屏幕，不用复述每一步点了什么；说结果。做完一件事不用关机，半小时没人用它会自己休眠，下次 open 十秒左右就醒。',
        ],
        parameters: Type.Object({
          action: StringEnum(['open', 'off', 'status'] as const),
        }),
        async execute(_id, p) {
          const res = (text: string, details: { state: string; tools?: string[] }) => ({ content: [{ type: 'text' as const, text }], details });
          const d = desktops();
          if (!d) throw new Error('这台机器没有桌面能力');
          const cur = c.bot().desktop;
          if (p.action === 'status') {
            if (!d.capable) return res(`你现在没有自己的电脑：${d.capableNote}。上网读页面用 fetch_url / web_search。`, { state: 'unavailable' });
            const st = cur?.state ?? 'off';
            const text = st === 'on' ? `电脑开着（自 ${new Date(cur!.since ?? 0).toLocaleTimeString('zh-CN')}），浏览器工具可用。` : st === 'starting' ? '正在开机。' : st === 'error' ? `上次开机失败：${cur?.note ?? ''}。可以再 open 试一次。` : `电脑关着${cur?.note ? `（${cur.note}）` : ''}。computer(open) 开机。`;
            return res(text, { state: st });
          }
          if (p.action === 'off') {
            await d.off(c.botId);
            return res('关机了。登录态还在，下次开机接着用。', { state: 'off' });
          }
          if (!d.capable) throw new Error(`你现在没有自己的电脑：${d.capableNote}。上网读页面改用 fetch_url / web_search。`);
          const { tools } = await d.on(c.botId);
          return res(`电脑开好了，用户那边能看到屏幕。你现在多了这些工具：${tools.map((t) => `computer__${t}`).join('、')}。先 browser_navigate 到网址，再 browser_snapshot 读页面。`, { state: 'on', tools });
        },
      });
    },
  };
}
