# 晚饭吃什么

一个轻量网页：展示家庭菜谱，并按“今晚情况”推荐晚饭菜单。

## 当前已完成

- 菜谱展示（照片、食材、做法、卡路里）
- 条件筛选（时间、分类、低卡、快手）
- 推荐算法（按目标 + 食材匹配 + 时间约束）
- 单图多菜切图工具（`/split.html`，手动框选导出）

## 启动

```bash
cd dinner-what-to-eat
npm start
# 默认端口 4173
```

访问：`http://127.0.0.1:4173`

## 数据结构

数据文件：`data/dishes.json`

你后续只需要往里面追加菜品对象，并把图片放到 `images/` 即可。

## 部署（无容器）

```bash
PORT=4173 node serve.js
```

再由 Nginx 反代到该端口。

## 部署（Docker）

```bash
docker build -t dinner-what-to-eat .
docker run -d --name dinner-app -p 4173:4173 dinner-what-to-eat
```
