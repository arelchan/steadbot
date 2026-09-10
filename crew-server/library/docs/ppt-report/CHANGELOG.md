# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — 特殊图形「一次成」

- **`scripts/silhouette.js`** — 人体剪影共享资产：男（西装提包）/ 女（长发职业）剪影
  path + viewBox（OpenClipart CC0 烘焙）、`window.BODY_ANCHORS` 部位坐标表、
  `injectSilhouette()`、`renderHumanPortrait(slideSel, {kind, labels})`。build 自动注入。
- **`slides-templates/value-chain.html`** — 价值流横轴模板（landscape-skeleton 的 B 骨架）：
  实体产业 / 航天 / 能源 / 制造用，5~6 环节卡横向 ▶ 串联 + 自营/外采徽章 + 沿链渐变。纯 CSS 全静态。
- **`build.py` 自动抽取内联 `<style>` / `<script>`**：模板做到「一个文件，拷过去即插即用」，
  不用再手动把样式块拆到 css 文件（先剔 HTML 注释再定位标签对，根治旧版正则误抓注释里 `<style>` 字样的坑）。

### Changed — 把「多轮迭代」改造成「一次成」

- **human-portrait 重构为数据驱动**：只写一段 `labels` 数据（每个标签绑定身体 `part`），
  剪影 / 部位**可见色点** / 引线**自动连接**全部算出。修复旧版「引线悬空无锚点、坐标写死换布局即崩」。
- **landscape-map 重写为全静态**：删除全部「测量卡片尺寸反推布局」的 JS
  （`redistributeSpans` / `redistributeTierHeights` / `setColumns` / `eqGroup`，被验证为死结）。
  改三 tier `1fr×3` 等高封顶（有界不溢出）+ chip `flex-wrap`+`align-items:center` 居中。JS 只注入 logo。
- 模板占位符统一为 `sX` / `initSlideX`（不再用 `sN`——字符串 `className` 含子串 `sN`，
  全局替换会误伤 JS）。

### Fixed — 文档与现实对齐

- `README` / `SKILL` 曾称剪影「pre-baked into common.js」实为子虚乌有——现已真实落地到 `silhouette.js` 并据实更新。
- 修正模板数（→ 9）、参考文档数（→ 11）、ECharts 函数数（→ 5）等文档漂移。
- 清理 references 里指向作者私人本机路径（`~/personal/...`）的悬空「参考实现」引用。
- 调和「黄金规则 #12」与 `landscape-qa` 的自相矛盾（旧版一边禁止 JS 测量、一边要求 JS 动态重排）。
- 刷新 `docs/screenshots/`（human-portrait 带色点新版 / landscape-map 静态版 / 新增 value-chain）。

## [0.1.0] — 初次发布

### Added

- **6 份参考文档**（~1300 行）：
  - `references/architecture.md` — 拆分架构 + build.py 工作原理 + 自适应缩放
  - `references/design-system.md` — 8 级字号 / 字重 / 颜色 / 间距硬规则
  - `references/layout-principles.md` — 14 条经典 PPT 布局法则（含卡片边界对齐）
  - `references/chart-mapping.md` — 数据形态 ↔ 图表选型决策表 + ECharts 配置范本
  - `references/components.md` — 通用组件库
  - `references/themes.md` — 5 套预设主题 + 自定义方法
- **5 套页面模板**：kpi-overview / two-country / three-phase / multi-trend / supply-bars
- **5 套预设主题**：modern-light / dark-tech / warm-business / brand-blue / minimal-mono
- **核心脚本**：
  - `build.py` — 自动检测 N 个 slides，合成单 HTML，自动转换 xlsx/csv 数据
  - `xlsx2json.py` — Excel/CSV → JSON 转换器（被 build 调用，也可单跑调试）
  - `export_pdf.py` — playwright + img2pdf，输出 13.33×7.5 inch 标准 16:9 PDF
  - `quickstart.sh` — 一键初始化新项目
- **数据格式**：支持 `.xlsx` / `.csv` / `.json` 三种（优先级 json > xlsx > csv）。xlsx 多 sheet → JSON 顶层多 key，csv 单表 → JSON 数组。openpyxl 是可选依赖（不装时只跳过 xlsx，不影响其他功能）
- **ECharts 范本函数**：`renderDailyDual` / `renderShare100` / `renderMultiTrend` / `renderMiniBars` / `renderKpiGrid`
- 主题切换：右上角 5 按钮 + localStorage 持久化
- 11 条黄金规则（在 `SKILL.md` 顶部）

### 设计目标

工程化解决数据汇报 PPT 的 4 个老大难：

1. 改一个数字要重画整张图 → 数据进 xlsx / csv / json，build 自动转换
2. 上下页字号不一致、卡片对不齐 → 8 级字号 + 卡片对齐规则
3. 想换风格要逐页重做 → CSS 变量 + 5 套预设
4. AI 协作 token 爆炸 → 每页 ≤ 200 行小文件
