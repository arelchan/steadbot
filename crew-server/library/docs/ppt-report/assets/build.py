"""
将 src/ 下的拆分文件合并成最终 HTML。

修改任意一页只需要编辑：
  - src/slides/slide-N.html   (HTML 片段)
  - src/scripts/slide-N.js    (该页图表初始化逻辑)
  - src/styles/slide-N.css    (该页特殊样式，可空)
  - src/data/slide-N.{xlsx,csv,json}  (该页数据，可选；存在则注入为 window.__DATA_N__)

数据文件支持三种格式（优先级 .json > .xlsx > .csv）：
  - .xlsx  推荐日常用 — 每个 sheet → JSON 顶层一个 key
  - .csv   单表数据 — 整份 → JSON 顶层一个 array
  - .json  原生格式 — 直接读取（机器生成 / 复杂结构时用）

详见 xlsx2json.py 顶部的转换约定。

然后运行 `python3 build.py` 即可。

通用样式/逻辑放在 src/styles/common.css、src/scripts/common.js。
配置项见文件顶部的 CONFIG。
"""
from pathlib import Path
import json
import re
import shutil
import sys

# 同目录的 xlsx2json 提供 Excel / CSV 读取能力
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
try:
    import xlsx2json
except ImportError:
    xlsx2json = None

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'

# ── CONFIG ────────────────────────────────────────────────
TITLE = '我的工作汇报'
OUT_NAME = '我的工作汇报.html'
# 自动检测 slides 数量；也可手动指定
NUM_SLIDES = None  # None = auto detect
# 构建产物输出目录（相对项目根）。源文件始终在 src/，产物单独归到此处，
# 便于用户管理「一个 PPT 用到的所有东西」：src/ 是料，dist/ 是成品。
OUT_DIR = 'dist'
# ──────────────────────────────────────────────────────────

OUT = ROOT / OUT_DIR / OUT_NAME


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8') if p.exists() else ''


def split_slide_html(raw: str):
    """从 slide 片段中分离出 (body, inline_css, inline_js)。

    模板可以把「该页专属的 <style> / <script>」直接内联在 HTML 片段里，
    做到「一个模板 = 一个文件，拷过去即插即用」。build 时自动把它们抽出来，
    分别注入到最终 HTML 的 CSS 区 / JS 区；body 里只留纯结构。

    注释里出现的 <style> / <script> 字样不会被误抓 —— 先剔除 HTML 注释，
    再在「无注释副本」里定位真实标签对（根治旧版正则从注释里误抓的坑）。
    """
    no_comments = re.sub(r'<!--.*?-->', '', raw, flags=re.S)
    css = '\n'.join(re.findall(r'<style\b[^>]*>(.*?)</style>', no_comments, flags=re.S))
    js = '\n'.join(re.findall(r'<script\b[^>]*>(.*?)</script>', no_comments, flags=re.S))
    body = re.sub(r'<!--.*?-->', '', raw, flags=re.S)
    body = re.sub(r'<style\b[^>]*>.*?</style>', '', body, flags=re.S)
    body = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.S)
    return body.strip(), css.strip(), js.strip()


def _load_slide_data(data_dir: Path, n: int):
    """查找 slide-N 数据，返回 (obj, source_label) 或 (None, None)。

    优先级：
      1. slide-N/  子目录（新格式 — 每页多数据源，文件名 stem 为 key）
      2. slide-N.json / .xlsx / .csv（旧格式 — 向后兼容）
    """
    if not data_dir.exists():
        return None, None

    # ── 新格式：slide-N/ 子目录 ──
    slide_dir = data_dir / f'slide-{n}'
    if slide_dir.is_dir():
        if xlsx2json is None:
            print(f'⚠ slide-{n}/ 目录中的 xlsx 需要 xlsx2json.py + openpyxl')
        try:
            obj = xlsx2json.load_slide_dir(slide_dir)
            if obj:
                return obj, f'slide-{n}/'
        except Exception as e:
            print(f'⚠ slide-{n}/: {e}')
        return None, None

    # ── 旧格式：单文件（向后兼容）──
    candidates = [
        ('.json', data_dir / f'slide-{n}.json'),
        ('.xlsx', data_dir / f'slide-{n}.xlsx'),
        ('.csv',  data_dir / f'slide-{n}.csv'),
    ]
    for ext, path in candidates:
        if not path.exists():
            continue
        try:
            if ext == '.json':
                obj = json.loads(path.read_text(encoding='utf-8'))
            elif ext == '.xlsx':
                if xlsx2json is None:
                    print(f'⚠ {path.name} 需要 xlsx2json.py（同目录）+ openpyxl')
                    continue
                obj = xlsx2json.xlsx_to_dict(path)
            elif ext == '.csv':
                if xlsx2json is None:
                    print(f'⚠ {path.name} 需要 xlsx2json.py（同目录）')
                    continue
                obj = xlsx2json.csv_to_list(path)
            else:
                continue
            return obj, path.name
        except Exception as e:
            print(f'⚠ {path.name}: {e}')
    return None, None


def detect_slides() -> int:
    if NUM_SLIDES is not None:
        return NUM_SLIDES
    slides_dir = SRC / 'slides'
    if not slides_dir.exists():
        return 0
    nums = []
    for f in slides_dir.glob('slide-*.html'):
        m = re.match(r'slide-(\d+)\.html', f.name)
        if m:
            nums.append(int(m.group(1)))
    return max(nums) if nums else 0


def main() -> None:
    n = detect_slides()
    if n == 0:
        raise SystemExit(f'No slides found in {SRC / "slides"}')

    # ── 0. 预读每页 HTML，分离 body / 内联 css / 内联 js ──
    slide_bodies, inline_css, inline_js = {}, {}, {}
    for i in range(1, n + 1):
        slide_bodies[i], inline_css[i], inline_js[i] = split_slide_html(
            read(SRC / 'slides' / f'slide-{i}.html'))

    # ── 1. 拼装 CSS（通用 + 竖屏(可选) + 每页 .css 文件 + 每页内联 <style>）──
    #    portrait.css 仅竖屏项目存在；缺失则 read() 返回空串，对横屏零影响。
    style_parts = [read(SRC / 'styles' / 'common.css'),
                   read(SRC / 'styles' / 'components.css'),
                   read(SRC / 'styles' / 'portrait.css')]
    for i in range(1, n + 1):
        style_parts.append(read(SRC / 'styles' / f'slide-{i}.css'))
        style_parts.append(inline_css[i])
    styles = '\n'.join(s.strip() for s in style_parts if s.strip())

    # ── 2. 拼装 SLIDES (纯结构 HTML，内联 style/script 已抽走) ──
    slide_parts = []
    for i in range(1, n + 1):
        body = slide_bodies[i].rstrip('\n')
        if body:
            slide_parts.append(f'      <!-- ── SLIDE {i} ── -->\n{body}')
    slides_html = '\n\n'.join(slide_parts)

    # ── 3. 拼装 DATA (xlsx/csv/json → window.__DATA_N__) ──
    # 同一 slide 编号下，优先级：.json > .xlsx > .csv
    data_dir = SRC / 'data'
    data_parts = []
    for i in range(1, n + 1):
        obj, src_name = _load_slide_data(data_dir, i)
        if obj is None:
            continue
        data_parts.append(
            f'window.__DATA_{i}__ = {json.dumps(obj, ensure_ascii=False)};  // <- {src_name}'
        )
    data_block = '\n'.join(data_parts)

    # ── 4. 拼装 JS（通用 + 剪影资产 + 主题切换 + 每页 .js 文件 + 每页内联 <script>）──
    #    silhouette.js 可选：存在则注入（human-portrait 页用），不存在不影响其他页。
    script_parts = [read(SRC / 'scripts' / 'common.js'),
                    read(SRC / 'scripts' / 'silhouette.js'),
                    read(SRC / 'scripts' / 'theme-switcher.js')]
    for i in range(1, n + 1):
        script_parts.append(read(SRC / 'scripts' / f'slide-{i}.js'))
        script_parts.append(inline_js[i])
    scripts = '\n\n'.join(s.strip() for s in script_parts if s.strip())

    # ── 5. 写入 shell ──
    shell = read(SRC / 'shell.html')
    final = (
        shell
        .replace('{{TITLE}}', TITLE)
        .replace('{{STYLES}}', styles)
        .replace('{{SLIDES}}', slides_html)
        .replace('{{DATA}}', data_block)
        .replace('{{SCRIPTS}}', scripts)
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(final, encoding='utf-8')

    # ── 6. 拷贝静态资源 src/assets/ → dist/assets/（如 logo 本地图标）──
    # HTML 里用相对路径 assets/logos/xxx.png 引用，产物在 dist/，
    # 必须把 src/assets/ 同步过去，否则离线/导出 PDF 时图标断链。
    assets_src = SRC / 'assets'
    if assets_src.is_dir():
        assets_dst = OUT.parent / 'assets'
        if assets_dst.exists():
            shutil.rmtree(assets_dst)
        shutil.copytree(assets_src, assets_dst)
        n_files = sum(1 for _ in assets_dst.rglob('*') if _.is_file())
        print(f'  ↳ copied src/assets/ → {assets_dst.relative_to(ROOT)} ({n_files} files)')

    print(f'✓ Built: {OUT.relative_to(ROOT)}  ({len(final):,} chars, {final.count(chr(10)) + 1} lines, {n} slides)')


if __name__ == '__main__':
    main()
