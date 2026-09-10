# 基础图表（8 种 · 复制即用）

> 本文档收录 8 种基础图表的世界级 HTML 模板。所有模板：
>
> - **纯 HTML/CSS/SVG**，无任何 JS 运行时依赖
> - **CSS 变量驱动**（`--accent-1`, `--card-bg-from` 等），自动适配 26 风格
> - **数字 `tabular-nums`**，PPT 中数字不跳动
> - **SVG 内零 `<text>`**，所有标签用 HTML `<div>`/`<span>` 绝对定位叠加（防偏移铁律）
> - **环形图用 `stroke-dasharray="弧长 圆周"` 两值格式**，禁止 `stroke-dashoffset`
> - **三角形/箭头用 SVG `<polygon>`**，禁止 CSS border 三角形
> - **禁止** `conic-gradient` / `mask-image` / `mix-blend-mode` / `background-clip: text`（详见 [pipeline-compat.md](../pipeline-compat.md)）

每个模板已在 dark / light / editorial 三类风格下用 puppeteer 截图验证，无渲染错误。

---

## 目录

1. [进度条 Progress Bar](#1-进度条-progress-bar) — 单一百分比 / 完成度
2. [对比柱 Compare Bar](#2-对比柱-compare-bar) — 两项或多项对比（最多 6 条）
3. [环形图 Ring Chart](#3-环形图-ring-chart) — 百分比 + 中心 KPI（最多 3 环）
4. [迷你折线 Sparkline](#4-迷你折线-sparkline) — 趋势方向（120×40px 嵌入式）
5. [点阵图 Waffle Chart](#5-点阵图-waffle-chart) — 比例直觉化（10×10 = 100 格）
6. [KPI 指标卡 KPI Card](#6-kpi-指标卡-kpi-card) — 大数字 + 趋势箭头 + 同比
7. [指标行 Metric Row](#7-指标行-metric-row) — 多指标垂直堆叠（3-6 行）
8. [评分指示器 Rating](#8-评分指示器-rating) — 5 分制（含半星）

---

## 1. 进度条 (progress_bar)

**何时用**：单一百分比 / 完成度 / 单维进度（如 "客户满意度 87%"、"项目完成度 64%"、"目标达成 92%"）。当只有一个百分比指标，且需要直观展示填充感时，进度条比环形图更省空间。

**数据格式**：

```json
{
  "type": "progress_bar",
  "value": 87,
  "label": "客户满意度",
  "target": 100,
  "unit": "%"
}
```

**HTML 模板**（直接复制即可）：

```html
<div class="chart-progress" style="
  width: 360px;
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01','cv11';
">
  <div style="
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 10px;
  ">
    <span style="
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-secondary);
      font-weight: 600;
    ">客户满意度</span>
    <span style="
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums proportional-nums;
      color: var(--text-primary);
    ">87<span style="font-size: 13px; opacity: 0.55; margin-left: 2px;">%</span></span>
  </div>

  <div style="
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: var(--card-bg-from);
    overflow: hidden;
    border: 1px solid var(--card-border);
  ">
    <div style="
      position: absolute; top: 0; left: 0; bottom: 0;
      width: 87%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent-1) 0%, var(--accent-2) 100%);
      box-shadow: 0 0 12px var(--accent-1);
    "></div>
  </div>

  <div style="
    display: flex; justify-content: space-between;
    margin-top: 8px;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  ">
    <span>0</span>
    <span>目标 100%</span>
  </div>
</div>
```

**变体 A：分段进度条（已完成 / 进行中 / 未完成 三色）**

```html
<div class="chart-progress-segmented" style="
  width: 360px;
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
">
  <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
    <span style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">迁移进度</span>
    <span style="font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--text-primary);">64<span style="font-size: 13px; opacity: 0.55;">%</span></span>
  </div>
  <div style="display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--card-bg-from); border: 1px solid var(--card-border);">
    <div style="width: 64%; background: linear-gradient(90deg, var(--accent-1), var(--accent-2));"></div>
    <div style="width: 22%; background: var(--accent-4); opacity: 0.55;"></div>
    <div style="width: 14%; background: transparent;"></div>
  </div>
  <div style="display: flex; gap: 18px; margin-top: 12px; font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums;">
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="width: 8px; height: 8px; border-radius: 2px; background: var(--accent-1);"></span>已完成 64%
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="width: 8px; height: 8px; border-radius: 2px; background: var(--accent-4); opacity: 0.55;"></span>进行中 22%
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="width: 8px; height: 8px; border-radius: 2px; border: 1px solid var(--card-border);"></span>未开始 14%
    </div>
  </div>
</div>
```

**变体 B：极简纤细进度条（嵌入文字段落用，高度 4px）**

```html
<div style="width: 240px;">
  <div style="height: 4px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
    <div style="height: 100%; width: 92%; border-radius: 999px; background: var(--accent-1);"></div>
  </div>
  <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums;">
    <span style="letter-spacing: 0.1em; text-transform: uppercase;">SLA 健康度</span>
    <span>92%</span>
  </div>
</div>
```

**自检**：

- [x] 数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 颜色全部用 CSS 变量（`--accent-1`, `--accent-2`, `--card-bg-from`, `--card-border`, `--text-primary`, `--text-secondary`）
- [x] 不使用 SVG（纯 div + linear-gradient）
- [x] 不在 SVG 内写 `<text>`
- [x] 无 `conic-gradient` / `mask-image` / `mix-blend-mode` / `background-clip: text`
- [x] 通过 puppeteer 渲染无错误

---

## 2. 对比柱 (compare_bar)

**何时用**：2-6 项分类指标的对比（如 "Q1 / Q2 / Q3 / Q4 营收"、"标准版 / Pro / Max 续航"、"竞品 A / B / C 市占"）。超过 6 条时用「指标行」或「多组对比柱（advanced）」。

**数据格式**：

```json
{
  "type": "compare_bar",
  "direction": "vertical",
  "items": [
    { "label": "标准版", "value": 668, "unit": "km" },
    { "label": "Pro",    "value": 825, "unit": "km" },
    { "label": "Max",    "value": 962, "unit": "km", "highlight": true }
  ]
}
```

**HTML 模板（垂直方向，最常用）**：

```html
<div class="chart-compare-bar-v" style="
  position: relative;
  width: 480px; height: 320px;
  padding: 24px 28px;
  border-radius: var(--card-radius, 8px);
  background: linear-gradient(180deg, var(--card-bg-from), var(--card-bg-to));
  border: 1px solid var(--card-border);
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01';
">
  <div style="
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--text-secondary); font-weight: 600;
    margin-bottom: 4px;
  ">— CLTC 续航对比</div>
  <div style="font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary);">三档版本一览</div>

  <div style="position: relative; height: 200px; margin-top: 24px;">
    <svg viewBox="0 0 420 200" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
      <line x1="0" y1="200" x2="420" y2="200" stroke="var(--card-border)" stroke-width="1"/>
      <line x1="0" y1="100" x2="420" y2="100" stroke="var(--card-border)" stroke-width="0.5" stroke-dasharray="2 4"/>
      <line x1="0" y1="0"   x2="420" y2="0"   stroke="var(--card-border)" stroke-width="0.5" stroke-dasharray="2 4"/>

      <rect x="40"  y="61"  width="60" height="139" rx="4" fill="var(--accent-3)" opacity="0.55"/>
      <rect x="180" y="29"  width="60" height="171" rx="4" fill="var(--accent-2)" opacity="0.75"/>
      <rect x="320" y="0"   width="60" height="200" rx="4" fill="url(#bar-grad-hi)"/>

      <defs>
        <linearGradient id="bar-grad-hi" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stop-color="var(--accent-1)"/>
          <stop offset="100%" stop-color="var(--accent-2)"/>
        </linearGradient>
      </defs>
    </svg>

    <span style="position: absolute; left: calc(40px / 420 * 100%); top: 47px; width: calc(60px / 420 * 100%); text-align: center;
      font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary);
      font-variant-numeric: tabular-nums proportional-nums;">668</span>
    <span style="position: absolute; left: calc(180px / 420 * 100%); top: 15px; width: calc(60px / 420 * 100%); text-align: center;
      font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary);
      font-variant-numeric: tabular-nums;">825</span>
    <span style="position: absolute; left: calc(320px / 420 * 100%); top: -14px; width: calc(60px / 420 * 100%); text-align: center;
      font-size: 22px; font-weight: 800; letter-spacing: -0.025em; color: var(--accent-1);
      font-variant-numeric: tabular-nums;">962</span>
  </div>

  <div style="
    display: flex; justify-content: space-between;
    margin-top: 10px; padding: 0 10px;
    font-size: 12px; color: var(--text-secondary);
    letter-spacing: 0.05em;
  ">
    <span style="width: 60px; text-align: center;">标准版</span>
    <span style="width: 60px; text-align: center;">Pro</span>
    <span style="width: 60px; text-align: center; color: var(--accent-1); font-weight: 600;">Max</span>
  </div>

  <div style="
    position: absolute; right: 28px; top: 28px;
    font-size: 10px; color: var(--text-secondary); opacity: 0.6;
    letter-spacing: 0.1em; text-transform: uppercase;
    font-variant-numeric: tabular-nums;
  ">UNIT · KM</div>
</div>
```

**变体 A：水平方向（适合分类标签较长时）**

```html
<div style="
  width: 420px;
  padding: 20px 24px;
  border-radius: 8px;
  background: linear-gradient(180deg, var(--card-bg-from), var(--card-bg-to));
  border: 1px solid var(--card-border);
  font-family: 'Inter Tight', 'Inter', sans-serif;
">
  <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600; margin-bottom: 18px;">市场份额 · 2026 Q1</div>

  <div style="display: flex; flex-direction: column; gap: 14px;">
    <div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
        <span style="color: var(--text-primary); font-weight: 500;">华为 HarmonyOS</span>
        <span style="color: var(--text-primary); font-weight: 700; font-variant-numeric: tabular-nums;">42.3%</span>
      </div>
      <div style="height: 8px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 42.3%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-1), var(--accent-2));"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
        <span style="color: var(--text-primary); font-weight: 500;">小米 HyperOS</span>
        <span style="color: var(--text-primary); font-weight: 700; font-variant-numeric: tabular-nums;">28.1%</span>
      </div>
      <div style="height: 8px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 28.1%; border-radius: 999px; background: var(--accent-2); opacity: 0.85;"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
        <span style="color: var(--text-primary); font-weight: 500;">vivo OriginOS</span>
        <span style="color: var(--text-primary); font-weight: 700; font-variant-numeric: tabular-nums;">17.6%</span>
      </div>
      <div style="height: 8px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 17.6%; border-radius: 999px; background: var(--accent-3); opacity: 0.75;"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
        <span style="color: var(--text-secondary);">其他</span>
        <span style="color: var(--text-secondary); font-weight: 500; font-variant-numeric: tabular-nums;">12.0%</span>
      </div>
      <div style="height: 8px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 12.0%; border-radius: 999px; background: var(--text-secondary); opacity: 0.4;"></div>
      </div>
    </div>
  </div>
</div>
```

**自检**：

- [x] 数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 颜色全部用 CSS 变量
- [x] **SVG 内只有 `<rect>` / `<line>`，无 `<text>`**；所有数据标签和 x 轴文字用 HTML span 绝对定位叠加
- [x] 渐变用 `<linearGradient>` 或 CSS `linear-gradient`，无 `conic-gradient`
- [x] 高亮项（Max）用 `--accent-1` 全色 + 大字号差异化突出
- [x] 通过 puppeteer 渲染无错误

---

## 3. 环形图 (ring_chart)

**何时用**：单百分比配合中心 KPI（如 "缓存命中率 75%"、"目标达成 92%"）。环形图比进度条更适合作为页面焦点元素。多环嵌套（最多 3 环）适合展示分层指标（如 "总目标 / 主推产品 / 重点客户"）。

**数据格式**：

```json
{
  "type": "ring_chart",
  "rings": [
    { "value": 75, "label": "缓存命中", "color": "accent-1" }
  ],
  "center": { "value": "75%", "label": "CACHE HIT" }
}
```

> **关键技术点**：弧长公式 `arc = 2 * pi * r * (percent / 100)`，圆周 `circumference = 2 * pi * r`。
> 例如 r=50：圆周 = 314.16，75% 对应弧长 = 235.62。
> `stroke-dasharray="235 314"` 表示画 235 长度然后留 314 长度间隔（足够长以覆盖剩余圆周）。
> **禁止用 `stroke-dashoffset`**，svg2pptx 不支持。

**HTML 模板（单环）**：

```html
<div class="chart-ring" style="
  position: relative;
  width: 200px; height: 200px;
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01';
">
  <svg viewBox="0 0 200 200" style="width: 100%; height: 100%; display: block;">
    <circle cx="100" cy="100" r="80" fill="none"
            stroke="var(--card-bg-from)" stroke-width="14"/>
    <circle cx="100" cy="100" r="80" fill="none"
            stroke="url(#ring1-grad)" stroke-width="14" stroke-linecap="round"
            stroke-dasharray="377 503"
            transform="rotate(-90 100 100)"/>
    <defs>
      <linearGradient id="ring1-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="var(--accent-1)"/>
        <stop offset="100%" stop-color="var(--accent-2)"/>
      </linearGradient>
    </defs>
  </svg>

  <div style="
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  ">
    <div style="
      font-size: 42px; font-weight: 800;
      letter-spacing: -0.035em; line-height: 1;
      color: var(--accent-1);
      font-variant-numeric: tabular-nums proportional-nums;
    ">75<span style="font-size: 22px; font-weight: 600; opacity: 0.75; margin-left: 2px;">%</span></div>
    <div style="
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--text-secondary);
      margin-top: 6px;
    ">CACHE HIT</div>
  </div>
</div>
```

**变体 A：双环嵌套（外环主指标 + 内环对比）**

```html
<div style="position: relative; width: 220px; height: 220px; font-family: 'Inter Tight', sans-serif;">
  <svg viewBox="0 0 220 220" style="width: 100%; height: 100%; display: block;">
    <circle cx="110" cy="110" r="90" fill="none" stroke="var(--card-bg-from)" stroke-width="10"/>
    <circle cx="110" cy="110" r="90" fill="none" stroke="var(--accent-1)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="481 565" transform="rotate(-90 110 110)"/>
    <circle cx="110" cy="110" r="68" fill="none" stroke="var(--card-bg-from)" stroke-width="10"/>
    <circle cx="110" cy="110" r="68" fill="none" stroke="var(--accent-3)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="269 427" transform="rotate(-90 110 110)"/>
  </svg>
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
    <div style="font-size: 28px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1;">85<span style="font-size: 14px; opacity: 0.6;">/63%</span></div>
    <div style="font-size: 9px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); margin-top: 4px;">实际 / 目标</div>
  </div>
</div>

<div style="display: flex; gap: 16px; margin-top: 14px; font-size: 11px; color: var(--text-secondary);">
  <div style="display: flex; align-items: center; gap: 6px;">
    <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--accent-1);"></span>实际 85%
  </div>
  <div style="display: flex; align-items: center; gap: 6px;">
    <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--accent-3);"></span>目标 63%
  </div>
</div>
```

**变体 B：三环嵌套（如 "总营收 / 新业务 / 海外"）**

```html
<div style="position: relative; width: 240px; height: 240px;">
  <svg viewBox="0 0 240 240" style="width: 100%; height: 100%; display: block;">
    <circle cx="120" cy="120" r="100" fill="none" stroke="var(--card-bg-from)" stroke-width="9"/>
    <circle cx="120" cy="120" r="100" fill="none" stroke="var(--accent-1)" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="565 628" transform="rotate(-90 120 120)"/>
    <circle cx="120" cy="120" r="80"  fill="none" stroke="var(--card-bg-from)" stroke-width="9"/>
    <circle cx="120" cy="120" r="80"  fill="none" stroke="var(--accent-2)" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="352 503" transform="rotate(-90 120 120)"/>
    <circle cx="120" cy="120" r="60"  fill="none" stroke="var(--card-bg-from)" stroke-width="9"/>
    <circle cx="120" cy="120" r="60"  fill="none" stroke="var(--accent-3)" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="151 377" transform="rotate(-90 120 120)"/>
  </svg>
</div>
```

**自检**：

- [x] 用 `stroke-dasharray="弧长 圆周"` 两值格式（弧长 = 2π·r·百分比/100，圆周 = 2π·r）
- [x] **不使用 `stroke-dashoffset`**
- [x] `transform="rotate(-90 cx cy)"` 让 0% 位置在 12 点钟方向
- [x] `stroke-linecap="round"` 圆角弧端
- [x] **中心文字用 HTML `<div>` 绝对定位叠加，不在 SVG 内写 `<text>`**
- [x] 大数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 颜色用 CSS 变量
- [x] 通过 puppeteer 渲染无错误

---

## 4. 迷你折线 (sparkline)

**何时用**：嵌入到 KPI 卡片或表格行内，展示短期趋势方向（无需精确数值）。标准尺寸 120×40px，可放在数字旁边作为「上下文」。当需要精确数值/坐标轴时改用全尺寸折线（advanced）。

**数据格式**：

```json
{
  "type": "sparkline",
  "values": [42, 45, 41, 48, 52, 56, 54, 61, 65, 68, 72, 78],
  "trend": "up",
  "delta": "+18.4%"
}
```

> **路径生成原则**：将 N 个值线性映射到 viewBox 的 x 轴均分点 + y 轴反转（SVG y 向下增长，但折线视觉上「上涨」需要 y 减小）。

**HTML 模板（上涨趋势 / 绿色）**：

```html
<div class="chart-sparkline" style="
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
">
  <div style="position: relative; width: 120px; height: 40px;">
    <svg viewBox="0 0 120 40" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
      <defs>
        <linearGradient id="spark-up-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="var(--accent-1)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--accent-1)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M 0 30 L 11 28 L 22 32 L 33 24 L 44 20 L 55 16 L 66 18 L 77 11 L 88 8 L 99 5 L 110 3 L 120 1 L 120 40 L 0 40 Z"
            fill="url(#spark-up-fill)"/>
      <path d="M 0 30 L 11 28 L 22 32 L 33 24 L 44 20 L 55 16 L 66 18 L 77 11 L 88 8 L 99 5 L 110 3 L 120 1"
            fill="none" stroke="var(--accent-1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="120" cy="1" r="2.5" fill="var(--accent-1)"/>
      <circle cx="120" cy="1" r="5"   fill="var(--accent-1)" opacity="0.25"/>
    </svg>
  </div>

  <div style="display: inline-flex; align-items: center; gap: 4px;">
    <svg width="10" height="10" viewBox="0 0 10 10" style="display: block;">
      <polygon points="5,1 9,8 1,8" fill="#22c55e"/>
    </svg>
    <span style="
      font-size: 12px; font-weight: 600;
      letter-spacing: -0.01em;
      color: #22c55e;
      font-variant-numeric: tabular-nums proportional-nums;
    ">+18.4%</span>
  </div>
</div>
```

**变体 A：下跌趋势（红色 + 反向箭头）**

```html
<div style="display: inline-flex; align-items: center; gap: 10px; font-family: 'Inter Tight', sans-serif;">
  <div style="position: relative; width: 120px; height: 40px;">
    <svg viewBox="0 0 120 40" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
      <defs>
        <linearGradient id="spark-down-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#ef4444" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#ef4444" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M 0 6 L 11 9 L 22 7 L 33 13 L 44 12 L 55 18 L 66 22 L 77 26 L 88 24 L 99 31 L 110 33 L 120 36 L 120 40 L 0 40 Z"
            fill="url(#spark-down-fill)"/>
      <path d="M 0 6 L 11 9 L 22 7 L 33 13 L 44 12 L 55 18 L 66 22 L 77 26 L 88 24 L 99 31 L 110 33 L 120 36"
            fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="120" cy="36" r="2.5" fill="#ef4444"/>
      <circle cx="120" cy="36" r="5"   fill="#ef4444" opacity="0.25"/>
    </svg>
  </div>
  <div style="display: inline-flex; align-items: center; gap: 4px;">
    <svg width="10" height="10" viewBox="0 0 10 10" style="display: block;">
      <polygon points="5,9 9,2 1,2" fill="#ef4444"/>
    </svg>
    <span style="font-size: 12px; font-weight: 600; color: #ef4444; font-variant-numeric: tabular-nums;">-7.2%</span>
  </div>
</div>
```

**变体 B：纯线（无填充，更克制）**

```html
<div style="width: 120px; height: 40px;">
  <svg viewBox="0 0 120 40" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
    <path d="M 0 30 L 15 28 L 30 24 L 45 26 L 60 18 L 75 20 L 90 12 L 105 9 L 120 4"
          fill="none" stroke="var(--accent-1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="120" cy="4" r="2" fill="var(--accent-1)"/>
  </svg>
</div>
```

**自检**：

- [x] **填充用 `<linearGradient>`**（半透明 0.28 → 0），不用 `mask-image` 或 CSS gradient
- [x] 端点高亮用 SVG `<circle>`（实心 2.5px + 半透明光晕 5px）
- [x] **趋势箭头用 SVG `<polygon>`**，不用 CSS border 三角形（`width: 0` 技巧禁用）
- [x] 增长率数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 上涨绿（#22c55e）/ 下跌红（#ef4444）两色为业界惯例，硬编码可接受（不参与 26 风格切换）
- [x] 折线本体颜色用 `var(--accent-1)` 跟随主题
- [x] **SVG 内无 `<text>`**
- [x] 通过 puppeteer 渲染无错误

---

## 5. 点阵图 (waffle_chart)

**何时用**：把抽象百分比变成「100 颗格子里有 N 颗亮起」的直觉感受（如 "每 100 个用户中 87 个会复购"、"100 户家庭里 23 户已配置太阳能"）。比环形图更易被非数据背景的人理解。

**数据格式**：

```json
{
  "type": "waffle_chart",
  "value": 87,
  "label": "用户复购率",
  "categories": [
    { "value": 87, "color": "accent-1", "label": "已复购" },
    { "value": 13, "color": "card-bg",  "label": "未复购" }
  ]
}
```

> **生成原理**：100 格 = 10 行 × 10 列 grid，前 N 格亮色填充，剩余 100-N 格用低对比色。Python 一行生成：`["on" if i < 87 else "off" for i in range(100)]`

**HTML 模板**：

```html
<div class="chart-waffle" style="
  width: 280px;
  padding: 22px 24px;
  border-radius: var(--card-radius, 8px);
  background: linear-gradient(180deg, var(--card-bg-from), var(--card-bg-to));
  border: 1px solid var(--card-border);
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01';
">
  <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px;">
    <div>
      <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">用户复购率</div>
      <div style="font-size: 28px; font-weight: 800; letter-spacing: -0.03em; color: var(--accent-1); margin-top: 4px; font-variant-numeric: tabular-nums proportional-nums; line-height: 1;">87<span style="font-size: 14px; opacity: 0.75; margin-left: 1px;">%</span></div>
    </div>
    <div style="font-size: 10px; color: var(--text-secondary); opacity: 0.55; letter-spacing: 0.1em; text-transform: uppercase; text-align: right;">每 100 人中</div>
  </div>

  <div style="
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(10, 1fr);
    gap: 4px;
    aspect-ratio: 1 / 1;
  ">
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--accent-1); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
    <span style="background: var(--card-bg-from); border: 1px solid var(--card-border); border-radius: 2px;"></span>
  </div>

  <div style="display: flex; gap: 14px; margin-top: 14px; font-size: 11px; color: var(--text-secondary);">
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--accent-1);"></span>已复购 87
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--card-bg-from); border: 1px solid var(--card-border);"></span>未复购 13
    </div>
  </div>
</div>
```

**变体 A：圆点版（用 `border-radius: 50%` 替换方格，更柔和）**

将上面所有 `border-radius: 2px;` 替换为 `border-radius: 50%;`，并把方格之间的 gap 改为 6px 即可。视觉上更像「点阵分布图」，适合浅色风格。

**变体 B：双类别配色（如 "全职 60% / 兼职 25% / 实习 15%"）**

仅需把 100 格按比例分成 3 段，每段一种颜色：前 60 格 `var(--accent-1)`、中间 25 格 `var(--accent-2)`、最后 15 格 `var(--accent-3)`。

**自检**：

- [x] 100 个 `<span>` 用 CSS grid `repeat(10, 1fr)` 自动 10×10 排布
- [x] 主色用 `var(--accent-1)`，未填充格用 `var(--card-bg-from)` + `var(--card-border)`
- [x] 大数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] **不使用 SVG**（纯 CSS Grid，最佳兼容性）
- [x] 无 `mask-image` / `mix-blend-mode` / `conic-gradient`
- [x] 通过 puppeteer 渲染无错误（注意：100 个 span 较多，建议在 Python 生成阶段用循环输出）

---

## 6. KPI 指标卡 (kpi_card)

**何时用**：单个核心指标的高对比度展示（如季度营收、DAU、转化率）。大数字 + 同比箭头 + 可选 sparkline = 5 秒内传达完整结论。多张组合时用「指标行」或 `card_type=data` 卡组。

**数据格式**：

```json
{
  "type": "kpi_card",
  "value": "¥ 2.84B",
  "label": "Q1 2026 营收",
  "delta": { "direction": "up", "percent": 23.7, "vs": "vs Q4 2025" },
  "sparkline": [42, 48, 52, 56, 61, 68, 72, 78, 82]
}
```

**HTML 模板（含 sparkline）**：

```html
<div class="chart-kpi-card" style="
  position: relative;
  width: 320px;
  padding: 26px 28px 22px;
  border-radius: var(--card-radius, 8px);
  background: linear-gradient(180deg, var(--card-bg-from), var(--card-bg-to));
  border: 1px solid var(--card-border);
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01','cv11';
  overflow: hidden;
">
  <div style="
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    font-weight: 600; color: var(--accent-1);
  ">
    <span style="width: 5px; height: 5px; border-radius: 50%; background: var(--accent-1); box-shadow: 0 0 8px currentColor;"></span>
    Q1 2026 营收
  </div>

  <div style="
    display: flex; align-items: baseline; gap: 6px;
    margin-top: 14px;
  ">
    <span style="
      font-size: 13px; font-weight: 600;
      color: var(--text-secondary); opacity: 0.75;
      letter-spacing: -0.01em;
    ">¥</span>
    <span style="
      font-size: 46px; font-weight: 800;
      letter-spacing: -0.04em; line-height: 1;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums proportional-nums;
    ">2.84</span>
    <span style="
      font-size: 22px; font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-secondary);
    ">B</span>
  </div>

  <div style="
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 16px;
  ">
    <div style="display: inline-flex; align-items: center; gap: 6px;">
      <svg width="11" height="11" viewBox="0 0 11 11" style="display: block;">
        <polygon points="5.5,1 10,9 1,9" fill="#22c55e"/>
      </svg>
      <span style="
        font-size: 13px; font-weight: 700;
        color: #22c55e;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums proportional-nums;
      ">+23.7%</span>
      <span style="
        font-size: 11px; color: var(--text-secondary); opacity: 0.65;
        margin-left: 4px; letter-spacing: 0.02em;
      ">vs Q4 2025</span>
    </div>

    <div style="width: 90px; height: 28px;">
      <svg viewBox="0 0 90 28" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
        <defs>
          <linearGradient id="kpi-spark-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stop-color="var(--accent-1)" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="var(--accent-1)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="M 0 22 L 11 20 L 22 17 L 33 14 L 44 12 L 55 9 L 66 7 L 77 5 L 90 2 L 90 28 L 0 28 Z"
              fill="url(#kpi-spark-fill)"/>
        <path d="M 0 22 L 11 20 L 22 17 L 33 14 L 44 12 L 55 9 L 66 7 L 77 5 L 90 2"
              fill="none" stroke="var(--accent-1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="90" cy="2" r="2" fill="var(--accent-1)"/>
      </svg>
    </div>
  </div>
</div>
```

**变体 A：极简无 sparkline（横向卡组用）**

```html
<div style="
  width: 240px; padding: 20px 22px;
  border-left: 2px solid var(--accent-1);
  font-family: 'Inter Tight', sans-serif;
">
  <div style="font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">DAILY ACTIVE USERS</div>
  <div style="font-size: 42px; font-weight: 800; letter-spacing: -0.04em; color: var(--text-primary); font-variant-numeric: tabular-nums proportional-nums; line-height: 1; margin-top: 8px;">1.42<span style="font-size: 18px; opacity: 0.6; margin-left: 3px;">M</span></div>
  <div style="display: inline-flex; align-items: center; gap: 4px; margin-top: 10px;">
    <svg width="9" height="9" viewBox="0 0 9 9"><polygon points="4.5,1 8,7 1,7" fill="#22c55e"/></svg>
    <span style="font-size: 12px; font-weight: 600; color: #22c55e; font-variant-numeric: tabular-nums;">+12.4%</span>
    <span style="font-size: 11px; color: var(--text-secondary); opacity: 0.6; margin-left: 4px;">WoW</span>
  </div>
</div>
```

**变体 B：下跌指标（红色箭头）**

```html
<div style="width: 240px; padding: 20px 22px; border-left: 2px solid #ef4444; font-family: 'Inter Tight', sans-serif;">
  <div style="font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">CHURN RATE</div>
  <div style="font-size: 42px; font-weight: 800; letter-spacing: -0.04em; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1; margin-top: 8px;">3.2<span style="font-size: 18px; opacity: 0.6; margin-left: 2px;">%</span></div>
  <div style="display: inline-flex; align-items: center; gap: 4px; margin-top: 10px;">
    <svg width="9" height="9" viewBox="0 0 9 9"><polygon points="4.5,8 8,2 1,2" fill="#ef4444"/></svg>
    <span style="font-size: 12px; font-weight: 600; color: #ef4444; font-variant-numeric: tabular-nums;">-0.8pp</span>
    <span style="font-size: 11px; color: var(--text-secondary); opacity: 0.6; margin-left: 4px;">MoM</span>
  </div>
</div>
```

**自检**：

- [x] 大数字 36-48px，`font-variant-numeric: tabular-nums proportional-nums`
- [x] 大数字 letter-spacing 在 -0.035em ~ -0.045em（遵守 [typography.md](../typography.md) 字距铁律）
- [x] **货币符号、单位（B / M / %）作为独立 `<span>`，flex baseline 对齐**（防止内嵌不同字号被 svg2pptx 错位）
- [x] **趋势箭头用 SVG `<polygon>`**，不用 CSS border 三角形
- [x] 上涨 #22c55e / 下跌 #ef4444 业界惯例硬编码
- [x] sparkline 端点用 `<circle>`，不用 SVG `<text>` 标记
- [x] 卡片背景用 `var(--card-bg-from/to)`，边框用 `var(--card-border)`
- [x] 通过 puppeteer 渲染无错误

---

## 7. 指标行 (metric_row)

**何时用**：3-6 个并列指标垂直堆叠，每行 = 数字 + 标签 + 进度条。比 KPI 卡组更省空间，适合放在右侧栏或卡片内。当指标 ≥ 7 个时拆成两列。

**数据格式**：

```json
{
  "type": "metric_row",
  "rows": [
    { "label": "API 可用性", "value": 99.97, "max": 100, "unit": "%", "highlight": true },
    { "label": "P99 延迟",   "value": 47,    "max": 200, "unit": "ms", "lower_better": true },
    { "label": "错误率",     "value": 0.03,  "max": 1,   "unit": "%", "lower_better": true },
    { "label": "吞吐量",     "value": 12.4,  "max": 20,  "unit": "K/s" }
  ]
}
```

**HTML 模板**：

```html
<div class="chart-metric-row" style="
  width: 380px;
  padding: 24px 26px;
  border-radius: var(--card-radius, 8px);
  background: linear-gradient(180deg, var(--card-bg-from), var(--card-bg-to));
  border: 1px solid var(--card-border);
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01','cv11';
">
  <div style="
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 18px;
  ">
    <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">— 系统健康度</div>
    <div style="font-size: 10px; color: var(--text-secondary); opacity: 0.55; letter-spacing: 0.1em; text-transform: uppercase;">LIVE</div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-size: 13px; color: var(--text-primary); font-weight: 500; letter-spacing: -0.005em;">API 可用性</span>
        <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--accent-1); font-variant-numeric: tabular-nums proportional-nums;">99.97<span style="font-size: 11px; opacity: 0.65; margin-left: 1px;">%</span></span>
      </div>
      <div style="height: 4px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 99.97%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-1), var(--accent-2));"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-size: 13px; color: var(--text-primary); font-weight: 500;">P99 延迟</span>
        <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); font-variant-numeric: tabular-nums;">47<span style="font-size: 11px; opacity: 0.55; margin-left: 2px;">ms</span></span>
      </div>
      <div style="height: 4px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 23.5%; border-radius: 999px; background: var(--accent-2); opacity: 0.85;"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-size: 13px; color: var(--text-primary); font-weight: 500;">错误率</span>
        <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); font-variant-numeric: tabular-nums;">0.03<span style="font-size: 11px; opacity: 0.55; margin-left: 1px;">%</span></span>
      </div>
      <div style="height: 4px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 3%; border-radius: 999px; background: var(--accent-3); opacity: 0.7;"></div>
      </div>
    </div>

    <div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-size: 13px; color: var(--text-primary); font-weight: 500;">吞吐量</span>
        <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); font-variant-numeric: tabular-nums;">12.4<span style="font-size: 11px; opacity: 0.55; margin-left: 2px;">K/s</span></span>
      </div>
      <div style="height: 4px; border-radius: 999px; background: var(--card-bg-from); overflow: hidden;">
        <div style="height: 100%; width: 62%; border-radius: 999px; background: var(--accent-4); opacity: 0.75;"></div>
      </div>
    </div>
  </div>
</div>
```

**变体 A：左大数字 + 右纤细进度条（适合 3 行的紧凑场景）**

```html
<div style="width: 320px; font-family: 'Inter Tight', sans-serif; display: flex; flex-direction: column; gap: 14px;">
  <div style="display: grid; grid-template-columns: 100px 1fr; align-items: center; gap: 16px;">
    <div style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums proportional-nums; line-height: 1;">87<span style="font-size: 14px; opacity: 0.55; margin-left: 1px;">%</span></div>
    <div>
      <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px;">客户满意度</div>
      <div style="height: 3px; border-radius: 999px; background: var(--card-bg-from);">
        <div style="height: 100%; width: 87%; border-radius: 999px; background: var(--accent-1);"></div>
      </div>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: 100px 1fr; align-items: center; gap: 16px;">
    <div style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1;">64<span style="font-size: 14px; opacity: 0.55; margin-left: 1px;">%</span></div>
    <div>
      <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px;">迁移完成度</div>
      <div style="height: 3px; border-radius: 999px; background: var(--card-bg-from);">
        <div style="height: 100%; width: 64%; border-radius: 999px; background: var(--accent-2);"></div>
      </div>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: 100px 1fr; align-items: center; gap: 16px;">
    <div style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1;">42<span style="font-size: 14px; opacity: 0.55; margin-left: 1px;">%</span></div>
    <div>
      <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px;">海外营收占比</div>
      <div style="height: 3px; border-radius: 999px; background: var(--card-bg-from);">
        <div style="height: 100%; width: 42%; border-radius: 999px; background: var(--accent-3);"></div>
      </div>
    </div>
  </div>
</div>
```

**自检**：

- [x] 每行用 **flex `align-items: baseline`** 让标签和数字基线对齐（关键！）
- [x] 数字单位（%、ms、K/s）作为内嵌 span 但 **数字本体保持独立 span**，避免 svg2pptx baseline 错位
- [x] 数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 进度条统一 4px 高度（不抢数字风头）
- [x] 各行可分别用 `--accent-1` ~ `--accent-4`，营造层级
- [x] 高亮项用 `color: var(--accent-1)` 而非更大字号（保持对齐）
- [x] 通过 puppeteer 渲染无错误

---

## 8. 评分指示器 (rating)

**何时用**：5 分制评分（含半星）/ 满意度 / 难度等级 / 性能档位。比纯数字（4.5/5）更直观。如果是 10 分制则改用进度条；如果是 0-100 用环形图。

**数据格式**：

```json
{
  "type": "rating",
  "value": 4.5,
  "max": 5,
  "label": "用户评分",
  "shape": "dot"
}
```

> **填充逻辑**：value=4.5，max=5 → 4 个满 + 1 个半 + 0 个空。
> 半星用 SVG path 的 50% 宽矩形 + clip 实现，**禁止用 CSS gradient 切半**（svg2pptx 不可靠）。

**HTML 模板（圆点版）**：

```html
<div class="chart-rating" style="
  display: inline-flex; flex-direction: column; gap: 8px;
  font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'kern','liga','ss01';
">
  <div style="
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--text-secondary); font-weight: 600;
  ">用户评分</div>

  <div style="display: inline-flex; align-items: center; gap: 10px;">
    <div style="display: inline-flex; gap: 6px;">
      <svg width="18" height="18" viewBox="0 0 18 18" style="display: block;">
        <circle cx="9" cy="9" r="7" fill="var(--accent-1)"/>
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" style="display: block;">
        <circle cx="9" cy="9" r="7" fill="var(--accent-1)"/>
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" style="display: block;">
        <circle cx="9" cy="9" r="7" fill="var(--accent-1)"/>
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" style="display: block;">
        <circle cx="9" cy="9" r="7" fill="var(--accent-1)"/>
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" style="display: block;">
        <circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent-1)" stroke-width="1.5"/>
        <path d="M 9 2 A 7 7 0 0 1 9 16 Z" fill="var(--accent-1)"/>
      </svg>
    </div>

    <div style="display: inline-flex; align-items: baseline; gap: 4px;">
      <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums proportional-nums; line-height: 1;">4.5</span>
      <span style="font-size: 12px; color: var(--text-secondary); opacity: 0.6; font-variant-numeric: tabular-nums;">/ 5.0</span>
    </div>
  </div>

  <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.7; letter-spacing: 0.02em;">
    基于 <span style="color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums;">12,847</span> 份反馈
  </div>
</div>
```

**变体 A：星形版（含半星 + SVG path）**

```html
<div style="display: inline-flex; align-items: center; gap: 10px; font-family: 'Inter Tight', sans-serif;">
  <div style="display: inline-flex; gap: 4px;">
    <svg width="18" height="18" viewBox="0 0 24 24" style="display: block;">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="var(--accent-1)"/>
    </svg>
    <svg width="18" height="18" viewBox="0 0 24 24" style="display: block;">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="var(--accent-1)"/>
    </svg>
    <svg width="18" height="18" viewBox="0 0 24 24" style="display: block;">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="var(--accent-1)"/>
    </svg>
    <svg width="18" height="18" viewBox="0 0 24 24" style="display: block;">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="var(--accent-1)"/>
    </svg>

    <svg width="18" height="18" viewBox="0 0 24 24" style="display: block;">
      <defs>
        <clipPath id="half-star-clip">
          <rect x="0" y="0" width="12" height="24"/>
        </clipPath>
      </defs>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="none" stroke="var(--accent-1)" stroke-width="1.2"/>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="var(--accent-1)" clip-path="url(#half-star-clip)"/>
    </svg>
  </div>

  <div style="display: inline-flex; align-items: baseline; gap: 4px;">
    <span style="font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); font-variant-numeric: tabular-nums proportional-nums; line-height: 1;">4.5</span>
    <span style="font-size: 11px; color: var(--text-secondary); opacity: 0.6;">/ 5</span>
  </div>
</div>
```

**变体 B：水平条段版（5 段，每段 = 1 分）**

```html
<div style="display: inline-flex; flex-direction: column; gap: 6px; font-family: 'Inter Tight', sans-serif;">
  <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">难度等级</div>
  <div style="display: inline-flex; gap: 4px;">
    <span style="width: 28px; height: 6px; border-radius: 2px; background: var(--accent-1);"></span>
    <span style="width: 28px; height: 6px; border-radius: 2px; background: var(--accent-1);"></span>
    <span style="width: 28px; height: 6px; border-radius: 2px; background: var(--accent-1);"></span>
    <span style="width: 28px; height: 6px; border-radius: 2px; background: linear-gradient(90deg, var(--accent-1) 50%, var(--card-bg-from) 50%);"></span>
    <span style="width: 28px; height: 6px; border-radius: 2px; background: var(--card-bg-from); border: 1px solid var(--card-border);"></span>
  </div>
  <div style="font-size: 12px; color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums;">3.5 <span style="opacity: 0.55; font-weight: 400;">困难</span></div>
</div>
```

**自检**：

- [x] 每个评分单元独立 `<svg>`，避免 dom-to-svg 把多个 path 合并产生坐标错位
- [x] **半星用 SVG `<clipPath>` + 矩形遮罩**，不用 CSS gradient 切半
- [x] **空心星用 `fill="none" stroke=...`**，不用 mask-image
- [x] 数字 `font-variant-numeric: tabular-nums proportional-nums`
- [x] 颜色用 `var(--accent-1)`，未填充用 `var(--card-bg-from)` + `var(--card-border)`
- [x] 圆点版用 `<circle>` + 路径，星形版用 `<polygon>`
- [x] 通过 puppeteer 渲染无错误

---

## 附录 A · 弧长速查表（环形图用）

| 半径 r | 圆周 (2πr) | 25% 弧长 | 50% 弧长 | 75% 弧长 | 90% 弧长 |
|--------|-----------|---------|---------|---------|---------|
| 40 | 251 | 63  | 126 | 188 | 226 |
| 50 | 314 | 79  | 157 | 236 | 283 |
| 60 | 377 | 94  | 188 | 283 | 339 |
| 68 | 427 | 107 | 214 | 320 | 384 |
| 80 | 503 | 126 | 251 | 377 | 452 |
| 90 | 565 | 141 | 283 | 424 | 509 |
| 100| 628 | 157 | 314 | 471 | 565 |

公式：弧长 = 2π × r × (百分比 / 100)，圆周 = 2π × r。
**`stroke-dasharray="弧长 圆周"`**，例如 r=80, 75% → `stroke-dasharray="377 503"`。

---

## 附录 B · 通用色梯度方案

各风格 `--accent-1` ~ `--accent-4` 的语义建议：

| 变量 | 语义 | 示例用法 |
|------|------|---------|
| `--accent-1` | **主高亮**（最强对比） | 当前值 / 已完成 / 高亮项 |
| `--accent-2` | 次级（同色系略浅） | 对比组 / 进行中 |
| `--accent-3` | 第三色（往往互补色） | 第三组 / 未开始 / 边缘装饰 |
| `--accent-4` | 警示/装饰（如金黄） | 强调标记 / 单一突出点 |

固定不参与主题切换的色：

| 颜色 | 用途 |
|------|------|
| `#22c55e` | 上涨绿 / 正向变化（业界惯例） |
| `#ef4444` | 下跌红 / 负向变化（业界惯例） |
| `#f59e0b` | 警告橙（可选，谨慎使用） |

---

## 附录 C · 通用自检清单（所有 8 种图表）

每个图表 HTML 模板交付前，对照以下 8 条：

- [ ] 数字加 `font-variant-numeric: tabular-nums proportional-nums`
- [ ] 颜色全部用 CSS 变量（`--accent-*`, `--card-bg-*`, `--card-border`, `--text-*`），无硬编码 hex（除业界惯例的红绿）
- [ ] 内联 SVG 中**没有 `<text>` 元素**，所有文字用 HTML `<div>`/`<span>` 绝对定位叠加
- [ ] 环形图用 `stroke-dasharray="弧长 圆周"` 两值格式，**不用 `stroke-dashoffset`**
- [ ] 三角形/箭头用 SVG `<polygon>`，**不用 CSS border 三角形技巧**
- [ ] 不使用 `conic-gradient` / `mask-image` / `mix-blend-mode` / `background-clip: text` / `filter: blur()`
- [ ] 不同字号混排用 flex `align-items: baseline` + 独立 `<span>`，不用嵌套 span
- [ ] 通过 puppeteer 渲染无控制台错误，目视检查在 dark / light 两类背景下都清晰可读
