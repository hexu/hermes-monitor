# Hermes Monitor SPEC-v21-M2 — Daily Metrics Dashboard 每日指标仪表盘

> 状态：冻结执行版  
> 日期：2026-06-14  
> 基线：v21-M1 Inspector 交互调试层  
> 范围：后端每日指标聚合 + 右侧仪表盘升级  

---

## 1. M2 目标

V21-M2 将右侧服务器区从“累计状态卡片”升级为“每日指标仪表盘”。

目标不是替换原指标，而是在保留现有核心指标基础上，增加每日视角与运行态解释能力。

---

## 2. 不变底线

1. 右侧数据必须真实，不能用前端估算替代后端真实字段。
2. 原有指标必须保留：状态、消息、累计 token、工具调用、模型名。
3. 左侧办公室仍维持 v21-M1 Inspector，不做 M3 场景事件增强。
4. 不接入本机 Claude Code / Cursor 外部 token；M2 只统计 Hermes 可见的 state.db / profile state.db 数据。
5. 若右侧 15% 空间不足，允许调为左 80% / 右 20%。

---

## 3. 后端指标定义

### 3.1 新接口

新增：

```text
GET /api/metrics/daily
```

返回：

```json
{
  "date": "2026-06-14",
  "generated_at": "2026-06-14T10:00:00",
  "profiles": [
    {
      "profile": "tech",
      "today_messages": 12,
      "today_tokens": 34567,
      "today_input_tokens": 12345,
      "today_output_tokens": 20000,
      "today_reasoning_tokens": 2222,
      "today_tool_calls": 8,
      "latest_started_at": "2026-06-14T09:55:00",
      "active_minutes_today": 42,
      "status_duration_seconds": 90,
      "last_active": "2026-06-14T09:59:30"
    }
  ]
}
```

### 3.2 数据源

- `default`：`/root/.hermes/state.db`
- 其他 profile：`/root/.hermes/profiles/{profile}/state.db`

优先读取 SQLite `sessions` 表。字段需兼容：

- `message_count`
- `tool_call_count`
- `input_tokens`
- `output_tokens`
- `reasoning_tokens`
- `started_at`
- `updated_at`（可能不存在）
- `model`

### 3.3 今日范围

按服务器本地日期计算：

```text
today_start = YYYY-MM-DDT00:00:00
```

sessions 归属今日的规则：

- 优先用 `updated_at` 或 `started_at`
- 若表无 `updated_at`，使用 `started_at`
- 若 timestamp 格式异常，则跳过，不影响接口整体可用

### 3.4 状态持续时间

M2 可不新建数据库表，因此状态持续时间可以基于当前 `collect()` 结果的 `last_active` 推导近似值：

- 有 `last_active`：`now - last_active`
- 无 `last_active`：null

这是运行态指标，不作为精确审计数据。

### 3.5 可靠性

`/api/metrics/daily` 出错时不得影响：

- `/health`
- `/api/state`
- WebSocket state 推送
- 前端现有面板渲染

单个 profile 读取失败时，应返回该 profile 的 0 值和 `error` 字段，而不是整个接口 500。

---

## 4. 前端仪表盘设计

### 4.1 布局调整

M2 将右侧宽度从 15% 调整为 20%，左侧办公室从 85% 调整为 80%。

原因：Daily Metrics 同时展示今日与累计指标，15% 宽度易拥挤。

### 4.2 每个 profile 卡片保留信息

必须保留：

- 中文名
- 状态文案
- 消息总数
- 累计 token
- 工具调用总数
- 模型名

### 4.3 新增显示信息

新增：

- 今日 token
- 今日消息
- 今日调用
- 最近活跃
- 状态持续时间

### 4.4 视觉层级

右侧卡片推荐结构：

```text
[姓名]                       [状态]
今日 token     今日消息/调用
累计 token     累计消息/调用
模型名
最近活跃 / 状态持续
```

重要度排序：

1. 状态 + 今日 token
2. 今日消息/调用
3. 累计 token/message/tool
4. 模型名
5. 最近活跃/持续时间

### 4.5 与 M1 Inspector 联动

保留右侧卡片点击联动：

- 点击卡片 → `ServerPanel.selectProfile(profile)`
- 同步 `PixelOffice.selectProfile(profile)`
- 右侧卡片 selected 高亮
- 左侧 Inspector 锁定对应人物

### 4.6 数据加载策略

`ServerPanel.update(data)` 仍接收 `/api/state` WebSocket 推送。

新增定时拉取：

```text
GET /api/metrics/daily
```

建议：

- 首次 init 拉一次
- 每 30 秒刷新一次
- 失败时保持旧 metrics，不清空面板
- 面板中若 metrics 缺失，今日数据显示 `--`

---

## 5. 实施文件范围

预计修改：

- `backend/hermes_collector.py`：新增每日指标聚合方法
- `backend/monitor_server.py`：新增 `/api/metrics/daily`
- `frontend/server-panel.js`：仪表盘渲染 + metrics 拉取
- `frontend/index.html`：版本文案 + 80/20 布局

不修改：

- `frontend/pixel-office.js`（除非版本文案必须同步，不应破坏 M1 Inspector）
- 数据库 schema
- collector 定时任务机制

---

## 6. 验收标准

1. `SPEC-v21-M2.md` 存在并记录执行范围。
2. 执行前备份 v21-M1，含 `RESTORE.sh`。
3. `/api/metrics/daily` HTTP 200。
4. `/api/metrics/daily` 返回 3 个 profiles。
5. 每个 profile 至少包含 today_tokens/today_messages/today_tool_calls。
6. `/api/state` 不受影响。
7. WebSocket 正常。
8. 右侧卡片仍显示原核心指标。
9. 右侧卡片新增今日 token/消息/调用。
10. 右侧布局为 20%，左侧为 80%。
11. 点击右侧卡片仍能联动左侧 Inspector。
12. 浏览器 console 无 JS error。
13. `node --check frontend/server-panel.js` 通过。
14. 后端 Python 语法检查通过。
15. 视觉上不能比 M1 更拥挤到不可读。

---

## 7. 回滚策略

回滚到 v21-M1：执行备份目录中的：

```bash
bash RESTORE.sh
```

回滚后验证：

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
curl -sS http://localhost:8899/health
curl -sS http://localhost:8899/api/state
```
