import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { CONNECTORS, POPULAR_TOOLKITS } from '../connectors.ts';

/**
 * connect: hand the user a one-click authorization card for a service the product knows
 * (Gmail, Google Calendar, …). The user signs in in the browser; when they are back the connector's
 * tools are on this bot and the bot is woken up to continue.
 */
export function connectExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const catalog = `Hand-tuned: ${CONNECTORS.map((x) => `${x.id} (${x.name})`).join(', ')}. Several hundred more mainstream platforms also work — service takes the platform slug, commonly: ${POPULAR_TOOLKITS.join(', ')}`;
  return {
    name: 'crew-connect',
    factory: (pi) => {
      pi.registerTool({
        name: 'connect',
        label: 'Connect a service',
        description: `Attach an external service to the user in one step: you call it, an authorisation card appears in the thread, they click it, log in and approve in their browser, and it is connected — the service's tools appear directly in your tool list and the system wakes you to continue. The user does not need to know what OAuth, IMAP, an API or a token is, and never supplies a credential — do not ask for one. Coverage: ${catalog}. When the user mentions mail, a calendar, documents, notes, a chat tool, a code host or project management and it is not connected, just call this. Do not ask them how they would like to connect it. Only when connect says plainly that it does not know the platform do you fall back to the manual route in the "Connecting an external service" manual.`,
        promptSnippet: 'one-click connection to hundreds of services (Gmail, Calendar, Notion, Slack, GitHub, Lark…): send a card, one click connects it',
        promptGuidelines: [
          'Connecting a service is always three steps: the user asks for something → you try connect first → only if connect does not know it do you connect by hand per the manual (find an existing MCP, or write one). Do not ask them how to connect at step one; just call connect.',
          'Once the card is out, one line — press the card and log in. No technical detail.',
          'After sending the card, do not chase and do not send another. The system tells you when they have approved, and you carry on then. Send a second one only if they say nothing happened or it failed.',
          'If the service is already connected (its tools are in your list), just use it. Do not connect again.',
        ],
        parameters: Type.Object({
          service: Type.String({ description: `the platform slug, like ${POPULAR_TOOLKITS.slice(0, 12).join(', ')}` }),
          why: Type.Optional(Type.String({ description: 'one line on what you will do with it once connected; shown on the card' })),
        }),
        async execute(_id, p) {
          const cur = c.current();
          const r = await ops().connect(c.botId, cur?.threadId ?? (`bot:${c.botId}` as const), p.service, p.why);
          return { content: [{ type: 'text', text: r.text }], details: { status: r.status, service: p.service } };
        },
      });
      pi.registerTool({
        name: 'request_credentials',
        label: 'Ask for credentials',
        description:
          'Ask the user for an app password, an App Secret, an API token — but not in the conversation. A credential card appears in the thread, they fill it in, and the values go straight into that connection\'s environment variables, invisible to you and to the transcript. Use it in the manual route, once the bridge is written and the connection exists with its credentials left empty. When they finish, the system reconnects and tells you the status.',
        promptSnippet: 'send a credential card for an app password or token (never through the conversation; straight into the connection)',
        promptGuidelines: [
          'Never have the user put a password, an app password, an App Secret or a token in the thread; always send a card. If they already pasted one, tell them to use the card next time, pass the value straight into build(aspect=mcp, action=add), and never repeat it afterwards.',
          'Secrets go in neither the conversation nor the card: an App Secret or token you saw on a web page never goes into a reply, into any field of a card, or into a file. For messengers use build(aspect=channel, action=add), or send request_credentials at the ch-xxx connection, and the system sends its own standard card.',
          'Build the bridge first (have delegate_agent write it, create the connection with build(aspect=mcp, action=add)), then send the card: the moment they fill it in, it works.',
          'Each field key has to match the environment variable the bridge reads; the label is in words the user knows ("QQ Mail app password", not IMAP_PASSWORD).',
          'help is required: url is the page one click takes them to (the settings page, the app page in the console), and steps says in three steps or fewer what to press once there. They should never have to find the way themselves.',
        ],
        parameters: Type.Object({
          integration: Type.String({ description: 'the connection the credentials belong to: name or id' }),
          title: Type.String({ description: 'the card title, like "Add your QQ Mail app password"' }),
          fields: Type.Array(
            Type.Object({
              key: Type.String({ description: 'the environment variable name, like QQMAIL_AUTH_CODE' }),
              label: Type.String({ description: 'the name the user sees' }),
              hint: Type.Optional(Type.String({ description: 'the placeholder, like "16 characters, letters only"' })),
              secret: Type.Optional(Type.Boolean({ description: 'whether to mask the input; defaults to true' })),
            }),
          ),
          help: Type.Optional(
            Type.Object({
              url: Type.Optional(Type.String({ description: 'the page one click reaches, like the settings page of https://mail.qq.com/' })),
              urlLabel: Type.Optional(Type.String({ description: 'the button text, like "Open QQ Mail settings"' })),
              steps: Type.Optional(Type.Array(Type.String({ description: 'what to do once on that page, in three steps or fewer' }))),
            }),
          ),
        }),
        async execute(_id, p) {
          const integ = c.store.data.integrations.find((i) => i.id === p.integration || i.name === p.integration || (i.kind === 'channel' && i.channel === p.integration));
          if (!integ) throw new Error(`no connection called "${p.integration}"; create it with build(aspect=mcp, action=add) first`);
          const cur = c.current();
          const threadId = cur?.threadId ?? (`bot:${c.botId}` as const);
          // An IM channel has its own card: the fields are fixed (the bridge reads them by name), the steps are written.
          // Whatever the model made up here is dropped, so the card and the bridge always agree.
          if (integ.kind === 'channel' && integ.channel && integ.channel !== 'app') {
            ops().connectChannel(c.botId, integ.channel, threadId);
            return { content: [{ type: 'text', text: `The credential card for ${integ.name} is in the thread (the standard one — its fields and steps are fixed, you do not define them). The system connects it and tells you when they are done; do not chase it.` }], details: { integrationId: integ.id, fields: [] } };
          }
          const fields = p.fields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, secret: f.secret ?? /code|secret|token|pass|key|pwd/i.test(f.key) }));
          c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `${p.title}. Fill it in on the card — I cannot see what you type, and it connects itself once saved.`, ts: Date.now(), card: { type: 'secrets', integrationId: integ.id, title: p.title, fields, help: p.help } });
          return { content: [{ type: 'text', text: `The credential card is in the thread (connection "${integ.name}", fields: ${fields.map((f) => f.key).join(', ')}). The system reconnects and tells you when it is filled in; do not chase it — carry on with something else or end the turn.` }], details: { integrationId: integ.id, fields: fields.map((f) => f.key) } };
        },
      });
    },
  };
}
