# Portrait / 竖屏格式 — 场景驱动的低密度汇报

> 适用：面向**手机观看**（老板手机竖握看汇报）+ **社媒公司宣传**（小红书 / 公众号 /
> 朋友圈 / 视频号）的竖屏版本。网页 / PDF / 图片三种输出都有。
>
> 与横屏（16:9，默认）并存、零冲突：竖屏全部 scope 在 `[data-format="portrait"]` 下。

## 一、核心理念：低「内容密度」、不低「有效信息密度」⭐

这是竖屏与横屏最大的区别，也是最容易做错的地方：

- **内容密度低** = 一屏**少放东西**：元素 ≤ 5、大字号、大留白、一屏**一个核心观点 + 一个视觉锚**。
- **有效信息密度不低** = 每个元素都**有信号、不放水**：那个大数字、那句结论、那张图，都得是干货。

> 反例：把横屏那种「一页 12 个卡片 + 4 张图」直接竖过来 → 手机上糊成一团，划两下就走。
> 正例：一张卡 = 一个 68% + 一句「为什么」。像一张好的小红书图：一眼看完、愿意截图转发。

手机上字要够大：竖屏设计稿宽 1080，手机上缩到 ~0.36，所以**字号要比横屏放大约 2.5×**
（已在 `portrait.css` 的 `--fs-*` 里定好，照用即可）。

## 二、工作流：先问「发哪儿」，再按场景出图 ⭐

竖屏的尺寸 / 页面模型 / 导出形态**由发布场景决定**。所以做竖屏汇报时：

**Step 1 — 先问用户本次的目标场景**（不要默认）：
> 「这次发哪儿？小红书图文 / 公众号长图 / 朋友圈 / 老板手机看 / 视频号封面？」

**Step 2 — 查场景规格表 [`assets/presets.json`](../assets/presets.json) 取规格**：

| 场景 | 比例 | 标准尺寸 | 页面模型 | 导出 |
|---|---|---|---|---|
| 小红书 · 图文（默认） | 3:4 | 1242×1656 | 离散卡 | 逐张 PNG + 网页 |
| 小红书 · 方图 | 1:1 | 1080×1080 | 离散卡 | 逐张 PNG |
| 公众号 · 长图 | 自适应 | 1080×N | 长图 | 单张长 PNG + 网页 |
| 公众号 · 图文卡 | 3:4 | 1080×1440 | 离散卡 | 逐张 PNG |
| 朋友圈 | 4:5 | 1080×1350 | 离散卡 | 逐张 PNG |
| 手机全屏汇报 | 9:16 | 1080×1920 | 离散卡 | 网页 + PDF |
| Stories / 视频号封面 | 9:16 | 1080×1920 | 离散卡 | 逐张 PNG |
| 竖屏 PDF（通用） | 3:4 | 1080×1440 | 离散卡 | PDF + 网页 |

中文别名也认（`小红书`/`公众号`/`朋友圈`/`手机汇报`/`视频号`…），见 presets.json 的 `scenario_aliases`。

**Step 3 — 按规格生产**：改 `shell-portrait.html` 的 `--design-w/h` 为该场景尺寸 → 选竖屏模板写内容 → build → 用 `export_images.py --preset <场景>` 精准出图。

## 三、竖屏模板（低密度，slides-templates/portrait/）

| 模板 | 用途 | 一屏放什么 |
|---|---|---|
| `cover.html` | 封面 / 首图钩子 | 钩子大标题 + 一句副标题 + 品牌页脚（+ 幽灵大字装饰）。**决定点开率** |
| `big-number.html` | 单巨型数字 | 一个数字（占屏中央）+ 它是什么 + 一句解读。最大冲击 |
| `list.html` | 3~5 项要点 | 每项一行：序号 + 标题 + 一句说明 + 右侧大数字。**最多 5 项，多了拆页** |
| `single-chart.html` | 单图表卡 | 一个标题 + 一张占满中部的图 + 一句结论。**只放一个图** |
| `quote.html` | 金句 / 大结论 | 整屏一句话，关键词高亮。让人记住、愿意转发 |
| `section.html` | 章节分隔 | 大章节号 + 章节标题 + 一句导语。给长内容分段、给读者喘口气 |
| `end.html` | 结尾 / 小结 + CTA | 一句带走的判断 + 行动号召（关注/转发）+ 品牌页脚 |
| `comparison.html` | A vs B 对比 | 两栏对比（对象 + 大数字 + 说明），胜方描边强调 + 一句结论 |
| `timeline.html` | 竖向时间线 | 3~4 个里程碑：日期 + 节点 + 一句说明。复盘历程 / 路线图 |
| `image-text.html` | 上图下文 | 上 60% 视觉区（换真实 `<img>`）+ 下方标题正文。小红书经典版式 |

模板是骨架：拷成 `src/slides/slide-N.html`，`sN` 改页号，改文案即可。图表模板尾部内联
`<script>` 由 build.py 自动抽取；图表字号已按竖屏放大（轴标签 22px 起）。

**章节节奏建议**（小红书 4~9 张）：封面钩子 → 大数字/金句开场 → 2~4 张要点/图表 → 金句收尾。

## 四、构建与导出

```bash
# 1. 竖屏项目：用竖屏 shell + portrait.css
cp <skill>/assets/shell-portrait.html  src/shell.html
cp <skill>/assets/styles/portrait.css  src/styles/portrait.css   # build.py 会自动纳入

# 2. 按场景设画幅（改 src/shell.html 的 body 行 --design-w/h）。例：小红书
#    style="--design-w: 1242px; --design-h: 1656px;"

# 3. 写内容 → 构建
python3 build.py

# 4. 按场景导出（尺寸/形态自动取 presets.json）
python3 export_images.py dist/*.html --preset 小红书      # → 逐张 3:4 PNG
python3 export_images.py dist/*.html --preset 公众号      # → 一张长图
python3 export_images.py dist/*.html --preset 手机汇报 --mode pdf   # → 竖屏 PDF
python3 export_images.py dist/*.html --size 1080x1920 --mode images # → 显式尺寸
```

`export_images.py` 不给 `--preset/--size` 时，自动读 deck 的 `--design-w/h`，逐张 PNG。

> **⭐ 一套内容 → 多场景**：给了 `--preset/--size` 时，`export_images.py` 会**按目标比例重新渲染** deck
> （竖屏模板用 flex 自适应高度，自动重排）。所以**同一份内容**能精准产出 3:4 小红书 / 9:16 全屏 / 1:1 方图——
> 不用为每个平台重做。这就是「场景驱动」：先把内容写好，用户说发哪儿，就出哪个规格的图。

## 五、设计铁律（踩坑预防）

1. **一屏一个锚**：一张卡只讲一件事。要讲两件 → 拆两张卡（竖屏卡很便宜，多几张无所谓）。
2. **字号别缩**：竖屏字号是为手机定的，别因为「桌面预览看着大」就调小——手机上正好。
3. **列表 ≤ 5 项**：超了拆页。每项一行，别让一项换行成两三行。
4. **图表只放一个**：竖屏一张卡放一个图就够；要对比就两张卡或用 100% 堆叠一张图。
5. **封面是命门**：小红书/朋友圈第一张决定点开率——大标题给钩子、给反差数字，别平铺直叙。
6. **画幅由场景定，不要拍脑袋**：先问发哪儿，再查 presets.json。9:16 发小红书会被裁、3:4 发 Stories 会留黑边。
7. **`--design-w/h` 设在 `<body>` 上**（不是 :root）——fitCanvas 和 export 都从 body 读；横屏 body 继承 :root 不受影响。

---

> 配套：`assets/presets.json`（场景规格表）· `assets/styles/portrait.css`（设计系统）·
> `assets/shell-portrait.html`（竖屏 shell）· `assets/slides-templates/portrait/`（模板）·
> `assets/export_images.py`（图片/长图/PDF 导出）。横屏默认格式见 `architecture.md`。
