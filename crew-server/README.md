# EverBot · 服务端（crew-server，基于 pi）

> 产品名 EverBot。目录仍叫 `crew-server`，数据目录仍是 `~/.crew`，环境变量仍是 `CREW_*`；这些内部名字在建独立开源仓库时统一迁移。
> 本地一键启动：仓库根目录 `bash everbot.sh`。

每个 bot 是一个 [pi](https://github.com/earendil-works/pi) `AgentSession`；事项、拍板、动作、记忆都是 pi Extension；前端通过 WebSocket 连进来。设计文档见 [../bot-crew/docs/pi-integration-plan.md](../bot-crew/docs/pi-integration-plan.md)。

## 跑起来

```bash
npm install --ignore-scripts
npm run dev            # tsx watch，默认 ws://localhost:5200/ws
```

前端用 `npm run dev:live`（在 bot-crew 里）即连到这个地址。

没有模型密钥时自动进入 **fake 模式**：一个脚本化的假模型把「消息 → 事项 → 拍板 → 执行 → 关闭」整条链路跑通，方便开发和演示。

## 配置

模型和它们的钥匙在 App 里配：**设置 › 模型**，一行一件事（对话 / 轻模型 / 看图 / 操作屏幕 / 画图 / 联网搜索 / 向量 / 重排），每行是一个完整的答案：哪一家、谁的钥匙、哪个模型。provider 目录、每家要什么凭据、每个模型的价格和上下文，都来自 pi 的 `ModelRuntime`，不是我们维护的清单。改完不用重启：写回 config.json → 重新挑模型 → 各 bot 下一轮生效（`models.ts`、`config.ts` 的 getter）。

画图和联网搜索只能选 OpenRouter：pi 的图像 api 只有 `openrouter-images`，搜索是 OpenRouter 自己的 `web` 插件。向量和重排是我们自己发的 HTTP，用哪家都行——provider 的 baseUrl 从 pi 读，key 从这一行自己的那把读（`models.ts` 的 `endpointOf`）。

`$CREW_HOME/config.json`（默认 `~/.crew/config.json`，600 权限）：

```json
{
  "model": "anthropic/claude-sonnet-4-6",
  "lightModel": "anthropic/claude-haiku-4-5",
  "imageModel": "openrouter/google/gemini-2.5-flash-image",
  "visionModel": "openrouter/google/gemini-2.5-flash",
  "guiModel": "openrouter/openai/gpt-6-astra",
  "embeddingModel": "openrouter/baai/bge-m3",
  "rerankModel": "openrouter/cohere/rerank-v3.5",
  "slotKeys": { "model": "...", "visionModel": "..." },
  "composioApiKey": "...",
  "modelMeta": { "openrouter/deepseek/deepseek-v4-flash": { "contextWindow": 1048576, "maxTokens": 32000, "vision": false, "costIn": 0.084, "costOut": 0.168 } },
  "port": 5200,
  "publicUrl": "http://localhost:5200",
  "askTimeoutMs": 1800000,
  "digestAt": "20:30",
  "telegramToken": "...",
  "feishuAppId": "cli_...", "feishuAppSecret": "...",
  "slackBotToken": "xoxb-...", "slackAppToken": "xapp-...",
  "wecomCorpId": "...", "wecomAgentId": "1000002", "wecomSecret": "...", "wecomToken": "...", "wecomAesKey": "..."
}
```

`slotKeys` **按行存**：一行一把钥匙。某一行没有自己的，就借同一家里第一把填了的（`keyOf`），所以一把 OpenRouter key 只用填一次，而需要单独账号的那一行仍然能有自己的。pi 每家 provider 只放得下一把凭据，所以有自己钥匙的行会落到一个克隆出来的 provider 上（`openrouter#visionModel`，同样的 baseUrl 和模型表、自己的 key，见 `bots.ts` 的 `providerForSlot`）；记账时会把 `#` 后面切掉，账上仍然是 openrouter。老的 `keys`（按环境变量名）和 `providerKeys`（按 provider）仍然读，作为谁都没填时的兜底。`modelMeta` 按 `provider/model-id` 记 pi 目录里还没有的新模型的上下文和价格——页面上填了模型 id 之后会就地问；老的全局 `modelInfo` 仍然作为兜底。`composioApiKey` 和 `googleClientId/Secret` 是产品级的（连接器走 Composio 托管 OAuth），不在页面上。当前产品配置：LLM 走 OpenRouter 的 `deepseek/deepseek-v4-flash`，头像走 `google/gemini-3.1-flash-image`。环境变量 `CREW_HOME / CREW_PORT / CREW_MODEL / CREW_FAKE=1` 可覆盖。

需要的模型：

| 用途 | 类型 | 说明 |
|---|---|---|
| bot 对话与工具调用 | LLM（支持 tool calling） | `model`，每个 bot 每轮用 |
| 生成 bot 身份、摘要 | 轻量 LLM | `lightModel`，可与主模型相同 |
| 联网搜索 | OpenRouter web 插件 | `searchModel`（缺省同 `lightModel`），每个 bot 都有 `web_search` / `fetch_url` |
| 头像 | 图像生成 | `imageModel`，走 pi-ai 的 `ImagesModels`（目前内置 OpenRouter） |
| 看图 | 能读图的 LLM | `visionModel`，`see` 工具；主模型自己能看图时可留空 |
| 操作屏幕 | computer-use 模型 | `guiModel`，`operate` 工具；缺省退到 `visionModel` |
| 向量检索 | embedding | `embeddingModel`，技能库和记忆引擎共用；任何 OpenAI 兼容端点 |
| 重排 | rerank | `rerankModel`，记忆引擎用；`"off"` 关掉 |

记忆引擎（everos）是独立进程，四条腿（LLM / embedding / 多模态 / rerank）各自解析自己的 provider，都经本机记账代理走（`meter-proxy.ts`，路径首段是 provider id），所以换了 provider 也还在同一本账里。

## 目录

```
src/
  index.ts        装配：store → bots → router → notifier → scheduler → ws → bridges
  config.ts       CREW_HOME、密钥、模型选择
  store.ts        产品状态（crew.json）：bots/matters/todos/pendings/actions/messages
  memory.ts       bots/<id>/MEMORY.md + shared/PROFILE.md
  bots.ts         BotManager：每 bot 一个 pi AgentSession，串行处理、事件→消息
  router.ts       线程路由、@提及、群同步、bot 间接力、迟到的拍板
  broker.ts       PendingBroker：ask → Pending + 卡片消息 → 等用户点选；headless ExtensionUIContext
  notifier.ts     打扰预算：now / digest / quiet，blocked 永远打断
  scheduler.ts    例行任务（每天 HH:MM / 每周X / 工作日 / 每 N 分钟）
  avatar.ts       pi-ai 生图，失败回退程序化头像
  infer-bot.ts    第一句话 → bot 身份（LLM JSON 或模板）
  library.ts      技能库：加载 library/ 目录、检索、建 bot 时挑选并挂载
  fake-brain.ts   无密钥时的脚本化模型（pi-ai faux provider）
  ws.ts           HTTP(/health, /avatars) + WebSocket(/ws)
  extensions/     identity / todo / ask_user / act / remember / build / library / connect / web（pi 扩展）
library/          精选技能库（按分类的 SKILL.md，见下）
  bridges/        IM 桥：telegram（长轮询），接口见 types.ts
```

数据目录（`CREW_HOME`）：

```
crew.json               产品状态
bots/<id>/sessions/     pi 会话 JSONL（LLM 上下文）
bots/<id>/MEMORY.md     该 bot 对用户的认知
shared/PROFILE.md       共享事实
avatars/                生成的头像
pi-agent/skills/        给 bot 用的 pi 技能（SKILL.md），按 Bot.skills 名字过滤加载
library/<分类>/<slug>/  技能库镜像（启动时从 crew-server/library 同步；可自行加目录）
```

## 技能库

`crew-server/library/manifest.json` 列出精选的社区技能（slug、分类、上游仓库与路径、检索用的标签）。`npm run library:sync` 按清单从 GitHub 把每个技能的整个目录（SKILL.md 及其 scripts / references）原文拉到 `crew-server/library/<分类>/<slug>/`，不做任何改写；每个目录附 `.source.json`（仓库、路径、commit、许可证）和上游 LICENSE。来源：obra/superpowers、anthropics/skills、mattpocock/skills、trailofbits/skills、ComposioHQ/awesome-claude-skills、NousResearch/hermes-agent、athola/claude-night-market 等。分类：dev 开发、docs 文档办公、writing 写作沟通、research 研究数据、productivity 效率生活、business 商业营销、design 设计创意、meta 方法与元技能。

- 建 bot 时：身份推断完成后，轻模型对着目录挑 0–5 份和职责直接相关的手册挂上，并去掉被覆盖的自写能力短语（无模型时按标签匹配）。
- 运行中：bot 有 `library` 工具（search / mount / list）。遇到没手册的一类任务先查库、再 mount，没有才用 `build` 自己写。
- 用户侧：bot 身份 › 技能 › 「从技能库添加」按分类浏览、搜索、挂载。
- 挂载 = 把整个技能目录复制到 `pi-agent/skills/<slug>/` 成为 bot 自己的技能（frontmatter 记 library / category / source），之后随 `build` 一起进化；库本身不变。
- 启动时把 `crew-server/library` 镜像到 `~/.crew/library`（`.bundled.json` 记录哪些是镜像来的，用户自己放进去的目录不会被动）。加自己的手册：`~/.crew/library/<分类>/<slug>/SKILL.md`，标准 frontmatter（name / description）即可。
- 许可证：sync 结束会列出许可证不明或专有的条目。anthropics 的 docx / xlsx / pptx / pdf 是 Anthropic 专有许可（按你与 Anthropic 的服务条款使用）；ComposioHQ 列表里自研的几份没有 LICENSE 文件。对外分发本产品前请复核这两组。

## 协议（WebSocket JSON）

客户端 → 服务端：`user_message` · `draft_message` · `pending_choice` · `patch_bot` · `patch_matter` · `create_matter` · `set_shared_profile` · `undo_action` · `avatar`

服务端 → 客户端：`snapshot`（连上时全量）· `message` · `message_patch` · `typing` · `todo` · `pending` · `action` · `bot` · `matter` · `shared_profile` · `toast` · `bot_created`

类型定义在 `src/types.ts` 底部；前端对应 `bot-crew/src/services/ws-agent.ts`。

## IM 渠道

| 渠道 | 方式 | 配置 | 拍板卡片 |
|---|---|---|---|
| Telegram | 长轮询 | `telegramToken` | inline 按钮 |

## 一键连接（connect 工具）

bot 用 `connect` 发一张授权卡，用户点开登录、同意，回调到 `publicUrl/oauth/google/callback`，令牌落在 `$CREW_HOME/connections/`（0600），连接器的工具直接挂到 bot 上。内置：`gmail`（搜、读、发邮件）、`google-calendar`（看、建、删日程）。

两种后端，配置了哪个用哪个（Composio 优先）：

- **Composio**（推荐，零登记）：config.json 填 `composioApiKey`。登录走 Composio 托管的 Google 应用，令牌由 Composio 保管，工具调用经它转发；回调到 `publicUrl/oauth/composio/callback`。
- **自有 Google 应用**：需要产品级的 Google OAuth 客户端，放在 config.json：`googleClientId`、`googleClientSecret`；Google Cloud 里启用 Gmail API 与 Calendar API，OAuth 客户端类型 Web，回调地址填 `<publicUrl>/oauth/google/callback`，测试阶段把用户邮箱加进 Test users。Gmail 读权限属于受限范围，对外发布前需通过 Google 审核。

| 飞书 | 长连接（WebSocket，无需公网） | `feishuAppId` / `feishuAppSecret`，开放平台订阅 `im.message.receive_v1` | 交互卡片按钮 |
| Slack | Socket Mode（无需公网） | `slackBotToken` / `slackAppToken` | Block Kit 按钮 |
| 企业微信 | 回调 URL `<publicUrl>/wecom/callback` | `wecomCorpId` / `wecomAgentId` / `wecomSecret` / `wecomToken` / `wecomAesKey` | 编号列表，回复数字 |

绑定方式统一：在对应 IM 里给机器人发 `/bind <botId>`。之后消息以 `via: <channel>` 进入该 bot 的线程，回复和卡片回到同一个会话。详细步骤见每个 bot 自带的「IM 渠道接入」技能。

## 运行地：bot 们住在哪台机器上

一个用户的全部 bot 状态就是 `CREW_HOME`（默认 `~/.crew`）这一个目录。持有它的服务进程就是 bot 们运行的地方；App 只是窗口。

- **本机（默认）**：`npm run serve`。没有配 `authToken` 时服务只监听 127.0.0.1，本机客户端免鉴权。
- **自己的服务器**：在一台 24 小时开着的 Linux 机器上 `bash deploy/install.sh`（需要 Docker）。脚本生成访问令牌、构建镜像、启动容器，最后打印一个**连接码**；把它贴到 App 的「bot 们在哪台机器上干活」页面，App 会把本机的整个家搬过去并切换连接。配了域名（`DOMAIN=…`）会由 Caddy 自动上 HTTPS。
- **搬回来**：本机服务运行时，在同一页面点「搬回这台电脑」。

服务端相关：
- `config.json` 的 `authToken` 一旦设置，服务监听所有网卡并要求 `Authorization: Bearer` 或 `?token=`；`/health`、OAuth 回调、企微回调除外。
- `lease.json` 是运行租约（心跳 15 秒），`moved.json` 表示这个家已搬到别处，此时服务只做路牌，不跑 bot。
- 搬家走 `GET /migrate/export?to=` 与 `POST /migrate/import`，打包时去掉本机的 port / bind / authToken，模型密钥和 IM 凭据随 bot 一起走。导入成功后进程以退出码 75 结束，`scripts/run.sh` 负责重启；被替换的旧状态留在 `.replaced-<时间戳>/` 里以备找回。
- 文件引用（`FileRef`）只存相对于 bot 目录的路径和 `/files/...` 相对地址，换机器后仍然有效。

## 托管云端（控制面）

`npm run cloud` 启动控制面（`src/cloud/`）：一个用户一台 crew-server，全部挂在控制面这一个地址后面（`/t/<id>/…` 反向代理，含 WebSocket），停着的机器有请求时自动拉起，每晚备份保留 7 份。

- 驱动：`CLOUD_DRIVER=docker`（生产，一容器一卷）或 `process`（开发，一进程一目录）。
- 环境：`CLOUD_PORT`（5300）、`CLOUD_PUBLIC_URL`、`CLOUD_DATA`、`CLOUD_IMAGE`、`CLOUD_ADMIN_TOKEN`。
- App 侧配 `VITE_CREW_CLOUD=<控制面地址>` 后，「bot 们在哪台机器上干活」页面出现「云端常驻」一键：匿名账号 → 开机 → 走同一套搬家。
- 服务器上：`bash deploy/cloud-install.sh`（需要 Docker 和一个域名），构建 crew-server 镜像，用 Caddy 上 HTTPS。

还没有的：账号体系（现在是匿名账号，令牌存在浏览器里）、闲时休眠、计费、告警。
