"""
交付前机检 —— 对构建好的 deck 做「不依赖布局测量」的可靠检查。

依赖：pip install playwright ; playwright install chromium

用法：
  python3 check_deck.py [HTML]          # 默认找 dist/ 或当前目录的 HTML
  python3 check_deck.py [HTML] --strict # 有任何 WARN 就 exit 1（用于 CI / 卡交付）

检查项（对照 references/report-quality.md）：
  · 字号体检    正文 / 脚注是否过小（设计 px < 11 → 投屏看不清）           —— 第 9 条
  · 币种单位    全篇是否 ¥ 与 $ 混用却没标换算                              —— 第 2 条
  · 数字缺信源  某页有 %/万/亿/倍/× 这类关键数字、却没有脚注 / 来源 / 估算标注 —— 第 1 条
  · 术语清单    列出全篇大写缩写（首现在哪页），供你核对是否首次出现就给了人话 —— 第 4 条

⚠ 本脚本「绝不」做溢出 / 留白 / 对齐检测：嵌套 flex/grid 里自写 scroll* 检测会
  系统性误判（教训见 references/landscape-qa.md）。这类布局问题只信 export_images.py /
  export_pdf.py 的逐页截图肉眼复核。
"""
import os
import re
import sys
import argparse

ROOT = os.path.dirname(os.path.abspath(__file__))

FONT_FLOOR = 11          # 设计 px：低于此判过小（脚注下限；正文应 ≥ --fs-body 13）
ACRONYM_STOP = {         # 这些缩写/词太常见，不必逐个核对，跳过
    # 通用技术 / 商业缩写
    'PDF', 'HTML', 'CSS', 'JS', 'JSON', 'CSV', 'URL', 'API', 'SDK', 'AI', 'ML',
    'OK', 'CEO', 'CTO', 'CFO', 'COO', 'KPI', 'OKR', 'ROI', 'ROE', 'GDP', 'GMV',
    'USD', 'RMB', 'CNY', 'EUR', 'HR', 'IT', 'PR', 'UI', 'UX', 'PPT', 'FAQ',
    'B2B', 'B2C', 'SaaS', 'YOY', 'QOQ', 'MOM',
    # 时间 / 周期标记（不是需要解释的术语）
    'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY', 'YTD',
    # 常见英文 eyebrow / 段落标签词（大写显示，但不是领域缩写）
    'PART', 'GROWTH', 'REVIEW', 'ENGINE', 'OVERVIEW', 'SUMMARY', 'AGENDA',
    'VISION', 'MISSION', 'IMPACT', 'FUTURE', 'RESULT', 'RESULTS', 'INTRO',
    'GOAL', 'GOALS', 'PLAN', 'NOTE', 'TIPS', 'NEW', 'TOP', 'KEY', 'END',
}

# 在浏览器里一次性采集：每页的纯文本、是否有脚注/来源、以及过小字号元素
COLLECT_JS = r"""
() => {
  const FLOOR = %d;
  const slides = [...document.querySelectorAll('.slide')];
  const ownText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.trim();
  };
  const FOOT_SEL = '[class*="foot"],[class*="source"],[class*="note"],[class*="cite"],[class*="caption"]';
  const FOOT_TEXT = /来源|数据来源|出处|估算|约\s*\d|注[:：]|备注|Source|source/;
  return slides.map((s, i) => {
    const text = (s.innerText || '').replace(/\s+/g, ' ').trim();
    // raw = textContent：保留作者原始大小写，不受 CSS text-transform:uppercase 影响，
    // 避免把大写显示的英文单词（eyebrow 的 Growth/Review）误判成缩写。术语扫描用它。
    const raw = (s.textContent || '').replace(/\s+/g, ' ').trim();
    const hasFoot = !!s.querySelector(FOOT_SEL) || FOOT_TEXT.test(text);
    // 过小字号：只看「自己直接有文字」的元素，避免父容器误报
    const small = [];
    const seen = new Set();
    for (const el of s.querySelectorAll('*')) {
      const t = ownText(el);
      if (!t) continue;
      const px = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (px && px < FLOOR) {
        const key = el.tagName + '|' + px + '|' + t.slice(0, 20);
        if (seen.has(key)) continue;
        seen.add(key);
        small.push({ px: Math.round(px * 10) / 10, tag: el.tagName.toLowerCase(),
                     cls: (el.className || '').toString().slice(0, 40), sample: t.slice(0, 30) });
      }
    }
    return { text, raw, hasFoot, small };
  });
}
""" % FONT_FLOOR


def find_html():
    for base in (os.path.join(os.getcwd(), 'dist'), os.getcwd(), os.path.join(ROOT, 'dist'), ROOT):
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if f.endswith('.html') and not f.startswith('.'):
                return os.path.join(base, f)
    raise SystemExit('未找到 HTML（dist/ 或当前目录）。')


# 关键数字：百分比 / 万亿 / 倍 / 乘数
NUM_RE = re.compile(r'\d[\d,\.]*\s*(?:%|％|万|亿|倍|‰)|[×x]\s*\d|\d+(?:\.\d+)?\s*[xX]\b')
RMB_RE = re.compile(r'[¥￥]|人民币|(?<![A-Za-z])元(?![a-z])|RMB|CNY')
USD_RE = re.compile(r'(?<!【)\$|美元|USD|US\$')
CONV_RE = re.compile(r'≈|汇率|USD\s*[:：=]|1\s*(?:USD|美元).*?[¥￥]|[¥￥].*?(?:USD|美元)')
ACRONYM_RE = re.compile(r'\b[A-Z][A-Z0-9]{1,5}\b')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html', nargs='?')
    ap.add_argument('--strict', action='store_true', help='有 WARN 就 exit 1')
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    html = os.path.abspath(args.html or find_html())
    if not os.path.exists(html):
        raise SystemExit(f'HTML 不存在：{html}')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('file://' + html)
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(300)
        slides = page.evaluate(COLLECT_JS)
        browser.close()

    warns, infos = [], []

    # 1) 字号体检
    for i, s in enumerate(slides, 1):
        for e in s['small']:
            warns.append(f'[字号] 第 {i} 页 <{e["tag"]} .{e["cls"]}> {e["px"]}px（< {FONT_FLOOR}）：'
                         f'"{e["sample"]}" —— 投屏可能看不清')

    # 2) 币种/单位混用（全篇）
    all_text = ' '.join(s['text'] for s in slides)
    if RMB_RE.search(all_text) and USD_RE.search(all_text) and not CONV_RE.search(all_text):
        warns.append('[币种] 全篇同时出现 ¥/人民币 与 $/美元，但没找到换算说明'
                     '（"1 USD ≈ ¥7.2" / 汇率 / ≈）—— 确认是否单一币种或标清换算')

    # 3) 数字缺信源（逐页启发式）
    for i, s in enumerate(slides, 1):
        nums = NUM_RE.findall(s['text'])
        if nums and not s['hasFoot']:
            sample = '、'.join(re.findall(r'\d[\d,\.]*\s*(?:%|％|万|亿|倍)', s['text'])[:3]) or '关键数字'
            warns.append(f'[信源] 第 {i} 页有关键数字（{sample}…）却没看到脚注/来源/估算标注'
                         f' —— 补出处或标"约/估算"')

    # 4) 术语清单（informational）
    first_seen = {}
    for i, s in enumerate(slides, 1):
        for m in ACRONYM_RE.findall(s.get('raw', s['text'])):
            if m in ACRONYM_STOP or m.isdigit():
                continue
            first_seen.setdefault(m, i)
    if first_seen:
        items = sorted(first_seen.items(), key=lambda kv: (kv[1], kv[0]))
        listed = '，'.join(f'{k}(P{v})' for k, v in items[:20])
        infos.append(f'[术语] 全篇缩写（核对每个是否首现就给了人话）：{listed}'
                     + ('…' if len(items) > 20 else ''))

    # ── 报告 ──
    print(f'\n══ 交付前机检 · {os.path.basename(html)}（{len(slides)} 页）══\n')
    if warns:
        print(f'⚠ WARN ×{len(warns)}（逐条确认；误报可忽略）：')
        for w in warns:
            print('  ·', w)
    else:
        print('✓ 机检项无警告。')
    if infos:
        print()
        for info in infos:
            print('ℹ', info)

    print('\n――――――――――――――――――――――――――――――――――――――――')
    print('⚠ 溢出 / 留白 / 对齐 / 一页一事 本脚本不查（布局测量会误判）。')
    print('  请务必再跑：python3 export_images.py dist/*.html  （或 export_pdf.py）')
    print('  逐页截图肉眼过一遍。详见 references/report-quality.md 第 13 条。\n')

    if args.strict and warns:
        sys.exit(1)


if __name__ == '__main__':
    main()
