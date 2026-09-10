# 暗色专业板块（7 风格）

> 板块定位：深色背景 + 高对比 + 精密科技/奢华情绪。适用于产品发布会、SaaS 平台、技术文档、奢侈品、电竞、Web3 等场景。
>
> 共享：[排版铁律](../typography.md) · [失败模式](../principles/failure-modes.md) · [Bento Grid](../bento-grid.md)

---

## 索引

| # | style_id | 灵感 | 一句话 |
|---|----------|------|-------|
| 1 | `dark_tech` | Linear.app | 天文台扫描光，深空冷寂的精密仪器感 |
| 2 | `xiaomi_orange` | Apple Keynote (硬件) | 暗夜中产品悬浮，橙光辐射的发布会感 |
| 3 | `luxury_purple` | Tom Ford | 黑金菱形装饰，YSL 级时尚奢华 |
| 4 | `nocturne_violet` | Linear (紫光版) | 紫色玻璃光晕，设计师工具的夜曲 |
| 5 | `cyberpunk_neon` | Cyberpunk 2077 | 紫青霓虹 + 扫描线，2077 未来街景 |
| 6 | `chrome_y2k` | Y2K / Vaporwave | 千禧年银色铬感 + 网格透视 |
| 7 | `noir_film` | 黑白电影 | 高反差黑白 + 胶片颗粒，纪录片质感 |

---

## 1. dark_tech — 暗黑科技

```json
{
  "style_id": "dark_tech",
  "style_name": "暗黑科技 (Dark Tech)",
  "category": "dark_professional",

  "inspiration": "Linear.app",
  "mood_keywords": ["深空冷寂", "精密仪器", "微光脉搏", "数据洪流", "未来感"],
  "design_soul": "天文台穹顶内部，深蓝黑幕中冷青的仪器扫描光有节奏地划过 -- 精密、冷寂、但每一次扫描都暗含脉搏。屏幕上的数据像星图一样精确排列。",
  "variation_strategy": "数据页用网格点阵+角标装饰线（紧张高密度），章节封面用大面积深空留白+单一光晕（释放），产品页用全屏暗底+中央悬浮发光数据面板（聚焦）。三种极端交替形成'在深空中切换仪器面板'的节奏。",

  "decoration_dna": {
    "signature_move": "网格点阵底纹 + 极光辉光（双层 radial-gradient） + Inter Tight 紧凑字距 + serif italic 关键词混排",
    "forbidden": [
      "渐变色块 (除背景微妙过渡外)",
      "叶片 / 花卉装饰",
      "波浪分隔线",
      "马卡龙糖果色",
      "serif 杂志感",
      "圆润儿童感字体"
    ],
    "recommended_combos": [
      "网格点阵 + 角标装饰 + 大号水印数字",
      "极光辉光 + 脉冲圆点 label + 半透明数字水印",
      "纤细底线 (linear-gradient transparent → cyan → transparent) + 玻璃卡片"
    ]
  },

  "background": {
    "primary": "#050b1f",
    "gradient_to": "#0a1f3d",
    "gradient_direction": "radial 100% 80% at 50% -20%",
    "texture": { "type": "grid_dot", "size": 80, "opacity": 0.015 },
    "glow": [
      { "x": "80%", "y": "30%", "color": "#6366f1", "opacity": 0.35, "blur": 60 },
      { "x": "20%", "y": "70%", "color": "#22D3EE", "opacity": 0.25, "blur": 60 }
    ]
  },

  "card": {
    "gradient_from": "rgba(34,211,238,0.08)",
    "gradient_to": "rgba(99,102,241,0.04)",
    "border": "rgba(34,211,238,0.2)",
    "border_radius": 8,
    "backdrop_blur": 10
  },

  "text": {
    "primary": "#FFFFFF",
    "secondary": "rgba(255,255,255,0.65)",
    "title_size": 28,
    "body_size": 14,
    "card_title_size": 20
  },

  "accent": {
    "primary": ["#22D3EE", "#3B82F6"],
    "secondary": ["#6366f1", "#FDE047"]
  },

  "typography": {
    "display_font": "'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "body_font": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "serif_italic_font": "'Instrument Serif', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.18em",
    "feature_settings": "'ss01', 'cv11', 'calt', 'kern', 'liga'",
    "tabular_nums": true
  },

  "decorations": {
    "label_anchor": "dot_pulse",
    "title_serif_italic": true,
    "corner_lines": true,
    "vertical_divider": false,
    "drop_cap": false,
    "masthead": false,
    "bottom_thin_line": true
  },

  "font_imports": [
    "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  ]
}
```

### CSS Variables

```css
:root {
  --bg-primary: #050b1f;
  --bg-secondary: #0a1f3d;
  --card-bg-from: rgba(34,211,238,0.08);
  --card-bg-to: rgba(99,102,241,0.04);
  --card-border: rgba(34,211,238,0.2);
  --card-radius: 8px;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255,255,255,0.65);
  --accent-1: #22D3EE;
  --accent-2: #3B82F6;
  --accent-3: #6366f1;
  --accent-4: #FDE047;
  --grid-dot-color: #FFFFFF;
  --grid-dot-opacity: 0.015;
  --grid-size: 80px;
  --display-font: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --body-font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --serif-italic-font: 'Instrument Serif', 'Fraunces', Georgia, serif;
  --mono-font: 'JetBrains Mono', 'DM Mono', 'Courier New', monospace;
}
```

### Mock HTML 标杆

完整 1280×720 mock 见 [`ppt-output/style-gallery/dark_tech.html`](../../ppt-output/style-gallery/dark_tech.html)。

---

---

## 2. xiaomi_orange — 小米橙（升级版）

```json
{
  "style_id": "xiaomi_orange",
  "style_name": "小米橙 (Xiaomi Orange)",
  "category": "dark_professional",
  "inspiration": "Apple Keynote (硬件发布会版)",
  "mood_keywords": ["产品舞台", "暗夜悬浮", "橙光辐射", "金属光感"],
  "design_soul": "暗夜中的产品舞台，金属橙色光球从右下角升起，把整个画面染成温暖的火焰色。",
  "variation_strategy": "封面用中央悬浮产品光球（最强冲击），规格页用 3 张暗黑数据卡 + 右下橙光辐射，对比页用左右对称的产品阴影投射。",
  "decoration_dna": {
    "signature_move": "金属橙色产品光球（多层 radial-gradient + 内高光 + 投影）+ 底部橙光辐射 + Inter Tight 紧凑字距",
    "forbidden": ["紫色 / 蓝色 accent", "马卡龙糖果色", "serif 杂志感", "渐变色块", "波浪线"],
    "recommended_combos": ["产品光球 + 橙光辐射 + 大数字 tabular-nums", "暗夜底 + 角标线 + 金属球反光"]
  },
  "background": {
    "primary": "#0a0a0a",
    "gradient_to": "#1a1a1a",
    "gradient_direction": "radial 70% 100% at 70% 100%",
    "texture": { "type": "vignette", "opacity": 0.3 },
    "glow": [{ "x": "70%", "y": "100%", "color": "#FF6900", "opacity": 0.4, "blur": 80 }]
  },
  "card": { "gradient_from": "#1a1a1a", "gradient_to": "#0a0a0a", "border": "rgba(255,105,0,0.2)", "border_radius": 8, "backdrop_blur": 0 },
  "text": { "primary": "#FFFFFF", "secondary": "rgba(255,255,255,0.65)", "title_size": 28, "body_size": 14, "card_title_size": 20 },
  "accent": { "primary": ["#FF6900", "#ff9d4a"], "secondary": ["#FFFFFF", "#ffd16b"] },
  "typography": {
    "display_font": "'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "body_font": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "serif_italic_font": "'Instrument Serif', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'ss01', 'cv11', 'calt', 'kern', 'liga'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "dot_pulse", "title_serif_italic": true, "corner_lines": true, "vertical_divider": false, "drop_cap": false, "masthead": false, "bottom_thin_line": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/xiaomi_orange.html`](../../ppt-output/style-gallery/xiaomi_orange.html)

---

## 3. luxury_purple — 紫金奢华（YSL 级重做）

```json
{
  "style_id": "luxury_purple",
  "style_name": "紫金奢华 (Luxury, Tom Ford-grade)",
  "category": "dark_professional",
  "inspiration": "Tom Ford / The Row / YSL Beauty",
  "mood_keywords": ["极致黑金", "对称仪式", "Didot 巨字", "时装周"],
  "design_soul": "纯黑墨幕中央，金色 Didot 巨字以对称姿态悬浮，金线与菱形装饰像高定服装上的纽扣。",
  "variation_strategy": "封面用 Didot 巨字居中 + 金线菱形装饰，章节页用 4 个角的金色 L 线 + Maison label，内容页用左右对称的双栏 + 金线分割。",
  "decoration_dna": {
    "signature_move": "Playfair/Didot italic 巨字 + 金线 + 金色菱形 + 居中对称布局 + 0.65em 字距 Maison label",
    "forbidden": ["sans serif 主标题", "渐变文字", "霓虹色", "活泼装饰", "圆角过大", "亮色背景"],
    "recommended_combos": ["金线 + 金色菱形 + 对称居中", "Didot 巨字 + 大字距小标 + 极简留白"]
  },
  "background": { "primary": "#060606", "gradient_to": "#0a0a0a", "texture": { "type": "none" } },
  "card": { "gradient_from": "rgba(201,169,96,0.04)", "gradient_to": "rgba(201,169,96,0.01)", "border": "rgba(201,169,96,0.2)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#f5e8c8", "secondary": "rgba(245,232,200,0.55)", "title_size": 124, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#c9a960", "#f5e8c8"], "secondary": ["#1a1a1a", "#fff"] },
  "typography": {
    "display_font": "'Playfair Display', 'Bodoni Moda', 'Didot', Georgia, serif",
    "body_font": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "serif_italic_font": "'Playfair Display', 'Didot', serif",
    "mono_font": "'JetBrains Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.005em",
    "headline_letter_spacing": "0",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.65em",
    "feature_settings": "'kern', 'liga', 'dlig', 'swsh'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": true, "vertical_divider": true, "drop_cap": false, "masthead": false, "centered_symmetric": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/luxury_purple.html`](../../ppt-output/style-gallery/luxury_purple.html)

---

## 4. nocturne_violet — 紫光夜曲（新增）

```json
{
  "style_id": "nocturne_violet",
  "style_name": "紫光夜曲 (Nocturne Violet)",
  "category": "dark_professional",
  "inspiration": "Linear.app (紫色版) / 设计师工具",
  "mood_keywords": ["夜曲玻璃", "紫色辉光", "设计师工具", "玻璃态卡片"],
  "design_soul": "深紫黑夜里，紫色辉光像星云一样浮动，玻璃态卡片在光晕中折射出微妙的紫色光影。",
  "variation_strategy": "封面用大紫色辉光 + 玻璃徽章，数据页用玻璃态卡片承载关键指标，章节页用紫光大留白。",
  "decoration_dna": {
    "signature_move": "紫色 radial-gradient 辉光 + 玻璃态卡片 (backdrop-filter blur + rgba 紫色边框) + Inter Tight + Editorial New italic 关键词",
    "forbidden": ["青色 / 蓝色 accent (与 dark_tech 区分)", "橙色 (与 xiaomi_orange 区分)", "霓虹色", "传统装饰"],
    "recommended_combos": ["紫光辉光 + 玻璃卡片 + 网格底纹", "脉冲圆点 label + 玻璃徽章 + 进度环"]
  },
  "background": {
    "primary": "#0a0612",
    "gradient_to": "#1a0d2e",
    "gradient_direction": "radial 100% 80% at 50% -20%",
    "texture": { "type": "grid_dot", "size": 80, "opacity": 0.015 },
    "glow": [
      { "x": "75%", "y": "30%", "color": "#9b64ff", "opacity": 0.4, "blur": 60 },
      { "x": "20%", "y": "70%", "color": "#6d3df0", "opacity": 0.25, "blur": 60 }
    ]
  },
  "card": { "gradient_from": "rgba(155,100,255,0.10)", "gradient_to": "rgba(155,100,255,0.04)", "border": "rgba(155,100,255,0.30)", "border_radius": 12, "backdrop_blur": 18 },
  "text": { "primary": "#FFFFFF", "secondary": "rgba(255,255,255,0.65)", "title_size": 28, "body_size": 14, "card_title_size": 20 },
  "accent": { "primary": ["#9b64ff", "#c4a8ff"], "secondary": ["#6d3df0", "#FDE047"] },
  "typography": {
    "display_font": "'Inter Tight', 'Inter', -apple-system, sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Instrument Serif', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.18em",
    "feature_settings": "'ss01', 'cv11', 'calt', 'kern', 'liga', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "dot_pulse", "title_serif_italic": true, "corner_lines": true, "vertical_divider": false, "drop_cap": false, "masthead": false, "glass_card": true, "bottom_thin_line": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/nocturne_violet.html`](../../ppt-output/style-gallery/nocturne_violet.html)

---

## 5. cyberpunk_neon — 赛博霓虹（新增）

```json
{
  "style_id": "cyberpunk_neon",
  "style_name": "赛博霓虹 (Cyberpunk Neon)",
  "category": "dark_professional",
  "inspiration": "Cyberpunk 2077 / 攻壳机动队 / Blade Runner 2049",
  "mood_keywords": ["紫青霓虹", "扫描线", "故障美学", "2077 街景"],
  "design_soul": "2077 年的夜色街道，青色霓虹和品红光斑交错闪烁，扫描线在屏幕上滚动，每个文字都像电视故障一样有双色错位。",
  "variation_strategy": "封面用 glitch 巨字 + 扫描线，数据页用切角科幻盒子 + 霓虹边框，章节页用大号像素艺术装饰。",
  "decoration_dna": {
    "signature_move": "扫描线 (repeating-linear-gradient) + glitch 文字 (双色 text-shadow 错位) + clip-path 切角科幻盒子 + 霓虹文字辉光 (text-shadow 大量)",
    "forbidden": ["serif 字体 (用 mono)", "传统圆角", "暖橙色", "金色 accent (那是 luxury 的)", "微妙渐变"],
    "recommended_combos": ["扫描线 + glitch 标题 + 切角盒子", "霓虹辉光 + 像素艺术 + mono 字体"]
  },
  "background": { "primary": "#0a0014", "gradient_to": "#1a0020", "texture": { "type": "scanlines", "opacity": 0.02 } },
  "card": { "gradient_from": "rgba(255,0,200,0.08)", "gradient_to": "rgba(0,255,255,0.04)", "border": "#ff00c8", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#FFFFFF", "secondary": "rgba(255,255,255,0.65)", "title_size": 152, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#00ffff", "#ff00c8"], "secondary": ["#ffd60a", "#ff3b3b"] },
  "typography": {
    "display_font": "'Orbitron', 'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "body_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "serif_italic_font": "'Instrument Serif', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.035em",
    "headline_letter_spacing": "-0.01em",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.30em",
    "feature_settings": "'kern', 'liga', 'calt', 'ss01', 'cv11', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "scanlines": true, "glitch_text": true, "clip_path_corners": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/cyberpunk_neon.html`](../../ppt-output/style-gallery/cyberpunk_neon.html)

---

## 6. chrome_y2k — 千禧铬感（新增）

```json
{
  "style_id": "chrome_y2k",
  "style_name": "千禧铬感 (Chrome Y2K)",
  "category": "dark_professional",
  "inspiration": "Y2K / Vaporwave / Apple iPod (2001) / Daft Punk",
  "mood_keywords": ["银色铬感", "千禧未来", "网格透视", "镭射光泽"],
  "design_soul": "千禧年的电子梦境，银色铬感金属球漂浮在蓝紫渐变中，地平线上的网格无限延伸，标题闪烁着镭射的银光。",
  "variation_strategy": "封面用居中镭射文字 + 双侧金属球 + 透视网格地平线，规格页用银色卡片 + 蓝色 accent。",
  "decoration_dna": {
    "signature_move": "镭射银色渐变文字 (linear-gradient clip text) + 银色金属球 (多层 radial-gradient) + SVG 透视网格地平线 + 千禧年光泽",
    "forbidden": ["哑光纯色", "暖色 (橙黄红)", "serif 字体", "传统装饰"],
    "recommended_combos": ["镭射文字 + 金属球 + 网格地平线", "银色卡片 + 蓝色 accent + mono 元数据"]
  },
  "background": { "primary": "#0a0518", "gradient_to": "#1a0d3a", "gradient_direction": "linear 180deg", "texture": { "type": "starfield", "opacity": 0.05 } },
  "card": { "gradient_from": "rgba(192,208,224,0.08)", "gradient_to": "rgba(160,160,232,0.04)", "border": "rgba(0,212,255,0.3)", "border_radius": 4, "backdrop_blur": 10 },
  "text": { "primary": "#e0e8f0", "secondary": "rgba(224,232,240,0.6)", "title_size": 132, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#c0d0e0", "#00d4ff"], "secondary": ["#ff6bcd", "#a0a0e8"] },
  "typography": {
    "display_font": "'Inter Tight', 'Orbitron', 'Inter', sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Instrument Serif', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.55em",
    "feature_settings": "'ss01', 'cv11', 'calt', 'kern', 'liga', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "centered_symmetric": true, "chrome_text": true, "metal_orbs": true, "perspective_grid": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Orbitron:wght@500;700;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/chrome_y2k.html`](../../ppt-output/style-gallery/chrome_y2k.html)

---

## 7. noir_film — 黑白胶片（新增）

```json
{
  "style_id": "noir_film",
  "style_name": "黑白胶片 (Noir Film)",
  "category": "dark_professional",
  "inspiration": "Magnum Photos / Henri Cartier-Bresson / 杜可风 / 苏珊桑塔格",
  "mood_keywords": ["黑白对比", "胶片颗粒", "纪录片质感", "杂志胶片标签"],
  "design_soul": "暗房里的相纸缓慢显影，纯黑底色上浮现出高反差的白色文字和胶片元数据，颗粒感细腻而克制。",
  "variation_strategy": "封面用大号 sans + serif italic 关键词 + 胶片元数据，章节页用极简单线分割 + 序号，内容页用胶片接片墙感。",
  "decoration_dna": {
    "signature_move": "SVG turbulence noise 胶片颗粒 + 胶片元数据 chip (mono font) + L 形角标 + 单色调（无任何彩色 accent）",
    "forbidden": ["任何彩色 accent (青/橙/金/紫/红/绿)", "渐变背景", "圆角大于 4px", "霓虹效果", "卡通元素"],
    "recommended_combos": ["黑底白字 + 胶片颗粒 + 元数据 chip 排", "L 角标 + 接片墙 + 单线分割"]
  },
  "background": { "primary": "#0a0a0a", "gradient_to": "#0a0a0a", "texture": { "type": "film_grain", "opacity": 0.06 } },
  "card": { "gradient_from": "rgba(250,250,250,0.04)", "gradient_to": "transparent", "border": "rgba(250,250,250,0.08)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#fafafa", "secondary": "rgba(250,250,250,0.5)", "title_size": 96, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#fafafa", "#5a5a5a"], "secondary": ["#2a2a2a", "#9a9a9a"] },
  "typography": {
    "display_font": "'Inter Tight', 'Helvetica Neue', -apple-system, sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Source Serif 4', 'Fraunces', 'Iowan Old Style', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', 'Courier New', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.30em",
    "feature_settings": "'ss01', 'cv11', 'calt', 'kern', 'liga', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": true, "vertical_divider": true, "drop_cap": false, "masthead": false, "film_grain": true, "film_metadata_chips": true, "monochrome_only": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/noir_film.html`](../../ppt-output/style-gallery/noir_film.html)
