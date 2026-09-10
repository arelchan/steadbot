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
        label: '电脑',
        description:
          'bot 们共用的一台电脑：bot 所在机器上的一个浏览器，所有 bot 共用它和它的登录态。在云机器上它有自己的桌面，用户在 App 里能实时看到屏幕、也能直接在上面操作；在用户自己的电脑上它就是用户桌面上的一个浏览器窗口，用户直接看得见。open = 接上它（睡着会先唤醒），接好后你会多出一组 computer__browser_* 工具（打开网址、把页面读成文字快照、点击、输入、切标签、截图…），用它们上网、登录网站、填表、下载文件；谁登录过的网站大家都能用。每个 bot 在自己的标签页里干活，互不影响。off = 让整台电脑休眠（登录态保留）。status = 看现在的状态。这台机器上开不了电脑时工具会告诉你，那就用 fetch_url / web_search。',
        promptSnippet: '接上 bot 们共用的电脑（一个共用浏览器，用户看得见）：computer(open) 后用 computer__browser_* 工具上网、登录、填表，只动自己的标签',
        promptGuidelines: [
          '只读一个公开网页用 fetch_url 就够；要登录、要点来点去、要填表、要下载、要在网站里操作，才接电脑：computer(open)，然后用 computer__browser_* 工具。',
          '浏览器是大家共用的，标签页是你自己的：接上时系统已经给你开了一个，只在自己开的标签里操作，不要 close / select 别人的标签；要多开就 browser_tabs(new)。自己的标签被关了就再开一个。',
          '接上后先 browser_navigate 到目标网址。每个动作（navigate / click / type）的结果里已经带着动作后的页面快照（文字版的页面结构，带可点的元素 ref），直接按 ref 继续，不用再单独 browser_snapshot。只想找某个按钮 / 输入框时用 browser_find(text) 比整页快照省得多；页面很大被截断了才 browser_snapshot。',
          '需要用户登录或点一下时：先 browser_tabs(list) 看哪条标着 current，browser_tabs(select, 那个 index) 把自己的标签拉到前台，再告诉用户「屏幕在你那边能看到，直接在上面登录一下，登好告诉我」，然后停下等他。密码永远不经过你。用户随时可能在屏幕上直接操作（和你同时），动手前 snapshot 一下看清当前页面。',
          '你看不见截图本身：browser_take_screenshot 存的是文件，路径在工作区的 _browser/ 下。要看清页面长什么样（版式、配色、有没有错位），对那个路径用 see；只是想知道页面上有什么字、能点什么，用 browser_snapshot 更快。',
          '用户看得见屏幕，不用复述每一步点了什么；说结果。做完一件事不用 off，半小时没人用它会自己休眠，下次 open 十秒左右就醒。',
        ],
        parameters: Type.Object({
          action: StringEnum(['open', 'off', 'status'] as const),
        }),
        async execute(_id, p) {
          const res = (text: string, details: { state: string; tools?: string[] }) => ({ content: [{ type: 'text' as const, text }], details });
          const d = desktops();
          if (!d) throw new Error('这台机器没有桌面能力');
          const cur = c.store.data.computer;
          if (p.action === 'status') {
            if (!d.capable) return res(`现在没有电脑可用：${d.capableNote}。上网读页面用 fetch_url / web_search。`, { state: 'unavailable' });
            const st = cur?.state ?? 'off';
            const mine = d.attached(c.botId);
            const who = (cur?.users ?? []).filter((id) => id !== c.botId).map((id) => c.store.bot(id)?.name).filter(Boolean);
            const text =
              st === 'on'
                ? `电脑开着（自 ${new Date(cur!.since ?? 0).toLocaleTimeString('zh-CN')}）${who.length ? `，${who.join('、')}也在用` : ''}。${mine ? '你的浏览器工具可用。' : '你还没接上：computer(open)。'}`
                : st === 'starting'
                  ? '电脑正在醒来。'
                  : st === 'error'
                    ? `上次没开起来：${cur?.note ?? ''}。可以再 open 试一次。`
                    : `电脑在休眠${cur?.note ? `（${cur.note}）` : ''}。computer(open) 唤醒并接上。`;
            return res(text, { state: st });
          }
          if (p.action === 'off') {
            const others = (cur?.users ?? []).filter((id) => id !== c.botId);
            if (others.length) return res(`${others.map((id) => c.store.bot(id)?.name ?? id).join('、')}正在用这台电脑，先不休眠。不用管它，闲半小时会自己睡。`, { state: cur?.state ?? 'on' });
            await d.off();
            return res('电脑休眠了。登录态还在，下次 open 接着用。', { state: 'off' });
          }
          if (!d.capable) throw new Error(`现在没有电脑可用：${d.capableNote}。上网读页面改用 fetch_url / web_search。`);
          const { tools } = await d.on(c.botId);
          return res(`接上了，用户那边能看到屏幕。你有自己的标签页，只在里面操作。你现在多了这些工具：${tools.map((t) => `computer__${t}`).join('、')}。先 browser_navigate 到网址，再 browser_snapshot 读页面。`, { state: 'on', tools });
        },
      });
    },
  };
}
