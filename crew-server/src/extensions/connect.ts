import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { CONNECTORS, POPULAR_TOOLKITS } from '../connectors.ts';

/**
 * connect: hand the user a one-click authorization card for a service the product knows
 * (Gmail, Google 日历, …). The user signs in in the browser; when they are back the connector's
 * tools are on this bot and the bot is woken up to continue.
 */
export function connectExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const catalog = `精修过的：${CONNECTORS.map((x) => `${x.id}（${x.name}）`).join('、')}；此外几百个主流平台都能接，service 用平台英文 slug，常见：${POPULAR_TOOLKITS.join(', ')}`;
  return {
    name: 'crew-connect',
    factory: (pi) => {
      pi.registerTool({
        name: 'connect',
        label: '连接服务',
        description: `把一个外部服务接到用户身上，一步到位：你调用后，对话里会出现一张授权卡，用户点一下、在浏览器里登录并同意，回来就接好了，服务的工具会直接出现在你的工具列表里，系统还会通知你继续。用户不需要懂 OAuth、IMAP、API、token 这些词，也不需要提供任何凭据——不要问他要。支持范围：${catalog}。用户提到邮件、日历、文档、笔记、聊天工具、代码仓库、项目管理这类外部服务而还没接时，直接用它，不要先问接入方式；只有 connect 明确说不认识这个平台时，才走「MCP 连接」技能里的手动方式。`,
        promptSnippet: '一键接入外部服务（Gmail、日历、Notion、Slack、GitHub、飞书…几百个）：发授权卡，用户点一下就接好',
        promptGuidelines: [
          '接外部服务永远三步：用户提需求 → 你先 connect 试一键接入 → connect 说不认识才按「MCP 连接」技能手动接（找现成 MCP，没有就写一个）。第一步不要问用户接入方式，直接 connect。',
          '出卡后一句话告诉用户「点一下卡片登录就行」，不解释技术细节。',
          '卡片发出后不要追问、不要重复发；用户授权完成系统会通知你，那时再继续手上的事。用户说「点了没反应 / 失败了」再发一张。',
          '同一个服务已经连着（工具列表里已有它的工具）就直接用，不要再 connect。',
        ],
        parameters: Type.Object({
          service: Type.String({ description: `平台英文 slug，如 ${POPULAR_TOOLKITS.slice(0, 12).join(', ')}` }),
          why: Type.Optional(Type.String({ description: '一句话，接上之后你要用它做什么；会显示在卡片上' })),
        }),
        async execute(_id, p) {
          const cur = c.current();
          const r = await ops().connect(c.botId, cur?.threadId ?? (`bot:${c.botId}` as const), p.service, p.why);
          return { content: [{ type: 'text', text: r.text }], details: { status: r.status, service: p.service } };
        },
      });
      pi.registerTool({
        name: 'request_credentials',
        label: '要凭据',
        description:
          '向用户要授权码、App Secret、API token 这类凭据，但不是在对话里要：对话里出现一张凭据卡，用户填在卡上，值直接写进指定连接的环境变量，你和对话记录都看不到。用于手动接入（第 3 步）：桥已经搭好、连接已经用 configure 建好（凭据留空）之后，用它把凭据要过来。用户填完系统会自动重连并通知你连接状态。',
        promptSnippet: '发凭据卡让用户填授权码 / token（不经过对话，直接进连接的环境变量）',
        promptGuidelines: [
          '任何密码、授权码、App Secret、token 都不要让用户发在对话里；一律 request_credentials 发卡。用户已经贴出来了，就提醒他以后用卡片，并把值原样传给 build(aspect=mcp, action=add) 建连接后不再复述。',
          '先搭桥（delegate_agent 写好、build(aspect=mcp, action=add) 建好连接），再发凭据卡：用户填完立刻能用，不用等。',
          'fields 的 key 必须和桥读取的环境变量名一致；label 用用户看得懂的话（「QQ 邮箱授权码」而不是 IMAP_PASSWORD）。',
          'help 必填：url 是用户点开就能到达的那一页（设置页、开放平台的应用页），steps 三步以内写清在那一页点什么。用户不该需要自己找路。',
        ],
        parameters: Type.Object({
          integration: Type.String({ description: '要写入凭据的连接：名字或 id' }),
          title: Type.String({ description: '卡片标题，如「填一下 QQ 邮箱的授权码」' }),
          fields: Type.Array(
            Type.Object({
              key: Type.String({ description: '环境变量名，如 QQMAIL_AUTH_CODE' }),
              label: Type.String({ description: '给用户看的名字' }),
              hint: Type.Optional(Type.String({ description: '输入框里的提示，如「16 位，全是字母」' })),
              secret: Type.Optional(Type.Boolean({ description: '是否密文输入，默认 true' })),
            }),
          ),
          help: Type.Optional(
            Type.Object({
              url: Type.Optional(Type.String({ description: '点开直达的页面，如 https://mail.qq.com/ 的设置页' })),
              urlLabel: Type.Optional(Type.String({ description: '按钮文字，如「打开 QQ 邮箱设置」' })),
              steps: Type.Optional(Type.Array(Type.String({ description: '到了那一页之后做什么，三步以内' }))),
            }),
          ),
        }),
        async execute(_id, p) {
          const integ = c.store.data.integrations.find((i) => i.id === p.integration || i.name === p.integration);
          if (!integ) throw new Error(`找不到连接「${p.integration}」，先用 build(aspect=mcp, action=add) 建好`);
          const cur = c.current();
          const threadId = cur?.threadId ?? (`bot:${c.botId}` as const);
          c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `${p.title}。填在卡上就行，我看不到内容，填完自动接。`, ts: Date.now(), card: { type: 'secrets', integrationId: integ.id, title: p.title, fields: p.fields.map((f) => ({ ...f, secret: f.secret ?? /code|secret|token|pass|key|pwd/i.test(f.key) })), help: p.help } });
          return { content: [{ type: 'text', text: `凭据卡已发到对话里（连接「${integ.name}」，字段：${p.fields.map((f) => f.key).join('、')}）。用户填完系统会重连并通知你；现在不要追问，继续别的或结束这一轮。` }], details: { integrationId: integ.id, fields: p.fields.map((f) => f.key) } };
        },
      });
    },
  };
}
