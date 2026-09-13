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
        label: 'Take credentials off a page',
        description:
          'Take a credential you can see on a page in the browser (App ID, App Secret, Bot Token, an xoxb-/xapp- token, WeCom\'s Secret / Token / EncodingAESKey, or an API key some tool needs) straight into config — the system reads the value off the page, so it never passes through you, the conversation or a file. action=take: target is the messenger (Feishu / Telegram / Slack / WeCom) or the connection name, field is the item to take (the key or the name on the card), url is a distinctive piece of your current tab\'s address (used to find that tab). When several values on the page share a format, add selector (CSS) or near (the label beside it, such as "App Secret"). Once the set is complete the system connects it and tells you. action=info: what this messenger still needs, and what you have to fill in on their side (WeCom\'s callback URL, this machine\'s public IP, what the bot should be called).',
        promptSnippet: 'take a secret straight off the page into config (the value never passes through you): harvest(take, target=Feishu, field=App Secret, url=part of the address); harvest(info) for what to fill in on their side',
        promptGuidelines: [
          'When connecting yourself to a messenger, every credential goes through harvest. Never write a secret from the page into a reply, a card or a file, and never make the user copy it out with request_credentials. If it is masked (•••• or a "view" button), reveal it first.',
          'Take them one at a time; after each, the system says what is still missing, and when the set is complete it connects and tells you the bot\'s name over there. If one cannot be taken (not found, or several candidates), add near / selector as suggested and try again. Only then ask the user to help on screen.',
          'Whatever you have to fill in on their side (callback URL, trusted IP, the bot\'s name) comes from harvest(info). Do not guess it.',
        ],
        parameters: Type.Object({
          action: Type.Optional(StringEnum(['take', 'info'] as const)),
          target: Type.String({ description: 'the messenger (Feishu / Telegram / Slack / WeCom), or a connection name or id' }),
          field: Type.Optional(Type.String({ description: 'take: the item to take, as the key on the card (feishuAppSecret) or its name (App Secret)' })),
          url: Type.Optional(Type.String({ description: 'take: a distinctive piece of your current tab address, like open.feishu.cn/app/cli_' })),
          selector: Type.Optional(Type.String({ description: 'take: a CSS selector for the element holding the value (optional)' })),
          near: Type.Optional(Type.String({ description: 'take: the label text beside the value (optional), such as "App Secret"' })),
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
