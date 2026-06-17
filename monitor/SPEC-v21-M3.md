# Hermes Monitor SPEC-v21-M3 — Visual Experience / Scene Event Scheduler

> 状态：冻结执行版  
> 日期：2026-06-14  
> 基线：v21-M2 Daily Metrics Dashboard  
> 范围：左侧办公室视觉体验增强 + Scene Event Scheduler 多人事件调度；不改右侧真实监控数据

---

## 1. M3 目标

V21-M3 目标是提升左侧办公室的“事件丰富度 + 事件合理性”，让人物行为更自然、更可解释，同时继续保持右侧 Daily Metrics Dashboard 的真实准确。

M3 的核心不是堆动作，而是引入 Scene Event Scheduler：多人聊天、同步、白板协作、评审等事件必须由统一调度器创建、锁定参与者、分配目标点和释放，不能由单个 actor 自发“对空气说话”。

---

## 2. 不变底线

1. 右侧服务器区 / Daily Metrics Dashboard 不做功能改造，真实数据优先。
2. Data State / Persona State / Scene Event 分离：
   - Data State 来自后端；
   - Persona State 是单个 actor 的表象行为；
   - Scene Event 是跨 actor 的多人或场景级事件。
3. Work Gate 保持：`working/thinking` 可进入工位；`sleeping/idle/unknown` 不进入工位；`error` 独立保护。
4. Offwork 非工作态不得进入工位区或工位坐席，restroom 走廊/厕所淡出例外。
5. 睡觉窗口保持 `21:00~次日08:00`。
6. 所有新增事件必须有 timeout / release，避免 actor 卡死。
7. 后端 Data State 变化必须打断 Scene Event 和 Persona 行为。
8. 人物事件文案保持轻盈，不使用厚重方框。

---

## 3. Scene Event Scheduler

### 3.1 新增运行态

在 `PixelOffice` 中新增：

```js
_sceneEvent: null,
_nextSceneEventAt: 0,
_sceneEventCooldowns: {},
```

actor runtime 新增：

```js
sceneEventId: null,
sceneRole: null,
sceneTarget: null,
scenePhrase: null,
```

### 3.2 生命周期

```text
candidate → reserve → gather → interact → release
```

- candidate：筛选可参与 actor。
- reserve：锁定参与者，取消其当前 persona 行为。
- gather：参与者走向会合点。
- interact：双方/多人到达后展示互动视觉和文案。
- release：到时释放参与者，并回到各自合理 home/persona。

### 3.3 可参与条件

一个 actor 可参与 Scene Event 必须满足：

1. profile 存在且 actor 坐标有限。
2. data status 不是 `error`。
3. 不是夜间睡在卧室的 `sleep_bed`。
4. 未 hidden。
5. 未被其他 scene event 锁定。
6. 当前 target 可被打断。
7. 对应 event 的目标点符合 Work Gate。

### 3.4 多人事件类型

M3 先实现轻量事件集：

| 类型 | 参与者 | 位置 | 说明 |
|---|---|---|---|
| `chat_pair` | 任意两个可用 actor | 休息区沙发/茶几旁 | 简短聊天，必须两人同时出现 |
| `sync_pair` | PM + tech 或 PM + default | 白板区 | 需求/排期/方案同步 |
| `whiteboard_pair` | 任意两个工作/思考 actor 优先 | 白板区 | 双人白板协作 |
| `review_pair` | PM + tech 优先 | 白板区 | PRD / 技术方案评审 |
| `debug_pair` | tech + default 优先 | 工位旁或白板区 | 技术排查/问题定位 |
| `standup_group` | 三人可用时 | 白板区 | 三人短会 |

### 3.5 合理性规则

1. 多人事件必须至少 2 个 participants。
2. 聊天/同步/评审不能显示单人文案。
3. 如果只有 1 个可用 actor，不启动多人事件。
4. sleeping 且已处于睡觉窗口的 actor 不参与多人事件。
5. offwork actor 的 `chat_pair` 目标点只在休息区；不得去工位区。
6. 白板/评审类事件优先选择 work/thinking actor；offwork actor 仅白天可参与 PM/default 简短同步，且目标在白板外缘/走廊合法点。
7. 事件期间如果 Data State 变化为 error 或睡觉窗口导致不可参与，应立即 release。

---

## 4. 单人事件增强

M3 在现有 Persona Scheduler 基础上补强单人事件：

1. `corridor_pace`：走廊来回踱步，2~4 个 waypoint，结束后返回合理 home。
2. `window_think`：窗边思考；offwork 使用休息区窗边点，work 可使用工位/白板附近合法点。
3. `sofa_rest`：沙发短休，替代部分 phone 观感。
4. `read_doc`：PM/tech/default 均可，但角色文案不同。
5. `whiteboard_solo`：独自白板思考，不冒充多人事件。

M3 重点新增 `corridor_pace` 路径链和视觉文案。

---

## 5. 视觉体验增强

### 5.1 人物动作提示

继续使用 `_drawActionWhisper()` 的轻盈漂浮提示。多人事件文案应显示在参与者头顶附近，或在两人中间显示轻量场景气泡。

### 5.2 多人事件视觉

新增 `_drawSceneEventDetails(ctx)`：

- 连接线 / 小光点表示交流对象；
- 白板事件时增强白板线框和便签；
- chat/sync/review 显示两人之间的轻量气泡，不对空气说话；
- debug/incident 用小警示点，但不能污染右侧真实状态。

### 5.3 标签遮挡

多人靠近时，底部姓名标签继续保持小尺寸；头顶动作提示可错位上浮，减少重叠。

---

## 6. 实施文件范围

预计修改：

- `frontend/pixel-office.js`：Scene Event Scheduler、corridor_pace、多人事件视觉、版本标题。
- `frontend/index.html`：版本文案更新为 `v21 · M3`。

不修改：

- `frontend/server-panel.js`（除非仅版本注释，不改功能）。
- `backend/hermes_collector.py`。
- `backend/monitor_server.py`。
- 数据库 schema。

---

## 7. 验收标准

1. `SPEC-v21-M3.md` 存在并记录执行范围。
2. 执行前备份 v21-M2，含 `RESTORE.sh`。
3. `node --check frontend/pixel-office.js` 通过。
4. `node --check frontend/server-panel.js` 通过。
5. `/health`、`/api/state`、`/api/metrics/daily` 正常。
6. 页面显示 `v21 · M3`。
7. `PixelOffice._sceneEvent` / `_nextSceneEventAt` 存在。
8. 存在 `_maybeStartSceneEvent()`、`_startSceneEvent()`、`_releaseSceneEvent()`、`_drawSceneEventDetails()`。
9. 强制触发 `chat_pair` 时 participants >= 2，双方被锁定并走向合理目标点。
10. 多人事件结束后参与者 release，actor 坐标 finite。
11. 任何聊天/同步/白板协作都有对象，不出现单人对空气聊天。
12. offwork actor 不进入工位区；restroom 例外保留。
13. 浏览器 console 无 JS error。
14. M1 Inspector 联动和 M2 Daily Metrics 仍正常。

---

## 8. 回滚策略

回滚到 v21-M2：执行本阶段备份目录中的：

```bash
bash RESTORE.sh
```

回滚后验证：

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
python3 -m py_compile backend/monitor_server.py backend/hermes_collector.py
curl -sS http://localhost:8899/health
curl -sS http://localhost:8899/api/state
curl -sS http://localhost:8899/api/metrics/daily
```
