#!/usr/bin/env python3
import json
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "uploads" / "food-photos-20260311" / "jpg"
OUT_DIR = ROOT / "uploads" / "food-photos-20260311" / "splits"
MANIFEST = OUT_DIR / "split_manifest.json"
REPORT = OUT_DIR / "SPLIT_REPORT.md"


def circle_overlap(c1, c2):
    x1, y1, r1 = c1
    x2, y2, r2 = c2
    d2 = (x1 - x2) ** 2 + (y1 - y2) ** 2
    d = d2 ** 0.5
    return d < (r1 + r2) * 0.72


def pick_circles(candidates, max_keep=4):
    kept = []
    for c in sorted(candidates, key=lambda x: x[2], reverse=True):
        if all(not circle_overlap(c, k) for k in kept):
            kept.append(c)
        if len(kept) >= max_keep:
            break
    return kept


def clamp(v, lo, hi):
    return max(lo, min(hi, int(round(v))))


def detect_dish_boxes(img):
    h, w = img.shape[:2]
    scale = 1600.0 / max(h, w) if max(h, w) > 1600 else 1.0
    small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (9, 9), 1.4)

    min_r = int(min(sh, sw) * 0.10)
    max_r = int(min(sh, sw) * 0.42)

    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.25,
        minDist=int(min(sh, sw) * 0.18),
        param1=120,
        param2=42,
        minRadius=max(24, min_r),
        maxRadius=max(min_r + 8, max_r),
    )

    candidates = []
    if circles is not None:
        for x, y, r in circles[0]:
            # avoid tiny false positives near border
            if x < r * 0.7 or y < r * 0.7 or x > sw - r * 0.7 or y > sh - r * 0.7:
                continue
            candidates.append((x, y, r))

    circles_kept = pick_circles(candidates, max_keep=4)

    boxes = []
    for x, y, r in circles_kept:
        m = r * 0.18
        x1 = clamp((x - r - m) / scale, 0, w - 1)
        y1 = clamp((y - r - m) / scale, 0, h - 1)
        x2 = clamp((x + r + m) / scale, 1, w)
        y2 = clamp((y + r + m) / scale, 1, h)
        if x2 - x1 > 80 and y2 - y1 > 80:
            boxes.append([x1, y1, x2, y2])

    # fallback: if no plate-like circle found, keep whole image as one dish candidate
    if not boxes:
        boxes = [[0, 0, w, h]]

    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))
    return boxes


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # clear old split jpgs
    for old in OUT_DIR.glob("*.jpg"):
        old.unlink(missing_ok=True)

    files = sorted([p for p in SRC_DIR.glob('*.jpg') if p.is_file()])
    manifest = {"sourceDir": str(SRC_DIR.relative_to(ROOT)), "outDir": str(OUT_DIR.relative_to(ROOT)), "photos": []}

    total_splits = 0
    for p in files:
        img = cv2.imread(str(p))
        if img is None:
            manifest["photos"].append({"file": p.name, "ok": False, "error": "read_failed"})
            continue

        boxes = detect_dish_boxes(img)
        split_files = []
        for idx, (x1, y1, x2, y2) in enumerate(boxes, start=1):
            crop = img[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            out_name = f"{p.stem}__dish{idx:02d}.jpg"
            out_path = OUT_DIR / out_name
            cv2.imwrite(str(out_path), crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
            split_files.append({
                "file": out_name,
                "bbox": [x1, y1, x2, y2],
                "w": x2 - x1,
                "h": y2 - y1,
            })

        total_splits += len(split_files)
        manifest["photos"].append({
            "file": p.name,
            "ok": True,
            "splitCount": len(split_files),
            "splits": split_files,
        })

    manifest["summary"] = {
        "photoCount": len(files),
        "splitCount": total_splits,
        "avgSplitPerPhoto": round(total_splits / max(1, len(files)), 2),
    }

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    top = sorted(
        [(x["file"], x.get("splitCount", 0)) for x in manifest["photos"] if x.get("ok")],
        key=lambda t: t[1],
        reverse=True,
    )[:12]

    lines = [
        "# 多菜分割报告",
        "",
        f"- 源目录: `{manifest['sourceDir']}`",
        f"- 输出目录: `{manifest['outDir']}`",
        f"- 处理照片: {manifest['summary']['photoCount']} 张",
        f"- 生成分割图: {manifest['summary']['splitCount']} 张",
        f"- 平均每张: {manifest['summary']['avgSplitPerPhoto']} 道",
        "",
        "## 分割数量 Top",
    ]
    for f, c in top:
        lines.append(f"- {f}: {c} 道")

    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(manifest["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
