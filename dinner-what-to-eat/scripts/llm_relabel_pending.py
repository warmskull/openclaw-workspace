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
DATA_DIR = ROOT / 'data'
DISHES_FILE = DATA_DIR / 'dishes.json'
CANDS_FILE = DATA_DIR / 'dish-split-candidates.json'
YOLO_MANIFEST = ROOT / 'uploads' / 'food-photos-20260311' / 'yolo-splits' / 'yolo_split_manifest.json'
REPORT = ROOT / 'data' / 'LLM_RELABEL_REPORT_20260312.md'
MODEL = 'claude-sonnet-4-6'
MAX_SIDE = 1400
API_TIMEOUT = 60
CATEGORIES = ['主菜', '主食', '配菜', '轻食', '小食', '水果', '其他']
TAG = 'llm-relabel-20260312'


def resize_for_vision(img: Image.Image):
    w, h = img.size
    if max(w, h) <= MAX_SIDE:
        return img
    scale = MAX_SIDE / float(max(w, h))
    return img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)


def img_to_b64_jpeg(img: Image.Image, quality=84):
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def extract_json(text: str):
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?', '', text).strip()
        text = re.sub(r'```$', '', text).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        raise ValueError('Cannot parse JSON from response')
    return json.loads(m.group(0))


def call_vision(image_b64: str, mode: str):
    base_url = os.getenv('ANTHROPIC_BASE_URL', '').rstrip('/')
    api_key = os.getenv('ANTHROPIC_AUTH_TOKEN')
    if not base_url or not api_key:
        raise RuntimeError('Missing ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN')
    url = f'{base_url}/v1/messages'
    headers = {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }
    if mode == 'candidate':
        prompt = (
            '你是中文美食识别器。请识别这张图片中的单道菜，输出严格 JSON。'
            '要求：1) 只判断图片中央主要食物；2) 若不是一道清晰单菜，category 返回“其他”；'
            '3) dish_name 用简洁自然的中文菜名；4) category 必须是以下之一：' + '、'.join(CATEGORIES) + '。'
            'JSON 格式：'
            '{"dish_name":"...","category":"主菜","is_single_dish":true,'
            '"is_multi_dish":false,"is_food":true,"visible_dishes":["..."],'
            '"confidence":0.0,"reason":"..."}'
        )
    else:
        prompt = (
            '你是中文美食识别器。请判断这张原图是一道菜还是一桌多道菜。输出严格 JSON。'
            '要求：1) 如果画面里明显有多道不同菜/多个餐盘/一桌子菜，is_multi_dish=true；'
            '2) 列出能看出的每道菜的简短中文名到 visible_dishes；'
            '3) 若主体不是单道菜，category 返回“其他”；'
            '4) dish_name 仅在能明确判断主菜时填写，否则给最合理的概括名；'
            'category 必须是以下之一：' + '、'.join(CATEGORIES) + '。'
            'JSON 格式：'
            '{"dish_name":"...","category":"其他","is_single_dish":false,'
            '"is_multi_dish":true,"is_food":true,"visible_dishes":["菜1","菜2"],'
            '"confidence":0.0,"reason":"..."}'
        )
    payload = {
        'model': MODEL,
        'max_tokens': 700,
        'temperature': 0,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': prompt},
                {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': image_b64}},
            ],
        }],
    }
    for i in range(3):
        resp = requests.post(url, headers=headers, json=payload, timeout=API_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            text = '\n'.join(c.get('text', '') for c in data.get('content', []) if c.get('type') == 'text')
            return extract_json(text)
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 + i * 2)
            continue
        raise RuntimeError(f'Vision API error {resp.status_code}: {resp.text[:500]}')
    raise RuntimeError('Vision API failed after retries')


def normalize_category(cat: str, single: bool):
    cat = str(cat or '').strip()
    if cat in CATEGORIES:
        return cat
    return '主菜' if single else '其他'


def update_tags(tags, *extra):
    out = [str(x).strip() for x in (tags or []) if str(x).strip()]
    for t in extra:
        if t and t not in out:
            out.append(t)
    return out


def main():
    dishes = json.loads(DISHES_FILE.read_text())
    cands = json.loads(CANDS_FILE.read_text())
    manifest = json.loads(YOLO_MANIFEST.read_text())
    yolo_counts = {p['file']: p.get('splitCount', 0) for p in manifest.get('photos', []) if p.get('ok')}

    todo_dishes = [d for d in dishes if d.get('needsConfirm')]
    todo_cands = [c for c in cands if c.get('needsConfirm')]

    report_lines = [
        '# LLM 重新识别报告（2026-03-12）',
        '',
        f'- 待确认正式菜：{len(todo_dishes)}',
        f'- 待确认 YOLO 候选：{len(todo_cands)}',
        '',
        '## 正式菜（原图）',
    ]

    multi_dish_source_files = []
    multi_verified = []

    for idx, item in enumerate(todo_dishes, 1):
        img_path = ROOT / item['photo'].lstrip('/')
        print(f'[dish {idx}/{len(todo_dishes)}] {item["id"]} -> {img_path.name}', flush=True)
        img = Image.open(img_path).convert('RGB')
        res = call_vision(img_to_b64_jpeg(resize_for_vision(img)), 'original')
        is_multi = bool(res.get('is_multi_dish'))
        visible = [str(x).strip() for x in (res.get('visible_dishes') or []) if str(x).strip()]
        conf = float(res.get('confidence') or 0)
        item['llmRecognition'] = {
            'model': MODEL,
            'tag': TAG,
            'dish_name': res.get('dish_name', ''),
            'category': res.get('category', ''),
            'is_single_dish': bool(res.get('is_single_dish')),
            'is_multi_dish': is_multi,
            'visible_dishes': visible,
            'confidence': conf,
            'reason': res.get('reason', ''),
        }
        if res.get('dish_name') and str(item.get('name', '')).startswith('待确认菜名'):
            item['name'] = str(res['dish_name']).strip()
        item['category'] = normalize_category(res.get('category', ''), bool(res.get('is_single_dish')))
        item['tags'] = update_tags(item.get('tags'), 'LLM识别', '原图复核')
        item['needsConfirm'] = True
        if is_multi:
            source_name = Path(item['photo']).name
            item['excludedFromFinal'] = True
            item['excludeReason'] = 'multi_dish_original'
            item['finalImage'] = False
            item['category'] = '其他'
            multi_dish_source_files.append(source_name)
            yolo_count = yolo_counts.get(source_name, 0)
            verified = yolo_count >= max(2, len(visible))
            multi_verified.append((source_name, len(visible), yolo_count, verified))
        report_lines.append(f"- {item['id']} / {Path(item['photo']).name}: {item['name']} | 多菜={is_multi} | visible={visible} | conf={conf:.2f}")

    report_lines += ['', '## YOLO 候选（裁剪图）']
    for idx, item in enumerate(todo_cands, 1):
        img_path = ROOT / item['photo'].lstrip('/')
        print(f'[cand {idx}/{len(todo_cands)}] {item["id"]} -> {img_path.name}', flush=True)
        img = Image.open(img_path).convert('RGB')
        res = call_vision(img_to_b64_jpeg(resize_for_vision(img)), 'candidate')
        conf = float(res.get('confidence') or 0)
        item['llmRecognition'] = {
            'model': MODEL,
            'tag': TAG,
            'dish_name': res.get('dish_name', ''),
            'category': res.get('category', ''),
            'is_single_dish': bool(res.get('is_single_dish')),
            'is_multi_dish': bool(res.get('is_multi_dish')),
            'visible_dishes': [str(x).strip() for x in (res.get('visible_dishes') or []) if str(x).strip()],
            'confidence': conf,
            'reason': res.get('reason', ''),
        }
        if res.get('dish_name'):
            item['name'] = str(res['dish_name']).strip()
        item['category'] = normalize_category(res.get('category', ''), bool(res.get('is_single_dish')))
        item['tags'] = update_tags(item.get('tags'), 'LLM识别')
        item['needsConfirm'] = True
        report_lines.append(f"- {item['id']} / {Path(item['photo']).name}: {item['name']} | 类别={item['category']} | conf={conf:.2f}")

    DISHES_FILE.write_text(json.dumps(dishes, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    CANDS_FILE.write_text(json.dumps(cands, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    report_lines += [
        '',
        '## 多菜原图与 YOLO 核对',
    ]
    if not multi_verified:
        report_lines.append('- 无')
    else:
        for src, vis_n, yolo_n, ok in multi_verified:
            report_lines.append(f'- {src}: LLM可见菜数≈{vis_n}，YOLO分割数={yolo_n}，核对结果={"通过" if ok else "不足"}')

    summary = {
        'pending_dishes': len(todo_dishes),
        'pending_candidates': len(todo_cands),
        'multi_dish_originals_excluded': len(multi_dish_source_files),
        'yolo_verified_multi_dish': sum(1 for _,_,_,ok in multi_verified if ok),
        'yolo_under_count': [src for src, _, _, ok in multi_verified if not ok],
    }
    report_lines += ['', '## Summary', '', '```json', json.dumps(summary, ensure_ascii=False, indent=2), '```', '']
    REPORT.write_text('\n'.join(report_lines), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
