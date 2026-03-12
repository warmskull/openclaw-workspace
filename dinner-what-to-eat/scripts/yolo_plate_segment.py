#!/usr/bin/env python3
import json
from pathlib import Path

import cv2
from ultralytics import YOLOWorld

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / 'uploads' / 'food-photos-20260311' / 'jpg'
OUT_DIR = ROOT / 'uploads' / 'food-photos-20260311' / 'yolo-splits'
MANIFEST = OUT_DIR / 'yolo_split_manifest.json'
REPORT = OUT_DIR / 'YOLO_SPLIT_REPORT.md'


def iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    return inter / (area_a + area_b - inter)


def dedupe(boxes, thr=0.45):
    out = []
    for b in sorted(boxes, key=lambda x: (x['x2']-x['x1'])*(x['y2']-x['y1']), reverse=True):
        rect = (b['x1'], b['y1'], b['x2'], b['y2'])
        if all(iou(rect, (k['x1'], k['y1'], k['x2'], k['y2'])) < thr for k in out):
            out.append(b)
    return out


def clamp_box(x1, y1, x2, y2, w, h):
    x1 = max(0, min(w - 1, int(round(x1))))
    y1 = max(0, min(h - 1, int(round(y1))))
    x2 = max(1, min(w, int(round(x2))))
    y2 = max(1, min(h, int(round(y2))))
    if x2 - x1 < 60 or y2 - y1 < 60:
        return None
    return x1, y1, x2, y2


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob('*.jpg'):
        old.unlink(missing_ok=True)

    model = YOLOWorld('yolov8s-worldv2.pt')
    # prompt classes
    labels = ['plate', 'dish', 'bowl', 'food plate', 'meal bowl']
    model.set_classes(labels)

    photos = sorted(SRC_DIR.glob('*.jpg'))
    manifest = {
        'sourceDir': str(SRC_DIR.relative_to(ROOT)),
        'outDir': str(OUT_DIR.relative_to(ROOT)),
        'model': 'yolov8s-worldv2',
        'classes': labels,
        'photos': [],
    }

    total = 0
    ok = 0

    for i, p in enumerate(photos, 1):
        print(f'[{i}/{len(photos)}] {p.name}', flush=True)
        img = cv2.imread(str(p))
        if img is None:
            manifest['photos'].append({'file': p.name, 'ok': False, 'error': 'read_failed'})
            continue

        h, w = img.shape[:2]
        try:
            res = model.predict(source=img, conf=0.12, iou=0.45, verbose=False)[0]
            boxes = []
            if res.boxes is not None and len(res.boxes) > 0:
                xyxy = res.boxes.xyxy.cpu().numpy()
                confs = res.boxes.conf.cpu().numpy()
                cls = res.boxes.cls.cpu().numpy().astype(int)
                for bb, c, k in zip(xyxy, confs, cls):
                    x1, y1, x2, y2 = clamp_box(bb[0], bb[1], bb[2], bb[3], w, h) or (None, None, None, None)
                    if x1 is None:
                        continue
                    area = (x2-x1)*(y2-y1)
                    if area < w*h*0.02 or area > w*h*0.92:
                        continue
                    boxes.append({
                        'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                        'label': labels[k] if 0 <= k < len(labels) else 'dish',
                        'confidence': float(c),
                    })

            boxes = dedupe(boxes)
            boxes = sorted(boxes, key=lambda z: (z['y1'], z['x1']))[:6]

            splits = []
            for j, b in enumerate(boxes, 1):
                crop = img[b['y1']:b['y2'], b['x1']:b['x2']]
                out_name = f'{p.stem}__yolo_dish{j:02d}.jpg'
                out_path = OUT_DIR / out_name
                cv2.imwrite(str(out_path), crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                splits.append({
                    'file': out_name,
                    'label': b['label'],
                    'confidence': round(b['confidence'], 4),
                    'bbox': {
                        'x': b['x1'], 'y': b['y1'],
                        'width': b['x2'] - b['x1'], 'height': b['y2'] - b['y1']
                    }
                })

            ok += 1
            total += len(splits)
            manifest['photos'].append({
                'file': p.name,
                'ok': True,
                'size': {'width': w, 'height': h},
                'splitCount': len(splits),
                'splits': splits,
            })
        except Exception as e:
            manifest['photos'].append({'file': p.name, 'ok': False, 'error': str(e)})

    manifest['summary'] = {
        'photoCount': len(photos),
        'okPhotoCount': ok,
        'splitCount': total,
        'avgSplitPerPhoto': round(total / max(1, ok), 2),
    }

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    top = sorted(
        [(x['file'], x.get('splitCount', 0)) for x in manifest['photos'] if x.get('ok')],
        key=lambda t: t[1], reverse=True
    )[:12]
    failed = [x['file'] for x in manifest['photos'] if not x.get('ok')]

    lines = [
        '# YOLO 盘子分割报告',
        '',
        f"- 模型: `{manifest['model']}`",
        f"- 类别: {', '.join(labels)}",
        f"- 处理照片: {manifest['summary']['photoCount']} 张",
        f"- 成功识别: {manifest['summary']['okPhotoCount']} 张",
        f"- 生成分割图: {manifest['summary']['splitCount']} 张",
        f"- 平均每张: {manifest['summary']['avgSplitPerPhoto']} 道",
        '',
        '## 分割数量 Top',
    ]
    for f, c in top:
        lines.append(f'- {f}: {c} 道')
    if failed:
        lines += ['', '## 失败图片'] + [f'- {x}' for x in failed]

    REPORT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(manifest['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
