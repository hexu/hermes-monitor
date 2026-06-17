# SPEC-v22 — 稳定收尾 + 可观测增强

**日期**: 2026-06-16
**状态**: 冻结 ✓

---

## 1. 方向确认

**V22 走方向 A**：稳定收尾 + 可观测增强
- V21-M5 Inspector / Debug Controls 基础上做收尾和增强
- 不引入新功能线（Monitor 监控告警 / 大乐透集成暂缓）
- 每个 M 可独立交付

---

## 2. 当前基线

**V21-M5**（Rule Inspector / Debug Controls）+ **V21-M6**（metrics 根因修复）

| 修复项 | 状态 |
|--------|------|
| 响应式 v4（物理像素尺度，字体 10~18px） | ✅ 已修复 |
| TODAY 盒精简（只保留 TODAY + token） | ✅ 已修复 |
| 活跃时长（message timestamp 间隔算法，上限 480min） | ✅ 已修复 |
| cron 归入 AI助手 profile | ✅ 已修复 |
| 洗手间中文标签 | ✅ 已修复 |

---

## 3. V22 里程碑

### V22-M1：收尾验证
- **目标**：响应式 + TODAY 盒 + 活跃时长在浏览器验证通过
- **动作**：前端刷新确认，无需代码改动
- **交付**：浏览器截图确认，无滚动条，数值合理

---

### V22-M2：Scene Event 可读性

**目标**：用户在 Inspector 面板中能清楚看到当前发生的所有事件。

**当前状态**：Inspector 已有基本结构，但 scene event 信息可能不完整。

**修改文件**：`frontend/pixel-office.js`（事件调度）+ `frontend/inspector-panel.js`（展示）

**实现**：
1. 当 scene event 触发时（如 `persona.pickup()`、`persona.goToWc()`），将事件信息推入 `PixelOffice._activeEvents[]`
2. 事件结构：`{ type, actor, target?, location, startTime, endTime?, description }`
3. Inspector 面板新增 **EVENTS** 区块，格式：
   ```
   🟢 PM → tech 评审中 (3m)
   🟡 Bruce 洗手间中
   ```
4. 事件结束后自动从列表移除（Inspector 实时更新）

**事件描述映射**（示例）：
| 行为 | 描述 |
|------|------|
| `meeting` | `{actor} 和 {target} 评审中` |
| `restroom` | `{actor} 洗手间中` |
| `water` | `{actor} 去接水` |
| `thinking` | `{actor} 思考中` |
| `sleeping` | `{actor} 休息中` |
| `idle` | `{actor} 发呆中` |

**验收**：刷新浏览器，人工触发一个行为（如去接水），Inspector 能显示对应描述。

---

### V22-M3：Inspector Hover 行为描述

**目标**：鼠标悬停在画布角色上时，Inspector 底部显示"正在：XXX"行为描述。

**修改文件**：`frontend/pixel-office.js`（hover 检测）+ `frontend/inspector-panel.js`（展示）

**实现**：
1. 画布角色绑定 `mousemove` 事件，检测悬停的角色 ID
2. 从 `PixelOffice._personaState[profile]` 读取当前行为（`currentBehavior` / `activity` / `scene`）
3. 将行为描述写入 Inspector 底部固定区域：`正在：{描述}`
4. 行为映射同 V22-M2 表格
5. 鼠标离开角色时清除描述（显示为空或最后状态）

**交互**：
- 悬停角色 → Inspector 底部出现 `正在：去接水`
- 鼠标移开 → 恢复空闲或当前 scene event 描述
- Inspector 已选中某个角色时，以选中状态为准，不响应 hover

---

### V22-M4：Token 趋势图

**目标**：在右侧 TODAY 盒下方增加每小时 Token 消耗 mini 趋势图。

**前置评估**：需先在浏览器测量右侧面板（576px 宽）TODAY 盒下方剩余高度。目标候选区域：TODAY 盒下方 50~70px 高度。

**修改文件**：`frontend/server-panel.js`（绘制 sparkline）

**实现**：
1. 复用 `/api/metrics/daily` 已有数据结构（profiles 数组含 `today_tokens`），前端每 5 分钟采样一次存入 `window.__tokenHistory[]`
2. TODAY 盒下方新增 `<canvas>` 或 SVG sparkline，宽度同 TODAY 盒，高度 50px
3. 每 profile 一条线（颜色用已有 `COLORS`），无坐标轴，只显示趋势
4. 悬停 sparkline 显示 tooltip：`{时间} {profile}: {token数}`
5. 采样数据结构：
   ```js
   window.__tokenHistory = [
     { t: 1781577600, default: 0, pm: 2605148, tech: 10320662 },
     { t: 1781577900, default: 0, pm: 2605148, tech: 10400000 },
     ...
   ]
   ```
6. 最多保留 24 个点（2 小时历史@5min 间隔，或按需扩展）

**备选方案**（如果右侧空间不足）：
- 将 sparkline 集成到 TODAY 盒内（替换或叠加在数字下方）
- 不做，专注 M2/M3

**验收**：确认 sparkline 有绘制，悬停 tooltip 显示数据，无性能问题。

---

## 4. debug=1 保留

`debug=1` 参数继续保留，挂载在 `PixelOffice` 全局，用于：
- 打印更多调试信息
- 显示 hidden states
- 不影响生产用户体验

---

## 5. 技术约束

1. **不改动 `backend/`**（metrics 已稳定）
2. **不改动数据层**：sessions 表结构不变，hermes_collector 不重写
3. **所有改动先备份**：`archive/before-v22-*.{js,py}` 格式
4. **长改动先出 SPEC/MD，再实施**
5. **浏览器验证通过才算完成**

---

## 6. 修改文件清单

| M | 文件 | 修改内容 |
|---|------|---------|
| M1 | - | 纯验证，无代码 |
| M2 | `frontend/pixel-office.js` | 事件收集 `_activeEvents[]` |
| M2 | `frontend/inspector-panel.js` | EVENTS 区块渲染 |
| M3 | `frontend/pixel-office.js` | mousemove hover 检测 |
| M3 | `frontend/inspector-panel.js` | 底部"正在"描述区 |
| M4 | `frontend/server-panel.js` | sparkline 绘制 + 采样 |
| M4 | `backend/monitor_server.py` | 可选：新增 `/api/metrics/history`（如果前端采样不够用） |

---

## 7. 备份策略

每个 M 开始前备份当前生产文件：
```
archive/before-v22-m2-pixel-office.js
archive/before-v22-m2-inspector-panel.js
...
```
