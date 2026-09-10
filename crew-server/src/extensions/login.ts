import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * ask_login: the bot is driving the shared computer and the page wants a human — a QR to scan or a password to
 * type. Sending the user to the computer panel to do it is a bad trade (find the panel, wait for a frame, scan a
 * code that is 300 px wide in a scaled-down screenshot, and the code expires while they look). This brings the
 * login to the conversation: a live, self-refreshing crop of the QR, or a card whose values the server types into
 * the page directly — never through the model, never stored.
 */
export function loginExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-login',
    factory: (pi) => {
      pi.registerTool({
        name: 'ask_login',
        label: '把登录搬到对话里',
        description:
          '在电脑上撞到登录墙时用这个，把登录搬到对话里，用户不用打开电脑。kind=qr：把页面上的二维码裁出来发成卡片，实时刷新（码过期了卡上的也跟着换），用户手机扫完系统自动告诉你。kind=password：发一张登录卡，用户填的账号密码由系统直接打进页面并提交，不经过你、不存下来。url 填当前标签页网址的一段（用来找到那个标签）；selector 填二维码那个元素的 CSS 选择器（kind=qr）；passwordSelector / accountSelector / submitSelector 填输入框和按钮的选择器（kind=password）。',
        promptSnippet: '页面要扫码或要密码：ask_login 把它发到对话里，用户在这儿就能弄，不用打开电脑',
        promptGuidelines: [
          '看到二维码或登录表单，第一反应是 ask_login，不是让用户「打开电脑扫一下」。选择器从你刚才的页面快照里读，别猜。',
          '发完就结束这一轮或者去做别的：用户扫完、填完，系统会主动叫你回来，不要在对话里追问「好了吗」。',
          '任何情况下都不要让用户把密码发在对话里，也不要自己去读页面上的密码框。',
        ],
        parameters: Type.Object({
          kind: StringEnum(['qr', 'password'] as const),
          url: Type.Optional(Type.String({ description: '当前标签页网址里独有的一段，如 open.feishu.cn/app' })),
          title: Type.Optional(Type.String({ description: '卡片标题，一句话说清要干什么，如「扫码登录飞书」' })),
          selector: Type.Optional(Type.String({ description: 'kind=qr：二维码元素的 CSS 选择器；不给就发整页截图' })),
          accountSelector: Type.Optional(Type.String({ description: 'kind=password：账号输入框的选择器（有就填）' })),
          passwordSelector: Type.Optional(Type.String({ description: 'kind=password：密码输入框的选择器' })),
          submitSelector: Type.Optional(Type.String({ description: 'kind=password：登录按钮的选择器；不给就在密码框里回车' })),
          note: Type.Optional(Type.String({ description: '卡片上方给用户的一句话' })),
        }),
        async execute(_id, p) {
          const cur = c.current();
          const text = await ops().askLogin(c.botId, cur?.threadId, p);
          return { content: [{ type: 'text' as const, text }], details: { kind: p.kind } };
        },
      });
    },
  };
}
