import type { SkillStore } from './skills.ts';

/**
 * Skills every bot carries: how to get the user through the three kinds of integration.
 * Written once into the skill store; the user can edit them afterwards like any skill.
 */
export const BUILTIN_SKILLS: { name: string; description: string; body: string }[] = [
  {
    name: 'IM 渠道接入',
    description: '用户想让 bot 住进 Telegram / 飞书 / 微信 / Slack 时，一步步带他接好渠道并绑定到 bot。',
    body: `## 目的
把某个 bot 接进用户常用的 IM。接好后，用户在 IM 里说的话进入同一个 bot、同一份对话和事项；bot 的回复和拍板卡片回到 IM。

## 何时使用
用户说「我想在微信/飞书/Telegram 里用你」「把你接到群里」「怎么在飞书里找到你」。

## 模型：一个 bot 就是 IM 里的一个机器人
每个 bot 在飞书 / Telegram / Slack / 企业微信里都是**独立的机器人**，有自己的名字和头像、自己的凭据。用户私聊那个机器人就是在和这个 bot 说话；把几个机器人拉进同一个群，它们就在群里一起干活（@谁谁回，群在这里对应一个「群聊」）。没有「先接渠道再绑会话」这回事，也没有 /bind 命令。

## 流程（只有三步，不要多说）
1. 用 configure(target=bot, field=integrations, action=add, value="飞书") 接入。系统会往对话里发一张凭据卡，卡上写着在那个平台上给你建机器人的步骤和要填的项。你只说一句「按卡上的步骤建一个机器人，凭据填在卡上」。
2. 用户填完，系统自动接上并通知你（成功会告诉你那边的机器人名字；失败会给原因）。成功后一句话告诉用户：在那个 IM 里找到这个机器人私聊就是你；想让你和别的 bot 一起干活，建个群把几个机器人都拉进去。
3. 失败就把原因说成人话，让他核对后重填：request_credentials，integration 填平台名（如「飞书」），fields 用卡上同样的 key。
凭据永远不进对话：不要问用户要 token / Secret，不要让他改配置文件，也不要自己去改配置。

## 各平台要点（卡上都有，这里只是你回答追问时用）
- Telegram：@BotFather 发 /newbot 拿 token，一分钟搞定，先推荐它。拉进群后默认只看得到 @它 的消息和对它的回复，正好。
- 飞书：开放平台 → 企业自建应用 → 添加机器人能力 → 权限（im:message、im:message:send_as_bot、im:chat:readonly）→ 事件订阅选长连接，加「接收消息」「机器人进群」「机器人被移出群」→ 复制 App ID / App Secret → 创建版本并发布（企业管理员审核）。不需要公网地址。
- Slack：api.slack.com/apps 建应用 → Bot Token Scopes（chat:write、im:history、channels:history、groups:history、app_mentions:read、channels:read、groups:read、users:read）→ Socket Mode 开启拿 xapp- token → 订阅 message.im、message.channels、message.groups、app_mention、member_joined_channel、member_left_channel → 安装到工作区拿 xoxb- token。不需要公网地址。
- 企业微信：自建应用，五项凭据，回调 URL 要指到本产品的公网地址（卡上写着完整地址；没有公网就用 ngrok / cpolar 临时穿透），接好后回企业微信点「保存」验证。企业微信的应用进不了群，只能私聊。
- 个人微信：没有官方接口，只有第三方协议，有封号风险，本产品不接。

## 收尾
- 用 configure(target=bot, action=get) 能看到「IM」一栏：哪个平台接了、那边叫什么。
- 提醒用户：在哪个 IM 都是同一个 bot，对话和事项只有一份；拍板卡片在 IM 里是按钮（企业微信里是编号，回数字）。
- 如果哪一步用户卡住，让他截图或复述看到的界面，再给下一步。`,
  },
  {
    name: 'MCP 连接',
    description: '用户想让 bot 连上邮箱、日历、Notion、GitHub、文件等外部服务时怎么接：能一键接的发授权卡，其余走 MCP 手动接入。',
    body: `## 目的
把外部服务接到用户身上，让它的能力变成你的工具。用户不需要懂 OAuth、IMAP、API、token，也不需要把任何凭据贴进对话。

## 先看能不能一键接（首选）
用 connect 工具一步到位：你调用，对话里出现一张授权卡，用户点一下、在浏览器登录并同意，回来就接好了，系统会通知你继续。几百个主流平台都支持，service 填平台的英文 slug：
- 邮件 / 日历：gmail、googlecalendar、outlook
- 文档 / 笔记 / 表格：notion、googledrive、googledocs、googlesheets、dropbox、airtable
- 沟通：slack、lark（飞书）、discord
- 开发 / 项目：github、linear、jira、trello、asana
- 其他：hubspot、twitter、youtube……拿不准就试一下 slug，connect 会告诉你认不认识
用户提到这些服务而没接时，直接 connect，不要先问「你用哪个邮箱」「走什么方式」。只有 connect 明确说不认识这个平台，再走下面的手动方式。

## 原则：端到端
凡是要用户去别处做一件事，给他能点的链接和到那一页之后的两三步，不要只说「去设置里开一下」。授权走 connect 卡；凭据走 request_credentials 卡（带 help 链接）；接好了系统会通知，用户什么都不用回来汇报。

## 三步走
1. 用户提需求（「整理邮件」「把飞书文档里的会议纪要汇总」）。
2. 你判断要接哪个平台，先 connect 试一键接入：认识就出卡，用户点一下登录即接好。
3. connect 说不认识，才手动接。顺序是「先搭桥，再要凭据」，不要反过来：
   a. 先干活：有现成 MCP 服务器就用（下面有清单，没有就搜「<平台> MCP server」）；确实没有、而你有「外部 agent」，立刻用 delegate_agent 让它照该平台的开放接口写一个最小的 stdio MCP 服务器，只做用户这次要的一两个接口（例：QQ 邮箱 = IMAP 收 + SMTP 发），凭据一律从环境变量读，写到你的工作区里。
   b. 用 configure(target=integration, action=add, value={"name":"…","command":"python3 /路径/server.py"}) 建连接。此时凭据还没有，状态是 error，正常。
   c. 用 request_credentials 发一张凭据卡：fields 的 key 就是桥读的环境变量名，label 用人话，hint 写去哪拿（例：QQ 邮箱 → 设置 › 账户 › 开启 IMAP/SMTP 服务 → 16 位授权码）。用户填在卡上，值直接进连接，不经过对话。
   d. 系统重连后通知你：成功就直接开始办事；失败就判断是凭据不对还是桥有 bug，分别重发凭据卡或让 agent 修。
   全程不要让用户把密码、授权码、token 打在对话里；也不要先问一堆再动手，用户只该看到「我去搭一下」→ 一张凭据卡 → 「接好了」。没有外部 agent 时，如实说需要在「集成 › 外部 agent」里开启 Claude Code、Codex、Hermes、OpenCode 或 OpenClaw。
connect 返回「还没开通」时，如实告诉用户这个产品暂时接不了它，不要引导他去生成 App 密码或 token。

## 手动方式：MCP（第 3 步）
MCP（Model Context Protocol）是把外部系统的能力包装成「工具」的标准。连上一个 MCP 服务器，它的工具就直接出现在你的工具列表里。
- stdio：本地启动一个进程（大多是 npx 一行命令）。适合文件系统、本地数据库、需要本机登录态的东西。
- http：一个远程地址（以 https:// 开头，通常以 /mcp 结尾）。适合 Notion、Linear、GitHub 等官方托管的 MCP，首次调用一般会走它们自己的 OAuth。

流程：
1. 问清用户要连什么、想让你用它做什么，判断该用哪个 MCP 服务器。
2. 需要凭据的，告诉用户去对应平台申请；凭据不要贴在对话里，stdio 类的放在启动命令的环境变量里，由用户在「集成」页填写。
3. 用 configure(target=integration, action=add, value={"name":"…","command":"…"}) 或 value={"name":"…","url":"…"} 创建连接，系统自动连接并列出工具数。
4. 用 configure(target=integration, action=get) 看状态：ok 且有工具数即成功；error 时把 note 里的报错原样告诉用户。
5. 用 configure(target=bot, field=integrations, action=add, value="连接名") 授权给需要的 bot（可以是你自己），工具名以连接名开头。
6. 让用户说一句要用到它的话，实际跑一次验证。

常用 MCP 服务器：
- 本地文件：npx -y @modelcontextprotocol/server-filesystem <允许访问的目录>
- GitHub：npx -y @modelcontextprotocol/server-github（需要环境变量 GITHUB_PERSONAL_ACCESS_TOKEN）
- Notion：官方托管 https://mcp.notion.com/mcp（http 方式）
- Linear：https://mcp.linear.app/mcp
- Slack 读写：npx -y @modelcontextprotocol/server-slack（需要 SLACK_BOT_TOKEN、SLACK_TEAM_ID）
- 浏览器自动化：npx -y @playwright/mcp@latest
- Postgres：npx -y @modelcontextprotocol/server-postgres <连接串>
- 画布 / 白板类（Excalidraw、tldraw）：搜「<产品名> mcp server」，一般也是 npx 一行

## 国内平台（都不在一键范围，只能第 3 步手动接）
要凭据一律用 request_credentials 发卡，help.url 给下面这些直达链接，steps 写到了那一页点什么。用户不该自己找菜单。
- 飞书 / Lark：应用列表 https://open.feishu.cn/app → 创建「企业自建应用」→「凭证与基础信息」里的 App ID 和 App Secret；在「权限管理」开通要用的范围（云文档 docx / drive、日历 calendar、通讯录 contact 等），然后「版本管理与发布」发布一版才生效。官方 MCP：npx -y @larksuiteoapi/lark-mcp mcp -a <App ID> -s <App Secret>；默认以应用身份访问，只能看应用被授权的文档，要读用户自己的文档需加 --oauth 走一次用户授权（会弹浏览器）。飞书作为 IM 渠道另有产品自带的接法，在「集成 › 渠道」里，用的是同一对 App ID / Secret。
- 钉钉：开发者后台 https://open-dev.dingtalk.com/fe/app → 应用开发 → 企业内部应用 → 凭证里的 Client ID（原 AppKey）和 Client Secret（原 AppSecret）；在「权限管理」申请对应接口权限。官方没有稳定的 MCP，社区有零散实现，找不到可用的就按第 3 步写最小服务。
- 企业微信：管理后台应用页 https://work.weixin.qq.com/wework_admin/frame#apps → 应用管理 → 自建应用 → AgentId 和 Secret；企业 ID（CorpID）在「我的企业」页底部。坑：接口调用要把服务器公网 IP 加进应用的「可信 IP」，本机无固定公网 IP 时会 60020 报错。没有官方 MCP。
- QQ 邮箱 / 163 / 126 / 企业邮箱：都走 IMAP + SMTP，凭据是「授权码」不是登录密码。QQ：https://mail.qq.com → 设置 › 账户 › 「IMAP/SMTP 服务」点开启 → 短信验证 → 16 位授权码（服务器 imap.qq.com:993 / smtp.qq.com:465）。163：https://mail.163.com → 设置 › POP3/SMTP/IMAP › 开启并「新增授权密码」（imap.163.com:993 / smtp.163.com:465）。没有现成 MCP，按第 3 步让 agent 写一个几十行的 IMAP/SMTP 桥，凭据字段 MAIL_ADDRESS、MAIL_AUTH_CODE。
- 个人微信：没有开放接口，任何「接微信」的说法都接不了，如实告诉用户。
- 腾讯文档、语雀、Notion 国内版等：先搜「<平台> MCP server」，一般是 npx 一行加一个 token 环境变量；没有就按第 3 步。

常见报错：
- spawn npx ENOENT：本机没有 Node.js / npx，让用户先装 Node 22+。
- 连接超时或 401/403：token 没配或过期；让用户重新申请后在集成里编辑连接。
- 0 个工具：服务器起来了但没登录态，让用户按该 MCP 的说明完成首次授权。

## 边界
- 每个连接都是用户自己的账号，权限跟用户一样大。涉及删除、发送、付款类工具时，仍然按自主度走 act / ask_user 的确认规则。
- 不确定某个平台有没有 MCP 时，如实说，并建议用户搜「<平台> MCP server」。`,
  },
  {
    name: '外部 agent 接入',
    description: '用户想让 bot 会写代码、跑脚本、批量处理文件或做深度调研时，接入 Claude Code、Codex、Hermes、OpenCode、OpenClaw 这类 agent 并授权给 bot 调用。',
    body: `## 目的
把外部 agent 变成 bot 的一个工具。bot 用 delegate_agent 把一个完整任务交给它，在 bot 自己的工作区里执行，拿回结果。支持五个：Claude Code、Codex、Hermes、OpenCode、OpenClaw。

## 两种接法（产品自动选，优先 ACP）
- ACP：像编辑器接 agent 一样。过程里 agent 调了什么工具用户都看得见；要跑命令、删文件、改工作区外的文件时会变成一张卡片问用户；同一个 agent 的会话保留，追加任务接着上次说。Hermes、OpenCode、OpenClaw 自带 ACP；Claude Code、Codex 通过 Zed 维护的适配器接入（有 npx 即可，首次会下载）。
- 一次性调用：本机只有 CLI 没有 ACP 时的兜底。一次一个进程，只有最终输出。
「集成 › 外部 agent」每一行的说明写着当前是哪种。

## 何时使用
用户说「让你能写代码」「帮我跑个脚本」「批量改一堆文件」「深挖一下这个项目」「接一下 Claude Code / Codex / Hermes」。

## 流程
1. configure(target=integration, action=get) 看「外部 agent」状态：ok 表示本机已装好；off 表示没有对应命令。
2. 没装的，按下面步骤带用户安装并登录，装完让用户在「集成」页点「重新检测」，或直接告诉你，你再 get 一次确认变成 ok。
3. configure(target=bot, field=integrations, action=add, value="Claude Code") 授权给需要它的 bot。
4. 之后 bot 就能用 delegate_agent 了。让用户说一个具体任务试一下，比如「把 workspace 里的 csv 合并成一个表」。

## 安装与登录
- Claude Code：npm install -g @anthropic-ai/claude-code；终端运行 claude 按提示登录（或设 ANTHROPIC_API_KEY）；验证 claude -p "说 hi"。
- Codex：npm install -g @openai/codex；终端 codex login；验证 codex exec "说 hi"。
- Hermes：按官方说明安装后终端 hermes setup 配好模型；验证 hermes chat -q "说 hi" --oneshot。
- OpenCode：npm install -g opencode-ai；终端 opencode auth login；验证 opencode run "说 hi"。
- OpenClaw：npm install -g openclaw；终端 openclaw login；验证 openclaw agent --local -m "说 hi"。
- 自定义：任何「命令行一次性接收任务、输出结果」的程序都能接：集成里新增 agent，填命令和参数，任务文本作为最后一个参数传入。

## bot 在云端机器上时：借用户电脑上的 agent（本机转接）
agent 和它的登录态只在用户的电脑上，不复制到云端。用户电脑上开着 EverBot 时，电脑会自动连上云端机器，把装在电脑上的 agent 借给 bot 用：任务发到电脑上执行，bot 的工作区先带过去、agent 写的文件再带回来，权限确认照样走 bot 的自主度和用户的卡片。
- 「集成 › 外部 agent」一行写着「装在你的电脑上 · 经它调用」的就是这种；「运行位置」页能看到电脑在不在线。
- 电脑关了、睡了、或电脑上的 EverBot 没开：这些 agent 暂时用不了，bot 别的事照常。用户问为什么用不了，答案就是这一句，让他打开电脑上的 EverBot（终端里输 everbot）即可，不用重装、不用搬回来。
- 要装新 agent，装在电脑上，然后点那一行的「重新检测」。

## 权限怎么定
ACP 下 agent 每次动手前会问。产品替 bot 决定：读、搜、看网页一律放行；改工作区里的文件放行；跑命令、删文件、改工作区外的文件，看 bot 的自主度——自主度是「do」的自己放行，否则弹卡片让用户拍板，用户可以选「允许，以后不用问」。

## 怎么把任务交给 agent
- 任务描述要自包含：目标、输入在哪、期望产出、约束。agent 看不到你们的聊天记录。
- 一次交一个完整任务，等结果回来再决定下一步；追加要求直接再交一次，会接着同一个会话；要彻底重来用 fresh=true。
- 结果里有文件产出，告诉用户文件在该 bot 的工作区（~/.crew/bots/<botId>/workspace）。
- agent 说没登录时，把它给的那句登录方法原样转给用户，不要自己去改配置。`,
  },
];

/** The steward's manual: where to get a machine that stays on, what to pick, where the IP / password / firewall live. Only the steward carries it. */
export const STEWARD_SKILL: { name: string; description: string; body: string } = {
  name: '云机器配置',
  description: '管家的运维手册：怎么带用户弄到一台 24 小时开着的 Linux 机器，怎么在上面装好服务、诊断和修复常见问题（网络、镜像源、MTU、防火墙、Docker），怎么把 bot 们搬过去。',
  body: `## 目的
用户的 bot 现在跑在他自己的电脑上，电脑一关就停。要让 bot 一直在线，需要一台不关机的 Linux 机器。这份手册是你（管家）的运维手册：先动手，看输出，再决定下一步；只在必须由人做的地方才让用户动手。

## 一、弄到机器
- 没有机器、图省事：腾讯云「轻量应用服务器」https://cloud.tencent.com/product/lighthouse 。创建方式「基于操作系统镜像」，Ubuntu 22.04；地域：模型走境外服务或要配域名选香港 / 境外节点，否则选离用户近的；套餐 2 核 4G；登录方式「自定义密码」。买好后实例卡片上有公网 IP，用户名 ubuntu，密码忘了在实例页「重置密码」。
- 阿里云「轻量应用服务器」https://www.aliyun.com/product/swas ：实例「通用型」（不要智能体专用型），镜像 Ubuntu 22.04，2 核 4G；用户名 root，「重置密码」设密码。
- 自己的机器：Linux（Ubuntu / Debian 都行）、24 小时开、固定 IP、能 ssh。用户名多为 root。
- 不用提前装任何东西。

## 二、连接
machine_card(stage=connect)。用户填完、连上后，系统把体检发给你（系统、CPU、内存、磁盘、Docker、网卡 MTU、sudo、GitHub / Docker Hub 通不通、有没有装过）。读一遍，心里有数：
- 内存 < 2G：能装，但要加 swap（见对策）。
- 磁盘可用 < 5G：先清（apt clean、docker system prune）或让用户换机器。
- GitHub 不通：构建时技能库拉不到，装完没有内置技能库，不致命；Docker Hub 不通：拉不了基础镜像，要配镜像源（见对策）。
- 已装过一份：直接 machine_pair，通了就发搬家卡。
连不上的常见原因：用户名 / 密码错（腾讯云是 ubuntu、阿里云是 root；密码去控制台重置）；IP 抄错或机器没开机（等一分钟）；22 端口被防火墙拦（云厂商默认放开，自己的机器要自己放）。

## 三、标准安装流程
1. machine_probe：看大包能不能过。
2. 需要就调 MTU（对策里的命令），并在第 4 步给安装脚本带 CREW_MTU=1300。
3. machine_upload。
4. machine_ssh：sudo env CREW_MTU=1300 bash /opt/crew/crew-server/deploy/install.sh （不需要 MTU 时去掉 CREW_MTU）。timeout_s 给 1500。它会装 Docker（缺的话）、构建镜像、启动服务、写好配对信息。看输出末尾有没有「装好了」。
5. machine_pair：读回地址，从外面测。
6. 访问不到端口 → 让用户去云控制台「防火墙」加规则（TCP、端口 5200、来源全部）。这一步只能用户做。做完 machine_probe 复查。
7. 通了 → machine_card(stage=move)。用户点完，App 自动切到那台机器，你在那边继续。

安装脚本、Docker 构建这类要跑几分钟、可能中途出状况的步骤，用 vigil 值守：先在后台把命令跑起来（machine_ssh，命令末尾加 >/tmp/install.log 2>&1 & 或用 nohup），然后 vigil(action=start, goal='把服务装起来', watching='安装日志和服务健康', check_kind=machine, check_command='tail -n 30 /tmp/install.log; echo ---; curl -s -o /dev/null -w %{http_code} http://127.0.0.1:5200/health', every_s=30)。系统只在日志有变化或健康检查异常时叫醒你，你看一眼、有问题就修、装好了就 machine_pair 并 vigil(action=stop)。这样长时间安装也不会把你卡住。

## 四、对策（看到什么，做什么）
- 上传卡住 / 第一块传不过去；或 machine_probe 报 MTU 黑洞：在机器上执行
  sudo ip link set dev "$(ip route show default | awk '/default/{print $5; exit}')" mtu 1300
  然后重试上传；安装脚本带 CREW_MTU=1300，它会把这个设置固化并让容器同样用 1300（否则搬家后 App 直连也会卡）。
- 装 Docker 失败 / get.docker.com 超时（多见于国内地域）：curl -fsSL https://get.docker.com | sudo sh -s -- --mirror Aliyun ；或 sudo apt-get install -y docker.io docker-compose-plugin 。
- docker pull 慢或失败（Docker Hub 不通）：写 /etc/docker/daemon.json 加 "registry-mirrors": ["https://docker.m.daocloud.io","https://dockerproxy.com"]（已有 mtu 等键要保留，用 python3 合并），sudo systemctl restart docker，再重跑安装脚本。
- apt 慢：把 /etc/apt/sources.list 里的 archive.ubuntu.com 换成 mirrors.aliyun.com（sed -i），apt-get update。
- 内存不足（构建时被 kill、OOM）：加 2G swap：sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab 。
- 磁盘满：sudo apt-get clean; sudo docker system prune -af ；还不够让用户换更大的盘。
- 5200 端口被占：ss -ltnp 看是谁；是旧的 crew 容器就 docker compose -f /opt/crew/crew-server/deploy/docker-compose.yml down 再装。
- 容器起了但 health 不通（在机器上 curl -s localhost:5200/health 没有 {"ok":true}）：docker compose -f /opt/crew/crew-server/deploy/docker-compose.yml logs --tail 100 crew 看日志；常见是模型密钥没带过去（搬家会带，装完空跑是正常的）或端口冲突。
- 「需要管理员权限 / sudo 失败」：让用户换 root 或有 sudo 的账号，重新发连接卡。
- 命令超时：看是卡在网络（下载）还是死锁；网络就换镜像源，死锁就 kill 后重跑。
- 同一个问题修两次没修好：停下，用一两句话告诉用户你看到的和你的判断，给两个选项（重试 / 换地域重买）。

## 五、跟用户怎么说
- 装的过程不汇报每一步；用户在卡片里能看到命令和输出。装完、卡住、要他动手（放防火墙、换机器、重填密码）时才说话。
- 一次一件事，说人话，不贴日志，不让他敲命令，不解释「MTU」「Docker」是什么，除非他问。
- 搬过去之后的事实：这台电脑关机也没关系；聊天记录、记忆、技能、工作区都过去了；想搬回来在 App 的「bot 们在哪台机器上干活」页面点「搬回来」。`,
};

/** Built-in manuals belong to the product: they are (re)written at every start so improvements ship. */
export function seedBuiltinSkills(skills: SkillStore) {
  for (const s of [...BUILTIN_SKILLS, STEWARD_SKILL]) {
    const cur = skills.get(s.name);
    if (!cur || cur.body.trim() !== s.body.trim() || cur.description !== s.description) skills.write(s.name, s.description, s.body);
  }
}

export const BUILTIN_SKILL_NAMES = BUILTIN_SKILLS.map((s) => s.name);
