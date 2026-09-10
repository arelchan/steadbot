"""ocr_refine.py — RapidOCR 文本骨架 + 本地校准 bbox.

对每个单行 text 元素找最佳匹配 OCR 框 (IoU + 文本相似度), 替换 bbox.
多行元素(含\n)跳过. rapidocr 不可用则整体跳过 (bbox 用 agent 原值).
"""
import difflib
import hashlib
import json
import math
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area = lambda r: (r[2] - r[0]) * (r[3] - r[1])  # noqa: E731
    return inter / (area(a) + area(b) - inter)


def sim(a, b):
    a, b = "".join(a.split()), "".join(b.split())
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def file_sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def center_distance(a, b):
    ax, ay = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
    bx, by = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    scale = max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1], 20)
    return math.hypot(ax - bx, ay - by) / scale


def load_ocr(run):
    """Run RapidOCR once per source hash and reuse the cached boxes on repairs."""
    run = Path(run)
    source = run / "source.png"
    cache = run / "work" / "ocr-cache.json"
    cache.parent.mkdir(exist_ok=True)
    sha = file_sha256(source)
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("source_sha256") == sha and isinstance(data.get("items"), list):
            print(f"[ocr] cache hit: {len(data['items'])} lines")
            return data["items"]
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        print("[ocr] rapidocr not installed, skip bbox refine")
        return []
    result, _ = RapidOCR()(str(source))
    items = []
    for quad, text, conf in result or []:
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        items.append({
            "bbox": [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))],
            "text": text,
            "confidence": round(float(conf), 5),
        })
    cache.write_text(json.dumps({
        "source_sha256": sha,
        "items": items,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[ocr] cache created: {len(items)} lines")
    return items


def seed_elements(run_dir, min_confidence=0.82):
    """从 source.png 生成可审阅的 OCR 文本骨架，永不覆盖 elements.json。

    这不是自动完成重建：agent 仍需纠字、把图内文字改为 text_in_graphic、
    删除噪声并补 card/graphic。但它省掉密集页逐行手抄 bbox 的主要耗时。
    """
    from PIL import Image

    run = Path(run_dir)
    source = run / "source.png"
    if not source.exists():
        raise SystemExit(f"[ocr-seed] missing {source}")
    items = load_ocr(run)
    if not items:
        raise SystemExit("[ocr-seed] no OCR result")
    with Image.open(source) as im:
        width, height = im.size
    elements, rejected = [], 0
    for item in items:
        text = str(item.get("text") or "").strip()
        conf = float(item.get("confidence") or 0)
        bbox = [int(v) for v in item.get("bbox", [])]
        if not text or len(bbox) != 4 or conf < min_confidence:
            rejected += 1
            continue
        x0, y0, x1, y1 = bbox
        if x1 <= x0 or y1 <= y0:
            rejected += 1
            continue
        idx = len(elements) + 1
        elements.append({
            "id": f"ocr{idx:03d}",
            "type": "text",
            "bbox": bbox,
            "text": text,
            "color": "#1D1D1F",
            "bold": (y1 - y0) >= 27,
            "seed_confidence": round(conf, 5),
        })
    payload = {
        "img_w": width,
        "img_h": height,
        "font": "Microsoft YaHei",
        "seed": {
            "source": "RapidOCR",
            "review_required": True,
            "candidate_count": len(elements),
            "rejected_count": rejected,
            "min_confidence": min_confidence,
        },
        "elements": elements,
    }
    out = run / "elements.seed.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[ocr-seed] wrote {len(elements)} candidates ({rejected} rejected) -> {out}")
    print("[ocr-seed] review/correct text, reclassify text_in_graphic, add card/graphic, then set seed.review_required=false")
    return out


def main(run_dir):
    run = Path(run_dir)
    ej = json.loads((run / "elements.json").read_text(encoding="utf-8"))
    items = load_ocr(run)
    if not items:
        print("[ocr] no ocr result, skip")
        return
    n, used = 0, set()
    for e in ej["elements"]:
        if e["type"] != "text" or "\n" in e["text"] or e.get("ocr_locked"):
            continue  # ocr_locked: OCR 框系统性偏移(含 icon 等)时锁定手工 bbox
        # A manual edit after an earlier refinement becomes the new agent anchor.
        if e.get("ocr_bbox") and e.get("bbox") != e.get("ocr_bbox"):
            e["agent_bbox"] = list(e["bbox"])
        anchor = e.setdefault("agent_bbox", list(e["bbox"]))
        best, best_score, best_idx, best_conf, best_text = None, 0.65, None, None, ""
        for idx, item in enumerate(items):
            if idx in used:
                continue
            bb, otext = item["bbox"], item["text"]
            ov, txt, dist = iou(anchor, bb), sim(e["text"], otext), center_distance(anchor, bb)
            # Text similarity alone must never pull repeated labels across the slide.
            if ov < 0.08 and dist > 1.0:
                continue
            s = ov * 1.8 + txt + max(0.0, 1.0 - dist) * 0.25
            if s > best_score and (ov > 0.08 or (txt > 0.6 and dist <= 1.0)):
                best, best_score, best_idx = bb, s, idx
                best_conf, best_text = item.get("confidence"), otext or ""
        if best and best != e["bbox"]:
            merged = list(best)
            at = "".join(e["text"].split())
            ot = "".join(best_text.split())
            # OCR 常漏检行首 marker (■/•/编号): 首字符对不上时保 agent 的 x0,
            # 否则渲染起点右移一个 marker 宽 (msgqos 页 bullet 集体右移 26px)。
            if at and ot and at[0] != ot[0]:
                merged[0] = min(anchor[0], best[0])
            e["ocr_bbox"] = best
            e["bbox"] = merged
            e["ocr_confidence"] = best_conf
            n += 1
        if best_idx is not None:
            used.add(best_idx)
    (run / "elements.json").write_text(json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[ocr] refined {n} text bboxes via rapidocr ({len(items)} ocr lines, unique+spatial match)")


if __name__ == "__main__":
    target = sys.argv[sys.argv.index("--run") + 1] if "--run" in sys.argv else sys.argv[1]
    seed_elements(target) if "--seed" in sys.argv else main(target)
