# 东方文化板块（3 风格）

> 板块定位：东方审美 + 宋体/楷书 + 朱红/墨色/金色 + 留白克制。中国宫廷 / 日本侘寂 / 新中式国潮。

---

## 索引

| # | style_id | 灵感 | 一句话 |
|---|----------|------|-------|
| 1 | `royal_red` | 北京冬奥开幕式 | 朱红宫墙 + 金色角饰 + 印章（升级）|
| 2 | `sakura_wabi` | 日本侘寂 | 和纸米色 + 竖排 + 单点樱花粉 |
| 3 | `ink_jade` | 新中式国潮 | 浅米和纸 + 墨色竖排 + 一笔朱红 |

---

## 1. royal_red（升级 - 北京冬奥级）

```json
{
  "style_id": "royal_red",
  "style_name": "朱红宫墙 (Royal Red, Beijing 2022-grade)",
  "category": "cultural_oriental",
  "inspiration": "北京 2022 冬奥开幕式 / 故宫文创 / 国家博物馆",
  "mood_keywords": ["朱红宫墙", "金色角饰", "宋体居中", "印章礼仪"],
  "design_soul": "故宫的朱漆宫墙在夕阳下泛着金光，4 个 L 形金线像窗棂一样精确，居中宋体大字像一方印章压在画卷正中。",
  "variation_strategy": "封面用居中宋体 + 4 角金线 + 朱印章，章节封面用大留白 + 渐隐金线，内容页用左右对称的双栏 + 金线分割。",
  "decoration_dna": {
    "signature_move": "深朱红径向背景 + 4 个 L 形金线角饰 + Noto Serif SC 宋体居中（0.18em 字距）+ 朱印章 + 渐隐金线（垂直 60px）",
    "forbidden": ["sans 主标题", "渐变文字", "霓虹效果", "圆角过大", "亮色背景", "马卡龙糖果色"],
    "recommended_combos": ["4 角金线 + 居中宋体 + 朱印章", "渐隐金线 + 大字距 maison label + 居中对称"]
  },
  "background": { "primary": "#6b0a0a", "gradient_to": "#2d0303", "gradient_direction": "radial 80% 60% at 50% 30%", "texture": { "type": "subtle_grain", "opacity": 0.02 } },
  "card": { "gradient_from": "rgba(201,169,96,0.05)", "gradient_to": "transparent", "border": "rgba(201,169,96,0.3)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#fff8e7", "secondary": "rgba(255,248,231,0.7)", "title_size": 96, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#c9a960", "#FFD700"], "secondary": ["#c0392b", "#fff8e7"] },
  "typography": {
    "display_font": "'Noto Serif SC', 'Source Han Serif SC', 'STSong', SimSun, serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Noto Serif SC', 'STSong', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "0.18em",
    "headline_letter_spacing": "0.12em",
    "body_letter_spacing": "0.05em",
    "label_letter_spacing": "0.8em",
    "feature_settings": "'kern', 'liga', 'palt', 'ss01', 'calt'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": true, "vertical_divider": false, "drop_cap": false, "masthead": false, "centered_symmetric": true, "gold_l_corners": true, "vertical_gold_gradient_line": true, "vermilion_seal": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/royal_red.html`](../../ppt-output/style-gallery/royal_red.html)

---

## 2. sakura_wabi（新增 - 日本侘寂）

```json
{
  "style_id": "sakura_wabi",
  "style_name": "侘寂樱花 (Sakura Wabi)",
  "category": "cultural_oriental",
  "inspiration": "日本侘寂 / 京都文化馆 / 谷崎润一郎《阴翳礼赞》",
  "mood_keywords": ["和纸米色", "竖排墨色", "单点樱花粉", "极致留白"],
  "design_soul": "京都茶室里，和纸推门半开，一缕晨光把竖排墨字照亮，唯一一抹樱花粉静静停在画面一角。",
  "variation_strategy": "封面用竖排标题 + 单点粉装饰 + 70% 留白，内容页用横向小标 + 短句，结果页用印章 + 引文。",
  "decoration_dna": {
    "signature_move": "和纸米色底 + 竖排日文/中文标题 (writing-mode: vertical-rl) + 单一樱花粉圆点 (radial-gradient) + 极简单线 + 70% 以上留白",
    "forbidden": ["饱和色", "暗色背景", "拥挤布局", "硬朗几何", "霓虹效果", "sans 主标题"],
    "recommended_combos": ["竖排宋体 + 单点粉 + 大留白", "横向小标 + 极简单线 + 朱印框"]
  },
  "background": { "primary": "#f5f0e8", "gradient_to": "#f5f0e8", "texture": { "type": "washi_grain", "opacity": 0.04 } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(201,184,150,0.3)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#2c2826", "secondary": "#5a4f44", "title_size": 64, "body_size": 13, "card_title_size": 16 },
  "accent": { "primary": ["#ffb7c5", "#d97a87"], "secondary": ["#c9b896", "#8b7d6b"] },
  "typography": {
    "display_font": "'Source Han Serif SC', 'Noto Serif JP', 'Hiragino Mincho ProN', 'Songti SC', serif",
    "body_font": "'Source Han Serif SC', 'Noto Serif JP', serif",
    "serif_italic_font": "'Source Han Serif SC', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "0.32em",
    "headline_letter_spacing": "0.18em",
    "body_letter_spacing": "0.05em",
    "label_letter_spacing": "0.55em",
    "feature_settings": "'kern', 'liga', 'palt'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": false, "vertical_divider": true, "drop_cap": false, "masthead": false, "vertical_writing": true, "single_pink_dot": true, "extreme_whitespace": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&family=Inter:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/sakura_wabi.html`](../../ppt-output/style-gallery/sakura_wabi.html)

---

## 3. ink_jade（新增 - 新中式国潮）

```json
{
  "style_id": "ink_jade",
  "style_name": "墨韵新中式 (Ink Jade)",
  "category": "cultural_oriental",
  "inspiration": "茶颜悦色 / 喜茶 PRO / 故宫文创年轻线 / 朴素生活馆",
  "mood_keywords": ["浅米和纸", "墨色竖排", "一笔朱红", "新中式国潮"],
  "design_soul": "新茶饮店的菜单上，宣纸浅米色背景上，墨色竖排标题旁有一笔朱红水墨痕，年轻又清雅。",
  "variation_strategy": "封面用竖排墨色标题 + 一笔朱红 + 印章，菜单页用横排引文 + 价格，故事页用短句 + 留白。",
  "decoration_dna": {
    "signature_move": "浅米和纸底 + 墨色竖排标题 + 一笔朱红水墨晕染（div + linear-gradient + 模糊点）+ 朱印章 + 大量留白",
    "forbidden": ["饱和彩色（除朱红外）", "暗色背景", "霓虹效果", "圆角大", "硬朗几何"],
    "recommended_combos": ["浅米底 + 竖排墨色 + 朱印章 + 一笔朱红", "横向小标 + 浅金 label + 留白"]
  },
  "background": { "primary": "#f5f1e8", "gradient_to": "#f5f1e8", "texture": { "type": "rice_paper_grain", "opacity": 0.04 } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(192,57,43,0.2)", "border_radius": 2, "backdrop_blur": 0 },
  "text": { "primary": "#1a1a1a", "secondary": "#5a4f44", "title_size": 84, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#c0392b", "#1a1a1a"], "secondary": ["#c9b896", "#8b7d6b"] },
  "typography": {
    "display_font": "'Source Han Serif SC', 'Noto Serif SC', 'STKaiti', 'STSong', serif",
    "body_font": "'Source Han Serif SC', 'Noto Serif SC', serif",
    "serif_italic_font": "'Source Han Serif SC', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "0.32em",
    "headline_letter_spacing": "0.18em",
    "body_letter_spacing": "0.05em",
    "label_letter_spacing": "0.4em",
    "feature_settings": "'kern', 'liga', 'palt', 'ss01', 'calt', 'ccmp'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line_short", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "vertical_writing": true, "vermilion_brush_stroke": true, "vermilion_seal": true, "ink_bleed_subtle": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Inter:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/ink_jade.html`](../../ppt-output/style-gallery/ink_jade.html)
