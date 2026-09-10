# 竖屏示例 · 上半年增长复盘（小红书 / 公众号）

一个完整的**竖屏低密度**汇报示例：10 张卡，覆盖全部 10 种竖屏模板，一套内容能精准产出
小红书图文（3:4 逐张）、公众号长图、朋友圈、手机全屏等多种规格。

## 内容编排（低内容密度、高有效信息密度）

| 页 | 模板 | 一屏一个点 |
|---|---|---|
| 1 | cover | 封面钩子：「2026 上半年 · 增长做对了什么」 |
| 2 | big-number | 次留 **68%** 创新高 |
| 3 | list | 增长三级火箭（3 项） |
| 4 | single-chart | DAU 半年翻倍曲线 |
| 5 | quote | 金句：增长不是堆功能，是把体验磨到顺 |
| 6 | section | 章节分隔：下半年怎么打 |
| 7 | end | 小结 + 关注/转发 CTA |
| 8 | comparison | 重构前后对比 42% → 68% |
| 9 | timeline | 1 月 / 3 月 / 6 月 三步走 |
| 10 | image-text | 上图下文：三级火箭 |

## 构建 & 导出

```bash
python3 build.py                                  # 合成竖屏网页 → dist/

# 小红书图文：逐张 3:4 PNG（1242×1656）
python3 export_images.py dist/*.html --preset 小红书 --out dist/xiaohongshu

# 公众号长图：一张超长 PNG（卡间留 16px）
python3 export_images.py dist/*.html --preset 公众号 --gap 16 --out dist/changtu

# 手机全屏 9:16 / 朋友圈 4:5：同一套内容换比例重渲染
python3 export_images.py dist/*.html --preset 手机汇报 --out dist/phone
python3 export_images.py dist/*.html --preset 朋友圈   --out dist/moments
```

> 画幅设在 `src/shell.html` 的 `<body>`（本例 1242×1656 小红书）；`export_images.py --preset`
> 会按目标场景**重新渲染**，所以同一份内容能出任意平台规格。

详见 [`references/portrait.md`](../../references/portrait.md)（竖屏设计规范）+
[`assets/presets.json`](../../assets/presets.json)（场景规格表）。
