import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * harvest: the bot has found a credential on a page it is driving (an App Secret on the open platform, a bot token
 * from @BotFather) and wants it in its own connection — without the value ever passing through the model or the
 * conversation. The server reads the element straight out of the shared browser (CDP), checks the format, writes
 * it into the bot's account for that IM (or the connection's environment), starts the bridge, and tells the bot
 * only that it is in — masked. This is what makes "the bot connects itself" possible without leaking anything.
 */
export function harvestExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-harvest',
    factory: (pi) => {
      pi.registerTool({
        name: 'harvest',
        label: '从页面取凭据',
        description:
          '把你在浏览器页面上看到的凭据（App ID、App Secret、Bot Token、xoxb-/xapp- token、企业微信的 Secret / Token / EncodingAESKey，或某个外部工具要的 API Key）直接收进配置——值由系统从页面里读，不经过你、不进对话、不进文件。action=take：target 填 IM 名（飞书 / Telegram / Slack / 企业微信）或连接名，field 填要收的那一项（卡片上的 key 或名字），url 填你当前标签页网址的一段（用来找到那个标签）；页面上同类格式的值不止一个时加 selector（CSS）或 near（那个值旁边的标签文字，如「App Secret」）。收齐后系统自动接入并把结果告诉你。action=info：看这个 IM 还差哪几项、以及你在对方平台上要填的东西（企业微信的回调 URL、本机公网 IP、机器人该叫什么）。',
        promptSnippet: '页面上看到的密钥直接收进配置（值不经过你）：harvest(take, target=飞书, field=App Secret, url=当前网址一段)；要填给对方平台的信息用 harvest(info)',
        promptGuidelines: [
          '自己接自己进 IM 时，凭据一律 harvest，不要把页面上的密钥写进回复、卡片或文件，也不要用 request_credentials 让用户抄一遍。看到密钥被遮住（•••• 或「查看」按钮）先点开再 harvest。',
          '一项一项收：每收一项系统会说还差什么；都收齐会自动接入并告诉你那边的机器人名字。收不到（找不到、有多个候选）就按提示加 near / selector 再试一次，还不行才让用户在屏幕上帮一下。',
          '要填给对方平台的信息（回调 URL、可信 IP、机器人名字）先 harvest(info) 拿，不要猜。',
        ],
        parameters: Type.Object({
          action: Type.Optional(StringEnum(['take', 'info'] as const)),
          target: Type.String({ description: 'IM 名（飞书 / Telegram / Slack / 企业微信），或连接的名字 / id' }),
          field: Type.Optional(Type.String({ description: 'take：要收的那一项，写卡片上的 key（如 feishuAppSecret）或名字（如 App Secret）' })),
          url: Type.Optional(Type.String({ description: 'take：你当前标签页网址里独有的一段，如 open.feishu.cn/app/cli_' })),
          selector: Type.Optional(Type.String({ description: 'take：值所在元素的 CSS 选择器（可选）' })),
          near: Type.Optional(Type.String({ description: 'take：值旁边的标签文字（可选），如「App Secret」' })),
        }),
        async execute(_id, p) {
          const cur = c.current();
          const text = await ops().harvest(c.botId, { action: p.action ?? 'take', target: p.target, field: p.field, url: p.url, selector: p.selector, near: p.near, threadId: cur?.threadId });
          return { content: [{ type: 'text' as const, text }], details: { action: p.action ?? 'take', target: p.target, field: p.field } };
        },
      });
    },
  };
}
