#!/usr/bin/env python3
import base64
import io
import json
import os
import re
import time
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "uploads" / "food-photos-20260311" / "jpg"
OUT_DIR = ROOT / "uploads" / "food-photos-20260311" / "llm-splits"
MANIFEST = OUT_DIR / "llm_split_manifest.json"
REPORT = OUT_DIR / "LLM_SPLIT_REPORT.md"

MODEL = "claude-sonnet-4-6"
MAX_SIDE = 1600
API_TIMEOUT = 60


def _resize_for_vision(img: Image.Image):
    w, h = img.size
    scale = 1.0
    if max(w, h) > MAX_SIDE:
        scale = MAX_SIDE / float(max(w, h))
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    return img, scale


def _img_to_b64_jpeg(img: Image.Image, quality=86):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()

    # direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # first {...}
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        return json.loads(m.group(0))

    raise ValueError("Cannot parse JSON from model output")


def call_vision_for_boxes(image_b64: str):
    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    api_key = os.getenv("ANTHROPIC_AUTH_TOKEN")
    if not base_url or not api_key:
        raise RuntimeError("Missing ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN")

    url = f"{base_url}/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    prompt = (
        "你是图像标注器。任务：识别图片里每一道‘有食物的盘子/碗/餐盘容器’的精确矩形坐标。"
        "\n要求："
        "\n1) 返回图片坐标系下的像素整数，原点在左上角。"
        "\n2) 每个 dish 的 bbox 尽量紧贴容器外缘（不要包太多背景）。"
        "\n3) 同一道菜只返回一个框；不要重复框。"
        "\n4) 排除空盘、杯子里的饮料、餐具。"
        "\n5) 若无可识别菜品，返回 dishes=[]。"
        "\n只输出 JSON，格式严格为："
        "\n{\"dishes\":[{\"label\":\"...\",\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"confidence\":0.0}]}"
    )

    payload = {
        "model": MODEL,
        "max_tokens": 1200,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_b64,
                        },
                    },
                ],
            }
        ],
    }

    for i in range(2):
        resp = requests.post(url, headers=headers, json=payload, timeout=API_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            text_chunks = [c.get("text", "") for c in data.get("content", []) if c.get("type") == "text"]
            text = "\n".join(text_chunks).strip()
            return _extract_json(text)

        # retry on rate/transient
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 + i * 2)
            continue
        raise RuntimeError(f"Vision API error {resp.status_code}: {resp.text[:500]}")

    raise RuntimeError("Vision API failed after retries")


def clamp_box(x, y, w, h, W, H):
    x = max(0, min(W - 1, int(round(x))))
    y = max(0, min(H - 1, int(round(y))))
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))
    if x + w > W:
        w = W - x
    if y + h > H:
        h = H - y
    if w < 40 or h < 40:
        return None
    return x, y, w, h


def iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / max(1, area_a + area_b - inter)


def dedupe(boxes, thr=0.45):
    kept = []
    for b in sorted(boxes, key=lambda z: z["bbox"][2] * z["bbox"][3], reverse=True):
        x, y, w, h = b["bbox"]
        rect = (x, y, x + w, y + h)
        if all(iou(rect, (k["bbox"][0], k["bbox"][1], k["bbox"][0] + k["bbox"][2], k["bbox"][1] + k["bbox"][3])) < thr for k in kept):
            kept.append(b)
    return kept


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.jpg"):
        old.unlink(missing_ok=True)

    photos = sorted(SRC_DIR.glob("*.jpg"))
    limit = int(os.getenv("LIMIT", "0") or 0)
    if limit > 0:
        photos = photos[:limit]
    manifest = {
        "sourceDir": str(SRC_DIR.relative_to(ROOT)),
        "outDir": str(OUT_DIR.relative_to(ROOT)),
        "model": MODEL,
        "photos": [],
    }

    total = 0
    ok_photos = 0

    for i, p in enumerate(photos, start=1):
        print(f"[{i}/{len(photos)}] {p.name}", flush=True)
        try:
            img = Image.open(p).convert("RGB")
            W, H = img.size
            vis, scale = _resize_for_vision(img)
            b64 = _img_to_b64_jpeg(vis)

            res = call_vision_for_boxes(b64)
            dishes = res.get("dishes", []) if isinstance(res, dict) else []

            parsed = []
            for d in dishes:
                bb = d.get("bbox", {}) if isinstance(d, dict) else {}
                x = bb.get("x", 0) / scale
                y = bb.get("y", 0) / scale
                w = bb.get("width", 0) / scale
                h = bb.get("height", 0) / scale
                clamped = clamp_box(x, y, w, h, W, H)
                if clamped is None:
                    continue
                parsed.append({
                    "label": d.get("label", "dish"),
                    "confidence": float(d.get("confidence", 0) or 0),
                    "bbox": list(clamped),
                })

            parsed = dedupe(parsed)
            parsed = sorted(parsed, key=lambda z: (z["bbox"][1], z["bbox"][0]))

            splits = []
            for j, d in enumerate(parsed, start=1):
                x, y, w, h = d["bbox"]
                crop = img.crop((x, y, x + w, y + h))
                out_name = f"{p.stem}__llm_dish{j:02d}.jpg"
                out_path = OUT_DIR / out_name
                crop.save(out_path, format="JPEG", quality=92)
                splits.append({
                    "file": out_name,
                    "label": d["label"],
                    "confidence": d["confidence"],
                    "bbox": {"x": x, "y": y, "width": w, "height": h},
                })

            total += len(splits)
            ok_photos += 1
            manifest["photos"].append({
                "file": p.name,
                "ok": True,
                "size": {"width": W, "height": H},
                "splitCount": len(splits),
                "splits": splits,
            })

        except Exception as e:
            manifest["photos"].append({"file": p.name, "ok": False, "error": str(e)})

    manifest["summary"] = {
        "photoCount": len(photos),
        "okPhotoCount": ok_photos,
        "splitCount": total,
        "avgSplitPerPhoto": round(total / max(1, ok_photos), 2),
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    top = sorted(
        [(x["file"], x.get("splitCount", 0)) for x in manifest["photos"] if x.get("ok")],
        key=lambda t: t[1],
        reverse=True,
    )[:12]

    lines = [
        "# LLM 盘子坐标分割报告",
        "",
        f"- 模型: `{MODEL}`",
        f"- 源目录: `{manifest['sourceDir']}`",
        f"- 输出目录: `{manifest['outDir']}`",
        f"- 处理照片: {manifest['summary']['photoCount']} 张",
        f"- 成功识别: {manifest['summary']['okPhotoCount']} 张",
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
