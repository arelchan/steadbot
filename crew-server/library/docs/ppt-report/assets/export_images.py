"""
竖屏导出 —— 把合成的竖屏 HTML 导出为「逐张 PNG / 公众号长图 / PDF」。

依赖：pip install playwright img2pdf pillow ; playwright install chromium

用法：
  python3 export_images.py [HTML]                 # 自动读 deck 的 --design-w/h，逐张 PNG
  python3 export_images.py [HTML] --preset xiaohongshu   # 按场景规格表(presets.json)定尺寸+形态
  python3 export_images.py [HTML] --size 1080x1920 --mode images,long,pdf
  python3 export_images.py [HTML] --preset 公众号        # 中文别名也认（→ 长图）

  --preset  presets.json 里的 key 或中文别名（小红书/公众号/朋友圈/手机汇报/视频号…）
  --size    WxH 显式画幅（覆盖 preset / deck）
  --mode    images,long,pdf 任意组合（默认按 preset 的 export，再默认 images）
  --out     输出目录（默认 HTML 同级的 <name>.export/）
"""
import os
import sys
import json
import argparse

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_presets():
    p = os.path.join(ROOT, 'presets.json')
    if not os.path.exists(p):
        return {'presets': {}, 'scenario_aliases': {}}
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def find_html():
    for base in (os.path.join(os.getcwd(), 'dist'), os.getcwd(), os.path.join(ROOT, 'dist'), ROOT):
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if f.endswith('.html') and not f.startswith('.'):
                return os.path.join(base, f)
    raise SystemExit('未找到 HTML（dist/ 或当前目录）。')


def resolve_preset(name, presets):
    if not name:
        return None
    aliases = presets.get('scenario_aliases', {})
    key = aliases.get(name, name)
    return presets.get('presets', {}).get(key)


OVERRIDE_CSS = """
:root { --fit: 1 !important; }
.nav, .theme-switcher { display: none !important; }
.stage { bottom: 0 !important; }
.canvas { transform: translate(-50%, -50%) scale(1) !important; }
"""

DISABLE_ANIM_JS = """
() => {
  if (window.echarts) {
    const o = echarts.init;
    echarts.init = function(...a){ const i=o.apply(this,a); const s=i.setOption.bind(i);
      i.setOption=(opt,...r)=>s({...opt,animation:false},...r); return i; };
  }
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html', nargs='?')
    ap.add_argument('--preset')
    ap.add_argument('--size')
    ap.add_argument('--mode')
    ap.add_argument('--out')
    ap.add_argument('--dsf', type=int, default=2)
    ap.add_argument('--gap', type=int, default=0, help='长图卡间距（设计 px，默认 0 无缝）')
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    html = os.path.abspath(args.html or find_html())  # file:// 需要绝对路径
    if not os.path.exists(html):
        raise SystemExit(f'HTML 不存在：{html}')

    presets = load_presets()
    preset = resolve_preset(args.preset, presets)

    # 画幅：--size > preset > deck 的 --design-w/h > 默认 1080×1440
    W = H = None
    if args.size:
        W, H = (int(x) for x in args.size.lower().split('x'))
    elif preset and preset.get('width'):
        W = preset['width']
        H = preset.get('height')  # 长图场景 height 可能为 null，后面用内容高度

    # 形态
    modes = None
    if args.mode:
        modes = [m.strip() for m in args.mode.split(',') if m.strip()]
    elif preset:
        exp = preset.get('export', [])
        modes = []
        if 'images' in exp:
            modes.append('images')
        if 'longimage' in exp:
            modes.append('long')
        if 'pdf' in exp:
            modes.append('pdf')
    if not modes:
        modes = ['images']

    name = os.path.splitext(os.path.basename(html))[0]
    out_dir = args.out or os.path.join(os.path.dirname(html), f'{name}.export')
    os.makedirs(out_dir, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 先用临时 viewport 打开，读 deck 的设计画幅（没显式给时）
        page = browser.new_page(device_scale_factor=args.dsf)
        page.on('pageerror', lambda e: print('[pageerror]', e))
        page.goto('file://' + html)
        page.wait_for_load_state('domcontentloaded')

        if not W:
            # 从 <body> 读（竖屏的 --design-w/h 设在 body 上；从 html 读会拿到横屏默认值）
            dw = page.evaluate("() => getComputedStyle(document.body).getPropertyValue('--design-w')")
            dh = page.evaluate("() => getComputedStyle(document.body).getPropertyValue('--design-h')")
            W = int(float(dw.replace('px', '').strip() or 1080)) if dw else 1080
            H = int(float(dh.replace('px', '').strip() or 1440)) if dh else 1440
        if not H:
            H = int(W * 4 / 3)  # 长图无显式高度时单页按 3:4 截，最后纵向拼

        page.set_viewport_size({'width': W, 'height': H})
        # 注入目标画幅：让 deck 按本次场景的比例重新渲染 —— 一套内容 → 任意场景尺寸
        #（竖屏模板用 flex 自适应高度，换比例会重排；canvas 继承 body 的 --design-w/h）。
        size_css = f"\nbody {{ --design-w: {W}px !important; --design-h: {H}px !important; }}\n"
        page.add_style_tag(content=OVERRIDE_CSS + size_css)
        page.evaluate(DISABLE_ANIM_JS)
        page.wait_for_timeout(300)

        n = page.evaluate('() => document.querySelectorAll(".slide").length')
        if not n:
            raise SystemExit('没找到 .slide。')

        png_paths = []
        for i in range(n):
            page.evaluate(
                """(idx)=>{document.querySelectorAll('.slide').forEach((s,j)=>s.classList.toggle('active',j===idx));
                   window.dispatchEvent(new Event('resize'));
                   if(typeof window['initSlide'+(idx+1)]==='function'){try{window['initSlide'+(idx+1)]();}catch(e){console.error(e);}}}""",
                i,
            )
            page.wait_for_timeout(450)
            try:
                page.wait_for_function(
                    "() => { const a=document.querySelector('.slide.active')||document; return [...a.querySelectorAll('img')].every(im=>im.complete); }",
                    timeout=12000,
                )
            except Exception:
                pass
            page.wait_for_timeout(150)
            out = os.path.join(out_dir, f'page-{i + 1:02d}.png')
            page.screenshot(path=out, clip={'x': 0, 'y': 0, 'width': W, 'height': H})
            png_paths.append(out)
            print(f'  ✓ page {i + 1}/{n}')
        browser.close()

    produced = []
    if 'images' in modes:
        produced.append(f'{len(png_paths)} 张 PNG → {out_dir}/page-*.png')

    if 'long' in modes:
        from PIL import Image
        imgs = [Image.open(p).convert('RGB') for p in png_paths]
        w = max(im.width for im in imgs)
        gap = max(0, args.gap) * args.dsf            # 卡间距（输出 px）
        bg = imgs[0].getpixel((0, 0))                # 背景取首图角像素 → 适配深/浅主题
        total = sum(im.height for im in imgs) + gap * (len(imgs) - 1)
        canvas = Image.new('RGB', (w, total), bg)
        y = 0
        for i, im in enumerate(imgs):
            canvas.paste(im, ((w - im.width) // 2, y))
            y += im.height + (gap if i < len(imgs) - 1 else 0)
        long_path = os.path.join(out_dir, f'{name}-long.png')
        canvas.save(long_path)
        produced.append(f'长图 → {long_path}  ({w}×{total}，间距 {args.gap})')

    if 'pdf' in modes:
        import img2pdf
        pdf_path = os.path.join(out_dir, f'{name}.pdf')
        # 竖屏 PDF：按 W:H 比例的页面（pt）
        layout = img2pdf.get_layout_fun(pagesize=(img2pdf.px_to_pt(W, 96), img2pdf.px_to_pt(H, 96)))
        with open(pdf_path, 'wb') as f:
            f.write(img2pdf.convert(png_paths, layout_fun=layout))
        produced.append(f'PDF → {pdf_path}')

    # 仅 images 模式保留 PNG；否则若没要 images 则清理中间 PNG
    if 'images' not in modes:
        for p in png_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    print(f'\n✓ 完成（{W}×{H}，模式 {",".join(modes)}）：')
    for line in produced:
        print('  ·', line)


if __name__ == '__main__':
    main()
