import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * channel_check: credentials that authenticate prove nothing about whether a person can actually reach the bot.
 * A Feishu app that was never published opens its websocket happily and then never receives a thing; the bot
 * reports "接好了" and the user finds nothing over there. So the last step of joining an IM is a round trip the
 * runtime judges: arm gives out a code, the bot goes to the shared computer and sends itself that line from the
 * user's own client, and status says whether it came home. Nothing here trusts the model's account of it.
 */
export function channelCheckExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-channel-check',
    factory: (pi) => {
      pi.registerTool({
        name: 'channel_check',
        label: '验收 IM 是否真的通了',
        description:
          '接完一个 IM 后的最后一步：验证用户那边真的能找到你、消息真的能进来。action=arm：拿一个暗号（如 EB-7F3A），然后用电脑打开那个 IM 的网页版（用户已经登录），搜自己的名字，以用户的身份给你自己发一条带这个暗号的消息。action=status：看暗号有没有回来——ok 才算真的通了；waiting 说明消息没进来，多半是应用没发布、可用范围不含这个用户，或事件没订上。这条测试消息不会出现在对话里。',
        promptSnippet: '接完 IM 用 channel_check(arm) 拿暗号，去电脑上以用户身份给自己发一条，再 channel_check(status) 看通没通',
        promptGuidelines: [
          '凭据接上不等于接好：飞书应用不发布、可用范围不含用户，照样连得上却收不到消息。所以每接完一个 IM 都要跑一次 channel_check，通过了才对用户说接好了。',
          'arm 之后去电脑里操作：打开那个 IM 的网页版（用户登录的那个），搜自己的机器人名字，把暗号发过去；然后 status。等 20 秒还是 waiting 就再 status 一次。',
          'status 一直不 ok：先回平台后台检查发布状态和可用范围、事件订阅，改完再发一次暗号。自己查完还不行才告诉用户，说清楚卡在哪一步。',
        ],
        parameters: Type.Object({
          action: StringEnum(['arm', 'status'] as const),
          channel: Type.String({ description: 'IM 名：飞书 / Telegram / Slack / 企业微信' }),
        }),
        async execute(_id, p) {
          const text = await ops().channelCheck(c.botId, p.channel, p.action);
          return { content: [{ type: 'text' as const, text }], details: { action: p.action, channel: p.channel } };
        },
      });
    },
  };
}
