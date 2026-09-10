#!/usr/bin/env python3
"""gallery.py -- 风格预览画廊生成器

读取 references/styles/*.md 中的 26 风格定义，生成：
- ppt-output/style-gallery/index.html  统一卡片墙索引（按 5 板块分组）
- 可选：调用 puppeteer 截图每个 mock 为 PNG（--screenshots 选项）

用法:
    python3 scripts/gallery.py                    # 生成 index.html
    python3 scripts/gallery.py --screenshots      # + 生成 PNG 截图
    python3 scripts/gallery.py --serve            # + 启动本地预览服务

输出:
    ppt-output/style-gallery/index.html
    ppt-output/style-gallery/<style_id>.png  (with --screenshots)
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT / "references" / "styles"
GALLERY_DIR = ROOT / "ppt-output" / "style-gallery"

CATEGORY_LABELS = {
    "dark_professional": ("暗色专业", "Dark Professional"),
    "light_premium": ("浅色高级", "Light Premium"),
    "vibrant": ("活力鲜明", "Vibrant"),
    "cultural_oriental": ("东方文化", "Cultural Oriental"),
    "natural_retro": ("自然/复古", "Natural / Retro"),
}

CATEGORY_ORDER = [
    "dark_professional",
    "light_premium",
    "vibrant",
    "cultural_oriental",
    "natural_retro",
]


def extract_style_jsons(md_path: Path) -> list:
    """从 markdown 中提取所有 ```json ... ``` 中含 style_id 的对象。"""
    text = md_path.read_text(encoding="utf-8")
    blocks = re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    styles = []
    for block in blocks:
        try:
            obj = json.loads(block)
            if isinstance(obj, dict) and "style_id" in obj:
                styles.append(obj)
        except json.JSONDecodeError:
            pass
    return styles


def collect_all_styles() -> list:
    """收集所有 26 风格。"""
    styles = []
    for md in sorted(STYLES_DIR.glob("*.md")):
        if md.name == "index.md":
            continue
        styles.extend(extract_style_jsons(md))
    return styles


def group_by_category(styles: list) -> dict:
    """按 category 分组。"""
    groups = {cat: [] for cat in CATEGORY_ORDER}
    for s in styles:
        cat = s.get("category", "uncategorized")
        if cat in groups:
            groups[cat].append(s)
    return groups


def get_swatches(style: dict) -> list:
    """提取 5 个代表色用于 swatch 行。"""
    bg = style.get("background", {})
    accent = style.get("accent", {})
    primary = accent.get("primary", [])
    secondary = accent.get("secondary", [])
    swatches = []
    if isinstance(bg.get("primary"), str) and bg["primary"].startswith("#"):
        swatches.append(bg["primary"])
    swatches.extend(primary[:2])
    swatches.extend(secondary[:2])
    # fallback 默认色
    while len(swatches) < 5:
        swatches.append("#888888")
    return swatches[:5]


def build_index_html(grouped: dict) -> str:
    """生成统一索引 HTML。"""
    sections = []

    for cat in CATEGORY_ORDER:
        styles = grouped.get(cat, [])
        if not styles:
            continue
        cn, en = CATEGORY_LABELS[cat]
        cards = []
        for s in styles:
            sid = s["style_id"]
            name = s["style_name"]
            inspiration = s.get("inspiration", "")
            soul = s.get("design_soul", "")[:90] + ("..." if len(s.get("design_soul", "")) > 90 else "")
            keywords = s.get("mood_keywords", [])
            swatches = get_swatches(s)
            sw_html = "".join(
                f'<div class="sw" style="background:{c}"></div>'
                for c in swatches
            )
            kw_html = " · ".join(keywords[:3])
            cards.append(f"""
        <a class="card" href="{sid}.html" target="_blank" rel="noopener">
          <div class="frame">
            <iframe src="{sid}.html" loading="lazy" sandbox="allow-same-origin" scrolling="no" tabindex="-1"></iframe>
          </div>
          <div class="meta">
            <div class="row1">
              <span class="name">{name}</span>
              <span class="open">↗</span>
            </div>
            <div class="row2">
              <span class="id">{sid}</span>
              <span class="dot">·</span>
              <span class="insp">{inspiration}</span>
            </div>
            <div class="kw">{kw_html}</div>
            <div class="swatches">{sw_html}</div>
          </div>
        </a>
""".strip())

        sections.append(f"""
    <section class="section">
      <div class="section-head">
        <div class="section-cn">{cn}</div>
        <div class="section-en">{en}</div>
        <div class="section-count">{len(styles)} 风格</div>
      </div>
      <div class="grid">
        {chr(10).join(cards)}
      </div>
    </section>
""".strip())

    body = "\n".join(sections)
    total = sum(len(v) for v in grouped.values())

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PPT Agent Skill · 26 风格预览画廊</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html, body {{
    background: #0a0a0c;
    color: #fff;
    font-family: 'Inter', -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    min-height: 100vh;
  }}
  .header {{
    padding: 60px 60px 40px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }}
  .header .label {{
    font-size: 11px;
    letter-spacing: 0.18em;
    color: #22D3EE;
    font-weight: 600;
    text-transform: uppercase;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }}
  .header .label::before {{
    content: '';
    width: 6px; height: 6px; border-radius: 50%;
    background: #22D3EE;
    box-shadow: 0 0 10px currentColor;
  }}
  .header h1 {{
    font-family: 'Inter Tight', sans-serif;
    font-size: 56px;
    font-weight: 700;
    letter-spacing: -0.045em;
    margin-top: 14px;
    line-height: 1;
  }}
  .header h1 em {{
    font-family: Georgia, 'Source Serif Pro', serif;
    font-style: italic;
    font-weight: 400;
    color: #22D3EE;
  }}
  .header .deck {{
    font-size: 16px;
    line-height: 1.6;
    color: rgba(255,255,255,0.65);
    max-width: 720px;
    margin-top: 18px;
    letter-spacing: -0.005em;
  }}
  .header .stats {{
    display: flex; gap: 48px; margin-top: 32px;
  }}
  .header .stat .num {{
    font-family: 'Inter Tight', sans-serif;
    font-size: 32px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.025em;
  }}
  .header .stat .l {{
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-top: 4px;
  }}

  .section {{
    padding: 50px 60px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }}
  .section-head {{
    display: flex; align-items: baseline; gap: 14px; margin-bottom: 28px;
  }}
  .section-cn {{
    font-family: 'Inter Tight', sans-serif;
    font-size: 22px; font-weight: 700;
    letter-spacing: -0.025em;
  }}
  .section-en {{
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-family: 'JetBrains Mono', monospace;
  }}
  .section-count {{
    margin-left: auto;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    letter-spacing: 0.05em;
    font-family: 'JetBrains Mono', monospace;
  }}

  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
    gap: 18px;
  }}
  .card {{
    background: #14141a;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, transform 0.15s;
    display: flex;
    flex-direction: column;
  }}
  .card:hover {{
    border-color: rgba(34,211,238,0.4);
    transform: translateY(-2px);
  }}
  .frame {{
    aspect-ratio: 16 / 9;
    overflow: hidden;
    position: relative;
    background: #000;
  }}
  .frame iframe {{
    border: 0;
    width: 1280px;
    height: 720px;
    transform: scale(calc(100% / 1280 * 420));
    transform-origin: top left;
    pointer-events: none;
    position: absolute;
    top: 0; left: 0;
  }}
  .meta {{
    padding: 14px 16px;
  }}
  .row1 {{
    display: flex; align-items: center; justify-content: space-between;
  }}
  .row1 .name {{
    font-family: 'Inter Tight', sans-serif;
    font-size: 14px; font-weight: 700;
    letter-spacing: -0.015em;
  }}
  .row1 .open {{
    font-size: 14px;
    color: rgba(255,255,255,0.4);
  }}
  .row2 {{
    display: flex; gap: 6px; align-items: center;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    margin-top: 4px;
  }}
  .row2 .id {{
    font-family: 'JetBrains Mono', monospace;
    color: #22D3EE;
  }}
  .row2 .dot {{ opacity: 0.4; }}
  .kw {{
    font-size: 11px;
    color: rgba(255,255,255,0.55);
    margin-top: 8px;
    line-height: 1.5;
  }}
  .swatches {{
    display: flex; gap: 4px; margin-top: 10px;
  }}
  .sw {{
    width: 18px; height: 18px; border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.1);
  }}

  .footer {{
    padding: 40px 60px 60px;
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }}
  .footer a {{
    color: rgba(255,255,255,0.5);
    text-decoration: none;
    transition: color 0.15s;
  }}
  .footer a:hover {{ color: #22D3EE; }}
</style>
</head>
<body>
  <header class="header">
    <div class="label">PPT AGENT SKILL · WORLD-CLASS</div>
    <h1>风格预览<em>画廊。</em></h1>
    <p class="deck">26 个世界级演示文稿风格，按 5 板块分组。每张卡片是真实 1280×720 设计稿的缩略预览，点击打开看原尺寸。</p>
    <div class="stats">
      <div class="stat"><div class="num">{total}</div><div class="l">STYLES</div></div>
      <div class="stat"><div class="num">5</div><div class="l">CATEGORIES</div></div>
      <div class="stat"><div class="num">18</div><div class="l">CHART TYPES</div></div>
    </div>
  </header>

{body}

  <footer class="footer">
    <a href="https://github.com" target="_blank">PPT AGENT SKILL · MMXXVI</a>
  </footer>
</body>
</html>
"""


def take_screenshots(styles: list) -> bool:
    """用 puppeteer 截图每个 mock 为 PNG。"""
    # 找 puppeteer 安装位置：优先项目根，其次 ppt-output/e2e-test
    candidates = [ROOT, ROOT / "ppt-output" / "e2e-test"]
    work_dir = None
    for cand in candidates:
        if (cand / "node_modules" / "puppeteer").exists():
            work_dir = cand
            break
    if work_dir is None:
        # 如果都没装，在项目根装一个
        work_dir = ROOT
        print("Installing puppeteer in project root...")
        subprocess.run(["npm", "install", "puppeteer"],
                      capture_output=True, text=True, timeout=180, cwd=str(work_dir))

    script_path = work_dir / ".gallery_screenshot.cjs"
    files = [{"id": s["style_id"], "html": str(GALLERY_DIR / f"{s['style_id']}.html"), "png": str(GALLERY_DIR / f"{s['style_id']}.png")} for s in styles]

    js = """
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const config = JSON.parse(process.argv[2]);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--font-render-hinting=none']
  });
  for (const item of config.files) {
    if (!fs.existsSync(item.html)) {
      console.warn('skip (no HTML):', item.id);
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
    await page.goto('file://' + item.html, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: item.png, fullPage: false });
    console.log('PNG: ' + item.id);
    await page.close();
  }
  await browser.close();
  console.log('Done: ' + config.files.length + ' screenshots');
})();
"""
    script_path.write_text(js)
    try:
        r = subprocess.run(
            ["node", str(script_path), json.dumps({"files": files})],
            cwd=str(work_dir), timeout=600
        )
        return r.returncode == 0
    finally:
        if script_path.exists():
            script_path.unlink()


def main():
    parser = argparse.ArgumentParser(description="PPT Style Gallery Generator")
    parser.add_argument("--screenshots", action="store_true",
                       help="Also take PNG screenshots of each mock (requires puppeteer)")
    parser.add_argument("--out", default=str(GALLERY_DIR / "index.html"),
                       help="Output index.html path")
    args = parser.parse_args()

    styles = collect_all_styles()
    if not styles:
        print("Error: no styles found in references/styles/*.md", file=sys.stderr)
        sys.exit(1)

    grouped = group_by_category(styles)
    html = build_index_html(grouped)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")

    print(f"\n{'='*60}")
    print(f"Gallery Index Generated")
    print(f"{'='*60}")
    print(f"📊 Total styles: {len(styles)}")
    for cat in CATEGORY_ORDER:
        cn, en = CATEGORY_LABELS[cat]
        cnt = len(grouped.get(cat, []))
        print(f"   · {cn} ({en}): {cnt}")
    print(f"\n📄 Output: {out_path}")
    print(f"   Open in browser to preview all 26 styles")

    if args.screenshots:
        print(f"\n📸 Taking screenshots...")
        ok = take_screenshots(styles)
        print(f"   {'✅ Done' if ok else '❌ Failed'} -> {GALLERY_DIR}/<style_id>.png")


if __name__ == "__main__":
    main()
