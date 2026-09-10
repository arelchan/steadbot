<div align="center">
  <img src="assets/logo.svg" alt="PPT Agent Skill" width="120" />

  <h1>PPT Agent Skill</h1>

  <p><strong>世界级 AI 演示文稿生成系统</strong> · 把一句话变成 PPT 设计公司级别的成品</p>

  <p>
    <a href="README_EN.md">English</a> ·
    <a href="#-快速开始">快速开始</a> ·
    <a href="#-26-风格预览画廊">风格画廊</a> ·
    <a href="#-工作流">工作流</a> ·
    <a href="#-架构">架构</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/styles-26-22D3EE?style=for-the-badge&labelColor=050b1f" alt="26 Styles" />
    <img src="https://img.shields.io/badge/charts-18-6366f1?style=for-the-badge&labelColor=050b1f" alt="18 Charts" />
    <img src="https://img.shields.io/badge/categories-5-FF9500?style=for-the-badge&labelColor=050b1f" alt="5 Categories" />
    <img src="https://img.shields.io/badge/pipeline-6_steps-22c55e?style=for-the-badge&labelColor=050b1f" alt="6-step Pipeline" />
  </p>

  <p>
    <a href="https://github.com/Akxan/ppt-agent-skill/stargazers"><img src="https://img.shields.io/github/stars/Akxan/ppt-agent-skill?style=for-the-badge&color=FFD700&labelColor=050b1f&logo=github&logoColor=white" alt="GitHub Stars" /></a>
    <a href="https://github.com/Akxan/ppt-agent-skill/network/members"><img src="https://img.shields.io/github/forks/Akxan/ppt-agent-skill?style=for-the-badge&color=22D3EE&labelColor=050b1f&logo=github&logoColor=white" alt="GitHub Forks" /></a>
    <a href="https://github.com/Akxan/ppt-agent-skill/watchers"><img src="https://img.shields.io/github/watchers/Akxan/ppt-agent-skill?style=for-the-badge&color=A855F7&labelColor=050b1f&logo=github&logoColor=white" alt="GitHub Watchers" /></a>
    <a href="https://github.com/Akxan/ppt-agent-skill/issues"><img src="https://img.shields.io/github/issues/Akxan/ppt-agent-skill?style=for-the-badge&color=22c55e&labelColor=050b1f&logo=github&logoColor=white" alt="Issues" /></a>
  </p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Akxan/ppt-agent-skill?style=flat-square&color=000" alt="MIT License" /></a>
    <img src="https://img.shields.io/github/last-commit/Akxan/ppt-agent-skill?style=flat-square&color=blue&logo=git&logoColor=white" alt="Last commit" />
    <img src="https://img.shields.io/github/repo-size/Akxan/ppt-agent-skill?style=flat-square&color=orange" alt="Repo size" />
    <img src="https://img.shields.io/github/languages/top/Akxan/ppt-agent-skill?style=flat-square&color=8b5cf6" alt="Top language" />
    <img src="https://img.shields.io/badge/python-≥3.8-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
    <img src="https://img.shields.io/badge/node-≥18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
    <img src="https://img.shields.io/badge/PPTX-editable-D24726?style=flat-square&logo=microsoftpowerpoint&logoColor=white" alt="PPTX" />
    <img src="https://img.shields.io/badge/Claude%20Code-skill-D97757?style=flat-square" alt="Claude Code Skill" />
  </p>

  <p>
    <strong>对标</strong>
    <code>Linear</code> · <code>Anthropic</code> · <code>Stripe</code> · <code>Apple</code> · <code>NYT Magazine</code> · <code>Tom Ford</code> · <code>Pitch</code> · <code>Mercury</code> · <code>Vercel</code>
  </p>
</div>

---

<div align="center">
  <img src="assets/hero-all.png" alt="26 风格预览" width="100%" />
  <p><sub>26 个世界级风格 · 5 板块覆盖所有商业场景 · 真实 1280×720 标杆 mock</sub></p>
</div>

---

## 💡 这是什么？

一个 **Claude Code Skill**，模拟万元/页 PPT 设计公司的完整工作流，把一句话变成专业级演示文稿（HTML + 可编辑矢量 PPTX）。

不是"给个大纲套模板"，而是**先调研后生成 / 内容驱动版式 / 全局风格一致 / 真实数据填充**的完整管线。

每个风格的视觉水准对标实际世界级品牌的官网/产品页排版做法（**不是参考截图，是参考实际 CSS 实现**）：字距铁律 / tabular-nums / OpenType 特性 / serif italic 混排 / 字体栈三层降级。

## 🎨 核心特性

| 特性 | 说明 |
|------|------|
| **6 步 Pipeline** | 需求调研 → 资料搜集 → 大纲策划 → 策划稿 → HTML 设计稿 → 后处理（SVG + PPTX）|
| **26 种世界级风格** | 5 板块覆盖：暗色专业 7 / 浅色高级 8 / 活力鲜明 4 / 东方文化 3 / 自然复古 4 |
| **18 种数据可视化** | 基础 8 + 进阶 6（雷达/时间线/漏斗/仪表盘）+ ECharts 级 4（世界地图/关系网络/桑基/热力日历）|
| **Bento Grid 布局** | 7 种卡片式灵活布局，内容驱动版式 |
| **世界级排版** | 7 级字号阶梯 · 字距铁律 · tabular-nums · OpenType 特性 · serif italic 混排 · 字体栈三层降级 |
| **智能配图** | AI 生成配图 + 5 种视觉融入技法（渐隐融合/色调蒙版/氛围底图等）|
| **失败模式目录** | 8 种 failure modes（underfill / decorative_substitution 等）+ 修复顺序铁律 |
| **跨页叙事** | 密度交替节奏 / 章节色彩递进 / 封面-结尾呼应 / 渐进揭示 |
| **风格预览画廊** | `gallery.py` 一键生成 26 风格卡片墙索引页 |
| **Smoke 测试** | `smoke_test.py` 校验风格 JSON / pipeline 兼容 / 排版铁律 / 端到端管线 |
| **PPTX 兼容** | HTML → SVG → PPTX 管线，PPT 365 中右键"转换为形状"全部可编辑 |

## 🚀 快速开始

**作为 Claude Code Skill 调用**（推荐）：

```
你：帮我做一个关于 X 的 PPT
  ↓
Agent 提问调研需求（等你回复 7 题）
  ↓
自动搜索资料 → 生成大纲 → 策划稿 → 逐页设计 HTML
  ↓
自动后处理：HTML → SVG → PPTX
  ↓
全部产物保存到 ppt-output/
```

**触发示例**：

| 场景 | 说法 |
|------|------|
| 纯主题 | `做一个关于 X 的 PPT` / `做一个 Y 的演示` |
| 带素材 | `把这篇文档做成 PPT` / `用这份报告做 slides` |
| 带要求 | `做 15 页暗黑科技风的 AI 安全汇报材料` |
| 隐式触发 | `我要给老板汇报 Y` / `做个培训课件` / `做路演 deck` |

**环境依赖**：

```bash
# Python 依赖
pip install python-pptx lxml Pillow

# Node.js >= 18，puppeteer 在首次 html2svg.py 运行时自动安装
```

## 🎨 26 风格预览画廊

5 个板块，覆盖所有典型商业场景。每个 mock 都是真实 1280×720 设计稿：

### 暗色专业（7 风格 · `references/styles/dark.md`）

<div align="center">
  <img src="assets/hero-dark-professional.png" alt="暗色专业 7 风格" width="100%" />
</div>

> Linear / Apple Hardware / Tom Ford / Cyberpunk 2077 / Y2K / Magnum 等品牌的实际排版做法

| ID | 灵感 | 适用场景 |
|----|------|---------|
| `dark_tech` | Linear.app | AI / SaaS / 开发者工具 |
| `xiaomi_orange` | Apple Keynote 硬件版 | 硬件 / IoT / 汽车发布 |
| `luxury_purple` | Tom Ford | 奢侈品 / 高端品牌 |
| `nocturne_violet` | Linear 紫光版 | 设计师 SaaS / 创业产品 |
| `cyberpunk_neon` | Cyberpunk 2077 | 电竞 / 游戏 / Web3 |
| `chrome_y2k` | Y2K / Vaporwave | Web3 / 千禧年复古 |
| `noir_film` | Magnum / 黑白纪录片 | 纪录片 / 影像艺术 / 摄影 |

### 浅色高级（8 风格 · `references/styles/light.md`）

<div align="center">
  <img src="assets/hero-light-premium.png" alt="浅色高级 8 风格" width="100%" />
</div>

> Apple / Anthropic / NYT Magazine / iOS 26 / Mayo Clinic / Suisse Int'l / 婚礼请柬

| ID | 灵感 | 适用场景 |
|----|------|---------|
| `blue_white` | Apple 企业页面 | 企业 SaaS / 培训 / 金融医疗 |
| `fresh_green` | Aesop | 护肤 / 养生 / 食品 / 美妆 |
| `minimal_gray` | NYT Magazine | 学术 / 法务 / 咨询 / 白皮书 |
| `mocha_editorial` | Anthropic / Pantone 2025 | AI 安全研究 / 出版 |
| `medical_pulse` | Mayo Clinic | 医疗 / 医药 / 健康保险 |
| `earth_concrete` | Suisse Int'l | 建筑 / 工业 / 咖啡品牌 |
| `champagne_gold` | 婚礼请柬 | 婚庆 / 宴会 / 颁奖典礼 |
| `liquid_glass` | iOS 26 / visionOS | XR / AR / 苹果生态发布 |

### 活力鲜明（4 风格 · `references/styles/vibrant.md`）

<div align="center">
  <img src="assets/hero-vibrant.png" alt="活力鲜明 4 风格" width="100%" />
</div>

| ID | 灵感 | 适用场景 |
|----|------|---------|
| `vibrant_rainbow` | Stripe Sessions | 营销 / 创作者 / 大会 |
| `kindergarten_pop` | 高质量儿童绘本 | 儿童教育 / 启蒙 / 亲子 |
| `bauhaus_block` | Bauhaus / Swiss Design | 教育 / 创意品牌 / 独立设计 |
| `candy_pastel` | Ladurée 糖果店 | 甜品 / 烘焙 / 零食 |

### 东方文化（3 风格 · `references/styles/cultural.md`）

<div align="center">
  <img src="assets/hero-cultural-oriental.png" alt="东方文化 3 风格" width="80%" />
</div>

| ID | 灵感 | 适用场景 |
|----|------|---------|
| `royal_red` | 北京冬奥开幕式 | 中国风 / 政务 / 文化 |
| `sakura_wabi` | 日本侘寂 | 日系 / 茶道 / 民宿 |
| `ink_jade` | 新中式国潮 | 茶饮 / 古风文创 / 独立书店 |

### 自然/复古（4 风格 · `references/styles/natural.md`）

<div align="center">
  <img src="assets/hero-natural-retro.png" alt="自然/复古 4 风格" width="100%" />
</div>

| ID | 灵感 | 适用场景 |
|----|------|---------|
| `botanic_forest` | Patagonia / Nat Geo | 户外 / 可持续 / 林产 |
| `safari_savanna` | National Geographic | 旅行 / 探险 / 纪录片 |
| `retro_70s` | Wes Anderson / 70s 海报 | 独立咖啡 / 唱片 / 复古 |
| `gov_authority` | 人民日报 / 国宴 | 党政 / 重大会议 / 严肃汇报 |

## 📈 18 种数据可视化

| 层级 | 数量 | 图表 | 文件 |
|------|------|------|------|
| **基础** | 8 | 进度条 · 对比柱 · 环形图 · 迷你折线 · 点阵图 · KPI 卡 · 指标行 · 评分 | [`charts/basic.md`](references/charts/basic.md) |
| **进阶** | 6 | 雷达图 · 时间线 · 漏斗图 · 仪表盘 · 多组对比柱 · 简单地理 | [`charts/advanced.md`](references/charts/advanced.md) |
| **ECharts 级** | 4 | 世界地图 choropleth · 关系网络 · 桑基图 · 热力日历 | [`charts/complex.md`](references/charts/complex.md) |

全部纯 HTML/CSS/SVG 实现，**无 JS 运行时**（保证 svg2pptx 管线兼容）。所有图表自动适配 26 风格的 CSS 变量。

## 🔧 工作流

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Step 1      │  │  Step 2      │  │  Step 3      │  │  Step 4      │  │  Step 5      │  │  Step 6      │
│  需求调研    │→ │  资料搜集    │→ │  大纲策划    │→ │  策划稿      │→ │  风格+设计稿 │→ │  后处理      │
│              │  │              │  │              │  │              │  │              │  │              │
│  7 题三层    │  │  3-15 查询   │  │  金字塔原理  │  │  Bento Grid  │  │  26 风格选 1 │  │  HTML→SVG    │
│  递进访谈    │  │  自适应      │  │  + 自检      │  │  策划卡      │  │  + 智能配图  │  │  →PPTX       │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
   STOP 等回复                                            建议等确认           按 Part 分批         自动执行
```

详细流程见 [`SKILL.md`](SKILL.md)。

## 🏗 系统架构

<div align="center">
  <img src="assets/architecture.png" alt="系统架构图" width="100%" />
  <p><sub>3 层架构：用户入口 / 6 步 Pipeline / 输出产物 · 5 大 Reference Library 注入到各步</sub></p>
</div>

**3 层架构**：

- **TIER 1 · 入口** — 用户一句话 prompt 触发 [SKILL.md](SKILL.md)（Agent 入口主流程指令）；引用 `references/` 下的所有规则文件
- **TIER 2 · 6 步 Pipeline** — 每步独立 STEP，前后用 JSON 合同传递；每步可见使用的 reference 文件
- **TIER 3 · 输出** — 4 种最终产物：翻页 HTML / 矢量 SVG / 可编辑 PPTX / 风格预览画廊

**Reference Library**（注入到各步）：

| 模块 | 数量 | 位置 |
|------|------|------|
| 📐 Style Library | 26 风格 | `references/styles/` (5 板块) |
| 📊 Chart Library | 18 图表 | `references/charts/` (3 层级) |
| 🔤 Typography | 14 铁律 | `references/typography.md` |
| ⚠ Failure Modes | 8 模式 | `references/principles/failure-modes.md` |
| 🎨 Bento Grid | 7 布局 | `references/bento-grid.md` |

## 📂 文件树

```
ppt-agent-skill/
├── SKILL.md                      # 主工作流指令（Agent 入口）
├── README.md / README_EN.md      # 本文件 / English
├── assets/                       # 视觉资产
│   ├── logo.svg                  # Logo
│   ├── banner.svg                # README 横幅
│   ├── hero-all.png              # 26 风格全景拼图
│   └── hero-<category>.png       # 5 板块单独拼图
├── references/                   # Skill 引用文档
│   ├── prompts.md                # 5 套 Prompt 模板（调研/大纲/策划/设计/备注）
│   ├── typography.md             # 世界级排版铁律 14 条
│   ├── bento-grid.md             # 7 种布局规格 + 卡片类型
│   ├── pipeline-compat.md        # HTML→SVG→PPTX 管线兼容规则
│   ├── method.md                 # 核心方法论
│   ├── style-system.md           # 引导文件（兼容旧引用）
│   ├── styles/                   # 26 风格按 5 板块分目录
│   │   ├── index.md              # 索引 + 决策矩阵 + JSON Schema
│   │   ├── dark.md               # 7 暗色专业
│   │   ├── light.md              # 8 浅色高级
│   │   ├── vibrant.md            # 4 活力鲜明
│   │   ├── cultural.md           # 3 东方文化
│   │   └── natural.md            # 4 自然/复古
│   ├── charts/                   # 18 种图表
│   │   ├── index.md              # 决策矩阵
│   │   ├── basic.md              # 8 种基础
│   │   ├── advanced.md           # 6 种进阶
│   │   └── complex.md            # 4 种 ECharts 级
│   └── principles/
│       └── failure-modes.md      # 8 种 failure modes + 修复顺序
├── scripts/                      # 后处理 + 工具
│   ├── html_packager.py          # 多页 HTML → 翻页预览
│   ├── html2svg.py               # HTML → SVG（dom-to-svg, 文字可编辑）
│   ├── svg2pptx.py               # SVG → PPTX（OOXML 原生）
│   ├── gallery.py                # 生成 26 风格预览画廊 + 截图
│   ├── build_hero.py             # 生成 README hero 拼图
│   └── smoke_test.py             # 端到端测试 + pipeline-compat 扫描
├── ppt-output/
│   └── style-gallery/            # 26 个 1280×720 mock + 26 PNG + index.html
├── docs/superpowers/specs/       # 设计文档归档
└── tests/smoke-results/          # 测试报告归档
```

## 🧪 质量保证

```bash
# 风格 JSON 校验 + pipeline-compat 扫描 + 排版自检（26 风格）
python3 scripts/smoke_test.py --phase 1
# → 52 pass / 0 fail / 0 warn

# 端到端管线（HTML→SVG→PPTX，3 风格代表性测试）
python3 scripts/smoke_test.py --phase 5
# → 6 pass / 0 fail（preview.html + svg/*.svg + presentation.pptx 三种产物全部生成）
```

## 🌟 世界级标杆参照系

排版做法参考的实际品牌（**不是看截图模仿，是阅读其官网 CSS**）：

| 类别 | 品牌 | 学到了什么 |
|------|------|-----------|
| 暗色 SaaS | [Linear](https://linear.app) | Inter Tight 紧凑字距 + 紫色辉光 + serif italic 关键词混排 |
| AI 编辑器 | [Anthropic](https://anthropic.com) | Mocha Mousse 米色 + Source Serif italic + 砖红强调线 |
| 渐变高级感 | [Stripe](https://stripe.com) | 多层 linear-gradient + 玻璃球（多层 radial-gradient + 内阴影）|
| 极简白 | [Apple](https://apple.com) | SF Pro 字体栈 + 大留白 + 内框线条 |
| 全息镭射 | [OpenAI](https://openai.com) | 纯黑底 + 全息球 + 极简留白 |
| 极致黑白 | [Vercel](https://vercel.com) | Geist Sans + 几何分割 + monospace 终端语义 |
| 杂志感 | NYT Magazine | masthead + 巨型 serif + 三栏分栏 + 首字下沉 |
| 演示工具 | [Pitch](https://pitch.com) | 大胆排版 + 全屏色块 + 拼贴感 |
| 金融 serif | [Mercury](https://mercury.com) | SangBleu serif 大标题 + 极简金融感 |
| 浏览器渐变 | [Arc](https://arc.net) | 渐变彩色 + 圆角图标 + 创意拼贴 |
| 时尚奢华 | Tom Ford | Didot italic + 黑金 + 居中对称 + 0.65em 字距 |
| 友好编辑器 | [Notion](https://notion.so) | Lyon Display + 米白 + emoji 系统 |

## 📄 设计文档

完整的世界级重做设计文档：[`docs/superpowers/specs/2026-05-10-world-class-redesign-design.md`](docs/superpowers/specs/2026-05-10-world-class-redesign-design.md)

包含：目标与动机 / 26 风格列表 / JSON Schema 升级 / 字体栈策略 / 排版铁律 / 图表系统设计 / 风格预览画廊 / 文件组织架构 / 向后兼容保证 / 5 阶段实施路线 / 成功标准 / 决策日志。

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#Akxan/ppt-agent-skill&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Akxan/ppt-agent-skill&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Akxan/ppt-agent-skill&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Akxan/ppt-agent-skill&type=Date&theme=dark" width="100%" />
    </picture>
  </a>
  <p><sub>实时生成 · 由 <a href="https://star-history.com">star-history.com</a> 提供 · 自动适配深色/浅色主题</sub></p>
</div>

## 🤝 贡献

欢迎提 Issue / PR：
- **新增风格**：在对应 `references/styles/<category>.md` 追加 JSON 定义 + 在 `ppt-output/style-gallery/<id>.html` 写 1280×720 mock
- **新增图表**：在 `references/charts/<level>.md` 追加 HTML 模板
- **改进文档**：欢迎 typo 修复、用法说明补充

提交前跑一下 `python3 scripts/smoke_test.py` 确保通过。

## 📜 许可证

[MIT](LICENSE)

---

<div align="center">
  <sub>Built with ❤️ for <a href="https://claude.com/claude-code">Claude Code</a> · MMXXVI</sub>
</div>
