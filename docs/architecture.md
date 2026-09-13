# Steadbot 架构规范与改造方案

2026-09-12，基于 `a605b1a`。经三轮 review 修订（v1 的多处结构性判断被推翻，见附录）。
`DESIGN.md` 说产品为什么长这样；这份说代码该怎么摆。

---

## 〇、动手前必须先做的一件事

根 `.gitignore` 是**白名单**：

```
/*
!/.gitignore
!/steadbot
!/crew-server/
!/bot-crew/
!/DESIGN.md
```

所以 `.github/`、根目录的 `shared/`、以及**这份文档本身**都提交不上去，而且 `git add` 不报错，只是什么都没发生。

任何涉及新增根目录文件的步骤，第一步都是给 `.gitignore` 加白名单，并用 `git check-ignore -v <路径>` 验证返回非零。

---

## 执行记录（2026-09-12 当天做完）

R0–R8 全部落地，都在 `opus-0912` 上，**没有 push**。两个包 typecheck + lint + 35 个测试 + 前端 build 全绿。

| | 结果 | 关键证据 |
|---|---|---|
| R0 | 前端锁 strict（零新增错误）；协议 switch 补 never；删掉 `as ServerMessage`；crew.json 读取加守卫 | 临时加一条消息 → TS2322 |
| R1 | 配置页认全六种日程写法；两处内联渠道 map 改用 CHANNEL_LABEL | 两边文法逐条对上 |
| R2 | CI：typecheck 硬门 + lint 棘轮 + build + 测试 | 清掉 5 个死 import，服务端 43 → 38 |
| R3 | 界面文案上类型 | 八个语言各八条过期键被揪出并删掉 |
| R4 | 渠道收成一张表 | 老两张别名表 23 个叫法逐个跑过，答案一致 |
| R5 | CrewOps 359 行搬出 index.ts（1573 → 1205）；json() 三份收一份 | 沙箱起了两次服务（TDZ 只有运行时暴露） |
| R6 | 五个纯函数测起来，35 个用例 | 顺带三个日程 parser 变两个 |
| R7 | 领域类型和协议合一，出向线终于有类型 | 两个方向各验一次：改字段名 TS2353，加消息 TS2322 |
| R8 | 首屏分页 + localStorage 上限 + 消息挪进追加文件 | 在 ~/.crew 拷贝上真跑：192 条 id 集合一致，crew.json 129586 → 38908 |

### 执行中改掉的三个判断

**lint 不设零容忍，改成棘轮。** 前端 49 条里 30 条是 `set-state-in-effect` / `exhaustive-deps`
——要一处处判断的 React 行为，不能机械清；服务端剩下的 38 条是风格 nit，一次改完只会跟
另一棵工作树撞车。卡住当前数量，只许降不许升。

**`checkFormats` 的已知缺口没补。** `A[云桌面 (Docker)]` 在 mermaid 里会挂，但括号是配平的，
计数规则看不出来。没补是故意的：这里误判的代价是「用户的话被扣住不发」，而合法的
`A(圆角节点)` 跟它没法靠正则可靠区分。宁可漏判。缺口写进测试了。

**升级那条第二 socket 不是冗余。** 两位 reviewer 都说它是第四份抄写、该并回主 socket。
读了代码才发现它连的是**本机** Steadbot——升级永远由本机执行，哪怕 App 正指着云上的 runtime。
所以并不得。改成主 switch 显式列出那三种消息「归别处管」，同时把它手写的形状换成共享类型。

### R8 还差最后一步（要你在场）

代码和迁移都好了、也在真实形状的数据上验过，但**没有上生产**。上线时按这个顺序：

1. 升级前 ssh 上去备份两份：单文件 `crew.json` + 整卷 tar（备份含 `config.json`，chmod 600，别下载到本机）
2. push → 点升级（`shared/` 在 `crew-server/src/` 下，命中的是「只是代码变了」，40 秒重启）
3. 起来后确认 `/data/crew.json.pre-split` 在、`crew.messages.jsonl` 的条数对得上
4. `.pre-split` 保留 ≥ 两周
5. 要回滚：`git revert`（不要 `reset --hard`，本机走的是 `git pull --ff-only`），
   而且**先** `mv crew.json.pre-split crew.json`，**再**重启

---

## 一、现状盘点（动手前）

| | 行数 | |
|---|---|---|
| crew-server/src | 20128 | `index.ts` 1573 · `everos.ts` 1076 · `bots.ts` 899 · `desktop.ts` 801 |
| bot-crew/src | 17122 | 其中 i18n 语料 7179，真实代码约 10000 |
| styles.css | 1750 | 单文件 |
| 测试 | **0** | 无 test script、无 runner、无 CI、无 git hook |

### 真正健康的部分（改造时别动）

- **`extensions/` 的工具分层**：25 个文件、平均 113 行，加一个工具 = 加一个文件 + 一行注册。
- **注释写为什么**：`format-check.ts`、`host.ts`、`scheduler.ts` 的模块头。
- **机械校验挡在模型前面**（`format-check.ts` → `bots.ts` 扣消息重发）：该由 parser 判的不交给模型判。这是模式，不是一次性代码。
- **bot 协作与主动性已经建好**：`router.ts` 的 handoff（含深度限制、送不达把 todo 打回 `waiting`）、`scheduler.ts`、`vigil.ts`、`notifier.ts`。这几块不在改造范围。
- **单租户是对的判断**：单 `CREW_HOME` + 单 `authToken` + 搬家到云机器，本身就是「一人一台 VM」的租户方案。不给多用户留位置。

### 债与 bug

先分清两类：**D = 会慢慢咬人的债；B = 现在就在出错的 bug。**

#### B1 · 例行任务被配置页悄悄改坏 🔴

日程语法有**三个** parser，不是两个：

| | 星期 | `每 N 小时` |
|---|---|---|
| `crew-server/src/scheduler.ts:39,83` | `[一二三四五六日天]` | ✅ |
| `bot-crew/src/calendar.ts:20-22` | `[一二三四五六日天]` | ✅ |
| `bot-crew/src/components/BotConfigModal.tsx:347,363` | `[日一二三四五六]` ← **没有「天」** | ❌ |

`readWhen` 匹配失败回落到 `DEFAULT_WHEN = 每天 09:00`，`writeWhen`（372）原样写回，`save()`（456）看到 schedule 变了还会重置 `lastRun`。

**后果**：一个 `每周天 09:00` 或 `每 2 小时` 的例行任务，列表里就显示成「每天 09:00」，用户碰一下时间控件就被永久改成每天九点。无任何报错。

#### B2 · 渠道标签有 5 份，2 份是错的，其中 1 份喂给模型 🔴

`Channel` 有 8 个值（`types.ts:3`）。`CHANNEL_LABEL`（`types.ts:6`）是全的。但另有两处内联的 label map 只写了 5 个：

- `crew-server/src/store.ts:143` → 成长动线写「住进了【weixin】」（原始 id）
- `crew-server/src/extensions/crew-tools.ts:104` → **这份进的是模型的自我描述提示词**，一个接了微信的 bot 被告知自己在「weixin」上

两处都只要改成用已有的 `CHANNEL_LABEL`。

#### B3 · `crew.json` 读取无守卫 🔴

```ts
// crew-server/src/store.ts:39
this.data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Snapshot) : seed();
```

没有 try/catch，没有备份。一次断电、一次磁盘写满卡在 `writeFileSync(tmp)` 之后 —— 服务起不来，配合 `scripts/run.sh` 的 while 循环就是**每 2 秒崩一次，永远循环**，而 `docker compose ps` 显示容器 `Up`。
对照：`config.ts` 读同一目录下的文件**是**包了 try/catch 的。

#### B4 · `Bot.bindings` 已经在往客户端发

`crew-server/src/types.ts:55` 注释写着 `server-only`，但 `ws.ts:151` 的快照是 `{ ...store.data, ... }`，全文件唯一的 redact（`ws.ts:104`）只管 `Integration.env`。所以每个 bot 的各 IM 私聊 chatId 都到了浏览器，并随 `persist()` 落进 localStorage。前端 `Bot` 类型没声明它，所以是隐形到的。

#### D1 · 协议有四份，其中一个接缝是硬转，出向完全无类型

v1 说的「前后端各写一遍」是错的。实际是：

| # | 在哪 | 状态 |
|---|---|---|
| 1 | `crew-server/src/types.ts:553` `ServerMessage` | 31 条 |
| 2 | `bot-crew/src/services/ws-agent.ts:9` 内联联合 | 30 条 |
| 3 | `crew-server/src/store.ts:6` `StoreEvent` | 19 条，经 `ws.ts:143` 的 `e as ServerMessage` 桥接 |
| 4 | `bot-crew/src/services/upgrade.ts:46` 自己手写 `{type?, line?}` | 旁路，另开一条 WebSocket |

`StoreEvent` 里的 `event` / `event_deleted` / `computer` **在 `ServerMessage` 里根本不存在** —— 服务端每天广播三种从未声明的消息，全靠那个 cast 咽下去。反方向，`upgrade_status` 等在 `ServerMessage` 里有、客户端主 switch 里没有，所以只能另开 socket 再解一遍。

**而客户端→服务端那条线完全没有类型**：

```ts
// bot-crew/src/services/ws-agent.ts:147
private send(o: object) {
```

35 种 `ClientMessage` 全是对着 `object` 拼字面量。打错 `type`、改了字段名、漏了必填 —— 全部编译通过，运行时静默失败。这比重复本身严重得多。

#### D2 · 没有 CI；`main` 现在就是坏的

`bot-crew` 的 `tsc` 在 `a605b1a` 上失败：`SettingsModal.tsx(5,1) TS6192`。`crew-server` 干净。
App 跑 `vite dev` 不做类型检查，所以坏了没人知道。

两个前提要纠正：
- **前端没有 `strict`。** `crew-server/tsconfig.json:6` 有，`bot-crew/tsconfig.app.json` **没有** —— 一万行 UI 加整个协议边界，`strictNullChecks` 关着。实测加上 `--strict` 后**新增错误 0 个**，代码本来就是干净的，只是没锁。
- **oxlint 现在 45 条 warning、退出码 0。** CI 里直接跑等于装饰品，要 `--max-warnings=0` 才是门（那就得先清 45 条）。

#### D3 · `index.ts` 是一个 1500 行的 `main()`（70–1568）

按行数切开：

| 区段 | 行数 | 是什么 |
|---|---|---|
| 70–310 | 240 | 启动装配 |
| 311–446 | 135 | `createBotFromBrief` / `resumeInterruptedTurns` |
| **456–814** | **358** | **`bots.ops = {...} satisfies CrewOps`** |
| 817–930 | 110 | `stopRunning` / `resumeRunning` / `migrateHomeTo` |
| 935–1218 | 280 | HTTP 路由（`json()` 抄了 3 遍） |
| 1222–1560 | 340 | 35 个 case 的 switch |
| 1482–1568 | 86 | shutdown |

关键判断（v1 搞反了）：**最该拆的是那 358 行的 `CrewOps` 实现，不是 switch。** `CrewOps`（`extensions/crew-tools.ts:9`）是「一个 bot 能对这个 crew 做什么」的全部，已经有显式接口，实现却塞在一个 1500 行函数的中段，而且是注定会长的那块。
反过来那 35 个 case 平均 10 行、几乎全是转发，是文件里最好读、最不会坏的部分。

#### D4 · 持久化无上限（但比 v1 说的轻）

- 服务端：`store.ts:72` 全量 pretty-print 重写（150ms debounce，不是每次改动）。现 130KB。
- 客户端：全部 state 含消息进 localStorage，5MB 上限，`catch { /* ignore */ }`。
- 快照：`ws.ts:151` 推全量历史，从不截断。

**但服务端是权威**，客户端写不进去丢的是首屏和离线体验、不是数据。用量 2.6%，消息不带大块二进制。**所以这是排期活，不是急事** —— 急的是 B3 和「别静默吞异常」。

#### D5 · i18n 已漂，但 v1 的修法是错的

en/zh 706 键，de/es/fr/ja/ko/pt 678，ru 728，zh-TW 679。缺的是 **36** 个（不是 28）。

ru 多出来的 58 个里 **50 个是俄语复数形式**（`.few` / `.many`），合法；真过期的只有 8 个，且每个非 zh/en 语言都有。
所以 v1 提的 `Record<keyof typeof zh, string>` **会把 50 个合法键判成错误**，而且会废掉 `i18n/index.tsx:88` 那条刻意设计的回退链（`ja → en → zh`，注释写明「缺的日语行读英文比读中文好」）。

真正在咬人的是 `t(key: string)`：打错键，`lookup(key) ?? key` 把**原始键名渲染给用户**，编译期完全静默。

#### D6 · 扩展点的抽象已经漏了

v1 的「加一个 X 只改这些文件」是愿望，不是现状。实测：

| 加什么 | v1 说 | 实际 |
|---|---|---|
| bot 工具 | 2 处 | 3 → 5（要 ops）→ 13+（花模型钱）→ 18+（带卡片） |
| **IM 渠道** | **3 处** | **24 处必改** |
| 卡片 | 2 处 | 4 处代码 + 约 60 行 i18n |
| ws 消息 | 2 处 | 5–8 处，横跨 4 份联合类型 |

IM 那 24 处里含：`channels.ts` 的 7 张表、两个 switch、**两套**互不相同的中文别名表（`index.ts:53` 与 `extensions/build.ts:12`）、`secrets.ts:52` 的脱敏正则（**漏了这条，新 IM 的 token 会进模型上下文**）、四处硬编码 IM 列表的提示词散文、前端第三份枚举、10 个语料文件。

v1 还漏了三个真实扩展点：**模型槽位/provider**（接下来动得最多的一处）、**`UsageKind`**（改一个枚举成员要动 13 处）、**持久化加字段**（全仓没有任何 schema 版本号，每加一个字段就在 `CrewStore` 构造函数里多一条无条件嗅探迁移）。

#### D7 · 两个真实的运行时循环依赖

`models.ts:5 → draw.ts` 与 `draw.ts:14 → models.ts`，双向值导入。前端 `Preview → Markdown → FileCard → Preview` 同理。
这类在 dev 里正常、production build 才炸 —— 而 D2 说了没人会发现。

---

## 二、架构规范

### 2.1 服务端分层

依赖只能向下。**新文件放哪一层，看它 import 了谁。**

```
① kernel        types.ts  config.ts
② state         store.ts  util.ts  broker.ts
③ capability    everos scheduler desktop machine models skills library connectors
                integrations bridges/* gui draw vision meter channels router
                host upgrade notifier vigil runtime ws
④ tools         extensions/*
⑤ composition   index.ts  bots.ts  cloud/index.ts —— 自己不实现业务
```

**现状离这个有距离，承认它**：26 个 extension 里 20 个 import 了 ③ 层的运行时模块（`operate.ts` → `desktop/gui/deps`，`see.ts` → `meter/vision/office`）。③ 层内部也有互引（`models ↔ draw` 是真环）。

所以这一节是**目标**，不是现状描述。唯一现在就该执行的硬约束是两条：**不新增环**、**新文件不往 ⑤ 里塞业务**。

### 2.2 前端分层

```
① types.ts  utils.ts
② store.ts  services/*     ← 所有网络调用只在这层
③ components/*             ← 不 fetch、不解析协议、不拼提示词
④ App.tsx  main.tsx
```

违规两处：`Preview.tsx`（3 处 fetch）、`RuntimeView.tsx`（1 处）。

### 2.3 四条硬规矩

1. **一个概念只有一份值。** 渠道集合、状态枚举、模型槽位 —— 用 `types.ts` 里那一份常量，不许内联重写（B2 就是破这条破出来的）。
2. **协议边界必须有编译期穷尽检查。** 每个 `switch (m.type)` 都要有 `default: { const _x: never = m; void _x; }`。
3. **文案不进业务模块。** 用户看的走 i18n，模型看的走 `promptGuidelines` / `identity.ts`。
4. **终态由代码守，不由提示词守。** 事项四态的迁移合法性属于 `format-check.ts` 那个模式的适用范围。

### 2.4 提示词也是承重结构

`extensions/identity.ts:136` 是一段 4KB 的散文，点名 17 个工具；`extensions/todo.ts:39` 才是四态机真正的规则所在。**这些不过编译器，但它们承重。**
规矩：改工具、改状态机、改渠道集合时，把这几处当调用点一起 grep。

---

## 三、改造方案

顺序按「改变问题到达速率」优先，而不是按存量大小。

### R0 · 一行 + 三行止血（一小时）

**R0a · `bot-crew/tsconfig.app.json` 加 `"strict": true`。**
实测新增错误 **0 个**。前端本来就是 strict 干净的，只是从没锁上。一行，零修复成本，永久锁住一项已经付过钱的纪律。

**R0b · 三行：**
- `ws-agent.ts` 的 switch 加 `default: { const _x: never = m; void _x; }` —— 现在**没有 default**，所以 R3 的"加一条消息看前端报错"验收在这之前是假的。
- 删掉 `ws.ts:143` 的 `as ServerMessage`，把 `event` / `event_deleted` / `computer` 补进 `ServerMessage`。
- `store.ts:39` 包 try/catch：坏了就改名成 `.corrupt` 并 seed，而不是让进程每 2 秒崩一次。

这四行拿走 R3 和 R5 各自一半的收益，不需要等它们排期。

### R1 · 修三个现存 bug（两小时）

- **B1**：`BotConfigModal.tsx` 的 `readWhen` 补 `天` 和 `每 N 小时`。更稳的做法是把 `calendar.ts` 的 parser 直接用过来，三个变两个。
- **B2**：`store.ts:143` 和 `crew-tools.ts:104` 改用 `CHANNEL_LABEL`。
- **B4**：`ws.ts` 加 `toWire(bot)` 剥掉 `bindings`，快照和广播都过它。**用运行时剥字段，不要指望类型声明**。

### R2 · CI，而且要是真门（半天）

- `.gitignore` 加 `!/.github/`，`git check-ignore` 验证
- `bot-crew/package.json` 补 `typecheck` script（现在只有 `build`，而 `tsc -b` 缺 `composite`）
- 修 `SettingsModal.tsx:5` 的 TS6192；清 `index.ts:42` 的死导入 `authorized`
- oxlint 加 `--max-warnings=0`，先清 45 条
- crew-server 的 lint 用 `npx oxlint@<pin>`，**不写进 devDependencies**

**必须知道**：CI 红**不会阻断部署**。升级不是 push 触发的，是主动发 `{type:'upgrade'}`（App 的升级按钮 / `deploy.mjs`），`upgrade.ts` ssh 到机器 `git checkout -f -B main origin/main`。CI 的价值是「点之前知道」，不是闸门。要真闸门得开分支保护 + 走 PR。

### R3 · i18n（一小时）

```ts
export type Dict = Partial<Record<keyof typeof zh, string>>;   // 非源语言
```
`zh` 保持全量必填。同时把 `t` / `tn` / `tx` 的 key 参数收紧成 `keyof typeof zh`。
保住回退链，不用补 36 个机翻，打错键变成编译错误。

### R4 · 把「一个概念一份值」落实（半天）

这是 D1 里真正在流血的那半，比合并类型文件优先：
- 渠道集合收成一份（`types.ts` 的 `CHANNEL_LABEL` + `channels.ts` 的表由它派生）
- 两套中文别名表（`index.ts:53` / `build.ts:12`）合一
- `UsageKind` 收口
- `secrets.ts:52` 的脱敏正则改成由渠道表派生 —— 否则下一个 IM 的 token 会进模型上下文

### R5 · 拆 `index.ts`（一天，但重新瞄准）

**第一优先：把 456–814 那 358 行搬进 `crew-server/src/crew-ops.ts`。** 签名就是它已有的 `CrewOps` 接口，依赖显式传。这是最机械也最要紧的一步。

然后：
- `http.ts`：合并三份 `json()`（951 / 1044 / 1181，完全一致，安全）
- `routes/`：搬进 3–4 个文件。`handlers.http` 已经是「处理了返回 true」的链式接口，seam 现成，**不要再造路由表抽象**
- **switch 原地不动**，也**不要造 `AppContext` 类型**。真要拆时 `Record<ClientMessage['type'], Handler>` 一张表比五个文件便宜

**不要合并 `readBody`**：五份不一致，`/upload/` 那份带 50MB 上限和 `req.destroy()`。

**搬家红线**（这些是隐性承重，动了就炸）：

| 位置 | 是什么 |
|---|---|
| `index.ts:838/922/925/928` | `broadcastRuntime` / `upgrader` / `broadcastUpgrade` / `server` 四个**前向引用**，靠箭头函数延迟求值才没炸。925 的 `server?.` 是假保护 —— `?.` 挡不住 TDZ。变成顶层 `const` 或构造时求值 = 启动即 `ReferenceError` |
| `index.ts:113` | `runtime.claim()` **有副作用**（抢租约），必须留在 `desktops`(108) 之后、`hosts`(119) 之前 |
| `index.ts:817` `let running` | 四个入口改同一个 bool（1109 / 1132 / 1345 / `migrateHomeTo`），正好被切在 `routes/` 和 `handlers/` 两边 |
| `index.ts:1224` | mode 闸门是**所有 case 的前置条件**，必须留在分发之前 |
| `index.ts:1291/1318` | 两处 `patchCard` 是「重读再 patch」的**并发防护**，别去重成持引用 |
| `index.ts:1323` | `machine_move` 先写消息再导出 —— 顺序是语义的一部分 |
| `ws.ts:42` | `PUBLIC_PATH` 和 `authorized` 在同一文件是有意的，别跟路由表走 |

一个改动一个 commit，**每个 commit 之后真的起一次服务** —— TDZ 只有运行时才暴露。

### R6 · 五个纯函数测试（一下午）

不是「全面单测」，是这五个已经在出错的地方。两个包都还没有 test runner，R2 的 CI 立起来时一并装上。

1. `lastDue()`（`scheduler.ts:74`）—— 时区/DST，`tick(now)` 已经把 now 做成可注入的了
2. **三个 parser 一致性**：凡是 `lastDue` 认的字符串，`readWhen → writeWhen` 必须原样吐回（一个 property test 抓完 B1 那类）
3. 事项四态：先补 `setTodoStatus(id, next)` 拒绝从终态出去（10 行）。现在 `broker.ts:84` 和 `ask.ts:67` **不检查终态**，一个 bot 先 `todo(close)` 再 `ask(...)` 会把 `done` 静默复活成 `waiting`
4. `checkFormats()`（`format-check.ts`）—— 它扣着用户的消息不发
5. 模型输出的 JSON 提取 —— 同一段代码抄了 6 份，`infer-bot.ts:111` 漏了 `indexOf === -1` 守卫，而那条路径是 **bot 出生**

### R7 · `shared/`（半天，排在 R0b 之后才有验收标准）

**放 `crew-server/src/shared/`，不要放仓库根。** 原因是部署，不是品味：

| 关卡 | 仓库根的 `shared/` |
|---|---|
| git | `.gitignore` 白名单挡住，`git add` 静默无效 |
| Docker build context | `docker-compose.yml:5` `context: ..` = `crew-server/`，`COPY . .` 拷不到 |
| bind mount | 只挂 `../src` `../scripts` `../library` |
| `upgrade.ts:219` heavy 规则 | `shared/**` 不匹配 → 判成「只是代码变了」→ 只重启不重建 |

四关全过不去，且前两关**静默失败**。后果：升级日志显示「✔ 升级完成」（健康检查用 `;` 连接，超时也 `echo DONE`），然后容器每 2 秒崩一次而 `docker compose ps` 显示 `Up`，所有 bot 集体失联，只能 ssh 救。

放 `crew-server/src/shared/` 则已在白名单、已在镜像、已被 bind mount、已在 `include: ["src"]` 里。前端用 vite alias 指过去。

**前端必须加**（否则 dev 白屏 403）：
```ts
server: { fs: { allow: ['..'] } },
resolve: { alias: { '@shared': fileURLToPath(new URL('../crew-server/src/shared', import.meta.url)) } }
```
`types.ts` 有值导出（`CHANNEL_LABEL`、`botThread`），不是纯类型模块，dev server 会真的去 HTTP 拉它；而仓库根没有 package.json，Vite 的 workspace root 探测会退回 `bot-crew/`。

**tsconfig 四条**：shared 内部相对 import 一律带 `.ts`（服务端 NodeNext 要求）；再导出用 `export * from`（两边 `verbatimModuleSyntax: true`）；**零** `Buffer` / `NodeJS.*` / DOM 类型（两边 `lib`/`types` 不同）；**零** `enum` / `namespace` / 参数属性（前端 `erasableSyntaxOnly: true`）。服务端不要用 bare specifier（没有 `baseUrl`/`paths`，`node_modules` 还是符号链接）。

**安全（v1 这一段整个点错了，重写）**：

| 东西 | 判断 |
|---|---|
| `config.ts` 的 `FileConfig` | **一个字段都不进** shared。它是全部凭据的形状，而且它本来就不在 `types.ts` 里 —— 别"顺手收拢" |
| `Integration.env` / `headers` | **真正危险的那个**（MCP 的 API key 明文）。shared 里定义**不含** `env` 的 `Integration`，服务端用交叉类型扩展；`ws.ts:104` 的 redact 返回类型钉死成 shared 那个 —— 让「前端拿不到 env」变成编译期事实，而不是一行运行时善意 |
| `Bot.bindings` | 不进 shared；但真正的修法是 R1 的 `toWire()`，不是留在服务端类型里 |
| `movedTo` | `RuntimeInfo.movedTo` 只是 URL 字符串，前端本来就有。真凭据是 `config.json` 里的 `movedTo.token`，那个不在 `types.ts` 里 |
| 带明文凭据的 `ClientMessage`（`migrate_to` `remote_install` `machine_connect` `submit_secrets` `submit_login`） | **进 shared 是对的** —— 方向是客户端→服务端，拆了前端就发不出这条消息 |
| `switch_runtime`（服务端→客户端带 token） | 进 shared，但**加注释写死它是故意的**，免得后人看到 token 顺手删 |

**分两个 commit 上线**：先只建目录 + 配置、服务端不 import，点一次升级验证容器正常；确认无误再提 import 那个 commit。

### R8 · 持久化（排期，碰用户真实数据）

**先纠正一个前提**：本机 `~/.crew/crew.json` 只有 192 条消息（`moved.json` 在，bot 在云上），**不是生产数据**。真正要迁的在 `deploy-crew-1` 的 `crew-data` volume。

**上线顺序必须是客户端先、服务端后**（和直觉相反）：`ws-agent.ts:263` 的 snapshot 是**整体替换**，`store.ts:64` 立刻 `persist()`。老客户端连上只推 200 条的新服务端 → 200 条覆盖 localStorage 全量副本 → 往上翻没有、刷新也回不来、**客户端侧无恢复路径**。
反过来新客户端连老服务端是安全的：`load_more` 走到 `default:` 回一个 error，客户端只 `console.warn`。

`load_more` 目前**完全不存在**。这不是「装个上限」，是一个完整的分页特性。

其余步骤（备份、`CREW_HOME` 沙箱验证、幂等迁移器、`crew.json.pre-split` 保留两周、`git revert` 而非 `reset --hard`）见执行清单。

---

## 四、明确不做

- 不引状态管理库（前端那个 store 够用）
- 不引 HTTP 框架（`handlers.http` 已经是干净的 seam）
- 不上 monorepo 工具（`crew-server/src/shared/` 解决问题，workspace 要动 CI、部署、Docker）
- 不造 `AppContext` 类型（传个普通对象字面量，别写 interface 去描述 20 个依赖）
- 不做全面单测 —— 但 R6 那五个是**要做的**，它在执行表里有格子

---

## 五、执行顺序

```
今天    R0 (一行 + 三行) + R1 (三个 bug)        两小时，全是止血
本周    R2 (真 CI) + R3 (i18n)                   半天 + 一小时
接着    R4 (一个概念一份值)                       半天
有空    R5 (拆 index.ts，瞄 CrewOps) + R6 (五个测试)
排期    R7 (shared/) → R8 (持久化)               R7 先，R8 最后
```

R0–R6 都不改运行时行为。R7 碰部署，分两个 commit。R8 碰数据，单独排单独验。

**共享工作树**：`/Users/admin/Project` 被另一个会话占着 main，这棵树 `git checkout main` 会被拒。用 `git push origin opus-0912:main` 或走 PR。R5 和 R7 都重改 fan-in 最高的文件，**不要同时做**，每 2–3 个 commit rebase 一次。永不 `git add -A`。

---

## 附录 · v1 被推翻的判断

留档是为了记住哪类判断不可信：**能数出来的都对，靠推断的几乎全错，而且一致地把问题说轻了。**

| v1 说 | 实际 |
|---|---|
| 没有发现环 | 两个真实运行时环 |
| store.ts 只 import kernel | 还 import `util.ts` |
| extensions 只 import ctx | 26 个里 20 个 import 了 ③ 层 |
| 前后端各写一遍协议 | 四份，出向完全无类型 |
| `ServerMessage` ~40 条 | 31 条 |
| `strict: true` | 只有后端有 |
| 4 个 any | 0 个（全是假阳性） |
| 两个日程 parser | 三个，第三个正在毁数据 |
| ru 有 22 个过期键 | 8 个，另外 50 个是合法复数形式 |
| R3 要防 bindings/imAccounts/movedTo | 三个全点错；真在漏的是 `Integration.env`，而 `bindings` 已经漏了 |
| 「前端那个 80 行的 store」 | 385 行 |
| R3 验收：加一条消息前端会报错 | switch 没有 default，不会报错 |
| CI 红能拦住坏代码上生产 | 升级不是 push 触发的，CI 不是闸门 |
