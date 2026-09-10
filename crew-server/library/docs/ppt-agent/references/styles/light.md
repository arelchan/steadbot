# 浅色高级板块（8 风格）

> 板块定位：浅色背景 + 高级感 + 学术/专业/温润/医疗/工业。Apple / Anthropic / NYT / Mayo Clinic / Suisse 风格。
>
> 共享：[排版铁律](../typography.md) · [失败模式](../principles/failure-modes.md) · [Bento Grid](../bento-grid.md)

---

## 索引

| # | style_id | 灵感 | 一句话 |
|---|----------|------|-------|
| 1 | `blue_white` | Apple 企业页面 | 极简白 + 雪松灰 + 一抹蓝色（升级版）|
| 2 | `fresh_green` | Aesop / Le Labo | 米色温润 + 草绿赭石 + serif italic（升级版）|
| 3 | `minimal_gray` | NYT Magazine | 米纸底色 + serif Display + 三栏分割（升级版）|
| 4 | `mocha_editorial` | Anthropic / Pantone 2025 | Mocha 米色 + Source Serif italic + 砖红强调线 |
| 5 | `medical_pulse` | Mayo Clinic | 纯白 + 医疗蓝 + ECG 心电波 + 红十字 |
| 6 | `earth_concrete` | Suisse Int'l | 水泥灰 + 暖橙丝带 + 网格秩序感 |
| 7 | `champagne_gold` | 高端婚礼请柬 | 米白渐变 + 金色 Playfair italic + 双线装饰 |
| 8 | `liquid_glass` | iOS 26 / visionOS | 彩色渐变 + 模糊 blob + 多层液态玻璃 |

---

## 1. blue_white — 蓝白商务（升级版）

```json
{
  "style_id": "blue_white",
  "style_name": "蓝白商务 (Blue White, Apple-grade)",
  "category": "light_premium",
  "inspiration": "Apple 企业页面 / 苹果开发者文档",
  "mood_keywords": ["极简白", "雪松灰", "苹果可信赖感", "内框线条"],
  "design_soul": "纯净的白纸上，淡蓝色像一缕信任的微光，所有文字都谨慎而克制，像一份签了名的协议。",
  "variation_strategy": "封面用大留白 + 细蓝线，章节页用淡蓝色色块 + serif italic，数据页用 4 张极简卡片 + tabular-nums。",
  "decoration_dna": {
    "signature_move": "Apple 级极简白 + 内框淡线 + 蓝色脉冲圆点 label + serif italic 关键词混排 + 大量留白",
    "forbidden": ["饱和橙红", "暗色背景", "渐变文字", "霓虹效果", "卡通元素", "拥挤布局"],
    "recommended_combos": ["内框线 + 蓝色 label + 大留白", "三栏数据卡 + 横线分隔 + tabular-nums"]
  },
  "background": { "primary": "#ffffff", "gradient_to": "#f6f8fb", "texture": { "type": "none" } },
  "card": { "gradient_from": "#ffffff", "gradient_to": "#f6f8fb", "border": "rgba(10,29,58,0.06)", "border_radius": 12, "backdrop_blur": 0 },
  "text": { "primary": "#0a1d3a", "secondary": "#64748b", "title_size": 78, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#2563EB", "#1D4ED8"], "secondary": ["#059669", "#047857"] },
  "typography": {
    "display_font": "-apple-system, 'SF Pro Display', 'Inter Tight', 'Inter', BlinkMacSystemFont, sans-serif",
    "body_font": "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
    "serif_italic_font": "'Instrument Serif', 'Fraunces', Georgia, serif",
    "mono_font": "'SF Mono', 'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.042em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'kern', 'liga', 'calt', 'ss01', 'cv11', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "dot_pulse", "title_serif_italic": true, "corner_lines": true, "vertical_divider": false, "drop_cap": false, "masthead": false, "inner_frame": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/blue_white.html`](../../ppt-output/style-gallery/blue_white.html)

---

## 2. fresh_green — 清新自然（Aesop 级重做）

```json
{
  "style_id": "fresh_green",
  "style_name": "清新自然 (Fresh Green, Aesop-grade)",
  "category": "light_premium",
  "inspiration": "Aesop / Le Labo / 高级护肤品牌",
  "mood_keywords": ["温润米色", "草绿赭石", "本草自然", "serif italic"],
  "design_soul": "晨光下的工坊，米色亚麻桌布上摆着草绿色的瓶子和赭石色的种子，serif italic 标题像手写一样温润。",
  "variation_strategy": "封面用 serif italic 主标题 + 米色卡片 + 一片真实叶子 SVG，产品页用 3 张暖色卡片，章节页用大留白 + 草绿色横线。",
  "decoration_dna": {
    "signature_move": "Source Serif 4 italic 标题 + 米色暖底 + 草绿赭石双 accent + 真实叶子 SVG（不用 emoji）+ 大量留白",
    "forbidden": ["亮饱和绿（婴儿绿）", "深色背景", "霓虹效果", "硬朗几何", "拥挤布局"],
    "recommended_combos": ["serif italic 主标题 + 草绿横线 + 米色卡片", "圆形产品配图 + 赭石价格标 + tabular-nums"]
  },
  "background": { "primary": "#f4ede0", "gradient_to": "#e8dec5", "texture": { "type": "none" } },
  "card": { "gradient_from": "#fffaf0", "gradient_to": "#f4ede0", "border": "rgba(133,158,90,0.18)", "border_radius": 14, "backdrop_blur": 0 },
  "text": { "primary": "#2d3a1f", "secondary": "#5a6840", "title_size": 64, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#859e5a", "#6b8344"], "secondary": ["#a85b3a", "#8b4513"] },
  "typography": {
    "display_font": "'Source Serif 4', 'Fraunces', 'Iowan Old Style', Georgia, serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Source Serif 4', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.018em",
    "headline_letter_spacing": "-0.012em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.4em",
    "feature_settings": "'kern', 'liga', 'onum', 'calt', 'ss01'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "leaf_svg": true, "lots_of_whitespace": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400;1,8..60,500&family=Fraunces:ital,wght@0,400;1,400&family=Inter:wght@400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/fresh_green.html`](../../ppt-output/style-gallery/fresh_green.html)

---

## 3. minimal_gray — 极简灰白（NYT Magazine 级重做）

```json
{
  "style_id": "minimal_gray",
  "style_name": "极简灰白 (NYT Magazine-grade)",
  "category": "light_premium",
  "inspiration": "纽约时报杂志 / The Quarterly Review / 学术期刊",
  "mood_keywords": ["米纸杂志", "巨型 serif", "三栏分栏", "首字下沉"],
  "design_soul": "周末早晨，米黄色的纸张展开，巨大的 Playfair 标题占据整个版面，下方三栏用细线分割正文。",
  "variation_strategy": "封面用 masthead 刊号头 + 巨型 serif 标题 + 三栏正文，章节页用大号章节编号 + 短引文，内容页用图表 + 注释。",
  "decoration_dna": {
    "signature_move": "Playfair Display 70-90px 主标题 + masthead 刊号头 + 三栏分栏（column-rule）+ 首字下沉 + 砖红色仅用于关键标识",
    "forbidden": ["纯 sans 主标题", "暗色背景", "饱和彩色", "圆角过大", "霓虹效果"],
    "recommended_combos": ["masthead + serif 大标题 + 三栏正文", "首字下沉 + 砖红 label + 老式数字 onum"]
  },
  "background": { "primary": "#f7f1e3", "gradient_to": "#f7f1e3", "texture": { "type": "paper", "opacity": 0.02 } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(0,0,0,0.12)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#1a1a1a", "secondary": "#404040", "title_size": 78, "body_size": 12, "card_title_size": 16 },
  "accent": { "primary": ["#a0392b", "#1a1a1a"], "secondary": ["#666", "#999"] },
  "typography": {
    "display_font": "'Playfair Display', 'Cheltenham', Georgia, serif",
    "body_font": "'Source Serif 4', 'Iowan Old Style', Georgia, serif",
    "serif_italic_font": "'Playfair Display', Georgia, serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.025em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'kern', 'liga', 'onum', 'pnum'",
    "tabular_nums": false
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": false, "vertical_divider": true, "drop_cap": true, "masthead": true, "three_column_body": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/minimal_gray.html`](../../ppt-output/style-gallery/minimal_gray.html)

---

## 4. mocha_editorial — Mocha 编辑器（新增 - Anthropic 级）

```json
{
  "style_id": "mocha_editorial",
  "style_name": "Mocha 编辑器 (Mocha Editorial, Anthropic-grade)",
  "category": "light_premium",
  "inspiration": "Anthropic.com / claude.ai / Pantone 2025 (Mocha Mousse)",
  "mood_keywords": ["温暖知识", "咖啡杂志", "serif italic", "砖红强调"],
  "design_soul": "午后咖啡馆里翻开一本研究期刊，米色 Mocha 纸面上 serif italic 标题缓缓展开，砖红色的强调线像书签一样精确。",
  "variation_strategy": "封面用 1fr/1.5fr 不对称网格 + serif italic 主标题 + 首字下沉，章节页用大号 PART 编号 + 引导句，内容页用左右两栏 + 引文。",
  "decoration_dna": {
    "signature_move": "Source Serif 4 + Instrument Serif italic 关键词 + 砖红色短横线 (24px) 上标 + 1fr/1.5fr 不对称网格 + 首字下沉",
    "forbidden": ["sans 主标题", "暗色背景", "饱和彩色（除砖红强调外）", "拥挤布局", "霓虹效果"],
    "recommended_combos": ["serif italic 标题 + 首字下沉 + 砖红 label", "不对称网格 + 大留白 + tabular-nums onum"]
  },
  "background": { "primary": "#f3ebde", "gradient_to": "#f3ebde", "texture": { "type": "none" } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(193,80,46,0.15)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#2a1810", "secondary": "#4a3a30", "title_size": 64, "body_size": 16, "card_title_size": 18 },
  "accent": { "primary": ["#c1502e", "#8b5a3c"], "secondary": ["#a85b3a", "#5a4a3a"] },
  "typography": {
    "display_font": "'Source Serif 4', 'Tiempos Text', 'Iowan Old Style', Georgia, serif",
    "body_font": "'Source Serif 4', Georgia, serif",
    "serif_italic_font": "'Instrument Serif', 'Fraunces', 'Source Serif 4', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.025em",
    "headline_letter_spacing": "-0.015em",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.25em",
    "feature_settings": "'kern', 'liga', 'onum', 'ss01'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line_short", "title_serif_italic": true, "corner_lines": false, "vertical_divider": false, "drop_cap": true, "masthead": false, "asymmetric_grid": true, "brick_red_short_line": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400;1,8..60,500&family=Instrument+Serif:ital@0;1&family=Fraunces:ital,wght@0,400;0,500;1,400&family=Inter:wght@500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/mocha_editorial.html`](../../ppt-output/style-gallery/mocha_editorial.html)

---

## 5. medical_pulse — 医疗专科（新增）

```json
{
  "style_id": "medical_pulse",
  "style_name": "医疗专科 (Medical Pulse)",
  "category": "light_premium",
  "inspiration": "Mayo Clinic / Stanford Medicine / 医疗 AI 产品页",
  "mood_keywords": ["纯白专业", "医疗蓝青", "ECG 心电波", "红十字"],
  "design_soul": "诊室的纯白墙面上，一根青色的心电波缓缓跳动，每个数据都精确而温和，像医生的笔记。",
  "variation_strategy": "封面用纯白 + 顶部彩色横条 + ECG 心电波 SVG，数据页用 4 张浅薄荷青卡片，结果页用红十字徽章 + 关键指标。",
  "decoration_dna": {
    "signature_move": "纯白底 + 顶部 4px 渐变彩色横条 (cyan-teal-mint) + ECG 心电波 SVG + 浅薄荷绿底色卡片 + 左侧绿色边框 + 右上角十字图标",
    "forbidden": ["暗色背景", "霓虹/赛博色", "serif 杂志感", "拥挤布局", "卡通元素"],
    "recommended_combos": ["顶部渐变横条 + ECG SVG + 4 数据卡", "十字徽章 + 蓝色 label + tabular-nums 临床数据"]
  },
  "background": { "primary": "#ffffff", "gradient_to": "#ffffff", "texture": { "type": "none" } },
  "card": { "gradient_from": "#f0fdfa", "gradient_to": "#f0fdfa", "border": "#4ecdc4", "border_radius": 8, "backdrop_blur": 0 },
  "text": { "primary": "#0a2540", "secondary": "#5a7a96", "title_size": 42, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#00b4d8", "#4ecdc4"], "secondary": ["#95e1d3", "#dc2626"] },
  "typography": {
    "display_font": "'Inter Tight', 'Inter', -apple-system, sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Instrument Serif', Georgia, serif",
    "mono_font": "'IBM Plex Mono', 'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.035em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'kern', 'liga', 'ss01', 'cv11', 'calt', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "dot_pulse", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "ecg_pulse": true, "top_gradient_bar": true, "cross_badge": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/medical_pulse.html`](../../ppt-output/style-gallery/medical_pulse.html)

---

## 6. earth_concrete — 大地水泥（新增 - 建筑/工业）

```json
{
  "style_id": "earth_concrete",
  "style_name": "大地水泥 (Earth Concrete)",
  "category": "light_premium",
  "inspiration": "Suisse Int'l / 建筑事务所 / Blue Bottle Coffee",
  "mood_keywords": ["水泥灰", "暖橙丝带", "网格秩序", "工业质感"],
  "design_soul": "水泥墙面上洒着一道暖橙的阳光，60px 网格在墙上投下精确的阴影，所有文字都像建筑图纸一样克制。",
  "variation_strategy": "封面用大字号建筑名 + 水泥噪点 + 暖橙丝带，项目页用 4-6 个 mono chip，参数页用网格 + 数据。",
  "decoration_dna": {
    "signature_move": "水泥渐变背景 + radial 噪点纹理 + 60px 网格底纹 + 暖橙色 clip-path 平行四边形丝带 + JetBrains Mono 元数据 chip",
    "forbidden": ["饱和彩色", "圆角大于 8px", "serif 字体", "霓虹效果", "卡通元素"],
    "recommended_combos": ["水泥噪点 + 网格 + 暖橙丝带", "mono chip 排 + 项目编号 + tabular-nums"]
  },
  "background": { "primary": "#d4cfc4", "gradient_to": "#b5b0a5", "texture": { "type": "cement_noise", "opacity": 0.04 } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(0,0,0,0.08)", "border_radius": 4, "backdrop_blur": 0 },
  "text": { "primary": "#1a1a1a", "secondary": "#5a5a5a", "title_size": 116, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#ff6b35", "#1a1a1a"], "secondary": ["#666", "#999"] },
  "typography": {
    "display_font": "'Inter Tight', 'Suisse Intl', 'Inter', sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Instrument Serif', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.025em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.32em",
    "feature_settings": "'kern', 'liga', 'ss01', 'cv11', 'calt', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line_short", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "cement_texture": true, "grid_pattern": true, "orange_ribbon": true, "mono_chips": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/earth_concrete.html`](../../ppt-output/style-gallery/earth_concrete.html)

---

## 7. champagne_gold — 香槟金喜（新增 - 婚庆/庆典）

```json
{
  "style_id": "champagne_gold",
  "style_name": "香槟金喜 (Champagne Gold)",
  "category": "light_premium",
  "inspiration": "高端婚礼请柬 / 五星酒店宴会 / 颁奖典礼",
  "mood_keywords": ["香槟金", "双线菱形", "Playfair italic", "居中喜庆"],
  "design_soul": "米白色礼服上，金色的 Playfair italic 字符像首饰一样精致，每根金线都被熨烫得平整，等待庄严的时刻。",
  "variation_strategy": "封面用居中 Playfair italic 巨字 + 双侧金线，章节页用金色印章 + 短引文，时间表页用金色日期 + 米色卡片。",
  "decoration_dna": {
    "signature_move": "金色 Playfair italic 100-120px + 双线菱形装饰（线—菱形—线 横向）+ 圆形金色印章 + 居中对称 + 大字距 maison label",
    "forbidden": ["饱和彩色（除金色外）", "暗色背景", "sans 主标题", "拥挤布局", "霓虹效果"],
    "recommended_combos": ["Playfair italic 巨字 + 双线菱形 + 金色印章", "maison label 0.65em + 金色横线 + 居中对称"]
  },
  "background": { "primary": "#faf6ed", "gradient_to": "#f3ead0", "texture": { "type": "none" } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(201,163,90,0.3)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#2a2218", "secondary": "rgba(42,34,24,0.6)", "title_size": 108, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#c9a35a", "#b88d3a"], "secondary": ["#f5e8c8", "#8e6a25"] },
  "typography": {
    "display_font": "'Playfair Display', 'Bodoni Moda', 'Didot', Georgia, serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Playfair Display', 'Didot', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.005em",
    "headline_letter_spacing": "0",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.65em",
    "feature_settings": "'kern', 'liga', 'dlig', 'calt', 'onum'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": true, "vertical_divider": true, "drop_cap": false, "masthead": false, "centered_symmetric": true, "gold_double_line": true, "gold_seal": true, "gold_gradient_text": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/champagne_gold.html`](../../ppt-output/style-gallery/champagne_gold.html)

---

## 8. liquid_glass — 液态玻璃（新增 - iOS 26 / visionOS）

```json
{
  "style_id": "liquid_glass",
  "style_name": "液态玻璃 (Liquid Glass)",
  "category": "light_premium",
  "inspiration": "iOS 26 / visionOS / Apple Vision Pro",
  "mood_keywords": ["液态玻璃", "毛玻璃 blob", "彩色渐变", "多层深度"],
  "design_soul": "Vision Pro 里浮动的玻璃面板，多层透明卡片在彩色光晕中折射出微妙的光泽，每个 blob 都像一颗液态的星。",
  "variation_strategy": "封面用大彩色渐变 + 5 个 blob + 1 张大玻璃卡，应用页用 3 张玻璃卡 + 顶部玻璃导航条，结果页用玻璃徽章 + 中央数据。",
  "decoration_dna": {
    "signature_move": "彩色渐变背景（蓝/粉/橙）+ 多个模糊 blob (rgba radial-gradient + filter blur) + 液态玻璃卡片 (rgba 半透明 + backdrop-filter blur) + 多层深度 + SF Pro",
    "forbidden": ["纯白/纯黑背景", "硬朗几何", "serif 字体", "暗调", "高对比"],
    "recommended_combos": ["彩色渐变 + 5 blob + 玻璃卡", "Live 徽章 + 顶部玻璃导航 + 多层深度"]
  },
  "background": { "primary": "linear-gradient(135deg, #1a73e8 0%, #34a0ff 40%, #ff6b9d 100%)", "gradient_to": "#ff6b9d", "texture": { "type": "blob_glass" } },
  "card": { "gradient_from": "rgba(255,255,255,0.15)", "gradient_to": "rgba(255,255,255,0.08)", "border": "rgba(255,255,255,0.35)", "border_radius": 20, "backdrop_blur": 30 },
  "text": { "primary": "#FFFFFF", "secondary": "rgba(255,255,255,0.85)", "title_size": 96, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#ff6b9d", "#ffb74d"], "secondary": ["#34a0ff", "#1a73e8"] },
  "typography": {
    "display_font": "-apple-system, 'SF Pro Display', 'Inter Tight', BlinkMacSystemFont, sans-serif",
    "body_font": "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
    "serif_italic_font": "'Instrument Serif', Georgia, serif",
    "mono_font": "'SF Mono', 'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.045em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'kern', 'liga', 'ss01', 'cv11', 'calt', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "blob_decorations": true, "glass_cards": true, "multi_layer_depth": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/liquid_glass.html`](../../ppt-output/style-gallery/liquid_glass.html)
