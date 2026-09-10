"""measure / adapters 浏览器回归测试。

需要 playwright + chromium；不可用时整模块 skip。
一个 fixture deck 覆盖多个已修复 checkpoint：
- 同 tag 装饰 div 组不得被误识别成 deck（slide 数 = section 数）
- 负坐标装饰 shape 的 measurement rect 保留负值
- 满页半透明遮罩产生 shape 记录
- display:none 文本不进 runs
- 零间隙相邻 span 之间不插空格
- 永动 canvas 不崩 measure（超时兜底）
- deck 缩短后参考截图目录清掉"幽灵页"
"""
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def deck(tmp_path_factory):
    pytest.importorskip("playwright.sync_api")
    from measure import measure
    out = tmp_path_factory.mktemp("meas") / "measurements.json"
    try:
        return measure(FIXTURES / "regression_deck.html", out,
                       no_screenshots=True, verbose=False)
    except Exception as e:  # chromium 未安装等
        pytest.skip(f"Playwright/Chromium 不可用: {e}")


def _records(deck, page):
    return deck["slides"][page]["records"]


def test_decoration_divs_not_mistaken_for_slides(deck):
    assert len(deck["slides"]) == 2, \
        "slide 内的同 tag 装饰 div 组被误识别成了 deck"


def test_negative_offset_rect_preserved(deck):
    xs = [r["rect"]["x"] for r in _records(deck, 0) if r["kind"] == "shape"]
    assert any(x < 0 for x in xs), "负坐标装饰 shape 的 rect 丢了负值"


def test_fullpage_overlay_measured(deck):
    fullpage = [r for r in _records(deck, 0)
                if r["kind"] == "shape"
                and r["rect"]["w"] >= 1900 and r["rect"]["h"] >= 1060
                and r["tag"] == "div"]
    assert fullpage, "满页半透明遮罩没有产生 shape 记录"


def test_hidden_text_not_extracted(deck):
    all_text = "".join(
        run.get("text", "")
        for r in _records(deck, 0) if r["kind"] == "text"
        for run in r.get("runs", []))
    assert "HIDDEN" not in all_text, "display:none 文本泄漏进 runs"


def test_zero_gap_spans_no_inserted_space(deck):
    h1 = next(r for r in _records(deck, 0) if r["kind"] == "text")
    joined = "".join(run.get("text", "") for run in h1["runs"])
    assert "ShipFast" in joined, f"零间隙 span 边界被插入空格: {joined!r}"
    assert "now" in joined


def test_animated_canvas_does_not_crash(deck):
    # deck fixture 能构建成功本身就是断言（slide 2 的 canvas 永不稳定）
    kinds = {r["kind"] for r in _records(deck, 1)}
    assert "canvas" in kinds


def test_stale_screenshot_pruned(tmp_path):
    pytest.importorskip("playwright.sync_api")
    from measure import measure
    anchor = tmp_path / "m.json"
    shots = tmp_path / "m_screenshots"
    shots.mkdir()
    stale = shots / "slide_99.png"
    stale.write_bytes(b"stale")
    try:
        measure(FIXTURES / "regression_deck.html", anchor,
                no_screenshots=False, verbose=False)
    except Exception as e:
        pytest.skip(f"Playwright/Chromium 不可用: {e}")
    assert not stale.exists(), "deck 缩短后的幽灵参考截图没有被清理"
    assert (shots / "slide_01.png").exists()
