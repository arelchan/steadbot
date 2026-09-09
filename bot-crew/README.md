# EverBot · App（bot-crew，多 bot 异步委托）

> 产品名 EverBot。本地一键启动：仓库根目录 `bash everbot.sh`。

一个「像在 IM 里安排同事」的个人 agent 工作台前端。用户有多个职责不同的 bot，
交代一句话就走，bot 记下事项去做，只在需要拍板、澄清或卡住时回来找人。

纯前端，React + Vite + TypeScript，无 UI 库。所有 bot 行为由 `MockAgentService` 用定时器模拟，
后端接入时替换这一个类即可。

## 跑起来

```bash
npm install
npm run dev
```

## 三个界面

| 视图 | 左栏 | 中栏 | 右栏 |
| --- | --- | --- | --- |
| 和一个 bot 共事 | bot 列表 + 多人事项 | 异步对话（日期分隔、回执、确认卡片）+ 右上角**事项浮窗** | **Bot 身份**面板，可收起；「查看 bot 配置」开弹窗 |
| 一件事几个 bot | 同上 | 群聊，bot 之间 @ 交接全可见 + 跨 bot 事项浮窗 | 「这件事」面板 |
| 等你处理（收件箱） | 同上 | 跨所有 bot 的待拍板列表 + 默默做完的 | 无 |

身份和事项是两个独立的东西，各自可以从对话头部右上角的图标展开 / 收起：

- **Bot 身份**：头像、名字、住在哪、一句话描述、两个开关（消息通知、置顶聊天），以及「查看 bot 配置」。
  配置是一个弹窗，就是 harness 层的具像化，分五个页签：指令（职责 + 能走多远 + 什么时候找我）、
  记忆（它自己记的 + 所有 bot 共享的）、技能（可复用的操作手册）、例行任务（定时自动跑的，可开关）、集成（连接了什么 + 住在哪个 IM）。
- **事项**：不是右栏，是挂在对话区右上角的一个小浮窗（可最小化成一条标题栏、可关闭）。里面是按状态分组的看板，卡住 → 等你 → 它在做 → 排队中 → 做完的。用户每发一句，看板就变一次（新增 / 更新 / 关掉），新变化高亮 4 秒。
  点一条进详情：「现在」（等你确认的按钮就在这里）、「经过」（动作 + 对话合并的时间线，可跳回对话、可撤销）、「你拍过的板」。
- 在群聊里，身份面板变成「群聊信息」：群名和描述可直接改，成员列表（牵头 / 参与 / 你）可添加、移出、改牵头，加消息通知和置顶两个开关；事项浮窗显示跨 bot 的事项。
- 左上角「＋」两项：**新建 bot** 直接开一个空窗口，第一句话发出时按内容生成 bot（起名、职责、技能、头像），随后照常办事；**新建群聊** 弹窗选成员（第一个选的默认牵头，群名可不填自动起），选定后才建出会话。
- 头像全部是圆形 Q 版，由 `services/avatar.ts` 的 `AvatarService` 生成。现在是程序化画的卡通脸（按 seed 确定），接真实生图模型时只换这一个类；Bot 身份里点头像可上传自己的图（裁圆、缩到 160px 存本地）或重新生成。

## 代码结构

```
src/
  types.ts              数据模型：Bot(含 routines / notify / pinned) / Matter / Todo / Pending / Action / Message
  store.ts              极简外部 store（useSyncExternalStore + localStorage）
  data/seed.ts          演示数据：三个 bot、一件多人事项、若干事项和待拍板
  services/agent.ts     AgentService 接口 + MockAgentService（后端接入点）
  components/
    Sidebar.tsx         左栏
    Thread.tsx          对话 + 输入框（支持模拟从不同 IM 发）
    Cards.tsx           确认 / 选项 / 卡住 / 摘要 四种卡片
    RightPanel.tsx      右栏身份面板（bot / 这件事）+ 事项浮窗（看板 / 详情）
    BotConfigModal.tsx  bot 配置弹窗：指令 / 记忆 / 技能 / 例行任务 / 集成
    Inbox.tsx           收件箱
    ProfileView.tsx     「它们眼中的你」共享层 + 各 bot 私有层
    Draft.tsx           新建 bot 的空窗口，第一条消息生成 bot
    NewGroupModal.tsx   新建群聊：选成员、起名
  services/avatar.ts    AvatarService：头像生成的接入点（程序化占位）+ 上传图裁剪
    Toasts.tsx          主动打断
```

## 后端接入点

`src/services/agent.ts` 里的接口就是全部：

```ts
interface AgentService {
  onUserMessage(threadId, text, via?)   // 用户在某个会话里说了一句
  onDraftMessage(text)                  // 新 bot 空窗口里的第一句：生成 bot，再照常处理
  onPendingChoice(pendingId, optionId)  // 用户点了某个待拍板的按钮
  start() / stop()                      // 主动事件（定时、触发器）的订阅
}
```

真实实现只需要往 store 里写同样的对象：`addMessage` / `addTodo` / `patchTodo` / `addPending` /
`resolvePending` / `addAction` / `setTyping` / `pushToast`。UI 不关心消息从哪来。

几个对后端有约束的模型决定：

- **一句话 → 一条事项的回执**（`Message.receipt`：created / updated / closed / reply）。后端做意图分类后必须回一个回执，否则用户不知道自己那句话被当成了什么。
- **Pending 绑定 Todo**（`Pending.todoId`），确认卡片是事项的镜像，正式入口在事项详情和收件箱。
- **能走多远 / 什么时候找我** 是两个独立旋钮（`Bot.autonomy` / `Bot.interrupt`）。前者决定 bot 停在哪一步，后者决定事件是弹出、攒摘要还是只留角标。
- **动作日志** (`Action`) 带 `undoable`，可撤销的动作 UI 会露出「撤销」。
- **渠道** (`Message.via`) 只是投递方式，对话按事项存一份。

## 接后端跑

后端在 [../crew-server](../crew-server)，基于 [earendil-works/pi](https://github.com/earendil-works/pi) 的 SDK + Extension 实现（方案见 [docs/pi-integration-plan.md](docs/pi-integration-plan.md)）。

```bash
# 终端 1
cd crew-server && npm install --ignore-scripts && npm run dev      # ws://localhost:5200/ws
# 终端 2
cd bot-crew && npm run dev:live                                      # VITE_CREW_WS 指向上面的地址
```

不设 `VITE_CREW_WS` 时仍是浏览器内的 mock。没有模型密钥时后端用脚本化假模型跑通整条链路。
