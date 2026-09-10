"""cutout.py — inpaint 去前景 + 语义元素切图 + card 纯色验证取色.

输入: <run>/source.png + <run>/elements.json
输出: <run>/clean_text.png (去文字), <run>/base.png (残差底图),
      <run>/assets/<id>.png (元素贴图), elements.json 回写 (card fill/降级/asset)
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PAD_TEXT = 3
PAD_GRAPHIC = 2
CARD_STD_MAX = 14.0   # card 中心区域各通道 std 上限, 超出降级 graphic
ALPHA_NEAR = 26       # 与底色距离 < NEAR 全透明
ALPHA_FAR = 60        # > FAR 全不透明, 之间线性
MASK_TOL_BG = 45      # 字形与局部底色的距离阈值 (背景相对检测)
MASK_TOL_MIN = 18     # 纯色底上的 AA/浅阴影需要更低阈值，避免淡色幽灵
MASK_COVER_MAX = 0.75 # 超过视为退化, 整框抹除
GRAD_MIN_DELTA = 26.0 # 渐变字检测: 两半区中位色差下限
GRAD_MIN_H = 28       # 渐变字检测: 文本框高度下限(px)——小字渐变不可感知, 假阳代价高
COLOR_MIN_DELTA = 40.0  # 墨色自校准: 实测与 agent 色偏差下限
INK_TOL_MIN = 38.0      # 取色/渐变用高阈: 自适应低阈会把 AA 浅像素混进样本, 墨色测偏浅
MARKER_CHARS = "■□▪▫●○•◦◆◇▶►"  # 行首 marker 字符集 (bullet/图例)


def imread_u(path):
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"[cutout] cannot read image: {path}")
    return img


def imwrite_u(path, img):
    ext = Path(path).suffix or ".png"
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise SystemExit(f"[cutout] cannot encode: {path}")
    buf.tofile(str(path))


def clip_bbox(b, w, h, pad=0):
    x0, y0, x1, y1 = b
    return [max(0, int(x0) - pad), max(0, int(y0) - pad),
            min(w, int(x1) + pad), min(h, int(y1) + pad)]


def mode_color(pixels):
    """众数色. pixels: (N,3) uint8. 量化到 4 级/通道再回中心值, 抗噪."""
    if len(pixels) == 0:
        return np.array([255, 255, 255], dtype=np.uint8)
    if len(pixels) > 20000:
        idx = np.random.default_rng(0).choice(len(pixels), 20000, replace=False)
        pixels = pixels[idx]
    q = (pixels // 4).astype(np.int32)
    keys = q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    k = vals[np.argmax(counts)]
    # 用该量化桶内像素的均值作为代表色(比桶中心更准)
    sel = pixels[keys == k]
    return sel.mean(axis=0).astype(np.uint8)


def remove_regions(img, mask, ring_kernel=25, inpaint_radius=3):
    """把 mask 区域抹掉: 每个连通块用外围环形众数色填充, 再 TELEA 平滑边缘."""
    if mask.max() == 0:
        return img.copy()
    out = img.copy()
    n, labels = cv2.connectedComponents(mask)
    all_mask = mask > 0
    for i in range(1, n):
        m = (labels == i).astype(np.uint8)
        ring = cv2.dilate(m, np.ones((ring_kernel, ring_kernel), np.uint8)) > 0
        ring &= ~all_mask
        px = out[ring] if ring.any() else out[~all_mask]
        out[m > 0] = mode_color(px)
    out = cv2.inpaint(out, mask, inpaint_radius, cv2.INPAINT_TELEA)
    return out


def ink_extreme(ci, sel, dist_bg, frac):
    """离底色最远的前 frac 比例像素 = 真墨色。AA 混合像素永远比墨芯更接近底色,
    因此按 dist_bg 取上分位天然滤掉混合像素, 小字也稳健 (白数字不再测出浅蓝)。"""
    px = ci[sel].astype(np.float32)
    d = dist_bg[sel]
    k = max(30, int(len(px) * frac))
    k = min(k, len(px))
    top = np.argpartition(d, -k)[-k:]
    return px[top], top


def detect_text_gradient(ci, sel, dist_bg, box_h, tol):
    """渐变字检测: 取 dist_bg > 1.5*tol 的墨芯像素 (绝对阈值——按距离分位选择会
    把渐变亮端整端滤掉, 纵向渐变被压没, 实测阳性用例漏检), 上/下半或左/右半
    中位色差显著则返回 {"dir","from","to"} (RGB hex)。仅对 >=GRAD_MIN_H px 的
    展示级文字启用——小字 AA 纵向分布不均会产生 27-88 的假 delta。"""
    if box_h < GRAD_MIN_H:
        return None
    n = int(np.count_nonzero(sel))
    if n < 500:
        return None
    core = sel & (dist_bg > tol * 1.5)
    if int(np.count_nonzero(core)) < 150:
        return None
    ink = ci[core].astype(np.float32)
    ys, xs = np.nonzero(core)
    ymid, xmid = np.median(ys), np.median(xs)

    def med(mask2):
        return np.median(ink[mask2], axis=0)

    splits = []
    a, b = ys <= ymid, ys > ymid
    if a.sum() >= 40 and b.sum() >= 40:
        splits.append((float(np.linalg.norm(med(a) - med(b))), "v", med(a), med(b)))
    a, b = xs <= xmid, xs > xmid
    if a.sum() >= 40 and b.sum() >= 40:
        splits.append((float(np.linalg.norm(med(a) - med(b))), "h", med(a), med(b)))
    if not splits:
        return None
    delta, direction, c1, c2 = max(splits, key=lambda s: s[0])
    if delta < GRAD_MIN_DELTA:
        return None

    def hx(c):  # BGR float -> #RRGGBB
        return "#%02X%02X%02X" % (int(c[2]), int(c[1]), int(c[0]))

    return {"dir": direction, "from": hx(c1), "to": hx(c2), "delta": round(delta, 1)}


def measure_text_color(ci, sel, dist_bg):
    """真墨色 ≈ 离底色最远前 30% 像素的中位色 (12% 太靠墨芯会系统性偏深,
    全量中位又被 AA 混合像素带偏——白字会测成浅蓝)。样本不足返回 None。"""
    if int(np.count_nonzero(sel)) < 60:
        return None
    ink, _ = ink_extreme(ci, sel, dist_bg, 0.30)
    return np.median(ink, axis=0)


def hex_to_bgr(value):
    ac = str(value or "#1D1D1F").lstrip("#")
    if len(ac) != 6:
        ac = "1D1D1F"
    return np.array([int(ac[4:6], 16), int(ac[2:4], 16), int(ac[0:2], 16)], dtype=np.int16)


def pick_bg_color(crop, agent_color):
    """文字行底色估计。frame 众数色在 ink 紧框小字上会反色成字形色 (蓝方块上的
    白色数字: 字触四边, frame 众数=白); interior 众数色在稠密文字行底色占少数时
    反色成字形色 (大标题字形 59% > 底色 41%)。两者不一致时用 agent 文字色仲裁:
    离文字色更远者才是底色。"""
    h, w = crop.shape[:2]
    k = min(3, h // 2, w // 2) or 1
    frame = np.concatenate([
        crop[:k, :].reshape(-1, 3), crop[-k:, :].reshape(-1, 3),
        crop[:, :k].reshape(-1, 3), crop[:, -k:].reshape(-1, 3)])
    f = mode_color(frame).astype(np.int16)
    i = mode_color(crop[k:h - k, k:w - k].reshape(-1, 3)).astype(np.int16) \
        if h > 2 * k and w > 2 * k else f
    if float(np.linalg.norm(f - i)) < 45:
        return f
    ac = str(agent_color or "#1D1D1F").lstrip("#")
    if len(ac) != 6:
        ac = "1D1D1F"
    rgb = np.array([int(ac[4:6], 16), int(ac[2:4], 16), int(ac[0:2], 16)], dtype=np.int16)
    return i if np.linalg.norm(i - rgb) > np.linalg.norm(f - rgb) else f


def adaptive_text_tolerance(ci, bg, configured=None):
    """按文字框自身的底噪选择掩码阈值。

    固定 45 对普通正文稳，但会漏掉 AI 生图中距离底色仅 20~40 的 AA/浅阴影。
    文字紧框通常仍有约 35% 真底色，因此用距离分布的 35 分位估计底噪，向上
    留 12 的余量并限制在 18~45。显式 mask_tolerance_bg 始终优先。
    """
    if configured is not None:
        return float(configured)
    dist = np.linalg.norm(ci - bg, axis=2)
    if dist.size < 20:
        return float(MASK_TOL_BG)
    noise = float(np.percentile(dist, 35))
    return float(np.clip(noise + 12.0, MASK_TOL_MIN, MASK_TOL_BG))


def solid_blocks(local, crop, dist_bg, row_h, text_bgr):
    """检出掩码中的"实心大块"(legend 色块/小图标, 非字形)。判据:
    尺寸(高≥0.5行高、宽 0.45~2.4 行高、宽/高≥0.65) + 填充率≥0.8
    + 行首位置(x < 35% 行宽)
    + 块内近纯色(std≤60, 容纳彩色 marker 的 AA 边; 25 会误杀蓝/红 marker)
    + **与后续字形的水平间隙 ≥0.25 行高**——这是与粗体汉字的本质区分:
    marker 后必有空隙, 汉字粘连块(如"功率控制"的"功")右边 1-3px 就是下一字
    (msgqos 按钮文字被误当 marker 剔除、card 连锁降级的血案)。"""
    blocks = []
    arr = (local > 0)
    # 间隙在高阈投影上量: 低阈掩码的 AA 拖尾会把 marker 与文字间 5px 的真实
    # 空隙侵蚀到 1-2px, 间隙判据在低阈列上必然全灭
    hi = arr & (dist_bg > 45.0)
    cols = np.nonzero((hi if hi.any() else arr).any(axis=0))[0]
    n, labels, stats, _ = cv2.connectedComponentsWithStats(arr.astype(np.uint8))
    for i in range(1, n):
        bx, by, bw, bh, area = stats[i]
        if not (bh >= 0.5 * row_h and 0.45 * row_h <= bw <= 2.4 * row_h
                and bw >= 0.65 * bh
                and area >= 0.8 * bw * bh):
            continue
        if bx > 0.35 * local.shape[1]:
            continue
        blk = labels == i
        px = crop[blk]
        # std 只做极端兜底(黑白杂块>110): 彩色 marker 的 AA 过渡像素把块内
        # std 推到 73-90 (msgqos 蓝/红 legend 实测), 60 会误杀; 汉字粘连块
        # 靠尺寸+填充率+间隙已拦住, 不依赖 std。
        if len(px) < 10 or float(px.std(axis=0).max()) > 110:
            continue
        # 与文字同色的实心块就是文字本身 (行首词"隐空间"低阈粘连 + 全角括号
        # 间隙 4px 可骗过 gap 判据): marker 色必须显著异于该行文字色。
        if float(np.linalg.norm(mode_color(px.astype(np.uint8)).astype(np.int16)
                                - text_bgr)) < 45:
            continue
        hcols = np.nonzero((hi & blk).any(axis=0))[0]
        right = int(hcols.max()) if len(hcols) else bx + bw
        nxt = cols[cols > right + 1]
        gap = (int(nxt.min()) - right) if len(nxt) else 999
        if gap < max(3.0, 0.28 * row_h):
            continue
        blocks.append(blk)
    return blocks


def add_text_glyph_mask(mask, img, element, w, h):
    """背景相对检测抹字形, 不用 agent 指定色: AI 生图小字号几乎全是 AA 中间调,
    到"标称文字色"的距离大量超阈 (实测列表行: 真字形 44.4% vs 色距命中 17.4%),
    导致成片幽灵残留。掩码 bbox 取 refined bbox 与 agent 锚框的并集, 防止
    OCR 紧框裁掉边缘字形。"""
    boxes = [element["bbox"]]
    if element.get("agent_bbox"):
        boxes.append(element["agent_bbox"])
    u = [min(b[0] for b in boxes), min(b[1] for b in boxes),
         max(b[2] for b in boxes), max(b[3] for b in boxes)]
    text_left = u[0]
    row_h = max(8, u[3] - u[1])
    text = str(element.get("text", ""))
    single = "\n" not in text
    has_marker = single and text.strip()[:1] in MARKER_CHARS
    # OCR 框通常从正文墨界开始，行首 marker 常在框外；单行文本统一左扩一个
    # marker 位交给五重判据检测。即使没有 marker，颜色差/间隙判据也会拒绝
    # 把粗体首字误认成色块。
    if single:
        u[0] = max(0, u[0] - int(1.6 * row_h))
    x0, y0, x1, y1 = clip_bbox(u, w, h, PAD_TEXT)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        return
    ci = crop.astype(np.int16)
    # Background estimation uses the original tight text region, never the
    # marker-search extension. Otherwise a long title near a card edge can see
    # mostly page white and invert white-on-red into red-on-red.
    gx0, gy0, gx1, gy1 = clip_bbox([text_left, u[1], u[2], u[3]], w, h, 0)
    bg_crop = img[gy0:gy1, gx0:gx1]
    source_color = element.get("source_color", element.get("color"))
    bg = pick_bg_color(bg_crop if bg_crop.size else crop, source_color)
    dist_bg = np.linalg.norm(ci - bg, axis=2)
    tol = adaptive_text_tolerance(ci, bg, element.get("mask_tolerance_bg"))
    local = (dist_bg > tol).astype(np.uint8) * 255
    coverage = float(np.count_nonzero(local)) / max(1, local.size)
    # A noisy/complex background can make the adaptive threshold over-select.
    # Retry with the conservative legacy threshold before ever falling back to
    # full-bbox removal, so a low threshold cannot erase an underlying graphic.
    if coverage > MASK_COVER_MAX and element.get("mask_tolerance_bg") is None:
        tol = float(MASK_TOL_BG)
        local = (dist_bg > tol).astype(np.uint8) * 255
        coverage = float(np.count_nonzero(local)) / max(1, local.size)
    fallback = element.get("mask_mode") == "bbox" or coverage < 0.005 or coverage > MASK_COVER_MAX
    element["mask_tolerance_used"] = round(tol, 1)
    if fallback:
        local[:, :] = 255
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], local)
        return
    # marker 双向规则: text 不含 marker 字符时, 掩码里的实心大块是 legend 色块/
    # 图标。记录精确 bbox、从文字掩码剔除，并在 main() 中生成独立语义贴图；
    # 不能只留在底图，因为 marker 位于原生 card 内时仍会被 card 清底擦掉。
    # text 含 marker 时它就是要抹的原 bullet, 保留在掩码里由原生文本重建。
    element.pop("marker_stripped", None)
    element.pop("marker_bboxes", None)
    if single and not has_marker:
        blocks = solid_blocks(local, crop, dist_bg, y1 - y0 - 2 * PAD_TEXT,
                              hex_to_bgr(source_color))
        if blocks:
            marker_bboxes = []
            for bm in blocks:
                by, bx = np.nonzero(bm)
                if len(by):
                    abs_bbox = [
                        x0 + int(bx.min()), y0 + int(by.min()),
                        x0 + int(bx.max()) + 1, y0 + int(by.max()) + 1,
                    ]
                    # A real row marker hugs the text. A distant rounded-card
                    # edge can otherwise satisfy all color/fill criteria after
                    # the search crop expands left (selftest negative case).
                    if max(0, text_left - abs_bbox[2]) <= 0.72 * row_h:
                        marker_bboxes.append(abs_bbox)
                local[bm] = 0
            if marker_bboxes:
                element["marker_stripped"] = True
                element["marker_bboxes"] = marker_bboxes
                print(f"[cutout] marker block detected for {element['id']} ({len(marker_bboxes)} block)")
        # The expanded left strip is a detector window, never a text-erasure
        # window. Non-solid neighboring line icons (e.g. the database outline
        # beside a caption) must survive even though they are high-contrast.
        glyph_left = max(0, int(text_left) - x0 - PAD_TEXT)
        local[:, :glyph_left] = 0
    mask[y0:y1, x0:x1] = np.maximum(
        mask[y0:y1, x0:x1],
        cv2.dilate(local, np.ones((3, 3), np.uint8), iterations=2))
    sel = local > 0
    # ink_bbox: 字形实际范围。OCR 框含标点伸展/marker 时比视觉 ink 大,
    # 供 assemble 拟合字号 (y) 与 marker_stripped 时的渲染起点 (x)。
    ys, xs = np.nonzero(local)
    if len(ys) >= 30:
        element["ink_bbox"] = [x0 + int(xs.min()), y0 + int(ys.min()),
                               x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1]
    # 取色/渐变样本用高阈 (与掩码阈值解耦): 自适应低阈掩码抹得干净, 但直接
    # 拿来采样会混入大量 AA 浅像素, 墨色系统性偏浅 (rg1t #4A4949 血案)。
    sel_ink = sel & (dist_bg > max(tol, INK_TOL_MIN))
    if int(np.count_nonzero(sel_ink)) < 60:
        sel_ink = sel
    # 渐变仅见于展示级短标题; 长句 OCR 框偏移+行际串扰会产生 d>100 的假渐变
    # (msgqos 页 21 字正文被测成 #A89D9E→#544547), 字数上限一刀切最稳。
    if "gradient" not in element and len(element.get("text", "").strip()) <= 14:
        g = detect_text_gradient(ci, sel_ink, dist_bg, element["bbox"][3] - element["bbox"][1], tol)
        if g:
            element["gradient"] = g
            print(f"[cutout] gradient text {element['id']}: {g['from']} -> {g['to']} ({g['dir']}, d={g['delta']})")
    # 墨色自校准: VLM 估色不可靠 (实测日期字 agent 报 #14213D, 真色 #5A6070),
    # 实测真墨色与 agent 色偏差大时以实测为准; agent 可 "color_locked":true 锁定。
    if not element.get("color_locked"):
        med = measure_text_color(ci, sel_ink, dist_bg)
        if med is not None and float(np.linalg.norm(med - hex_to_bgr(source_color))) > COLOR_MIN_DELTA:
            element["color"] = "#%02X%02X%02X" % (int(med[2]), int(med[1]), int(med[0]))
            element["color_corrected"] = True
            print(f"[cutout] color corrected {element['id']}: -> {element['color']}")


def to_alpha(bgr):
    """白/纯色底转透明: 底色取四角众数, 距离线性映射 alpha, 输出 BGRA."""
    h, w = bgr.shape[:2]
    k = max(2, min(h, w) // 12)
    corners = np.concatenate([
        bgr[:k, :k].reshape(-1, 3), bgr[:k, -k:].reshape(-1, 3),
        bgr[-k:, :k].reshape(-1, 3), bgr[-k:, -k:].reshape(-1, 3)])
    bg = mode_color(corners).astype(np.int32)
    dist = np.abs(bgr.astype(np.int32) - bg).sum(axis=2)
    alpha = np.clip((dist - ALPHA_NEAR) / (ALPHA_FAR - ALPHA_NEAR), 0, 1)
    alpha = cv2.GaussianBlur((alpha * 255).astype(np.uint8), (3, 3), 0)
    out = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    out[:, :, 3] = alpha
    return out


def main(run_dir):
    run = Path(run_dir)
    img = imread_u(run / "source.png")
    H, W = img.shape[:2]
    ej = json.loads((run / "elements.json").read_text(encoding="utf-8"))
    els = ej["elements"]

    # Idempotency: marker sprites are deterministic derived elements. Rebuild them
    # from the current source/text geometry on every run instead of accumulating.
    els[:] = [e for e in els if not e.get("auto_marker_for")]

    raw = run / "elements.raw.json"
    if not raw.exists():
        raw.write_text(json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")

    texts = [e for e in els if e["type"] == "text"]
    for e in texts:
        e.setdefault("source_color", e.get("color", "#1D1D1F"))
    keep = [clip_bbox(e["bbox"], W, H, 1) for e in els if e["type"] == "text_in_graphic"]

    # 1) 去文字 (text_in_graphic 区域保护, 不进 mask)
    tmask = np.zeros((H, W), np.uint8)
    for e in texts:
        add_text_glyph_mask(tmask, img, e, W, H)

    # Materialize detected marker blocks as independent draggable sprites. Choose
    # the smallest containing card/graphic as parent so a parent graphic can cut
    # out the child and avoid duplicates; card children simply render above it.
    marker_sprites = []
    containers = [e for e in els if e["type"] in ("card", "graphic")]
    for e in texts:
        sprite_ids = []
        for i, bbox in enumerate(e.get("marker_bboxes", []), 1):
            cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
            marker_area = max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
            # If an already-declared small semantic object covers the detected
            # block, it is already independently editable (e.g. KPI bars beside
            # +28%). Do not create a duplicate sprite over that object.
            already_semantic = False
            for c in containers:
                cb = c["bbox"]
                ix0, iy0 = max(bbox[0], cb[0]), max(bbox[1], cb[1])
                ix1, iy1 = min(bbox[2], cb[2]), min(bbox[3], cb[3])
                inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
                c_area = max(1, (cb[2] - cb[0]) * (cb[3] - cb[1]))
                if inter >= 0.70 * marker_area and c_area <= 10 * marker_area:
                    already_semantic = True
                    break
            if already_semantic:
                print(f"[cutout] marker sprite skipped (already semantic): {e['id']} {bbox}")
                continue
            covers = [c for c in containers
                      if c["bbox"][0] <= cx <= c["bbox"][2]
                      and c["bbox"][1] <= cy <= c["bbox"][3]]
            parent = min(covers,
                         key=lambda c: (c["bbox"][2] - c["bbox"][0])
                                       * (c["bbox"][3] - c["bbox"][1]),
                         default=None)
            sid = f"{e['id']}__marker" + (f"_{i}" if i > 1 else "")
            sprite = {
                "id": sid, "type": "graphic", "bbox": bbox,
                "desc": f"auto marker for {e['id']}", "alpha": True,
                "auto_marker_for": e["id"],
            }
            if parent:
                sprite["parent"] = parent["id"]
            marker_sprites.append(sprite)
            sprite_ids.append(sid)
        if sprite_ids:
            e["marker_sprite_ids"] = sprite_ids
        else:
            e.pop("marker_sprite_ids", None)
    els.extend(marker_sprites)
    # tig 保护区与显式 text 元素重叠时 text 优先: tig 只清"无 text 声明"的区域,
    # 否则 tig 框稍大就会吃掉相邻 text 的字形掩码, 留半字残影 (msgqos r6 血案)
    tzone = np.zeros((H, W), np.uint8)
    for e in texts:
        boxes = [e["bbox"]] + ([e["agent_bbox"]] if e.get("agent_bbox") else [])
        u = [min(b[0] for b in boxes), min(b[1] for b in boxes),
             max(b[2] for b in boxes), max(b[3] for b in boxes)]
        bx = clip_bbox(u, W, H, PAD_TEXT)
        tzone[bx[1]:bx[3], bx[0]:bx[2]] = 255
    for x0, y0, x1, y1 in keep:
        tmask[y0:y1, x0:x1] = np.where(
            tzone[y0:y1, x0:x1] > 0, tmask[y0:y1, x0:x1], 0)
    clean_text = remove_regions(img, tmask, ring_kernel=7, inpaint_radius=2)
    imwrite_u(run / "clean_text.png", clean_text)

    # 2) card 纯色验证 + 取色 (中心 72% 区域, 剔除与 text bbox 相交部分 — 血泪#10)
    for e in els:
        if e["type"] != "card":
            continue
        x0, y0, x1, y1 = clip_bbox(e["bbox"], W, H)
        nested = [x for x in els if x.get("parent") == e.get("id")]
        # 两级内缩: 细条(KPI bar)的 bbox 上下常带 2-3px 背景边, 14% 内缩裁不掉,
        # 首测超标时加深内缩到 32% 重测一次再判降级
        for shrink in (0.14, 0.32):
            mw, mh = int((x1 - x0) * shrink), int((y1 - y0) * shrink)
            cx0, cy0, cx1, cy1 = x0 + mw, y0 + mh, x1 - mw, y1 - mh
            m = np.ones((H, W), bool)
            m[:cy0, :] = False; m[cy1:, :] = False
            m[:, :cx0] = False; m[:, cx1:] = False
            for t in texts + [{"bbox": b} for b in keep] + nested:
                tx0, ty0, tx1, ty1 = clip_bbox(t["bbox"], W, H, 4)
                m[ty0:ty1, tx0:tx1] = False
            # 在 clean_text 上采样: 文字已被抹成底色, 小按钮(文字占比 90%)剔除后
            # 也不会 fallback 到含文字的原图区域 (v0.3 按钮 std 爆表降级的根因)
            px = clean_text[m]
            if len(px) < 40:
                px = clean_text[cy0:cy1, cx0:cx1].reshape(-1, 3)
            std = float(px.std(axis=0).max()) if len(px) else 999.0
            if std <= CARD_STD_MAX:
                break
        if std <= CARD_STD_MAX or e.get("force_native"):
            c = mode_color(px)
            e["fill"] = f"#{c[2]:02X}{c[1]:02X}{c[0]:02X}"
            forced = ", forced" if e.get("force_native") and std > CARD_STD_MAX else ""
            e.pop("demoted_from", None)
            print(f"[cutout] card {e['id']}: fill={e['fill']} (std={std:.1f}{forced})")
        else:
            e["demoted_from"] = "card"
            e["type"] = "graphic"
            e.setdefault("desc", "card-demoted")
            print(f"[cutout] card {e['id']}: std={std:.1f} > {CARD_STD_MAX}, demoted to graphic")

    # 3) graphic 贴图 (从 clean_text 裁, 文字不烧死在贴图里)
    assets = run / "assets"
    assets.mkdir(exist_ok=True)
    for e in els:
        if e["type"] != "graphic":
            continue
        x0, y0, x1, y1 = clip_bbox(e["bbox"], W, H, PAD_GRAPHIC)
        crop = clean_text[y0:y1, x0:x1].copy()
        children = [x for x in els if x.get("parent") == e.get("id") and x["type"] in ("card", "graphic")]
        if children:
            cmask = np.zeros(crop.shape[:2], np.uint8)
            for child in children:
                cx0, cy0, cx1, cy1 = clip_bbox(child["bbox"], W, H, PAD_GRAPHIC)
                lx0, ly0 = max(0, cx0 - x0), max(0, cy0 - y0)
                lx1, ly1 = min(crop.shape[1], cx1 - x0), min(crop.shape[0], cy1 - y0)
                if lx1 > lx0 and ly1 > ly0:
                    cmask[ly0:ly1, lx0:lx1] = 255
            crop = remove_regions(crop, cmask, ring_kernel=9, inpaint_radius=2)
        # text_in_graphic 属于贴图内容 — 但 clean_text 阶段已保护, 从原图恢复无必要
        out = to_alpha(crop) if e.get("alpha") else crop
        p = assets / f"{e['id']}.png"
        imwrite_u(p, out)
        e["asset"] = f"assets/{e['id']}.png"
        e["crop_bbox"] = [x0, y0, x1, y1]

    # 4) 残差底图: 从 clean_text 再抹掉 card/graphic 区域
    fmask = np.zeros((H, W), np.uint8)
    for e in els:
        if e["type"] in ("card", "graphic"):
            x0, y0, x1, y1 = clip_bbox(e["bbox"], W, H, PAD_GRAPHIC)
            fmask[y0:y1, x0:x1] = 255
    base = remove_regions(clean_text, fmask)
    imwrite_u(run / "base.png", base)

    (run / "elements.json").write_text(
        json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")
    n_g = sum(1 for e in els if e["type"] == "graphic")
    n_c = sum(1 for e in els if e["type"] == "card")
    print(f"[cutout] done: {len(texts)} text / {n_c} card / {n_g} graphic -> {assets}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--run") + 1] if "--run" in sys.argv else sys.argv[1])
