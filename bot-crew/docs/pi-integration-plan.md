# bot-crew × pi：基于 pi 扩展体系的后端实现方案

> 目标：把 `bot-crew` 前端原型（多 bot 异步委托工作台）接到 [earendil-works/pi](https://github.com/earendil-works/pi) 上，用 pi 的 SDK + 扩展（Extension）机制承载「bot 身份 / 事项 / 拍板 / 主动打扰 / 群聊 / 多 IM」这些能力。
> 源码已克隆到 `../pi-src`（v0.85.1，Node ≥ 22.19）。

---

## 0. 一句话结论

**pi 的 `AgentSession`（一个会话 = 一个 agent 循环 + 一份 JSONL 会话树）就是我们的「一个 bot」；我们的所有产品语义（事项、拍板、打扰预算、群聊、IM 分发）都以 pi Extension 的形式实现，跑在一个我们自己写的 Node 服务 `crew-server` 里；前端把 `MockAgentService` 换成一个 WebSocket 客户端即可。**

不需要 fork pi，也不需要改 pi 源码。所有接入点都是 pi 公开的 SDK / Extension API。

---

## 1. pi 提供了什么（调研结论）

| 层 | 包 | 我们用来做什么 |
|---|---|---|
| 模型 | `@earendil-works/pi-ai` | 多 provider 统一流式 API，不用自己接模型；另有独立的图像生成接口 `ImagesModels.generateImages()`（头像用） |
| agent 循环 | `@earendil-works/pi-agent-core` | `Agent`：工具调用、事件流、`transformContext` |
| **会话 + 扩展 + 技能** | `@earendil-works/pi-coding-agent` | `createAgentSession()`、`SessionManager`、`DefaultResourceLoader`、Extension API、Skills、Prompt Templates、Settings、Packages |
| 远程协议（实验） | `pi-protocol` / `pi-server` / `pi-client` / `chord` | 多 presentation 附着到同一 Session 的 CBOR 协议。**现阶段不采用**，见 §7 |
| IM 桥接 | `earendil-works/pi-chat`（独立仓库） | Discord/Telegram → pi 会话的扩展，作为多 IM 分发的参考实现 |

### 1.1 关键 API（我们会直接用的）

**SDK**
- `createAgentSession({ cwd, agentDir, sessionManager, resourceLoader, tools, customTools, model })` → `{ session }`
- `session.prompt(text, { streamingBehavior: 'steer' | 'followUp', images })`、`steer()`、`followUp()`、`abort()`
- `session.subscribe(event)`：`agent_start/end/settled`、`turn_*`、`message_start/update/end`、`tool_execution_*`、`queue_update`
- `session.bindExtensions({ uiContext, mode, ... })`：**把 `ctx.ui.select/confirm/input/notify` 的实现换成我们自己的**，这是「拍板卡片」的入口
- `SessionManager.create(cwd, sessionDir)` / `open(path)` / `inMemory()`：每个 bot 一个 sessionDir
- `DefaultResourceLoader({ extensionFactories, additionalExtensionPaths, skillsOverride, systemPromptOverride, agentsFilesOverride })`：程序化注入扩展、技能、系统提示、上下文文件
- `createEventBus()` + `pi.events`：跨扩展、跨 session 的事件总线（bot 之间传话）

**Extension API（`(pi: ExtensionAPI) => void`）**
- `pi.registerTool({ name, parameters(TypeBox), execute(id, params, signal, onUpdate, ctx), promptSnippet, promptGuidelines })`：给模型加工具
- `pi.on('before_agent_start')`：每轮改 systemPrompt / 注入消息 → **bot 角色、对你的认知、共享记忆都从这里进**
- `pi.on('input')`：拦截/改写用户输入（`source: 'rpc' | 'interactive' | 'extension'`）→ 识别 @提及、来源渠道
- `pi.on('session_start' | 'session_tree' | 'agent_settled' | 'tool_result' | 'tool_call')`
- `pi.sendMessage({ customType, content, display }, { deliverAs, triggerTurn })`：注入进入 LLM 上下文的自定义消息 → **另一个 bot 的话、定时任务触发、IM 来信**
- `pi.sendUserMessage(text, { deliverAs })`：以用户身份注入
- `pi.appendEntry(customType, data)`：写入会话但**不进** LLM 上下文 → 事项快照、拍板记录、可撤销动作日志
- `ctx.sessionManager.getBranch()/getEntries()`：重放会话重建扩展状态（todo.ts 的做法）
- `ctx.ui.select/confirm/input/notify/setStatus`：需要用户介入时调用；在 RPC 模式或我们自定义 `uiContext` 下变成协议消息
- `pi.setSessionName()`、`pi.setLabel()`、`ctx.compact()`、`ctx.getContextUsage()`

**状态持久化约定（pi 官方建议）**
- 工具产生的状态放 `toolResult.details`，会随分支/fork 自动正确
- UI-only 的持久数据用 `appendEntry`
- `session_start` 时从 `getBranch()` 重放重建内存态

**可分发形式**：扩展 + 技能 + 提示词模板可以打成 **pi package**（npm / git），`settings.json` 里 `packages: [...]` 一行装上。

---

## 2. 前端功能清单 → 后端需求

按前端现有代码（`src/types.ts`、`store.ts`、`services/agent.ts`、各组件）逐项列出，并标出 pi 侧对应机制。

### 2.1 Bot（身份 / 配置）

| 前端功能 | 数据 | pi 映射 |
|---|---|---|
| bot 列表、置顶、通知开关 | `Bot.pinned / notify` | crew-server 自己的 `bots.json`（产品级元数据，pi 不管） |
| 名字、描述（=指令）可编辑 | `Bot.name / role` | `role` → `before_agent_start` 注入 systemPrompt；`name` → `pi.setSessionName` + `bots.json` |
| 「新建 bot」空窗口，首条消息生成 bot | `onDraftMessage` | crew-server 用一次 `pi-ai` 单轮调用做 `inferBot`（名字/角色/技能/头像 seed），再创建 session |
| 头像：生图生成、上传替换、重新生成 | `avatarUrl / avatarSeed` | `AvatarService` 在服务端用 pi-ai 的 `builtinImagesModels().generateImages(model, { input:[{type:'text', text: prompt}] })` 生成，鉴权走 pi 的 provider 凭据；文件存本地 `avatars/`，`bots.json` 存 URL |
| 配置弹窗 · 指令 | `role / autonomy / interrupt` | `before_agent_start` 拼装；autonomy/interrupt 作为**策略参数**传给 crew 扩展 |
| 配置弹窗 · 记忆 | `viewOfYou[]`、`sharedProfile[]` | 两份 markdown：`bots/<id>/MEMORY.md`（私有）、`shared/PROFILE.md`（共享）。通过 `agentsFilesOverride` 或 `before_agent_start` 注入；bot 用 `memory` 工具追加 |
| 配置弹窗 · 技能 | `skills[]` | pi Skills（`SKILL.md` 目录），`skillsOverride` 按 bot 过滤；技能列表来自 `~/.pi/agent/skills` + 我们的 `skills/` |
| 配置弹窗 · 例行任务 | `routines[]` | crew-server 的 cron 调度器；到点用 `pi.sendMessage({customType:'routine'}, {triggerTurn:true})` 触发该 bot |
| 配置弹窗 · 集成（连接、渠道） | `connections[]`、`channels[]` | 连接 = MCP/浏览器/API 凭据状态，由 crew 扩展维护；渠道 = IM 桥接开关（§5） |

### 2.2 消息流（Thread）

| 前端功能 | pi 映射 |
|---|---|
| 用户发消息 → bot 回复，打字中态 | `session.prompt()`；`agent_start` → typing on，`message_end`(assistant) → 一条 bot 消息，`agent_settled` → typing off |
| bot 回复流式 | `message_update.text_delta` 拼接（前端可选择只在 `message_end` 落一条） |
| 每条用户消息上的「回执」(created/updated/closed/reply) | 由 `todo` 工具的调用结果推导：一轮内若发生了 `todo.create/update/close`，把回执挂到触发它的用户消息上 |
| 消息与事项关联 `todoId` | 工具调用参数里带 `todoId`；扩展在 `tool_result` 时发 `crew:todo-changed` 事件 |
| 「看对话」跳转到某条消息 | 消息 id = pi 会话 entry id，前端 `focusMessage(entryId)` |
| @提及某个 bot（群聊内） | `input` 事件解析 `@名字`，路由到对应 bot 的 session（§2.5） |
| 渠道来源标记 `via` | IM 桥接注入时带 `customType:'im-inbound', details:{channel}` |
| 日期分隔、已读/未读、角标 | 纯前端；服务端用 `lastSeen` 记录即可 |

### 2.3 事项（Todo 浮窗）

这是产品核心。**事项由 bot 通过工具静默维护，不由用户操作。**

| 前端功能 | pi 映射 |
|---|---|
| 状态 `open/doing/waiting/blocked/done`、`summary`、`result` | 扩展注册 `todo` 工具：`create / update(status,summary) / close(result) / list`；状态存 `toolResult.details`（可分支安全），并镜像到 `todos.json` 便于服务端跨 bot 查询 |
| 一条用户消息可能 新建 / 更新 / 关闭 事项 | systemPrompt 指南：「每条用户消息先判断对事项的影响，用 todo 工具落地，再回复」；`promptGuidelines` 里写死 |
| 事项详情 · 现在 / 经过 / 你拍过的板 | 经过 = 该 todoId 关联的 assistant 消息 + 动作日志；拍过的板 = `Pending` 记录（§2.4） |
| 可撤销动作 `Action.undoable` + 撤销 | 扩展注册 `act` 工具（执行有副作用的动作，如支付、下单），必须提供 `undo` 描述；服务端保存 `actions.json`；撤销 = 向该 bot `sendUserMessage('撤销动作 <id>')` 或直接调 connector 的 undo |
| 板上「新」脉冲 | 前端基于 `updatedAt` |

### 2.4 拍板（Pending：confirm / clarify / blocked）

| 前端功能 | pi 映射 |
|---|---|
| bot 需要确认/澄清时出卡片，用户点选项 | 扩展注册 `ask_user` 工具（参考 `examples/extensions/question.ts`），内部调用 `ctx.ui.select()`；我们在 `bindExtensions({ uiContext })` 里实现的 `select` 把请求变成 `Pending` 记录 + WebSocket 推送，**Promise 挂起直到用户点选**，再作为工具结果返回给模型 |
| 金额确认卡（`confirm`） | `ask_user` 参数含 `kind:'confirm', amount` |
| 选项卡（`options`，带价格） | `ask_user` 参数含 `options[{label,hint,price}]` |
| 卡住卡（`blocked`，如 12306 登录过期） | 连接失效时扩展主动 `ask_user(kind:'blocked')`；`blocked` 无视通知开关必推 |
| 收件箱（所有待处理拍板） | 服务端聚合所有 bot 未 resolved 的 Pending |
| 拍板记录持久化 | 工具结果 `details` + `appendEntry('pending')` |
| 用户很久不点：超时 | `ctx.ui.select(..., { timeout })` 或我们的 uiContext 自行处理（超时 = 选默认/挂到收件箱） |

**注意**：pi 的 `select()` 是「阻塞当前 turn」的。长时间挂起意味着该 bot 的 agent 循环停在这个工具上。对于异步委托这是**合理的**（bot 等你拍板），但要保证：(a) 不同 bot 各自一个 session，互不阻塞；(b) 同一 bot 收到新消息时用 `steer` 队列，等拍板返回后再处理。长期看可改为 `plugins.md` 里描述的「Session 拥有的延迟交互服务」模式（§7）。

### 2.5 群聊（Matter）

| 前端功能 | pi 映射 |
|---|---|
| 群 = 多 bot 围绕一件事 | **一个 Matter 对应一个「协调 session」**（牵头 bot 的 session）+ 参与 bot 各自 session。方案见下 |
| 群名 / 描述 / 成员增删 / 设为牵头 | `matters.json` |
| 用户在群里说话，@谁谁答；不 @ 则牵头答 | `input` 事件解析 → 路由到目标 bot session 的 `prompt()`；其他成员收到 `sendMessage({customType:'group-transcript', display:false}, {deliverAs:'nextTurn'})` 保持上下文同步（不触发回复） |
| bot 之间接力（订完票 @账单管家 报销） | bot 回复里含 `@其他bot` → 扩展在 `message_end` 检测 → 通过 `eventBus` 把这句以 `sendMessage({customType:'from-bot'}, {triggerTurn:true})` 送到被提及 bot 的 session；带 `depth` 防止无限对话 |
| 群里事项归属 | `todo.create` 参数带 `matterId`；`todos.json` 按 matter 聚合 |

### 2.6 主动性与打扰预算

| 前端功能 | pi 映射 |
|---|---|
| bot 主动说话（哨兵推送、账单填好了） | 例行任务 / 外部 webhook → `sendMessage(..., {triggerTurn:true})`，bot 决定说不说 |
| `interrupt: now / digest / quiet` | crew-server 的 **Notifier**：收到 bot 输出后按策略决定 push（toast）/ 攒到摘要 / 只留角标；`blocked` 永远 push |
| `autonomy: tell / prepare / do` | 写进 systemPrompt 的行为准则 + `act` 工具的 `tool_call` 钩子：`tell` 模式下直接拦截有副作用的工具并转成 `ask_user` |
| 消息通知开关、群通知开关 | Notifier 读取 `bots.json / matters.json` |
| 「攒到晚上」摘要 | Notifier 每天固定时刻聚合 digest 卡片 |

### 2.7 多 IM 部署

| 前端功能 | pi 映射 |
|---|---|
| bot 住在 飞书 / 微信 / Slack / Telegram | 每个渠道一个 **Bridge**（参考 pi-chat）：IM 入站 → 找到 bot → `sendUserMessage(text)`，消息带 `via`；bot 输出 → Bridge 回写 IM |
| 拍板卡片在 IM 里怎么点 | Bridge 把 `Pending` 渲染成 IM 原生按钮/快捷回复；回调 → `resolvePending` |
| 同一 bot 在多处对话，上下文一致 | 单一 session，所有渠道共享；`via` 只是消息属性 |

---

## 3. 架构

```
┌───────────────── bot-crew (React) ─────────────────┐
│  store.ts  ←  services/agent.ts = WsAgentService    │
└───────────────────────────┬────────────────────────┘
                            │ WebSocket (JSON)
┌───────────────────────────┴────────────────────────┐
│  crew-server (Node 22, TypeScript)                  │
│                                                     │
│  CrewStore     bots.json matters.json todos.json    │
│                pendings.json actions.json           │
│  BotManager    每个 bot 一个 pi AgentSession        │
│  Router        thread → session；@提及；群同步       │
│  Notifier      interrupt 预算 / digest / toast      │
│  Scheduler     routines (cron)                      │
│  Bridges       feishu / wechat / slack / telegram   │
│  AvatarService pi-ai ImagesModels (OpenRouter)      │
│                                                     │
│  pi extensions (每个 session 都装)                    │
│   ├ crew-identity   before_agent_start 注入角色/记忆 │
│   ├ crew-todo       todo 工具 + 状态重放             │
│   ├ crew-ask        ask_user 工具 → Pending          │
│   ├ crew-act        act 工具 + autonomy 门控 + undo  │
│   ├ crew-memory     memory 工具 (私有/共享)          │
│   ├ crew-mention    message_end 解析 @bot 接力       │
│   └ crew-connections 连接状态、失效→blocked          │
└─────────────────────────────────────────────────────┘
                            │
                 @earendil-works/pi-coding-agent
                 (AgentSession / SessionManager / Skills)
```

### 3.1 为什么是 SDK 进程内，而不是 `pi --mode rpc` 子进程

- 我们要**自定义 `uiContext`**，把 `ctx.ui.select` 变成 Pending 卡片；SDK 的 `bindExtensions({ uiContext })` 直接支持。RPC 模式也能做（`extension_ui_request`），但要多一层进程管理。
- 多个 bot 需要共享 `eventBus`（bot 之间传话），进程内最简单。
- 需要隔离时（不可信技能、跑 bash），再把单个 bot 换成 RPC 子进程或 Gondolin 沙箱，接口不变。

### 3.2 目录与存储

```
~/.crew/
├── bots.json / matters.json / todos.json / pendings.json / actions.json
├── shared/PROFILE.md              # 共享记忆（前端「记忆」页可编辑）
├── bots/<botId>/
│   ├── MEMORY.md                  # 该 bot 对你的认知
│   ├── sessions/*.jsonl           # pi SessionManager 的 sessionDir
│   └── avatar.png
└── skills/<skill>/SKILL.md        # 自建技能，pi 标准格式
```

每个 bot：`SessionManager.create(cwd=~/.crew/bots/<id>, sessionDir=.../sessions)`；长期只用一个 session 文件，靠 pi 的自动 compaction 控制上下文；需要「重开」时 `runtime.newSession()`。

---

## 4. 扩展设计（核心代码形态）

### 4.1 crew-identity：角色与记忆注入

```ts
export const crewIdentity = (bot: () => BotMeta, mem: MemoryStore): InlineExtension => ({
  name: 'crew-identity',
  factory: (pi) => {
    pi.on('before_agent_start', async (ev) => {
      const b = bot();
      const prompt = [
        ev.systemPrompt,
        `# 你是「${b.name}」`, b.role,
        `## 行为准则`, AUTONOMY_RULES[b.autonomy], INTERRUPT_RULES[b.interrupt],
        `## 你对用户的认知`, await mem.read(b.id),
        `## 关于用户的共享事实`, await mem.readShared(),
        `## 事项纪律`,
        '- 每条用户消息先判断：新建 / 更新 / 关闭 哪个事项，用 todo 工具落地，再简短回复。',
        '- 只有需要用户拍板或卡住时才用 ask_user；其余情况静默推进。',
      ].join('\n\n');
      return { systemPrompt: prompt };
    });
  },
});
```

### 4.2 crew-todo：事项工具

```ts
const TodoParams = Type.Object({
  action: StringEnum(['create','update','close','list'] as const),
  todoId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(['open','doing','waiting','blocked','done'] as const)),
  summary: Type.Optional(Type.String({ description: '一句话进展' })),
  result: Type.Optional(Type.String({ description: '关闭时的结果' })),
  matterId: Type.Optional(Type.String()),
});

pi.registerTool({
  name: 'todo', label: '事项', parameters: TodoParams,
  promptSnippet: '维护你的事项列表（create/update/close/list）',
  promptGuidelines: ['用户每条消息都可能改变事项，先用 todo 落地再回复；不要向用户复述 todo 的内部操作。'],
  async execute(_id, p, _sig, _upd, ctx) {
    const snapshot = store.applyTodo(botId, p);          // 写 todos.json
    events.emit('crew:todo', { botId, action: p.action, todo: snapshot.changed });
    return { content: [{ type: 'text', text: `ok ${snapshot.changed?.id ?? ''}` }],
             details: { todos: snapshot.forBot } };      // 分支安全
  },
});
pi.on('session_start', (_e, ctx) => store.rebuildTodosFromBranch(botId, ctx.sessionManager.getBranch()));
```

`Router` 监听 `crew:todo`，把它折叠成该轮用户消息的 `receipt`（created/updated/closed），推给前端。

### 4.3 crew-ask：拍板

```ts
pi.registerTool({
  name: 'ask_user', label: '请用户拍板', executionMode: 'sequential',
  parameters: Type.Object({
    kind: StringEnum(['confirm','clarify','blocked'] as const),
    title: Type.String(), detail: Type.Optional(Type.String()),
    amount: Type.Optional(Type.Number()),
    todoId: Type.Optional(Type.String()),
    options: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), hint: Type.Optional(Type.String()), primary: Type.Optional(Type.Boolean()) })),
  }),
  async execute(callId, p, signal, _upd, ctx) {
    // ctx.ui.select 由 crew-server 的 uiContext 实现：创建 Pending、推送前端/IM、挂起等待
    const choice = await ctx.ui.select(JSON.stringify({ ...p, callId }), p.options.map(o => o.id), { signal });
    return { content: [{ type: 'text', text: choice ? `用户选择：${choice}` : '用户暂未回应' }],
             details: { pending: { ...p, choice, at: Date.now() } } };
  },
});
```

crew-server 侧的 `uiContext.select(title, options, opts)`：解析 `title` 里的 JSON（或改用 `pi.events` 传结构化数据，`select` 只做等待），写 `pendings.json`，`ws.broadcast({type:'pending', ...})`，返回一个 Promise，前端 `onPendingChoice(pendingId, optionId)` 时 resolve。`notify()` → toast；`setStatus()` → bot 的 `status` 小字。

### 4.4 crew-act：有副作用的动作 + 自主度门控

```ts
pi.on('tool_call', async (ev, ctx) => {
  if (!SIDE_EFFECT_TOOLS.has(ev.toolName)) return;
  const b = bot();
  if (b.autonomy === 'do') return;                              // 直接办
  const ok = await ctx.ui.confirm(...);                         // prepare: 备好等你点
  if (!ok) return { block: true, reason: '用户未确认' };
});
// act 工具执行后记录 actions.json，携带 undo 描述；撤销 = connector.undo(actionId)
```

### 4.5 crew-mention：bot 之间接力

```ts
pi.on('message_end', (ev) => {
  if (ev.message.role !== 'assistant') return;
  for (const target of parseMentions(textOf(ev.message), allBots())) {
    events.emit('crew:handoff', { from: botId, to: target.id, text, matterId, depth: depth + 1 });
  }
});
// Router 收到 crew:handoff 且 depth < 3 → targetSession.sendMessage({customType:'from-bot', content:`@${from} 说：${text}`, display:true}, {triggerTurn:true})
```

### 4.6 crew-memory / crew-connections

- `memory` 工具：`remember(text, scope:'private'|'shared')` 追加到 MEMORY.md / PROFILE.md；前端「记忆」页直接读写这两个文件。
- `connections`：扩展持有各连接的健康检查；失效时 `ask_user(kind:'blocked')`，用户处理完后 `crew:connection-restored` 事件解锁。

---

## 5. 服务端 API（WebSocket，替换 MockAgentService）

前端 `AgentService` 接口不变，新增 `WsAgentService implements AgentService`：

```
client → server
  { type:'user_message', threadId, text, via? }
  { type:'draft_message', text }                        // 新建 bot
  { type:'pending_choice', pendingId, optionId }
  { type:'patch_bot' | 'patch_matter', id, patch }
  { type:'create_matter', title, memberIds, leadId }
  { type:'undo_action', actionId }
  { type:'avatar', botId, op:'upload'|'regen'|'reset', dataUrl? }
  { type:'set_shared_profile', lines }

server → client（都是对 store 的增量 patch）
  { type:'snapshot', state }                            // 连接时全量
  { type:'message', message }                           // 含 receipt / card / todoId / via
  { type:'typing', threadId, botId, on }
  { type:'todo', todo }
  { type:'pending', pending } / { type:'pending_resolved', id, choice }
  { type:'action', action }
  { type:'bot', bot } / { type:'matter', matter }
  { type:'toast', toast }                               // Notifier 决定是否发
```

事件到 store 的映射就是现在 `MockAgentService` 里调用的那些 mutation（`addMessage / patchTodo / addPending / resolvePending / addAction / patchBot / pushToast / setTyping`），一一对应，前端组件无需改动。

---

## 6. 实施步骤

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 跑通单 bot** | `crew-server` 骨架；`createAgentSession` 一个 bot；`crew-identity` + `crew-todo`；WS 推 message/typing/todo；前端 `WsAgentService` | 在真模型上对话，事项随消息变化 |
| **P1 拍板** | 自定义 `uiContext`；`crew-ask`；Pending 持久化与收件箱；超时策略 | confirm / options / blocked 三种卡片走真流程 |
| **P2 多 bot + 新建 bot** | BotManager 多 session；`inferBot` 生成；头像生成服务；bots.json 配置读写；记忆文件 | 前端所有 Bot 身份/配置项可用 |
| **P3 群聊** | matters.json；Router @提及路由；`group-transcript` 同步；`crew-mention` 接力 | 群里 @ 与 bot 互相接力 |
| **P4 主动性** | Scheduler（routines）；Notifier（interrupt 预算、digest）；`crew-act` 自主度门控 + 撤销 | 主动推送、攒摘要、直接办/备好等你点 |
| **P5 IM** | Bridge 抽象 + 第一个渠道（飞书或 Telegram，参考 pi-chat）；卡片→IM 按钮 | bot 住到 IM 里 |
| **P6 打包** | 扩展 + 技能打成 pi package；`settings.json` 一行安装；隔离选项（RPC 子进程 / Gondolin） | 可分发 |

P0–P1 约一周可见效果；P2–P4 是产品主体。

---

## 6.1 实现状态（2026-09-06）

已按本方案实现于 `crew-server/`，前端接入在 `bot-crew/src/services/ws-agent.ts`：

| 阶段 | 状态 | 备注 |
|---|---|---|
| P0 单 bot | 完成 | `BotManager` + `crew-identity` + `crew-todo`，WS 推 message/typing/todo/receipt |
| P1 拍板 | 完成 | `PendingBroker` + `ask_user`；自定义 `ExtensionUIContext`；超时 → waiting，迟到的选择以用户消息续上 |
| P2 多 bot / 新建 bot | 完成 | 首句 → `inferBot`（LLM JSON，回退模板）；头像走 pi-ai `ImagesModels`，无 key 回退程序化 |
| P3 群聊 | 完成 | @提及路由、`group-transcript` 静默同步、`crew:handoff` 接力（depth ≤ 3） |
| P4 主动性 | 完成 | `Scheduler`（每天/每周/工作日/每 N 分钟）、`Notifier`（now/digest/quiet，blocked 必打断）、`act` 自主度门控 + 撤销 |
| P5 IM | 部分 | `Bridge` 接口 + Telegram 长轮询实现（未用真 token 验证）；飞书/微信/Slack 待接 |
| P6 打包 | 未做 | 现为进程内 SDK；pi package 化与沙箱隔离后续 |

无模型密钥时 `fake-brain.ts` 用 pi-ai 的 faux provider 脚本化整条链路，用于开发与演示。真实连接器（12306、报销系统等）尚未接入：`act` 工具目前只记录动作并留下可撤销日志。

## 7. 已知风险与取舍

1. **`ctx.ui.select` 阻塞 turn。** 用户几小时不拍板，该 bot 的 agent 循环一直挂在工具上。缓解：每 bot 独立 session；新消息用 `steer` 排队；给 select 设超时，超时后工具返回「用户未回应」、事项标 `waiting`，用户之后点选项时用 `sendUserMessage('关于 X 我选 Y')` 续上。长期方案：pi `plugins.md` 里的「Session-owned deferred interactions」（问题作为 keyed service 实例，所有 presentation 都能观察，worker 重启可恢复），但它依赖仍标注 experimental 的 chord/pi-server 栈。
2. **pi-server / pi-client / chord 尚为实验性**，版本间无兼容承诺。方案刻意只依赖 `pi-coding-agent` 的 SDK 与 Extension API（稳定、有文档、示例 70+）。等 `pi client` 体系稳定后，crew-server 可以改成 pi-server 的一个 application host，前端直接走 pi-client。
3. **bot 之间对话可能失控。** `crew:handoff` 带 depth 上限，且只有 @明确提及才触发。
4. **上下文膨胀。** 群聊同步的 `group-transcript` 用 `display:false` + `nextTurn`，并依赖 pi 的自动 compaction；也可在 `transformContext` 里只保留最近 N 条群消息。
5. **权限与沙箱。** pi 默认无权限系统；有副作用的工具靠 `tool_call` 钩子 + autonomy 门控；运行不可信技能时给该 bot 用 RPC 子进程或 Gondolin 微 VM。
6. **头像生图**走 pi-ai 的 `generateImages()`，是一次性调用，不经过 agent 工具循环。当前内置只有 OpenRouter 一个图像 provider（如 `google/gemini-2.5-flash-image`），要接别家用 `createImagesProvider()` 自定义。时延在「新建 bot」流程里异步处理：先用 procedural 占位，生成完再替换；`stopReason:'error'` 时保留占位。

---

## 8. 参考位置（pi-src 内）

- SDK：`packages/coding-agent/docs/sdk.md`，示例 `examples/sdk/01–13`
- Extension API：`docs/extensions.md`（3000 行，含全部事件与 `ctx.ui`）
- 拍板参考：`examples/extensions/question.ts`、`timed-confirm.ts`、`permission-gate.ts`
- 事项状态参考：`examples/extensions/todo.ts`（`details` 存状态 + `session_start` 重放）
- 子 agent：`examples/extensions/subagent/`（spawn `pi --mode json -p`）
- 注入消息：`examples/extensions/send-user-message.ts`、`event-bus.ts`
- RPC 协议（备选）：`docs/rpc.md`，客户端 `src/modes/rpc/rpc-client.ts`
- 自定义 uiContext 参考实现：`src/modes/rpc/rpc-mode.ts`（`createExtensionUIContext`）
- 会话格式：`docs/session-format.md`
- 技能：`docs/skills.md`；打包：`docs/packages.md`
- 延迟交互的长期形态：`packages/agent/docs/plugins.md` §「Session-owned deferred interactions」
- IM 桥接参考：https://github.com/earendil-works/pi-chat
