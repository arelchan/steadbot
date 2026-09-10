# 自然/复古板块（4 风格）

> 板块定位：自然元素 + 复古情怀 + 严肃官方。Patagonia / National Geographic / 70 年代 / 党政机关。

---

## 索引

| # | style_id | 灵感 | 一句话 |
|---|----------|------|-------|
| 1 | `botanic_forest` | Patagonia / Nat Geo | 深绿森林 + 暖橙夕阳 + serif italic |
| 2 | `safari_savanna` | National Geographic | 沙漠暖橙 + 探险护照邮戳 + 经纬度 |
| 3 | `retro_70s` | Wes Anderson / 黑胶 | 棕橙黄三色 + 圆润 70s 字体 + 颗粒感 |
| 4 | `gov_authority` | 人民日报 / 国务院 | 庄严深红蓝 + 五角星 + 章印 |

---

## 1. botanic_forest（新增 - 户外/可持续）

```json
{
  "style_id": "botanic_forest",
  "style_name": "深林秘境 (Botanic Forest)",
  "category": "natural_retro",
  "inspiration": "Patagonia / The North Face / National Geographic",
  "mood_keywords": ["深森绿", "暖橙夕阳", "户外质感", "serif italic"],
  "design_soul": "夜幕降临前的森林深处，最后一缕暖橙夕阳穿过松枝，山脉剪影在远方静默。",
  "variation_strategy": "封面用 serif italic 标题 + 山脉 SVG + 叶子装饰，故事页用大文字 + 简笔地图，结果页用 3 张数据卡 + tabular-nums 里程。",
  "decoration_dna": {
    "signature_move": "深绿径向背景 + 暖橙 accent + Source Serif italic 大标题 + SVG 山脉剪影 + 叶子 SVG 装饰",
    "forbidden": ["亮饱和绿（婴儿绿）", "纯白背景", "霓虹效果", "卡通元素", "拥挤布局"],
    "recommended_combos": ["深绿底 + 暖橙夕阳光晕 + serif italic", "山脉 SVG + 叶子 SVG + 经纬度 mono"]
  },
  "background": { "primary": "#1a2e1f", "gradient_to": "#0d1a14", "gradient_direction": "radial 100% 80% at 70% 30%", "texture": { "type": "subtle_grain", "opacity": 0.03 } },
  "card": { "gradient_from": "rgba(255,140,66,0.08)", "gradient_to": "rgba(255,140,66,0.02)", "border": "rgba(255,140,66,0.25)", "border_radius": 6, "backdrop_blur": 0 },
  "text": { "primary": "#e8efe2", "secondary": "rgba(232,239,226,0.7)", "title_size": 96, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#ff8c42", "#e8b86d"], "secondary": ["#5a8c3a", "#3a5e28"] },
  "typography": {
    "display_font": "'Source Serif 4', 'Fraunces', Georgia, serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Source Serif 4', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "-0.025em",
    "headline_letter_spacing": "-0.015em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.22em",
    "feature_settings": "'kern', 'liga', 'onum', 'calt', 'ss01', 'cv11'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "mountain_silhouette_svg": true, "leaf_svg": true, "warm_sunset_glow": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400;1,8..60,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/botanic_forest.html`](../../ppt-output/style-gallery/botanic_forest.html)

---

## 2. safari_savanna（新增 - 旅行/探险）

```json
{
  "style_id": "safari_savanna",
  "style_name": "萨凡纳探险 (Safari Savanna)",
  "category": "natural_retro",
  "inspiration": "National Geographic / Lonely Planet / 萨凡纳草原日落",
  "mood_keywords": ["沙漠暖橙", "探险护照", "经纬度元数据", "旅行刊物"],
  "design_soul": "牛皮纸做的旅行日记翻开，盖着倾斜的探险邮戳，旁边是手绘的简笔地图和经纬度坐标。",
  "variation_strategy": "封面用 Playfair italic 标题 + 探险邮戳 + 经纬度，行程页用地图 + 时间线，故事页用大字号 + 引文。",
  "decoration_dna": {
    "signature_move": "温暖沙漠米色底 + 茶色边框 + 探险护照邮戳（倾斜 -12 度）+ 简笔地图 SVG + 经纬度 mono 元数据",
    "forbidden": ["纯白背景", "暗色调", "霓虹效果", "硬朗几何", "拥挤布局"],
    "recommended_combos": ["沙漠米底 + 倾斜邮戳 + 简笔地图", "经纬度 mono + 落日橙 accent + serif italic"]
  },
  "background": { "primary": "#f3e6cc", "gradient_to": "#e8d4a8", "gradient_direction": "linear 135deg", "texture": { "type": "paper_grain", "opacity": 0.04 } },
  "card": { "gradient_from": "transparent", "gradient_to": "transparent", "border": "rgba(196,77,42,0.4)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#2a1f0f", "secondary": "#5a4a30", "title_size": 78, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#c44d2a", "#8b3a1f"], "secondary": ["#e8b86d", "#5a4a30"] },
  "typography": {
    "display_font": "'Playfair Display', 'Fraunces', Georgia, serif",
    "body_font": "'Source Serif 4', Georgia, serif",
    "serif_italic_font": "'Playfair Display', 'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', monospace",
    "display_letter_spacing": "-0.025em",
    "headline_letter_spacing": "-0.015em",
    "body_letter_spacing": "0",
    "label_letter_spacing": "0.42em",
    "feature_settings": "'kern', 'liga', 'onum', 'calt', 'ss01'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": true, "corner_lines": true, "vertical_divider": false, "drop_cap": false, "masthead": false, "expedition_stamp": true, "tilted_passport": true, "simple_map_svg": true, "geo_metadata_mono": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&family=JetBrains+Mono:wght@400;500;700&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/safari_savanna.html`](../../ppt-output/style-gallery/safari_savanna.html)

---

## 3. retro_70s（新增 - 70 年代复古）

```json
{
  "style_id": "retro_70s",
  "style_name": "70 年代复古 (Retro 70s)",
  "category": "natural_retro",
  "inspiration": "Wes Anderson / 黑胶唱片 / Saul Bass / 1970s 海报",
  "mood_keywords": ["棕橙黄拼贴", "圆润粗壮", "复古颗粒", "Wes Anderson 对称"],
  "design_soul": "1972 年布鲁克林的独立咖啡馆，墙上挂着 Saul Bass 的海报，棕橙黄三色像唱片封面一样和谐。",
  "variation_strategy": "封面用 Bagel Fat One 巨字 + 棕橙黄拼贴，菜单页用圆形装饰 + 圆角卡，故事页用复古颗粒 + serif body。",
  "decoration_dna": {
    "signature_move": "奶油底 + 棕橙黄三色拼贴 + Bagel Fat One 圆润粗壮字体 + 复古颗粒（SVG turbulence）+ 圆形装饰元素 + Wes Anderson 对称",
    "forbidden": ["暗色背景", "霓虹效果", "霓虹色（紫粉青）", "硬朗几何", "拥挤布局"],
    "recommended_combos": ["奶油底 + 圆形棕橙 + Bagel Fat One 巨字", "颗粒纹理 + 圆角卡 + 黑胶元素"]
  },
  "background": { "primary": "#f4e9d0", "gradient_to": "#f4e9d0", "texture": { "type": "retro_grain", "opacity": 0.10 } },
  "card": { "gradient_from": "#ffffff", "gradient_to": "#f4e9d0", "border": "#6b4423", "border_radius": 8, "backdrop_blur": 0 },
  "text": { "primary": "#2a1810", "secondary": "#5a3823", "title_size": 116, "body_size": 14, "card_title_size": 18 },
  "accent": { "primary": ["#e07a3e", "#d4a82a"], "secondary": ["#6b4423", "#c14d3f"] },
  "typography": {
    "display_font": "'Bagel Fat One', 'Bowlby One', 'Inter Tight', sans-serif",
    "body_font": "'Inter', -apple-system, sans-serif",
    "serif_italic_font": "'Fraunces', Georgia, serif",
    "mono_font": "'JetBrains Mono', 'DM Mono', monospace",
    "display_letter_spacing": "-0.035em",
    "headline_letter_spacing": "-0.02em",
    "body_letter_spacing": "-0.005em",
    "label_letter_spacing": "0.4em",
    "feature_settings": "'kern', 'liga', 'ss01', 'cv11', 'calt'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": false, "vertical_divider": false, "drop_cap": false, "masthead": false, "circular_decorations": true, "retro_grain": true, "vinyl_record": true, "warm_palette_collage": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Bowlby+One&family=Inter+Tight:wght@500;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/retro_70s.html`](../../ppt-output/style-gallery/retro_70s.html)

---

## 4. gov_authority（新增 - 党政严肃）

```json
{
  "style_id": "gov_authority",
  "style_name": "庄严官方 (Government Authority)",
  "category": "natural_retro",
  "inspiration": "人民日报头版 / 新华社 / 国务院新闻办 / 国宴",
  "mood_keywords": ["庄严深红蓝", "宋体居中", "五角星章印", "极致克制"],
  "design_soul": "国宴大厅前的红地毯，国徽在中央庄严挂起，宋体大字在金线下方居中，每一个细节都不容轻慢。",
  "variation_strategy": "封面用红蓝双色横条 + 居中宋体大标题 + 五角星，章节页用大号章节编号 + 引文，内容页用四栏数据 + tabular-nums。",
  "decoration_dna": {
    "signature_move": "深红 + 深蓝双色横条头 + 居中 Source Han Serif 宋体 + 五角星 SVG + 章印感方框 + 双线分割 + 居中对称",
    "forbidden": ["饱和橙黄绿", "霓虹效果", "卡通元素", "圆角过大", "拥挤布局", "马卡龙糖果色"],
    "recommended_combos": ["红蓝双色横条 + 居中宋体 + 五角星", "章印方框 + 居中对称 + tabular-nums 数据"]
  },
  "background": { "primary": "#fffaf3", "gradient_to": "#fffaf3", "texture": { "type": "subtle_grain", "opacity": 0.02 } },
  "card": { "gradient_from": "#ffffff", "gradient_to": "#fffaf3", "border": "rgba(196,30,58,0.3)", "border_radius": 0, "backdrop_blur": 0 },
  "text": { "primary": "#1a1a1a", "secondary": "#404040", "title_size": 64, "body_size": 14, "card_title_size": 16 },
  "accent": { "primary": ["#c41e3a", "#1a3a6e"], "secondary": ["#8b1721", "#0d2a5e"] },
  "typography": {
    "display_font": "'Source Han Serif SC', 'Noto Serif SC', 'STSong', SimSun, serif",
    "body_font": "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    "serif_italic_font": "'Source Han Serif SC', serif",
    "mono_font": "'JetBrains Mono', monospace",
    "display_letter_spacing": "0.22em",
    "headline_letter_spacing": "0.15em",
    "body_letter_spacing": "0.05em",
    "label_letter_spacing": "0.45em",
    "feature_settings": "'kern', 'liga', 'palt', 'calt'",
    "tabular_nums": true
  },
  "decorations": { "label_anchor": "horizontal_line", "title_serif_italic": false, "corner_lines": true, "vertical_divider": true, "drop_cap": false, "masthead": false, "centered_symmetric": true, "red_blue_top_bar": true, "five_star_svg": true, "seal_box": true },
  "font_imports": ["https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"]
}
```

Mock: [`ppt-output/style-gallery/gov_authority.html`](../../ppt-output/style-gallery/gov_authority.html)
