"""行内上下标（<sup>/<sub> vertical-align）→ OOXML baseline 偏移的回归测试。

对应场景：大数字 + 上标单位（63%、$1.4M、x²）。修复前 % 掉到基线。
"""
from assemble import _annotate_baseline_offsets


def _run(text, fs, va="baseline", ink_bottom=None, **kw):
    return {"text": text, "fontSize": fs, "verticalAlign": va,
            "inkBottom": ink_bottom, **kw}


def test_sup_gets_positive_baseline():
    # 540px 数字（墨迹底 790）+ 130px 上标 %（墨迹底 330，vertical-align:top）
    runs = [_run("63", 540, ink_bottom=790), _run("%", 130, "top", ink_bottom=330)]
    _annotate_baseline_offsets(runs)
    assert "baselinePct" not in runs[0]
    # offset = (790 - 108) - (330 - 26) = 378px → 378/130 ≈ 291%
    assert 250000 < runs[1]["baselinePct"] < 330000


def test_baseline_runs_untouched():
    runs = [_run("hello", 32, ink_bottom=100), _run("world", 32, ink_bottom=100)]
    _annotate_baseline_offsets(runs)
    assert all("baselinePct" not in r for r in runs)


def test_cross_line_offset_discarded():
    # 非基线 run 与参考 run 不在同一视觉行（偏移超过参考字号 1.2 倍）→ 不标注
    runs = [_run("big", 100, ink_bottom=200), _run("x", 20, "super", ink_bottom=800)]
    _annotate_baseline_offsets(runs)
    assert "baselinePct" not in runs[1]


def test_missing_ink_bottom_safe():
    runs = [_run("63", 540), _run("%", 130, "top")]
    _annotate_baseline_offsets(runs)  # 不抛异常
    assert all("baselinePct" not in r for r in runs)
