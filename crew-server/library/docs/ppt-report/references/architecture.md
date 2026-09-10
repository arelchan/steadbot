# 架构与构建机制

## 项目布局

```
my-report/
├── dist/                      ← 构建产物目录（build.py 自动创建）
│   ├── 我的汇报.html          ← 最终产物（build.py 生成）
│   └── 我的汇报.pdf           ← export_pdf.py 生成（可选）
├── build.py                   ← 合并脚本（也把 src/assets/ 拷进 dist/）
├── export_pdf.py              ← PDF 导出脚本
├── xlsx2json.py               ← Excel/CSV → JSON 转换器（被 build 自动调用，也可单跑）
├── fetch_logos.py             ← 可选：把在线 logo 缓存到 src/assets/logos/ 供离线（默认在线引用，不跑也能显示）
└── src/
    ├── shell.html             ← HTML 骨架，含 {{STYLES}} {{SLIDES}} {{SCRIPTS}} 占位
    ├── styles/
    │   ├── common.css         ← 全局样式（含主题变量、组件库）
    │   ├── slide-1.css        ← 第 1 页特殊样式（可空）
    │   └── slide-N.css
    ├── slides/
    │   ├── slide-1.html       ← 第 1 页 .slide div 内容（不含 <html>/<body>）
    │   └── slide-N.html
    ├── scripts/
    │   ├── common.js          ← 自适应 + 导航 + ECharts helper
    │   ├── slide-1.js         ← 必须导出 initSlide1() 函数
    │   └── slide-N.js
    ├── assets/                ← 本项目静态资源（build 时整体拷进 dist/assets/）
    │   └── logos/             ← 可选离线缓存：fetch_logos.py 下载的 logo（在线模式下可空）
    └── data/                  ← 每页一个子目录（推荐）或单文件（向后兼容）
        ├── slide-1/           ← 推荐：每页一个文件夹，文件名即 JS key
        │   ├── kpis.xlsx      →  window.__DATA_1__.kpis
        │   ├── trend.csv      →  window.__DATA_1__.trend
        │   └── cfg.json       →  window.__DATA_1__.cfg
        ├── slide-2/           ← 多数据源互不干扰
        │   ├── funnel.xlsx
        │   └── segments.csv
        └── slide-3.xlsx       ← 旧格式仍完全支持（向后兼容）
```

## build.py 工作原理

```python
# 1. 把所有 styles/*.css 拼接 → {{STYLES}}
# 2. 把所有 slides/*.html 拼接 → {{SLIDES}}（自动加 <!-- SLIDE N --> 注释）
# 3. 把所有 scripts/*.js 拼接 → {{SCRIPTS}}
# 4. 写入 shell.html 的占位符 → 输出最终 HTML
```

**为什么这么做？**
- 单页改动只动 1~3 个小文件，单文件 ≤ 200 行 → 编辑器/Claude 上下文友好、token 省
- 最终是单 HTML（无外部依赖、可直接邮件/IM 分享）
- 多人协作时按页分工不冲突

## 数据分离机制

**核心思路**：渲染代码（HTML/JS）和数据（xlsx/csv/json）完全解耦。下次更新数据，只改数据文件，重跑 `python3 build.py`，**渲染代码一行都不用动**。

### 推荐新格式：每页一个目录

```
src/data/slide-2/
├── funnel.xlsx      →  window.__DATA_2__.funnel
├── segments.csv     →  window.__DATA_2__.segments
└── config.json      →  window.__DATA_2__.config
```

**文件名（不含扩展名）即 JS key**。一页有多少个独立数据源就放多少文件，互不干扰。

同 key 名下优先级：`.json > .xlsx > .csv`。以 `_` 开头的文件名跳过。

### 旧格式：单文件（向后完全兼容）

```
src/data/slide-3.xlsx    （多 sheet → 多 key）
src/data/slide-3.csv     （单表 → 数组）
src/data/slide-3.json    （原生）
```

**build.py 优先找 `slide-N/` 目录，没有目录才回退到单文件**，所以旧项目无需改动。

### 数据文件格式与转换规则

| 文件类型 | 转换结果 | 说明 |
|---|---|---|
| `.xlsx`（单 sheet） | `[{col: val}, ...]` 数组 | **自动解包**：省掉一层多余的 key |
| `.xlsx`（多 sheet） | `{sheetA: [...], sheetB: [...]}` | 每个 sheet → 一个子 key |
| `.csv` | `[{col: val}, ...]` 数组 | 整份 → 数组 |
| `.json` | 原值（any） | 直接读取，适合嵌套结构 |

**xlsx / csv 共同约定**：
1. 第 1 行 = 表头，后续每行 = 一个对象
2. 纯数字单元格自动转 number，其他保留 string
3. sheet 名 / 列名以 `_` 开头跳过（辅助列、备注）
4. 空行自动跳过

### 示例：一页三个数据源

目录结构：
```
src/data/slide-3/
├── kpis.xlsx      （1 sheet "data"：label/value/unit 三列）
├── trend.csv      （week/na/eu 三列）
└── marks.json     （折线图里程碑标注）
```

`window.__DATA_3__` 注入结果：

```json
{
  "kpis":  [{"label":"DAU","value":12.4,"unit":"万"}, {"label":"ARR","value":48,"unit":"M USD"}],
  "trend": [{"week":"W1","na":12.1,"eu":8.4}, {"week":"W2","na":12.4,"eu":8.6}],
  "marks": [{"x":"W4","label":"上线","color":"#3b82f6"}]
}
```

JS 里访问：
```js
function initSlide3() {
  const D = window.__DATA_3__;
  // D.kpis、D.trend、D.marks 各自独立，来自不同文件
  renderDailyDual('chart-3', D.trend.map(r=>r.week), D.trend.map(r=>r.na), D.trend.map(r=>r.eu));
}
```

### build.py 注入流程

```
src/data/slide-N/kpis.xlsx   ← 用户改数据
src/data/slide-N/trend.csv   ←
        ↓  build.py 调 xlsx2json.load_slide_dir()
{ kpis:[...], trend:[...] }  ←  合并 dict
        ↓  json.dumps → window.__DATA_N__ = ...;
最终 HTML <script> 中可用
        ↓  initSlideN() 读取
ECharts / DOM 渲染
```

### 独立调试

```bash
# 调试单页目录（新格式）
python3 xlsx2json.py src/data/slide-2/

# 调试单个文件（旧格式）
python3 xlsx2json.py src/data/slide-3.xlsx

# 转整个 data/ 目录（自动识别新旧格式混用）
python3 xlsx2json.py src/data/
```

### 何时用哪种格式

- **xlsx 单 sheet**：最常见——一个"表"对应一个数据源，自动解包为数组，最简洁
- **xlsx 多 sheet**：一张 Excel 里有多个相关表（如月报 + 年报），放在同一文件里方便管理
- **csv**：从 BI / 数据库直接导出，零加工丢进目录即用
- **json**：嵌套结构（markLine 配置、API 返回的复杂对象）或机器生成数据

### 运行时 fetch（可选，不推荐）

不通过 build.py 内联，而是浏览器运行时 `fetch('./data/slide-5.json')`，适合数据频繁变动 + 服务器托管。注意 `file://` 打开时 CORS 会拦截，所以默认走 build 内联。

## 自适应缩放（核心约束）

**所有元素按设计稿 1600×900 像素来定**。浏览器窗口大小变化时，整个 canvas 通过 CSS `transform: scale(--fit)` 等比缩放，永远完整可见、不裁剪。

```css
:root {
  --design-w: 1600px;
  --design-h: 900px;
  --fit: 1; /* JS 计算后写入 */
  --nav-reserve: 88px; /* 底部导航条预留 */
}
.canvas {
  position: absolute; top: 50%; left: 50%;
  width: var(--design-w);
  height: var(--design-h);
  transform: translate(-50%, -50%) scale(var(--fit));
  transform-origin: center center;
}
```

```js
function fitCanvas() {
  const w = window.innerWidth;
  const h = Math.max(0, window.innerHeight - 88);
  const scale = Math.min(w / 1600, h / 900);
  document.documentElement.style.setProperty('--fit', scale.toFixed(4));
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('DOMContentLoaded', fitCanvas);
```

**这条约束的副作用（必须遵守）**：
- ❌ **不要用** `vw / vh / %` 来定字号或间距 → 会跟整体 scale 双重缩放
- ✅ 全部用 `px`，按 1600×900 设计稿来量
- ✅ 字号也用 `px`（已经在 `--fs-*` 变量里）
- ✅ Chart 的 `font.size`、`borderWidth` 也按 px 设计稿值

## 导航与图表初始化

`common.js` 提供：
- `goTo(idx)` / `go(±1)` — 切页
- 键盘 ←/→/↑/↓ 翻页
- 底部圆点 + "1 / 6" 计数器
- `initCharts(idx)` 自动调用 `window.initSlide{N}()`，每页只初始化一次

每页 JS 必须导出 `function initSlide{N}() { ... }`（即使页面没图表也要有空函数，否则 PDF 导出会找不到）。

## PDF 导出（export_pdf.py）

- 用 Playwright headless Chromium，viewport = 1600×900，device_scale_factor=2（@2x，文字锐利）
- 注入 CSS override：`--fit:1` + 隐藏 nav bar
- 关闭 Chart.js 动画 → 截图前 chart 已完整渲染
- 逐页激活 → 等 chart canvas 有像素 → 截 PNG
- `img2pdf` 合并为 13.33×7.5 inch（标准 16:9 演示文稿尺寸）的 PDF

## 字体加载

`shell.html` 引入：
- **Noto Sans SC** — 正文中文（300/400/500/700/900）
- **JetBrains Mono** — 数字 / 代码 / 标签
- **Bebas Neue** — 大数字（可选，仅总览页那种"5 个" 64px 大数字时用）

切主题时如果换字体，在该主题的 CSS 段里 import 即可。
