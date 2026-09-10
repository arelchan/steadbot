"""assemble.py OOXML 不变量回归测试（纯 Python，不需要浏览器）。

每个测试对应一个已修复的 bug / lessons-learned checkpoint：
- generic-only font-family 不得把关键字写进 typeface
- 负坐标 shape 的 <a:off> 必须保留负值
- 满页半透明遮罩必须保留；与背景同色的满页 shape 才跳过
- 圆形 带背景+四边同色边框 必须有 outline
"""
import re
import zipfile

from assemble import assemble, first_font, DEFAULT_LATIN_FALLBACK

WHITE = "rgb(255, 255, 255)"


def _slide(records, bg=WHITE):
    return {"slide": {"background": bg, "theme": "test"}, "records": records}


def _shape(x, y, w, h, deco):
    return {"kind": "shape", "rect": {"x": x, "y": y, "w": w, "h": h}, "deco": deco}


def _render_xml(tmp_path, records, bg=WHITE):
    out = tmp_path / "t.pptx"
    assemble({"slides": [_slide(records, bg)]}, out)
    return zipfile.ZipFile(out).read("ppt/slides/slide1.xml").decode("utf-8")


def test_first_font_generic_only_falls_back():
    # 整条 stack 全是 generic 关键字 → 不能把 "system-ui" 写进 OOXML typeface
    assert first_font("system-ui, sans-serif") == DEFAULT_LATIN_FALLBACK
    assert first_font("sans-serif") == DEFAULT_LATIN_FALLBACK
    # 正常路径不受影响：第一个非 generic 项透传
    assert first_font('"My Custom Font", sans-serif') == "My Custom Font"


def test_negative_offset_preserved(tmp_path):
    # position:absolute; left:-200px 的装饰 shape：OOXML <a:off x> 支持负值，必须原样保留
    xml = _render_xml(tmp_path, [
        _shape(-200, -150, 500, 500,
               {"hasBg": True, "bg": "rgb(233, 69, 96)", "borderRadius": "50%"}),
    ])
    assert '<a:off x="-1270000" y="-952500"/>' in xml  # -200/-150 px × 6350 EMU


def test_fullpage_translucent_overlay_kept(tmp_path):
    # inset:0 + rgba 压暗层：不是"与背景等价"，必须发 shape（带 alpha）
    xml = _render_xml(tmp_path, [
        _shape(0, 0, 1920, 1080,
               {"hasBg": True, "bg": "rgba(10, 10, 40, 0.45)"}),
    ])
    assert xml.count("<p:sp>") == 1
    assert re.search(r'<a:alpha val="45000"', xml)


def test_fullpage_same_as_bg_skipped(tmp_path):
    # 与 slide 背景同色不透明、无边框的满页 shape：视觉冗余且在 WPS 里可选可拖 → 跳过
    xml = _render_xml(tmp_path, [
        _shape(0, 0, 1920, 1080, {"hasBg": True, "bg": WHITE}),
    ])
    assert xml.count("<p:sp>") == 0


def _text(runs, x=100, y=100, w=800, h=100):
    return {"kind": "text", "rect": {"x": x, "y": y, "w": w, "h": h},
            "style": {"fontSize": 32, "lineHeight": "48px", "textAlign": "left"},
            "runs": runs, "deco": {},
            "text": "".join(r.get("text", "") for r in runs)}


def test_run_color_alpha_emitted(tmp_path):
    # rgba 文字色（muted 弱化文字）的 alpha 必须进 <a:alpha>，否则变不透明主色
    xml = _render_xml(tmp_path, [
        _text([{"text": "muted label", "fontSize": 18, "fontWeight": "400",
                "fontFamily": "Arial", "color": "rgba(240, 232, 210, 0.58)"}]),
    ])
    assert '<a:alpha val="58000"/>' in xml


def test_ea_ambiguous_symbol_gets_latin_ea(tmp_path):
    # × ÷ ° 等码点会被 PowerPoint 路由到 ea 槽；非 CJK run 的 ea 应指回 latin 同字体
    xml = _render_xml(tmp_path, [
        _text([{"text": "3.2×", "fontSize": 90, "fontWeight": "800",
                "fontFamily": "Arial", "color": "rgb(240, 232, 210)"}]),
    ])
    assert '<a:ea typeface="Arial"/>' in xml
    # 纯 ASCII run 不写 ea
    xml2 = _render_xml(tmp_path, [
        _text([{"text": "plain", "fontSize": 20, "fontWeight": "400",
                "fontFamily": "Arial", "color": "rgb(0, 0, 0)"}]),
    ])
    assert "<a:ea" not in xml2


def test_circle_with_bg_and_border_has_outline(tmp_path):
    # border-radius:50% + background + border 的头像圆：描边并入 shape outline，不得丢失
    sides = {f"border{s}": True for s in ("Top", "Bottom", "Left", "Right")}
    widths = {f"border{s}Width": 6 for s in ("Top", "Bottom", "Left", "Right")}
    colors = {f"border{s}Color": "rgb(51, 51, 51)" for s in ("Top", "Bottom", "Left", "Right")}
    xml = _render_xml(tmp_path, [
        _shape(800, 400, 200, 200,
               {"hasBg": True, "bg": WHITE, "borderRadius": "50%",
                **sides, **widths, **colors}),
    ])
    assert 'prst="ellipse"' in xml
    m = re.search(r'<a:ln[^>]*w="(\d+)"[^>]*>.*?srgbClr val="333333"', xml, re.S)
    assert m, "圆形描边丢失"
    assert int(m.group(1)) == 6 * 6350  # 6px 线宽
