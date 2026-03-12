#!/usr/bin/env python3
import json
from pathlib import Path
from collections import Counter
import argparse


def load_items(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def is_confirmed(item: dict) -> bool:
    name = str(item.get('name', ''))
    return not name.startswith('待确认菜名') and not item.get('needsConfirm', False)


def build_report(items, repo_root: Path) -> str:
    total = len(items)
    with_photo = 0
    confirmed = []
    pending = []
    cats = Counter()

    for item in items:
        photo = str(item.get('photo') or '')
        if photo:
            abs_path = repo_root / photo.lstrip('/')
            if abs_path.exists():
                with_photo += 1
        cats[item.get('category') or '未分类'] += 1
        (confirmed if is_confirmed(item) else pending).append(item)

    lines = [
        '# 菜品库现状分析',
        '',
        f'- 菜品总数：{total}',
        f'- 已有图片：{with_photo}',
        f'- 已确认菜品：{len(confirmed)}',
        f'- 待确认/待补全：{len(pending)}',
        '',
        '## 分类分布',
    ]
    for k, v in sorted(cats.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f'- {k}: {v}')

    lines += ['', '## 已确认菜品']
    for item in confirmed:
        ingredients = '、'.join(item.get('ingredients') or []) or '待补充'
        lines += [
            f"### {item.get('name', item.get('id', '未命名'))}",
            f"- ID：`{item.get('id', '-')}`",
            f"- 分类：{item.get('category', '未分类')}",
            f"- 制作时间：{item.get('prepTimeMin', '-')} 分钟",
            f"- 热量：{item.get('caloriesKcal', '-')} kcal",
            f"- 材料：{ingredients}",
            f"- 营养说明：{item.get('nutritionNote', '待补充')}",
            f"- 图片：`{item.get('photo', '-')}`",
            ''
        ]

    lines += ['## 待确认菜品']
    for item in pending:
        ingredients = '、'.join(item.get('ingredients') or []) or '待补充'
        lines += [
            f"### {item.get('name', item.get('id', '未命名'))}",
            f"- ID：`{item.get('id', '-')}`",
            f"- 分类：{item.get('category', '未分类')}",
            f"- 制作时间：{item.get('prepTimeMin', '-')} 分钟",
            f"- 热量：{item.get('caloriesKcal', '-')} kcal",
            f"- 材料：{ingredients}",
            f"- 营养说明：{item.get('nutritionNote', '待补充')}",
            f"- 图片：`{item.get('photo', '-')}`",
            ''
        ]

    return '\n'.join(lines).rstrip() + '\n'


def main():
    parser = argparse.ArgumentParser(description='Analyze dinner dishes database and generate markdown report.')
    parser.add_argument('--dishes', default='/root/.openclaw/workspace/dinner-what-to-eat/data/dishes.json')
    parser.add_argument('--repo-root', default='/root/.openclaw/workspace/dinner-what-to-eat')
    parser.add_argument('--out', default='')
    args = parser.parse_args()

    dishes_path = Path(args.dishes)
    repo_root = Path(args.repo_root)
    items = load_items(dishes_path)
    report = build_report(items, repo_root)

    if args.out:
        Path(args.out).write_text(report, encoding='utf-8')
    print(report)


if __name__ == '__main__':
    main()
