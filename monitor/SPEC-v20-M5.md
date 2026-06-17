# Hermes Monitor v20-M5 SPEC：Persona State 表象状态机

> 状态：已冻结，待实施  
> 版本：v20-M5  
> 当前基线：v20-M4 角色差异化 + 场景细节增强  
> 路径：`/root/.hermes/monitor/SPEC-v20-M5.md`  
> 核心原则：右侧服务器区继续显示真实 Data State；左侧办公室只做 Persona State 场景演绎。

---

## 0. 背景与问题

v20-M1 到 v20-M4 已完成：

1. Safe Camera：左侧办公室顶部不裁切，保持 85/15 布局。
2. Data State 与 Scene State 初步分离：右侧显示真实后端状态，左侧做场景映射。
3. 行为链与稳定化：支持 coffee / water / restroom / stretch / whiteboard / window / phone 等软行为。
4. 角色差异化：PM、研发经理、AI助手具有不同屏幕内容、短语与行为倾向。

但 M4 仍存在三个体验问题：

1. **非工作角色长期坐沙发**  
   白天 `sleeping` 被映射为 `lounge_idle`，避免白天躺床，但行为变化不足，PM / AI助手看起来一直坐沙发。

2. **phone 行为过度显眼**  
   M4 行为池较窄，部分 profile 的确定性 hash + cooldown 容易让 phone 反复出现，导致观感像一直刷手机。

3. **restroom 事件难观察**  
   restroom 并非全角色基础事件，只在部分状态/角色池中出现，概率和 cooldown 又较保守，实际观察中不易触发。

用户进一步提出正确架构方向：

> 后端底层状态只需要区分是否工作；人物前端表现状态可以完全自定义。

因此 M5 不再继续简单扩大 M4 行为池，而是升级为：

```text
Backend Data State → Work Gate → Frontend Persona State Machine → Visual Behavior
```

---

## 1. M5 目标

### 1.1 主目标

引入 `Persona State 表象状态机`，让左侧办公室人物拥有独立于后端细粒度状态的生活化表现。

后端状态只负责判断：

- 是否工作
- 是否异常
- 是否非工作

前端根据这个 gate 自主选择人物当前表象状态，例如：

- coding
- thinking_plan
- whiteboard
- coffee_break
- water_break
- restroom
- sofa_idle
- phone
- sofa_nap
- sleep_bed
- corridor_walk
- window
- chat
- read_doc

### 1.2 明确不做

M5 不做以下事项：

1. 不修改 `backend/hermes_collector.py` 核心采集逻辑。
2. 不修改右侧服务器区数据结构。
3. 不让右侧服务器区读取 Persona State。
4. 不新增复杂 API。
5. 不引入外部 spritesheet。
6. 不改变 85% / 15% 布局。
7. 不改 token 统计字段含义。
8. 不把 `idle` 作为休息行为的主要依据，因为 `idle` 太稀缺。

### 1.3 成功体验

M5 完成后，用户观察左侧办公室时应看到：

1. PM / AI助手不再长期固定坐沙发。
2. 非工作态人物会在休息区、卧室、窗边、走廊、茶水区、洗手间等区域低频流动。
3. 工作态人物仍主要围绕工位活动，但不再永远坐死在椅子上。
4. phone 可以出现，但不主导视觉。
5. restroom 成为全角色低频基础事件，可以被观察到，但不会频繁刷屏。
6. 后端状态变化时，前端行为会被打断并回到正确区域。
7. 右侧服务器区状态、统计、模型名完全不受影响。

---

## 2. 架构原则

### 2.1 Data State

Data State 来自后端 `/api/state`，字段包括但不限于：

- `profile`
- `status`
- `location`
- `message_count`
- `tool_call_count`
- `total_tokens`
- `metadata.model`

Data State 的使用边界：

1. 右侧服务器区直接显示 Data State。
2. 左侧办公室只使用 Data State 派生 Work Gate。
3. 左侧不得把 `sleeping` 机械等同于“正在床上睡觉”。
4. 左侧不得依赖稀缺 `idle` 来触发休息生活行为。

### 2.2 Work Gate

M5 新增函数：

```javascript
_workModeFromData(p) {
  const s = this._statusOf(p);
  if (s === 'working' || s === 'thinking') return 'work';
  if (s === 'error') return 'error';
  return 'offwork';
}
```

映射表：

| 后端 status | Work Gate | 左侧意义 |
|---|---|---|
| working | work | 正在工作，主要围绕工位活动 |
| thinking | work | 正在思考，仍属于工作态 |
| sleeping | offwork | 非工作，前端自行选择休息生活表象 |
| idle | offwork | 非工作，前端自行选择休息生活表象 |
| error | error | 保护态，避免复杂行为 |
| unknown | offwork | 兜底非工作 |

### 2.3 Persona State

M5 为每个 actor 增加 `persona` 运行时对象：

```javascript
actor.persona = {
  mode: 'work' | 'offwork' | 'error',
  state: 'coding',
  startedAt: frame,
  until: frame,
  target: { x, y, kind },
  returnTarget: { x, y, kind },
  interruptible: true,
  reason: 'weighted-choice'
};
```

Persona State 是纯前端运行时状态：

1. 不持久化。
2. 不上报后端。
3. 不影响右侧服务器区。
4. 刷新页面后允许重新选择。
5. 必须可被后端 Work Gate 变化打断。

---

## 3. Work Mode 行为边界

### 3.1 work 模式边界

当 `mode === 'work'`：

1. 人物主锚点仍是工位。
2. 大多数时间应在工位或工位附近。
3. 允许短暂离开工位去：
   - 白板
   - 咖啡机
   - 饮水机
   - 洗手间
   - 窗边
   - 走廊伸展
4. 离开后必须能回到工位。
5. 工作态不得长时间去床睡觉。
6. `thinking` 必须被视为工作态，不得显示成睡眠。

### 3.2 offwork 模式边界

当 `mode === 'offwork'`：

1. 人物主锚点不再固定为沙发。
2. 可在非工位区域活动：
   - 沙发
   - 卧室
   - 茶水区
   - 饮水机
   - 窗边
   - 走廊
   - 洗手间
3. 夜间更倾向去床睡觉。
4. 白天/傍晚更倾向沙发、窗边、咖啡、接水、走廊闲逛。
5. 非工作态不得进入工位坐下工作；最多允许经过走廊或窗边，不表现为工作。

### 3.3 error 模式边界

当 `mode === 'error'`：

1. 清理正在进行的 persona / behavior。
2. 可回到安全休息位置或保持当前位置。
3. 不触发 restroom hidden 链。
4. 不触发复杂行为。
5. 右侧服务器区继续真实显示异常。

---

## 4. Persona State 列表

### 4.1 work states

| state | 目标区域 | 说明 | 可打断 | 建议持续 |
|---|---|---|---|---|
| coding | 工位 | 编码/执行任务 | 是 | 900-1800 帧 |
| thinking_plan | 工位/白板 | 思考方案 | 是 | 720-1500 帧 |
| whiteboard | 白板 | 白板推演 | 是 | 600-1200 帧 |
| coffee_break | 咖啡机 | 工作间隙咖啡 | 是 | 420-900 帧 |
| water_break | 饮水机 | 接水 | 是 | 360-720 帧 |
| restroom | 洗手间出口 | 低频离开 | 是 | 900-1500 帧 |
| stretch | 工位旁/走廊 | 伸展 | 是 | 360-720 帧 |
| corridor_walk | 走廊 | 短暂走动 | 是 | 480-900 帧 |
| window_think | 窗边 | 看窗思考 | 是 | 480-900 帧 |
| micro_nap | 工位旁 | 短暂闭目，不去床 | 是 | 360-600 帧 |
| overtime | 工位/走廊 | 夜间加班叙事 | 是 | 900-1800 帧 |

### 4.2 offwork states

| state | 目标区域 | 说明 | 可打断 | 建议持续 |
|---|---|---|---|---|
| sofa_idle | 沙发 | 普通休息 | 是 | 900-1800 帧 |
| phone | 沙发/茶几 | 看手机，低权重 | 是 | 360-720 帧 |
| coffee | 咖啡机/沙发 | 咖啡休息 | 是 | 480-900 帧 |
| water | 饮水机 | 接水 | 是 | 360-720 帧 |
| chat | 沙发/走廊 | 闲聊/交流 | 是 | 600-1200 帧 |
| sleep_bed | 卧室 | 睡觉，夜间高权重 | 是 | 1200-2400 帧 |
| sofa_nap | 沙发 | 沙发小憩 | 是 | 900-1800 帧 |
| corridor_walk | 走廊 | 闲逛 | 是 | 480-900 帧 |
| window | 窗边 | 看窗/发呆 | 是 | 600-1200 帧 |
| restroom | 洗手间出口 | 低频基础事件 | 是 | 900-1500 帧 |
| read_doc | 沙发/桌边 | 看文档/阅读 | 是 | 720-1500 帧 |
| search_idle | 沙发/茶几 | AI助手检索/等待 | 是 | 720-1500 帧 |

---

## 5. 权重规则

### 5.1 总原则

1. 使用权重选择器替代 `roll % options.length`。
2. 权重受以下因素影响：
   - profile 类型
   - Work Gate
   - 当前时段
   - cooldown
   - 最近状态
   - restroom 全局/个人冷却
3. 权重选择必须确定性 + 帧错峰，避免所有人同一时间选择同一事件。
4. 不使用真正随机导致刷新体验完全不可复现。

### 5.2 profile 倾向

#### default / AI助手

work 模式：

- coding/search：高
- coffee_break：中
- water_break：中
- whiteboard：低
- restroom：低
- stretch：中

 offwork 模式：

- search_idle：高
- sofa_idle：中
- coffee：中
- water：中
- phone：低
- restroom：低
- corridor_walk：中
- sleep_bed：夜间高，白天低

#### pm

work 模式：

- thinking_plan：高
- whiteboard：高
- window_think：中
- coffee_break：中
- water_break：低中
- restroom：低
- coding：低

 offwork 模式：

- read_doc：高
- window：中高
- chat：中
- sofa_idle：中
- coffee：中
- phone：低
- restroom：低
- sleep_bed：夜间高，白天低

#### tech / 研发经理

work 模式：

- coding：高
- thinking_plan：中
- coffee_break：中高
- water_break：中
- stretch：中
- whiteboard：中
- restroom：低
- overtime：夜间高

 offwork 模式：

- coffee：中
- water：中
- corridor_walk：中
- sofa_idle：中
- phone：低
- restroom：低
- sleep_bed：夜间高，白天低
- read_doc：中

### 5.3 phone 降权规则

phone 不删除，但必须降权：

1. 在所有 offwork 行为中，phone 权重不得排名第一。
2. PM 的 phone 权重应低于 read_doc / window / chat。
3. default 的 phone 权重应低于 search_idle / sofa_idle / coffee。
4. tech 的 phone 权重应低于 coffee / water / corridor_walk。
5. 同一角色触发 phone 后，应进入较长 phone cooldown。
6. 多角色不得在短时间内同时 phone。

### 5.4 restroom 规则

restroom 是全角色低频基础事件：

1. work / offwork 都可触发。
2. 所有 profile 都可触发。
3. 权重低，但不能为 0。
4. 有个人 cooldown。
5. 有全局 stagger，避免多人同时上厕所。
6. restroom 链保持 M3/M4 机制：到出口 → hidden → 返回。
7. 后端 Work Gate 变化必须打断 restroom hidden 链。

---

## 6. Cooldown / Duration / Interrupt 规则

### 6.1 duration

每个 persona state 必须有持续时间：

```javascript
until = frame + durationFrames;
```

持续时间不得无限。

### 6.2 cooldown

至少需要三类 cooldown：

1. `actor.cooldownUntil`：角色通用行为冷却。
2. `actor.personaCooldowns[state]`：某类行为冷却。
3. `this._globalEventCooldowns[event]`：全局事件冷却，例如 restroom / phone。

### 6.3 interrupt

以下情况必须打断当前 Persona State：

1. profile 的 Work Gate 从 `offwork` 变成 `work`。
2. profile 的 Work Gate 从 `work` 变成 `offwork`。
3. profile 进入 `error`。
4. target 坐标非法。
5. pathfinding 失败超过阈值。
6. persona 超过 timeout。
7. actor 坐标出现 NaN / Infinity。

打断后：

1. 清理 `actor.persona`。
2. 清理 `actor.behavior` 或兼容映射。
3. 清理 `hidden`，除非当前仍在 restroom 正常流程且 Work Gate 未变。
4. 回到当前 Work Gate 的 home target。

---

## 7. 与现有 M4 代码的兼容策略

M5 应尽量沿用 M4 已验证机制：

1. 保留 `_actors`。
2. 保留 `_findPath()`。
3. 保留 `_stepActor()`。
4. 保留 `_drawBehaviorEffect()`，但可让它兼容 persona state。
5. 保留 `_drawSceneActivityDetails()`，从 `actor.behavior` 扩展到 `actor.persona`。
6. 保留坐标防御：`Number.isFinite` 兜底。
7. 保留 restroom hidden 不删除 actor 的原则。
8. 保留 M4 角色屏幕与场景细节。

建议新增或改造函数：

```javascript
_workModeFromData(p)
_personaHomeTargetForProfile(p, mode)
_syncPersonaForActor(a, p, homeTarget)
_choosePersonaState(a, p, mode, homeTarget)
_weightedChoice(options, seed)
_personaTargetForState(p, state, mode, homeTarget)
_cancelPersona(a, homeTarget, cooldown)
_finishPersona(a, homeTarget)
_personaVisualState(a)
```

现有 `_targetForProfile()` 推荐改为：

```text
Data State → Work Gate → Home Target → Persona Target → Safe Target
```

---

## 8. 视觉表现要求

### 8.1 工作态

工作态仍要让用户感知“人在工作”：

1. 工位屏幕保持亮起。
2. 人物大多数时间在工位或附近。
3. 白板、咖啡、接水、洗手间属于短暂离开。
4. PM 更常去白板/窗边。
5. tech 更常在工位/咖啡/接水/深夜加班。
6. default 更像检索/执行任务。

### 8.2 非工作态

非工作态应更像“办公室生活”：

1. 白天不强制去床。
2. 夜间提高 sleep_bed 权重。
3. 沙发不是唯一目标。
4. phone 是小动作，不是主行为。
5. 咖啡/水/走廊/窗边/阅读/闲聊应能被看到。

### 8.3 restroom

restroom 视觉沿用 M4：

1. 走到右侧出口。
2. 出口显示弱提示，例如 `...`。
3. actor hidden 一段时间。
4. 从出口返回。
5. 任何状态变化都能提前终止。

---

## 9. 数据准确性与安全边界

1. 右侧服务器区必须继续只读取真实后端 Data State。
2. 右侧状态文案不变：
   - working → 工作中
   - thinking → 思考中
   - idle → 待机中
   - error → 异常
   - sleeping → 白天休眠中 / 夜间睡眠中
3. 右侧统计不受 persona 影响：
   - 消息数
   - token 消耗
   - 工具调用
   - 模型名
4. 如果 M5 影响右侧展示，立即回退。
5. 如果左侧视觉不满意但右侧正确，可优先回退前端到 M4 备份。

---

## 10. 实施步骤

### M5-1：基础状态机骨架

1. 新增 `_workModeFromData(p)`。
2. actor 增加 `workMode` / `persona` / `personaCooldowns`。
3. 将 `_sceneStateForProfile()` 保留为兼容层，但不再作为左侧行为主驱动。
4. 实现 work/offwork home target。
5. 确保当前视觉不明显退化。

### M5-2：权重选择器与行为池

1. 新增 `_weightedChoice(options, seed)`。
2. 新增 work persona pool。
3. 新增 offwork persona pool。
4. 引入 profile 权重差异。
5. 替换 M4 中容易导致单一行为反复出现的选择逻辑。

### M5-3：restroom / phone / cooldown 精修

1. restroom 加入全角色低频基础事件。
2. phone 降权并加长 cooldown。
3. 加入全局 cooldown，避免多人同时 phone/restroom。
4. 验证状态变化能打断 restroom hidden。

### M5-4：视觉细节与稳定性

1. `_drawBehaviorEffect()` 兼容 persona state。
2. `_drawSceneActivityDetails()` 兼容 persona state。
3. 增加 read_doc / chat / search_idle 等轻量视觉。
4. 强化坐标与 timeout 防御。
5. 更新页面版本文案为 `v20 · M5`。

---

## 11. 验收标准

### 11.1 基础验证

必须通过：

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
curl -s http://localhost:8899/health
curl -s -o /dev/null -w 'root HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/
curl -s -o /dev/null -w 'pixel HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/static/pixel-office.js
curl -s -o /dev/null -w 'server HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/static/server-panel.js
```

### 11.2 API 验证

`/api/state` 必须正常返回 profiles，且右侧字段不被污染。

### 11.3 浏览器验证

浏览器控制台检查：

```javascript
(() => ({
  ready: !!window.PixelOffice,
  hasServer: !!window.ServerPanel,
  conn: document.querySelector('#conn')?.textContent,
  ver: [...document.querySelectorAll('.ver')].map(e=>e.textContent),
  profiles: window.PixelOffice?._data?.profiles?.map(p => [p.profile,p.status,p.location]) || [],
  actors: Object.fromEntries(Object.entries(window.PixelOffice?._actors || {}).map(([k,a]) => [k, {
    x: a.x, y: a.y,
    finite: Number.isFinite(a.x) && Number.isFinite(a.y),
    workMode: a.workMode,
    persona: a.persona?.state || null,
    hidden: !!a.hidden
  }]))
}))()
```

必须满足：

1. `ready === true`
2. `hasServer === true`
3. `conn` 显示已连接
4. 版本为 `v20 · M5`
5. actor 坐标均 finite
6. 右侧服务器栏仍可读
7. 左侧办公室无顶部裁切

### 11.4 体验验收

观察一段时间或通过控制台强制触发后，应满足：

1. PM / default 非工作态不会长期固定沙发。
2. phone 不再频繁主导。
3. restroom 可以低频触发。
4. work 模式仍能回工位。
5. offwork 模式不长期占用工位。
6. Work Gate 变化会打断当前 persona。
7. `thinking` 仍显示为工作态。

---

## 12. 回退策略

M5 实施前必须备份当前 M4：

- `frontend/index.html`
- `frontend/pixel-office.js`
- `frontend/server-panel.js`
- `frontend/data/`
- `SPEC-v20.md`
- `SPEC-v20-M5.md`

备份目录格式：

```text
/root/.hermes/monitor/archive/v20-m4-before-m5-YYYYMMDD-HHMMSS/
```

必须生成：

```text
RESTORE.sh
```

回退命令示例：

```bash
cd /root/.hermes/monitor/archive/v20-m4-before-m5-YYYYMMDD-HHMMSS
bash RESTORE.sh
```

如果 M5 任一里程碑出现：

1. 右侧数据不准确；
2. 页面无法加载；
3. actor 坐标污染；
4. restroom hidden 卡死；
5. 视觉效果明显退步；
6. 用户不满意；

则直接回退到 M4 备份，不在不满意版本上硬修。

---

## 13. 冻结决策

本 SPEC 冻结以下决策：

1. M5 名称：`v20-M5：Persona State 表象状态机`。
2. 后端状态只作为 Work Gate，不再直接决定左侧细粒度表象。
3. `working/thinking` 属于 work。
4. `sleeping/idle/unknown` 属于 offwork。
5. `error` 为保护态。
6. 右侧服务器区继续显示真实 Data State，不消费 Persona State。
7. phone 降权。
8. restroom 成为全角色低频基础事件。
9. 引入权重选择器和 cooldown，而非简单取模选择。
10. M5 只改前端，除非后续明确批准。
11. 实施前必须备份 M4 并提供 RESTORE.sh。

---

## 14. 实施许可

用户已确认流程：

```text
冻结后再备份当前 M4，然后实施。
```

因此执行顺序固定为：

1. 写入并验证本 SPEC。
2. 备份当前 M4。
3. 实施 M5。
4. 基础验证。
5. 浏览器验证。
6. 更新 skill。
