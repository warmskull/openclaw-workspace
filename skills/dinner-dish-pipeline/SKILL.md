---
name: dinner-dish-pipeline
description: 管理“晚饭吃什么”菜品库、图片分图、菜品归档、信息卡片生成与套餐检查清单的工作流。用于以下场景： (1) 用户上传新的晚饭照片，尤其是来自 Telegram 的拍照图片；(2) 需要运行 YOLO/分图脚本，把一张图拆成多道菜候选；(3) 需要把候选菜品写入或整理到 `dinner-what-to-eat/data/dishes.json`；(4) 需要分析当前菜品库里的菜名、材料、营养、制作时间和图片状态；(5) 需要把“单菜随机推荐”升级为“蛋白质/蔬菜/主食”组合的晚饭套餐，并生成可自动勾选或手动修改的材料检查清单；(6) 需要为网页端提供可编辑的数据模型。
---

# Dinner Dish Pipeline

把“晚饭拍照 → 单菜候选 → 菜品信息卡片 → 正式菜品库 → 晚饭套餐推荐”当成一条连续流水线处理，不要把图片、候选、正式菜品、网页编辑拆成互不相干的零碎任务。

## Quick start

### 先做现状盘点
优先运行：

```bash
python3 skills/dinner-dish-pipeline/scripts/analyze_dishes.py \
  --out /root/.openclaw/workspace/dinner-what-to-eat/DATA_ANALYSIS_REPORT.md
```

用它先看：
- 当前有多少菜
- 哪些菜已经确认
- 哪些还是待确认
- 每道菜的图片、材料、营养说明、制作时间是否完整

### 需要设计或改数据结构时
读：
- `references/data-model.md`

### 需要接图片分图/归档工作流时
读：
- `references/workflow.md`

## Workflow

### 1. 接新图片
如果用户从 Telegram 发来新照片：
- 先把图片保存到 workspace 的 intake 目录
- 不要直接覆盖正式图片
- 保留来源信息（日期、原始文件名、来源聊天）

### 2. 分图生成候选
优先复用已有脚本：
- `dinner-what-to-eat/scripts/yolo_plate_segment.py`
- `dinner-what-to-eat/data/dish-split-candidates.json`

先生成候选，再人工/网页确认；不要直接把低置信度识别结果写成正式菜品。

### 3. 生成菜品信息卡片
每个候选至少要有：
- 菜名（允许先待确认）
- 图片
- 材料
- 营养说明
- 制作时间
- 分类
- `needsConfirm`

如果无法高置信识别菜名或食材：
- 保留占位值
- 明确写“待确认”
- 不要伪造很具体的配料细节

### 4. 网页端编辑
网页需要支持两层编辑：
- 单菜编辑：菜名 / 材料 / 营养 / 制作时间 / 图片
- 套餐编辑：蛋白质 / 蔬菜 / 主食 组合，以及材料检查清单

### 5. 套餐推荐
把“晚饭吃什么”从单菜随机，升级为一顿饭组合：
- 至少 1 个蛋白质
- 至少 1 个蔬菜
- 可选或推荐 1 个主食

推荐完成后：
- 自动汇总材料
- 按“蛋白质 / 蔬菜 / 主食”分组
- 生成可手动勾选的检查清单

## Working rules
- 先保留原始照片，再生成裁剪图，不要反向覆盖。
- 正式库和候选库分开维护。
- 需要批量写入时，先生成报告或候选，再做合并。
- 当前项目以 `dinner-what-to-eat/data/dishes.json` 为单菜事实源；新增套餐层时，不要破坏旧页面兼容性。
- 页面改造优先顺序：
  1. 支持单菜编辑
  2. 支持套餐推荐
  3. 支持检查清单
  4. 支持 Telegram 新图入库自动化

## Resources

### scripts/
- `analyze_dishes.py`: 盘点现有菜品库并输出 Markdown 报告

### references/
- `workflow.md`: Telegram 图片 → YOLO 分图 → 候选归档 → 人工确认的标准流程
- `data-model.md`: 单菜、套餐、检查清单的数据模型建议
