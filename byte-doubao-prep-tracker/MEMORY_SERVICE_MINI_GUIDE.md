# Read / Query / Merge / Deduplicate 最小服务复习手册

> 目标：用最小可运行版本，把“记忆写入、读取查询、合并去重”讲清楚并跑通。

---

## 1) 最小服务目标

在面试场景里，你要体现三件事：
1. **结构清晰**：数据模型与接口边界明确
2. **可运行**：能写入、能查、能合并去重
3. **可扩展**：后续可以平滑接向量检索、持久化与在线评估

---

## 2) 接口定义（MVP）

- `write_memory(user_id, text, tags)`
  - 写入一条候选记忆
- `query_memory(user_id, query, topk=5)`
  - 按关键词相关性 + 时间新鲜度返回 Top-K
- `merge_memories(user_id, source_ids, merged_text, merged_tags=None)`
  - 人工或自动合并多条记忆，生成新记忆并标记旧记忆失效
- `deduplicate(user_id, sim_threshold=0.75)`
  - 自动去重：相似文本归并
- `read_memory(user_id, memory_id)`
  - 按 ID 读取单条记忆（用于追踪和解释）

---

## 3) 数据模型（最小版）

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import List

@dataclass
class MemoryItem:
    id: str
    user_id: str
    text: str
    tags: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    is_active: bool = True
    merged_from: List[str] = field(default_factory=list)
```

关键字段解释：
- `is_active`：合并后旧记忆可失效，但保留可追溯性
- `merged_from`：说明这条记忆是由哪些旧记忆合并而来

---

## 4) 参考实现（可直接运行）

```python
import re
import uuid
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

@dataclass
class MemoryItem:
    id: str
    user_id: str
    text: str
    tags: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    is_active: bool = True
    merged_from: List[str] = field(default_factory=list)

class MemoryService:
    def __init__(self):
        self.store: Dict[str, Dict[str, MemoryItem]] = {}

    def _tokenize(self, s: str) -> set:
        return set(re.findall(r"[a-zA-Z0-9\u4e00-\u9fff]+", s.lower()))

    def _jaccard(self, a: str, b: str) -> float:
        sa, sb = self._tokenize(a), self._tokenize(b)
        if not sa and not sb:
            return 1.0
        if not sa or not sb:
            return 0.0
        return len(sa & sb) / len(sa | sb)

    def _ensure_user(self, user_id: str):
        if user_id not in self.store:
            self.store[user_id] = {}

    def write_memory(self, user_id: str, text: str, tags: List[str] = None) -> MemoryItem:
        self._ensure_user(user_id)
        item = MemoryItem(
            id=str(uuid.uuid4()),
            user_id=user_id,
            text=text.strip(),
            tags=tags or [],
        )
        self.store[user_id][item.id] = item
        return item

    def read_memory(self, user_id: str, memory_id: str) -> MemoryItem | None:
        return self.store.get(user_id, {}).get(memory_id)

    def query_memory(self, user_id: str, query: str, topk: int = 5) -> List[Tuple[MemoryItem, float]]:
        items = [x for x in self.store.get(user_id, {}).values() if x.is_active]
        now = datetime.utcnow()
        scored = []
        for it in items:
            sim = self._jaccard(query, it.text)
            age_hours = max((now - it.updated_at).total_seconds() / 3600, 1)
            freshness = 1 / age_hours
            score = 0.85 * sim + 0.15 * freshness
            scored.append((it, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:topk]

    def merge_memories(self, user_id: str, source_ids: List[str], merged_text: str, merged_tags: List[str] = None) -> MemoryItem:
        self._ensure_user(user_id)
        source_items = []
        for mid in source_ids:
            it = self.store[user_id].get(mid)
            if it and it.is_active:
                source_items.append(it)

        tag_set = set(merged_tags or [])
        for it in source_items:
            tag_set.update(it.tags)
            it.is_active = False
            it.updated_at = datetime.utcnow()

        merged = MemoryItem(
            id=str(uuid.uuid4()),
            user_id=user_id,
            text=merged_text.strip(),
            tags=sorted(tag_set),
            merged_from=[x.id for x in source_items],
        )
        self.store[user_id][merged.id] = merged
        return merged

    def deduplicate(self, user_id: str, sim_threshold: float = 0.75) -> List[Tuple[str, str, float]]:
        active_items = [x for x in self.store.get(user_id, {}).values() if x.is_active]
        merged_pairs = []
        visited = set()

        for i in range(len(active_items)):
            if active_items[i].id in visited:
                continue
            for j in range(i + 1, len(active_items)):
                if active_items[j].id in visited:
                    continue
                sim = self._jaccard(active_items[i].text, active_items[j].text)
                if sim >= sim_threshold:
                    new_text = f"{active_items[i].text}；{active_items[j].text}"
                    self.merge_memories(user_id, [active_items[i].id, active_items[j].id], new_text)
                    merged_pairs.append((active_items[i].id, active_items[j].id, sim))
                    visited.add(active_items[i].id)
                    visited.add(active_items[j].id)
                    break
        return merged_pairs
```

---

## 5) 最小测试清单（面试可说）

1. 写入 10 条记忆，`query_memory` 能返回 topk
2. `read_memory` 能读取指定 id
3. 两条高相似文本执行 `deduplicate` 后，旧记录失效，新记录可查
4. `merge_memories` 后 `merged_from` 可追溯
5. 边界：空 tags、topk 超过总量、重复 merge 的幂等处理

---

## 6) 面试讲解模板（2分钟）

我先做了一个最小内存版服务，核心接口是写入、查询、合并和去重。  
数据模型里保留 `is_active` 和 `merged_from`，保证合并后可追溯。  
查询打分采用“语义相关 + 新鲜度”加权，后续可以替换成向量检索。  
去重先用 Jaccard 做基线，触发阈值后自动合并，并保留审计信息。  
这套设计的价值是先低成本跑通闭环，再平滑演进到生产级方案。

---

## 7) 你明晚可以升级的点（可选）

- 把 `query_memory` 改为 hybrid（关键词 + embedding）
- 把 store 从内存改 SQLite（持久化）
- 给 `deduplicate` 增加“人工确认模式”（高风险时不自动合并）
