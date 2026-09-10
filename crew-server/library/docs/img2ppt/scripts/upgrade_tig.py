"""upgrade_tig.py — text_in_graphic 安全升级助手 (tig 密集页可选步骤).

对用户要求"尽量可编辑"的页面, 逐个评估 tig 能否安全升级为原生 text:
  1) 文字来源: OCR 缓存中与 tig 框 IoU 最大且 >=0.25、conf>=0.45 的条目;
     无 OCR 命中 → 保持锁定 (不编造文字)。
  2) 底质评估: 外框 3px 环带仅用于估计底色；背景相对掩码的非字形残余
     std < 18 (内部无线条/节点穿过) → 升级安全; 否则保留 tig。
升级: type->text, text=OCR 文本, color=墨芯实测(缺省按底色明度), 标 upgraded_from。
首次运行备份 elements.upgrade-tig.bak.json; 决策表写 work/upgrade-tig.json。
OCR 只提供候选文字，升级后必须人工校对并解除 tig_upgrade.review_required 门禁。

用法: python upgrade_tig.py --run <run_dir>   (pipeline 至少跑过一次后再用)
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import cutout  # noqa: E402
import ocr_refine  # noqa: E402

PAD = 0               # 评估用贴框 crop; 外扩会把框外异色底带进评估
RESID_STD_MAX = 18.0   # 非字形残余 std 上限: 均匀底
IOU_MIN = 0.25
CONF_MIN = 0.45


def eval_safety(ci, ring=None):
    """安全 = 非字形残余像素足够均匀。底色优先用紧邻 2-3px 环带众数——
    整框众数在"白粗字紧框"上会反色成字形色 (02/04 白字测成 #090700 黑字血案);
    环带窄到不出色块, 又躲开字形。环带样本不足才退回整框众数。
    稠密文字若让众数色反色成字形色, 残余 std 同样飙高 → 保守不升级, 方向安全。"""
    if ring is not None and len(ring) >= 40:
        bg = cutout.mode_color(ring.astype(np.uint8)).astype(np.int16)
    else:
        bg = cutout.mode_color(ci.reshape(-1, 3).astype(np.uint8)).astype(np.int16)
    dist_bg = np.linalg.norm(ci - bg, axis=2)
    tol = cutout.adaptive_text_tolerance(ci, bg)
    sel = dist_bg > tol
    resid = ci[~sel]
    resid_std = float(resid.std(axis=0).max()) if len(resid) > 20 else 999.0
    return resid_std < RESID_STD_MAX, resid_std, bg, sel, dist_bg


def main(run_dir):
    run = Path(run_dir)
    ej_path = run / "elements.json"
    ej = json.loads(ej_path.read_text(encoding="utf-8"))
    els = ej["elements"]
    tigs = [e for e in els if e["type"] == "text_in_graphic"]
    if not tigs:
        print("[upgrade-tig] no text_in_graphic elements")
        return
    img = cutout.imread_u(run / "source.png").astype(np.int16)
    H, W = img.shape[:2]
    items = ocr_refine.load_ocr(run)

    bak = run / "elements.upgrade-tig.bak.json"
    if not bak.exists():
        shutil.copy2(ej_path, bak)

    decisions = []
    n_up = 0
    for e in tigs:
        # 评估用无 pad 贴框 crop: pad 会把框外异色底/图标带进外框环带造成误杀
        x0, y0, x1, y1 = cutout.clip_bbox(e["bbox"], W, H, 0)
        ci = img[y0:y1, x0:x1]
        rec = {"id": e["id"], "bbox": e["bbox"]}
        if ci.size == 0:
            rec.update(decision="keep", reason="empty crop")
            decisions.append(rec)
            continue
        # 1) OCR 文字来源: IoU 优先; 否则中心距 <=0.35 且与次优拉开 (tig 框常有
        #    整体偏移, IoU=0 但确是同一行; rg1t 类两线等距则正确拒判)。
        #    升级时采纳 OCR 框为准确墨界, 文本标 ocr_text 供 agent 校对。
        best, best_iou = None, IOU_MIN
        for it in items:
            ov = ocr_refine.iou(e["bbox"], it["bbox"])
            if ov >= best_iou and float(it.get("confidence") or 0) >= CONF_MIN:
                best, best_iou = it, ov
        if not best:
            cand = sorted(((ocr_refine.center_distance(e["bbox"], it["bbox"]), it)
                           for it in items if float(it.get("confidence") or 0) >= CONF_MIN),
                          key=lambda t: t[0])
            if cand and cand[0][0] <= 0.35 and (len(cand) == 1 or cand[1][0] > cand[0][0] + 0.05):
                best = cand[0][1]
        if not best:
            near = ""
            if items:
                dlist = sorted(((ocr_refine.center_distance(e["bbox"], it["bbox"]), it)
                                for it in items), key=lambda t: t[0])
                if dlist and dlist[0][0] < 1.5:
                    near = f" nearest: {dlist[0][1]['text'][:14]!r} conf={dlist[0][1].get('confidence')}"
            rec.update(decision="keep", reason="no OCR text (conf/iou)" + near)
            decisions.append(rec)
            continue
        # 2) 底质评估 (底色取 3px 外扩环带, 防紧框白粗字反色)
        rx0, ry0, rx1, ry1 = cutout.clip_bbox(e["bbox"], W, H, 3)
        rcrop = img[ry0:ry1, rx0:rx1]
        rmask = np.ones(rcrop.shape[:2], bool)
        rmask[(y0 - ry0):(y1 - ry0), (x0 - rx0):(x1 - rx0)] = False
        safe, rstd, bg, sel, dist_bg = eval_safety(ci, ring=rcrop[rmask])
        rec.update(resid_std=round(rstd, 1),
                   ocr_text=best["text"], ocr_conf=best.get("confidence"))
        if not safe:
            rec.update(decision="keep", reason=f"bg not uniform (resid {rstd:.0f})")
            decisions.append(rec)
            continue
        # 3) 升级: 采纳 OCR 准确墨界框; 测色用高阈样本 (低阈混入 AA 浅像素,
        #    墨色偏浅 —— rg1t #4A4949 血案), 并锁色防 cutout 二次仲裁翻车
        sel_ink = sel & (dist_bg > max(float(cutout.INK_TOL_MIN),
                                       cutout.adaptive_text_tolerance(ci, bg)))
        if int(np.count_nonzero(sel_ink)) < 60:
            sel_ink = sel
        med = cutout.measure_text_color(ci, sel_ink, dist_bg)
        if med is not None:
            color = "#%02X%02X%02X" % (int(med[2]), int(med[1]), int(med[0]))
        else:  # 样本不足按底色明度兜底
            color = "#FFFFFF" if float(bg.mean()) < 128 else "#1D1D1F"
        e["type"] = "text"
        e["bbox"] = list(best["bbox"])
        e["text"] = str(best["text"]).strip()
        e["color"] = color
        e["color_locked"] = True
        e["bold"] = (e["bbox"][3] - e["bbox"][1]) >= 27
        e["upgraded_from"] = "text_in_graphic"
        n_up += 1
        rec.update(decision="upgrade", color=color, needs_review=True)
        decisions.append(rec)

    if n_up:
        ej["tig_upgrade"] = {
            "review_required": True,
            "report": "work/upgrade-tig.json",
            "upgraded": n_up,
            "instruction": "Correct OCR text/bboxes in elements.json, then set review_required=false",
        }
    ej_path.write_text(json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")
    (run / "work").mkdir(exist_ok=True)
    (run / "work" / "upgrade-tig.json").write_text(
        json.dumps(decisions, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[upgrade-tig] upgraded {n_up}/{len(tigs)} tig -> native text")
    for d in decisions:
        mark = "UP " if d["decision"] == "upgrade" else "keep"
        print(f"  {mark} {d['id']}: {d.get('ocr_text','')[:18]!r} {d.get('reason','')}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--run") + 1] if "--run" in sys.argv else sys.argv[1])
