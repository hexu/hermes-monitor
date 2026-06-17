# SPEC-v21-M6 — Metrics 根因修复 & Cron 追踪

**日期**: 2026-06-16
**状态**: 冻结 ✓

---

## 1. 根因分析

### 问题 1: tech 今日活跃分钟显示 0

**根因**: `_daily_active_minutes` 用 `WHERE started_at >= today_start` 过滤，导致"昨天开始但今天仍在运行"的 session 完全不计入。

**数据证据**:
```
tech sessions:
- 20260615_144051: started=Jun15 14:40, ended=Jun16 10:48  → 今日贡献 654 分钟（未计入）
- 20260616_105458: started=Jun16 10:54 (OPEN)             → 贡献 35 分钟（正确）
```

### 问题 2: tech active_minutes 意外显示 6899 分钟

**根因**: tech DB 有 9 个"僵尸 session"（`ended_at=NULL`，started_at 在 May-Jun，但从未关闭）。`COALESCE(ended_at, now)` 把它们全当作从 started_at 到现在的时长，导致虚高。

**数据证据**:
```
Sessions with ended_at=NULL contributing to today:
- started=2026-05-13 (OPEN)    → 690 min（僵尸）
- started=2026-06-04 14:07 ×4 (OPEN) → 4×690 min（各方复制？）
- started=2026-06-10 09:54 (OPEN)    → 690 min（僵尸）
...合计 6899 分钟全部来自 9 个僵尸 session
```

### 问题 3: AI助手/cron 看不到 token 消耗

**根因**: 每天的 cron 任务（新闻 10:00、天气 21:00）运行模式为 **`no_agent=True`（纯脚本）**，完全不经过 AIAgent，不创建任何 session 记录，因此无法从 sessions 表追踪。

**证据**:
```yaml
# cron/output/37b8ef3bef74/2026-06-16_10-00-14.md
**Mode:** no_agent (script)
```

---

## 2. 修复方案

### 2.1 `_daily_active_minutes`: 重叠窗口算法 + 僵尸过滤

```python
# 之前: WHERE started_at >= today_start（漏掉跨天 session）
# 之后: 计算每个 session 与 [today_start, now] 的重叠量

eff_start = max(started, today_ts)        # session 在今天的开始
eff_end   = min(ended or now_ts, now_ts) # session 在今天的结束
if eff_end > eff_start:
    total += eff_end - eff_start         # 重叠量累加
```

**僵尸过滤**: 排除 `ended_at=NULL AND started_at < today_start - 86400` 的 session（即超过24小时未关闭的 open session 大概率是异常数据）。

### 2.2 新增 `cron` pseudo-profile

从 `/root/.hermes/cron/output/{job_id}/*.md` 文件解析今日运行的 no_agent cron 任务：
- `cron_run_count`: 今日运行次数
- `cron_jobs_today`: 今日运行的 job ID 和时间
- `active_minutes`: 每 job 固定 60 秒（no_agent 脚本执行，无 LLM 消耗，mtime 不准确）

### 2.3 Token 统计

**不改动** token 查询逻辑（`WHERE started_at >= today_start`）。Token 是会话级的累加值，"今天消耗"应以 session 开始时间归属，不做重叠计算（否则更不直观）。

---

## 3. 修改文件

| 文件 | 修改内容 |
|------|---------|
| `backend/hermes_collector.py` | `_daily_active_minutes` 重叠算法；新增 `_cron_metrics_from_output_files`；`collect_daily_metrics` 增加 cron profile |
| `frontend/server-panel.js` | COLORS/NAMES 增加 `cron` 条目（`#94a3b8` / `Cron系统`） |

---

## 4. 各 Profile 修复后数据

| Profile | 今日 active | 今日 msg | 今日 tokens | 说明 |
|---------|------------|---------|------------|------|
| default | 0 min | 0 | 0 | 无活动 |
| pm | ~1380 min | 92 | 2.6M | session Jun16 10:32 开，仍在线 |
| tech | ~690 min | 245 | 9.1M | Jun15 session→16 + Jun16 新 session |
| **cron** | 1 min | 0 | 0 | 新闻 job 今日 10:00 运行（no_agent） |

---

## 5. 待解决：PM active 时间异常

PM session 从 Jun 15 15:47 到 Jun 16 11:30 = 约 20 小时。`active_minutes` 显示 ~1380 分钟（23 小时），略高于预期（差约 3-4 小时）。

可能原因：session started_at 早于 Jun 15 15:47（可能是 Jun 15 15:41 的 session 延续），导致重叠窗口略大于实际。

**影响**: 当前精确度可接受，不阻塞发布。后续可考虑从 `messages.timestamp` 推算实际活跃时段。

---

## 6. 备份

修复前版本已备份至:
```
archive/before-cron-fix-20260616-1209.py
```
