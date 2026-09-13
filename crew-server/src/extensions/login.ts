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
        label: 'Bring the login into the thread',
        description:
          'For when the computer hits a login wall: bring the login into the thread so the user does not have to go to the computer. kind=qr crops the QR code off the page into a card that refreshes live (when the code expires, the card follows), and the system tells you once they have scanned it with their phone. kind=password sends a login card; what they type is typed into the page and submitted by the system, never passing through you and never stored. url is a piece of the current tab\'s address (used to find the tab); selector is the CSS selector of the QR element (kind=qr); passwordSelector / accountSelector / submitSelector are the fields and the button (kind=password).',
        promptSnippet: 'a page wants a QR scan or a password: ask_login puts it in the thread, so the user never has to open the computer',
        promptGuidelines: [
          'A QR code or a login form means ask_login, not telling the user to go and scan something on the computer. Read the selectors out of the snapshot you just took; do not guess them.',
          'Once it is sent, end the turn or do something else. The system wakes you when they have scanned or filled it in — do not ask whether they are done.',
          'Never, in any circumstance, have the user type a password into the thread, and never read a password field off the page yourself.',
        ],
        parameters: Type.Object({
          kind: StringEnum(['qr', 'password'] as const),
          url: Type.Optional(Type.String({ description: 'a distinctive piece of the current tab address, like open.feishu.cn/app' })),
          title: Type.Optional(Type.String({ description: 'the card title, one line on what this is for, like "Scan to sign in to Feishu"' })),
          selector: Type.Optional(Type.String({ description: 'kind=qr: the CSS selector of the QR element; without it the whole page is sent' })),
          accountSelector: Type.Optional(Type.String({ description: 'kind=password: the selector of the account field, if there is one' })),
          passwordSelector: Type.Optional(Type.String({ description: 'kind=password: the selector of the password field' })),
          submitSelector: Type.Optional(Type.String({ description: 'kind=password: the selector of the sign-in button; without it, Enter is pressed in the password field' })),
          note: Type.Optional(Type.String({ description: 'one line to the user, above the card' })),
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
