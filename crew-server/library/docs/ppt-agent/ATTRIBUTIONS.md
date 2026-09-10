# Attributions

本项目大量借鉴了开源社区的优秀工作。以下是关键 attributions（按贡献量排序）：

---

## sunbigfly/ppt-agent-skills (MIT License)

**仓库**：https://github.com/sunbigfly/ppt-agent-skills
**作者**：sunbigfly
**许可**：MIT License (Copyright © 2025 sunbigfly)

### 直接复制的资源（91 个 markdown + 12 个 Python 脚本）

**references 目录**：

| 子目录 | 文件数 | 内容 |
|--------|-------|------|
| `principles/` | 9 | 8 个设计原则文件（cognitive-load / color-psychology / composition / data-visualization / design-principles-cheatsheet / narrative-arc / runtime-failure-modes / visual-hierarchy）+ README |
| `design-runtime/` | 6 | css-weapons / data-type-decoration-mapping / data-type-visual-mapping / design-specs / director-command-rules / director-command-examples |
| `blocks/` | 9 | 卡片原型库（card-styles / comparison / diagram / image-hero / matrix-chart / people / quote / timeline）+ README |
| `page-templates/` | 4 | cover / end / section / toc |
| `layouts/` | 11 | 10 layout 各成文件（asymmetric / hero-top / l-shape / mixed-grid / primary-secondary / single-focus / symmetric / t-shape / three-column / waterfall）+ README |
| `playbooks/` | 11 | 每步执行手册（outline-phase1/2 / research-phase1/2 / source-phase1/2 / style-phase1/2 / step4 page-html/planning/review）|
| `prompts/` | 23 | 模块化 Prompt 模板（按 step + module + tpl 拆分）|
| 根 | 2 | `references/README.md` + `cli-cheatsheet.md` |

**scripts 目录**：

| 文件 | 行数 | 用途 |
|------|------|------|
| `contract_validator.py` | ~44K | 各 phase 间的 JSON 合同校验 |
| `planning_validator.py` | ~30K | 策划稿 schema 校验 |
| `visual_qa.py` | ~25K | 视觉 QA（planning + html 双层断言）|
| `smoke_skill.py` | ~71K | 完整端到端冒烟测试 |
| `subagent_logger.py` | ~5K | 多 agent 协作日志 |
| `milestone_check.py` | ~13K | 阶段里程碑检查 |
| `resource_loader.py` | ~17K | 动态资源加载（按 layout_hint / card_type / chart_type 路由）|
| `prompt_harness.py` | ~5K | Prompt 模板渲染框架 |
| `check_skill.py` | ~15K | 文档/代码合同漂移检查 |
| `html2png.py` | ~6K | HTML → PNG 备用管线 |
| `png2pptx.py` | ~2K | PNG → PPTX 备用管线 |
| `workflow_versions.py` | ~1K | 跨脚本版本号定义 |

**总计借鉴**：约 245 KB markdown 文档 + 约 232 KB Python 代码。

### 借鉴的概念

- **资源路由表** (`layout_hint→layouts/`, `page_type→page-templates/`, `card_type→blocks/`, `chart_type→charts/`)
- **density_contract / density_label** 页面密度合同概念
- **visual_qa 双层断言** (planning + html 两层校验)
- **subagent 强制调度** + **上下文隔离** 模式
- **prompt_harness** 强制模板化 Prompt 生成
- **失败模式目录** 的 8 模式分类法（早期已借鉴到 [`references/principles/failure-modes.md`](references/principles/failure-modes.md)）
- **多阶段 orchestrator** 协议（phase1 → phase2 → phase3）

### 我们的原创贡献（在 sunbigfly 基础上的扩展）

| 维度 | sunbigfly | 我们 |
|------|-----------|------|
| **预置风格** | 8 | **26** (升级 8 + 新增 18) |
| **风格分类** | 单一列表 | **5 板块**（暗色专业 / 浅色高级 / 活力鲜明 / 东方文化 / 自然复古）|
| **风格 Mock** | 无 | **26 张 1280×720 标杆 mock HTML**（对标 Linear / Anthropic / Stripe / Apple / NYT 等）|
| **PNG 截图** | 无 | **26 张 PNG**（puppeteer 高清渲染）|
| **图表分级** | 13 种平铺 | **18 种分 3 层级**（基础 8 + 进阶 6 + ECharts 级 4）|
| **ECharts 级图表** | 无 | 世界地图 choropleth / 关系网络 / 桑基图 / 热力日历 |
| **排版铁律** | 弱 | [`typography.md`](references/typography.md) 14 条（字距 / tabular-nums / OpenType / serif italic 混排 / 字体栈三层降级）|
| **风格预览画廊** | 无 | [`gallery.py`](scripts/gallery.py) + [`style-gallery/index.html`](ppt-output/style-gallery/) 卡片墙 |
| **Hero 拼图** | 无 | [`build_hero.py`](scripts/build_hero.py) + 5 板块拼图（README 用）|
| **架构图** | 无 | [`assets/architecture.svg`](assets/architecture.svg) 自制可视化 |
| **README 包装** | 简洁 | logo + banner + 5 hero 拼图 + 架构图 + 实时 badges + star history |

### 致谢

非常感谢 sunbigfly 在 PPT Agent 工程化方面的开创性工作。我们的 design 深度建立在他们的 engineering 严谨性之上。

如果你需要更"工程化"、validators 更深、更多 prompt 变体的版本，请直接使用原版：https://github.com/sunbigfly/ppt-agent-skills

---

## 字体（Google Fonts，OFL/Apache 2.0）

各风格使用的 Web 字体均通过 Google Fonts CDN 引入：

- **Inter / Inter Tight** ([rsms/inter](https://github.com/rsms/inter), OFL) — 现代 sans 主力
- **Source Serif 4** (Adobe, OFL) — 编辑器 serif
- **Instrument Serif** (Instrument Studio, OFL) — italic 关键词混排
- **Fraunces** (Undercase Type, OFL) — 暖色 serif
- **Playfair Display** (Claus Eggers Sørensen, OFL) — 时尚奢华 serif
- **Noto Serif SC / JP** (Google, OFL) — CJK 衬线
- **JetBrains Mono** (JetBrains, OFL) — 终端 mono
- **Quicksand** (Andrew Paglinawan, OFL) — 儿童圆润
- **Bagel Fat One** (FENGARDO, OFL) — 70s 复古粗壮

---

## 设计参照

排版做法来自实际品牌官网 CSS 阅读（**不参与代码授权，仅作设计灵感**）：

Linear / Anthropic / Stripe / Apple / OpenAI / Vercel / NYT Magazine / Pitch / Mercury / Arc / Tom Ford / Notion / Patagonia / National Geographic / Mayo Clinic / Suisse Int'l / Bauhaus / Cyberpunk 2077 / iOS 26 / Wes Anderson / 北京冬奥开幕式 / Apple Keynote 等。

---

## License

本项目采用 [MIT License](LICENSE)。

借鉴的所有 sunbigfly 文件保留其原始 MIT 许可。
