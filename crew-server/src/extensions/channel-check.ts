import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';

/**
 * channel_check: credentials that authenticate prove nothing about whether a person can actually reach the bot.
 * A Feishu app that was never published opens its websocket happily and then never receives a thing; the bot
 * reports success and the user finds nothing over there. So the last step of joining an IM is a round trip the
 * runtime judges: arm gives out a code, the bot goes to the shared computer and sends itself that line from the
 * user's own client, and status says whether it came home. Nothing here trusts the model's account of it.
 */
export function channelCheckExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-channel-check',
    factory: (pi) => {
      pi.registerTool({
        name: 'channel_check',
        label: 'Verify the messenger really works',
        description:
          'The last step after connecting a messenger: prove the user can actually find you and that messages actually arrive. action=arm gives you a passphrase (like EB-7F3A); then open that messenger\'s web client on the computer (where the user is already logged in), search for your own name, and send yourself a message containing it as the user. action=status checks whether it came back — only ok means it works. waiting means nothing arrived, usually because the app is unpublished, its availability does not include this user, or events are not subscribed. The test message never appears in the thread.',
        promptSnippet: 'after connecting a messenger: channel_check(arm) for a passphrase, send yourself one as the user from the computer, then channel_check(status)',
        promptGuidelines: [
          'Credentials connecting is not the same as being connected: an unpublished Feishu app, or one whose availability excludes the user, connects fine and receives nothing. So every messenger gets a channel_check, and only a pass lets you tell the user it is done.',
          'After arm, work on the computer: open that messenger\'s web client (the one the user is logged into), search for your bot name, send the passphrase, then status. Still waiting after twenty seconds, status again.',
          'If status never turns ok: go back to the console and check the publish state, the availability and the event subscriptions, fix them, and send the passphrase again. Only after that do you tell the user, and then say exactly which step is stuck.',
        ],
        parameters: Type.Object({
          action: StringEnum(['arm', 'status'] as const),
          channel: Type.String({ description: 'the messenger: Feishu / Telegram / Slack / WeCom' }),
        }),
        async execute(_id, p) {
          const text = await ops().channelCheck(c.botId, p.channel, p.action);
          return { content: [{ type: 'text' as const, text }], details: { action: p.action, channel: p.channel } };
        },
      });
    },
  };
}
