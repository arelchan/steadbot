"""pipeline.py — img2ppt-lite 编排入口.

用法:
  python pipeline.py --run <run_dir> [--font "Noto Sans SC"] [--fast] [--no-ref] [--no-ocr]
  python pipeline.py --run <run_dir> --seed   # source.png -> elements.seed.json（不覆盖正式标注）
  python pipeline.py --selftest        # 合成样张全链路自检(含 COM 渲染)

前置: <run>/source.png + <run>/elements.json (agent 看图产出)
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import assemble  # noqa: E402
import cutout  # noqa: E402
import ocr_refine  # noqa: E402
import render_check  # noqa: E402

RUNS_ROOT = Path(os.environ.get("IMG2PPT_RUNS", str(Path.home() / "ppt-lite" / "runs")))


def run_pipeline(run_dir, font=None, fast=False, no_ref=False, no_ocr=False):
    t0 = time.time()
    timings = {}
    run = Path(run_dir)
    for f in ("source.png", "elements.json"):
        if not (run / f).exists():
            raise SystemExit(f"[pipeline] missing {run / f}")
    ej = json.loads((run / "elements.json").read_text(encoding="utf-8"))
    if ej.get("seed", {}).get("review_required"):
        raise SystemExit("[pipeline] OCR seed is not reviewed: classify/correct it and set seed.review_required=false")
    if ej.get("tig_upgrade", {}).get("review_required"):
        raise SystemExit("[pipeline] TIG upgrades are not reviewed: correct work/upgrade-tig.json + elements.json, then set tig_upgrade.review_required=false")
    (run / "work").mkdir(exist_ok=True)
    if not no_ocr:
        ts = time.time()
        ocr_refine.main(run)
        timings["ocr_seconds"] = round(time.time() - ts, 3)
    else:
        timings["ocr_seconds"] = 0.0
    ts = time.time()
    cutout.main(run)
    timings["cutout_seconds"] = round(time.time() - ts, 3)
    ts = time.time()
    out = assemble.main(run, font=font, no_ref=no_ref)
    timings["assemble_seconds"] = round(time.time() - ts, 3)
    ts = time.time()
    rep = render_check.main(run, pptx_path=out) if not fast else None
    timings["render_validate_seconds"] = round(time.time() - ts, 3) if not fast else 0.0
    timings["total_seconds"] = round(time.time() - t0, 3)
    timings["fast"] = bool(fast)
    (run / "work" / "timing.json").write_text(
        json.dumps(timings, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[pipeline] total {timings['total_seconds']:.1f}s -> {out}")
    return out, rep


def selftest():
    from PIL import Image, ImageDraw, ImageFont
    run = RUNS_ROOT / f"{datetime.now():%Y%m%d-%H%M%S}-selftest"
    run.mkdir(parents=True)

    fb44 = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 44)
    fr22 = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 22)
    fb36 = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 36)
    fr20 = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 20)

    img = Image.new("RGB", (1280, 720), "#F5F6F8")
    d = ImageDraw.Draw(img)
    d.text((80, 60), "通道重构验证平台", font=fb44, fill="#1D1D1F")
    tb1 = d.textbbox((80, 60), "通道重构验证平台", font=fb44)
    d.text((80, 132), "Image to Editable PPTX Selftest", font=fr22, fill="#6E6E73")
    tb2 = d.textbbox((80, 132), "Image to Editable PPTX Selftest", font=fr22)
    d.rounded_rectangle([80, 200, 560, 420], radius=14, fill="#DCE8FA")
    d.text((120, 250), "吞吐 +37%", font=fb36, fill="#0A57D0")
    tb3 = d.textbbox((120, 250), "吞吐 +37%", font=fb36)
    d.rectangle([112, 354, 128, 370], fill="#FF3B30")
    d.text((150, 348), "独立色标", font=fr22, fill="#1D1D1F")
    tbm = d.textbbox((150, 348), "独立色标", font=fr22)
    d.ellipse([620, 80, 700, 160], fill="#FF9F0A")   # icon (alpha 测试)
    d.line([720, 560, 1180, 560], fill="#999999", width=3)  # 图表
    d.line([720, 200, 720, 560], fill="#999999", width=3)
    for (x, top), c in zip([(760, 380), (860, 320), (960, 260), (1060, 230)],
                           ["#4C8BF5", "#34C759", "#FF9F0A", "#FF3B30"]):
        d.rectangle([x, top, x + 60, 557], fill=c)
    d.text((1058, 202), "98.7", font=fr20, fill="#333333")
    tb4 = d.textbbox((1058, 202), "98.7", font=fr20)
    img.save(run / "source.png")

    ej = {"img_w": 1280, "img_h": 720, "font": "Microsoft YaHei", "elements": [
        {"id": "c1", "type": "card", "bbox": [80, 200, 560, 420], "radius": 14},
        {"id": "g1", "type": "graphic", "bbox": [620, 80, 700, 160], "desc": "橙色圆icon", "alpha": True},
        {"id": "g2", "type": "graphic", "bbox": [718, 198, 1182, 564], "desc": "四柱图表"},
        {"id": "t1", "type": "text", "bbox": list(tb1), "text": "通道重构验证平台", "color": "#1D1D1F", "bold": True},
        {"id": "t2", "type": "text", "bbox": list(tb2), "text": "Image to Editable PPTX Selftest", "color": "#6E6E73"},
        {"id": "t3", "type": "text", "bbox": list(tb3), "text": "吞吐 +37%", "color": "#0A57D0", "bold": True},
        {"id": "tm", "type": "text", "bbox": list(tbm), "text": "独立色标", "color": "#1D1D1F", "parent": "c1"},
        {"id": "x1", "type": "text_in_graphic", "bbox": list(tb4)},
    ]}
    (run / "elements.json").write_text(json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")

    out, rep = run_pipeline(run)

    ej2 = json.loads((run / "elements.json").read_text(encoding="utf-8"))
    els = {e["id"]: e for e in ej2["elements"]}
    errs = []
    if not Path(out).exists():
        errs.append("pptx missing")
    for g in ("g1", "g2"):
        if not (run / "assets" / f"{g}.png").exists():
            errs.append(f"asset {g} missing")
    if "tm__marker" not in els or not (run / "assets" / "tm__marker.png").exists():
        errs.append("positive marker case was not promoted to an independent sprite")
    if "t3__marker" in els:
        errs.append("negative marker case: bold text was misclassified as a marker")
    fill = els["c1"].get("fill", "")
    if fill:
        want, got = (0xDC, 0xE8, 0xFA), tuple(int(fill[i:i + 2], 16) for i in (1, 3, 5))
        if max(abs(a - b) for a, b in zip(want, got)) > 10:
            errs.append(f"card fill {fill} far from #DCE8FA")
    else:
        errs.append(f"card demoted unexpectedly: {els['c1']}")
    fp = els["t1"].get("fitted_px", 0)
    if not 36 <= fp <= 52:
        errs.append(f"t1 fitted_px {fp} not in [36,52] (期望≈44)")
    if rep and rep["issues"]:
        errs.extend(rep["issues"])
    if errs:
        print("[selftest] FAIL:")
        for e in errs:
            print(f"  ! {e}")
        raise SystemExit(1)
    print(f"[selftest] PASS — run dir: {run}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run")
    ap.add_argument("--font")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--no-ref", action="store_true")
    ap.add_argument("--no-ocr", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--seed", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    elif a.run and a.seed:
        ts = time.time()
        out = ocr_refine.seed_elements(a.run)
        run = Path(a.run)
        (run / "work").mkdir(exist_ok=True)
        (run / "work" / "timing-seed.json").write_text(json.dumps({
            "seed_seconds": round(time.time() - ts, 3),
            "output": str(out),
        }, ensure_ascii=False, indent=1), encoding="utf-8")
    elif a.run:
        run_pipeline(a.run, font=a.font, fast=a.fast, no_ref=a.no_ref, no_ocr=a.no_ocr)
    else:
        ap.print_help()
