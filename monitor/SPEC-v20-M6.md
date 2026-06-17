# Hermes Monitor v20-M6 SPEC：Stochastic Persona Scheduler 随机化人格事件调度器

冻结时间：2026-06-13
状态：待实施
实施范围：仅前端 `frontend/pixel-office.js`，必要时同步 `frontend/index.html` 版本文案

---

## 0. 背景

v20-M5 已完成 Persona State 表象状态机：

```text
Backend Data State → Work Gate → Frontend Persona State Machine → Visual Behavior
```

M5 的事件池、cooldown、global cooldown、状态中断、restroom hidden-return 链路均已工作。但当前事件触发仍存在一个明显问题：

> 刷新页面后，由于事件触发帧和 weightedChoice seed 均由 profile hash + frame + time phase 决定，人物事件顺序具有强确定性。短时间多次刷新时，PM/研发经理/AI助手容易按相同节奏和相同顺序触发事件。

M6 目标是在不破坏 M5 稳定性的前提下，引入“随机但有边界”的事件调度。

---

## 1. 目标

### 1.1 产品目标

1. 人物事件触发具备一定随机性。
2. 多次刷新页面后，各角色首个事件和事件顺序不应完全一致。
3. 保留 M5 的角色人格差异：
   - PM 偏文档/白板/沟通/窗边思考；
   - 研发经理偏 coding/coffee/water/whiteboard/深夜加班；
   - AI助手偏 search/coding/coffee；
4. 保留 cooldown 和 global cooldown，避免多人同时做同一类动作。
5. 保持后端 Data State 作为权威：右侧服务器区真实数据不受前端随机行为影响。
6. 不引入持久化行为队列，不把前端 persona 写回后端。

### 1.2 技术目标

1. 引入 session 级随机种子。
2. 引入统一随机工具函数，避免散落 `Math.random()`。
3. actor runtime 新增：
   - `nextPersonaAt`
   - `recentPersonaTypes`
4. 将固定取模触发：
   ```js
   (frame + hashOffset) % 540 === 0
   ```
   改为 actor 级下一次触发时间。
5. weightedChoice 从 seed 取模改为 rng-based weighted random。
6. 最近事件降权或阻断，降低重复感。
7. 保留 M5 事件池和视觉表现，优先改调度，不重做渲染。

---

## 2. 非目标

1. 不改后端 collector。
2. 不改右侧 server-panel 数据逻辑。
3. 不新增数据库或 localStorage 持久化。
4. 不做完全随机移动。
5. 不删除 M5 的 Work Gate / Persona State 架构。
6. 不改变 restroom hidden-return 的基本链路。
7. 不让办公室画面美观优先于右侧数据准确性。

---

## 3. 当前 M5 事件池

### 3.1 Work 事件池

适用：`working/thinking → work`

| type | 说明 | 备注 |
|---|---|---|
| `coding` | 工位工作 | coding/屏幕/键盘表现 |
| `thinking_plan` | 工位规划/思考 | thinking 状态下使用 |
| `whiteboard` | 白板讨论/规划 | PM 权重高 |
| `coffee` | 咖啡机 | tech 略高 |
| `water` | 饮水机 | tech 略高 |
| `stretch` | 伸懒腰 | 短动作 |
| `window` | 窗边思考 | PM 较高 |
| `restroom` | 上厕所 | 全局 cooldown |
| `overtime-walk` | 深夜加班踱步 | 仅 night + tech |
| `micro_nap` | 工位小憩 | 低频 |

### 3.2 Offwork 事件池

适用：`sleeping/idle/unknown → offwork`

| type | 说明 | 备注 |
|---|---|---|
| `sleep_bed` | 夜间上床睡觉 | night 权重高 |
| `sofa_idle` | 沙发待机 | 白天/傍晚高 |
| `search_idle` | 空闲检索 | default 高 |
| `read_doc` | 看文档/PRD | PM 高 |
| `window` | 窗边发呆/思考 | PM 较高 |
| `coffee` | 倒咖啡 | tech 略高 |
| `water` | 接水 | 中低频 |
| `corridor_walk` | 走廊散步 | 中低频 |
| `chat` | 聊两句 | PM 略高 |
| `phone` | 看手机 | 明确低权重 + global cooldown |
| `restroom` | 上厕所 | 全角色低频 + global cooldown |
| `sofa_nap` | 沙发小睡 | night 权重更高 |

---

## 4. M6 设计

### 4.1 Session 随机种子

新增：

```js
_sessionSeed: 0,
_randState: 0,
```

初始化时生成：

```js
_initRandomSeed() {
  const arr = new Uint32Array(1);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    arr[0] = Math.floor(Math.random() * 0xffffffff);
  }
  this._sessionSeed = (Date.now() ^ arr[0]) >>> 0;
  this._randState = this._sessionSeed || 0x9e3779b9;
}
```

要求：每次刷新页面生成不同 seed。

### 4.2 统一 RNG

新增 xorshift 或 LCG：

```js
_rand() { ... return 0..1; }
_randInt(min, max) { ... }
```

所有 M6 行为调度随机均走统一 RNG。

### 4.3 actor.nextPersonaAt

actor runtime 新增：

```js
nextPersonaAt: 0,
recentPersonaTypes: []
```

首次创建 actor 或 mode 切换后，设置随机 initial delay：

```js
_scheduleNextPersona(a, mode, initial=true)
```

建议间隔：

| mode | initial delay | normal interval |
|---|---:|---:|
| work | 120~720 frames | 900~1800 frames |
| offwork | 180~900 frames | 700~1700 frames |
| night offwork | 360~1200 frames | 1200~2400 frames |
| error | Infinity / 不触发 | 不触发 |

### 4.4 触发条件

M6 `_maybeStartPersona()` 触发条件：

```js
if (a.persona || a.behavior) return;
if (a.mode === 'walk') return;
if (a.hidden) return;
if (this._frame < (a.cooldownUntil || 0)) return;
if (this._frame < (a.nextPersonaAt || 0)) return;
```

不再使用固定取模节拍。

### 4.5 Weighted Choice 改造

当前：

```js
_weightedChoice(options, seed)
```

M6：

```js
_weightedChoice(options) {
  const total = ...;
  let r = this._rand() * total;
  ...
}
```

同时保留 options 的权重体系。

### 4.6 Recent History 降权

每次事件结束时：

```js
a.recentPersonaTypes.unshift(type);
a.recentPersonaTypes = a.recentPersonaTypes.slice(0, 3);
```

构建 options 后按 history 调整权重：

- 最近 1 次同 type：权重 = 0；
- 最近 2~3 次同 type：权重 *= 0.35；
- 对核心状态如 `coding/sofa_idle` 可以不完全禁用，最低保留 20% 权重，防止 options 被清空。

### 4.7 行为结束后重新调度

`_finishPersona()` 结束时：

1. 记录 recent history；
2. 设置个人 cooldown；
3. 设置 type cooldown；
4. 调用 `_scheduleNextPersona(a, mode, false)`。

### 4.8 状态中断/取消后重新调度

`_cancelPersona()` 或状态变化导致行为取消时：

- 不把取消事件记录为 completed history；
- 清 hidden；
- 设置短 cooldown；
- 重新 schedule next persona，避免取消后立刻触发。

---

## 5. 验收标准

### 5.1 基础验证

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
curl -sS --max-time 3 http://localhost:8899/health
curl -sS --max-time 5 http://localhost:8899/api/state -o /tmp/hermes-monitor-state.json
```

### 5.2 浏览器运行态验证

Console：

```js
(() => ({
  conn: document.querySelector('#conn')?.textContent,
  seed: PixelOffice._sessionSeed,
  actors: Object.fromEntries(Object.entries(PixelOffice._actors || {}).map(([k,a]) => [k, {
    x:a.x, y:a.y, hidden:a.hidden,
    workMode:a.workMode,
    persona:a.persona?.type,
    nextPersonaAt:a.nextPersonaAt,
    recent:a.recentPersonaTypes
  }]))
}))()
```

要求：

- WebSocket 已连接；
- seed 非 0；
- actors 坐标 finite；
- `nextPersonaAt` 存在；
- 无 JS error。

### 5.3 刷新随机性验证

连续刷新至少 3 次：

- `_sessionSeed` 每次不同；
- PM/研发经理/default 的 `nextPersonaAt` 不完全相同；
- 第一个触发事件不固定为同一个顺序；
- 多人不同时触发同一事件；
- 同一角色不会连续 3 次重复同一事件。

### 5.4 视觉验证

- 办公室静态层正常；
- AI助手/PM/研发经理均可见；
- 头顶动作说明漂浮无硬框；
- 底部身份说明无方框、小而可读；
- restroom hidden 后能返回；
- 右侧服务器区数据准确。

---

## 6. 回滚策略

实施前必须备份当前 M5 微调版到：

```text
/root/.hermes/monitor/archive/v20-m5-before-m6-<timestamp>/
```

至少包含：

- `frontend/index.html`
- `frontend/pixel-office.js`
- `frontend/server-panel.js`
- `frontend/data/`
- `SPEC-v20-M5.md`
- `SPEC-v20-M6.md`
- `RESTORE.sh`

回滚命令：

```bash
cd /root/.hermes/monitor/archive/v20-m5-before-m6-<timestamp>
bash RESTORE.sh
```

---

## 7. 决策冻结

M6 实施原则：

1. 只改前端调度，不改后端数据。
2. 保留 M5 的事件池。
3. 用 session seed + actor nextPersonaAt 替代固定取模触发。
4. 用 rng weighted choice 替代 seed modulo choice。
5. 加 recent history 降权，减少重复感。
6. 数据准确性优先于办公室演绎。
