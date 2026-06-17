# Hermes Monitor SPEC-v21 — Observable Office 可观测办公室

> 状态：冻结草案（执行前基线）  
> 日期：2026-06-14  
> 基线版本：v20-M6（含随机化人格调度器、offwork 区域边界修正、21:00~08:00 睡觉窗口）  
> 主题：监控实用性 + 视觉体验双主线升级

---

## 0. V21 总目标

V21 的主题为：**Observable Office 可观测办公室**。

V21 不只是继续增加动画，而是把 Hermes Monitor 从“漂亮的状态看板”推进为：

1. 可观察：能清楚知道每个 profile 当前真实状态、行为状态、位置、指标。
2. 可解释：能解释人物为什么在某处、当前处于什么 persona / scene event。
3. 可交互：支持 hover / click / debug / 时间模拟。
4. 可追踪：支持今日指标、状态持续时间、最近活跃等监控数据。
5. 可扩展：为后续 Daily Metrics、Watchdog、多人场景事件、配置化、外部 token 接入预留结构。

---

## 1. 不变底线

### 1.1 服务器区数据准确性优先

右侧服务器/仪表盘区是真实监控区，数据准确性优先于办公室视觉表现。任何升级如果导致右侧真实数据缺失、错误、不可读，必须回滚或暂停。

### 1.2 现有监控指标必须保留

V21-M2 及之后即使右侧升级为仪表盘，也必须保留现有指标：

- profile 名称
- 状态
- 消息数
- 累计 token 消耗
- 工具调用数
- 模型名

新增指标只能补充，不能替换或隐藏这些核心指标。

### 1.3 Data State / Persona State 分离继续保留

- 右侧展示真实 Data State。
- 左侧办公室展示 Scene / Persona / Visual Event。
- 左侧可以演绎，但不能误导真实状态。

### 1.4 Work Gate 继续保留

- `working` / `thinking` 属于 `work`，可以进入工位区。
- `sleeping` / `idle` / `unknown` 属于 `offwork`，默认不进入工位区。
- `error` 单独保护。
- `thinking` 不能被当成 sleeping 或非工作。

### 1.5 Offwork 区域边界继续保留

非工作态不得随机进入工位区或工位坐席。只有 `work/thinking` 才能去工位区。restroom 走廊/厕所淡出是例外。

### 1.6 睡觉窗口继续保留

人物进入卧室/上床睡觉的判定窗口为：

```text
21:00 ~ 次日 08:00
```

该规则独立于视觉昼夜相位。`21:00~22:00` 可仍显示傍晚滤镜，但 offwork/sleeping 人物已经可以回卧室睡觉。

---

## 2. V21 阶段路线

```text
V21-M1 Inspector 交互调试层
  ↓
V21-M2 Daily Metrics Dashboard 每日指标仪表盘
  ↓
V21-M2.5 Watchdog / Reliability 可靠性增强
  ↓
V21-M3 Visual Experience 场景体验增强
  ↓
V21-M4 Rule Config Extraction 规则配置化
  ↓
V21-M5 External Token Bridge 跨工具消耗接入
```

本次执行范围：**V21-M1 Inspector**。

M2/M3 的关键决策在本 SPEC 中预留，但不在 M1 中实现。

---

## 3. V21-M1：Inspector 交互调试层

### 3.1 目标

让监控面板从“只能看”变成“可检查”。

用户看到一个人物或右侧卡片时，可以知道：

- 它是谁
- 真实状态是什么
- 工作模式是什么
- 当前表象行为是什么
- 当前目标点是什么
- 当前模型是什么
- 最近活跃是什么
- 对应右侧哪个 profile

### 3.2 非目标

M1 不做：

- Daily Metrics 后端聚合
- 新数据库表
- Watchdog 自动重启
- 多人场景事件调度
- 规则配置化
- 外部 IDE token 接入
- 大幅重构 Canvas 渲染架构

### 3.3 默认交互

#### Hover 人物

鼠标悬停左侧人物时，在人物附近显示轻量 tooltip。

Tooltip 内容：

```text
中文名 / profile
真实状态：working/thinking/sleeping/idle/error
工作模式：work/offwork/error
位置：x,y
目标：kind x,y
表象：persona.type 或 idle
模型：metadata.model
最近活跃：last_active 或 N/A
```

M1 如果还没有 Daily Metrics，今日 token 可不显示或显示“待接入”。

#### Click 人物

点击人物后锁定 inspector：

- 人物出现轻微高亮光环
- tooltip 固定显示
- 点击空白区域取消锁定
- 点击其他人物切换锁定对象

#### Click 右侧卡片

点击右侧某个 profile 卡片后：

- 左侧对应人物高亮
- 右侧卡片进入 selected 态
- inspector 锁定该 profile

若右侧卡片命中实现成本过高，M1 可先提供 Canvas 人物 click/hover，右侧卡片联动作为 M1.1；但优先尝试实现。

### 3.4 Debug Mode

通过 URL 参数开启：

```text
?debug=1
```

Debug 模式显示：

- profile 名
- actor 坐标
- target 坐标
- workMode
- persona type
- nextPersonaAt
- path 路径线
- hitbox 边界

Debug 信息只用于调试，默认不显示。

### 3.5 时间模拟参数

支持 URL 参数：

```text
?hour=21
?hour=7.5
?hour=12
```

该参数设置 `PixelOffice._debugHour`，用于验证：

- 睡觉窗口
- 昼夜相位
- 夜间/傍晚视觉
- 后续 M3 的夜间行为

### 3.6 Tooltip 视觉风格

遵守主人视觉偏好：

- 轻量、半透明、漂浮
- 不使用厚重黑色方框
- 不遮挡头顶动作说明
- 字体小但清晰
- 边缘柔和

### 3.7 Hitbox 设计

每帧绘制人物时记录 hitbox：

```js
_hitboxes = [
  {
    profile,
    screenX,
    screenY,
    w,
    h,
    actor,
    target,
    data
  }
]
```

Hitbox 必须复用 Safe Camera 的 `scale/dx/dy`，避免命中区域与人物错位。

### 3.8 Inspector 只读原则

Inspector 只能读取状态，不得修改：

- actor.path
- actor.persona
- actor.behavior
- hardTarget
- dataStatus
- workMode

### 3.9 M1 验收标准

1. 默认页面与 v20-M6 观感基本一致。
2. Hover 人物显示 tooltip。
3. Click 人物可锁定详情。
4. 点击空白处可取消锁定。
5. `?debug=1` 显示 path / hitbox / target / persona 调试信息。
6. `?hour=21` 可模拟 21 点睡觉窗口。
7. 右侧现有指标不受影响。
8. `node --check frontend/pixel-office.js` 通过。
9. `node --check frontend/server-panel.js` 通过。
10. `/health` 正常。
11. `/api/state` 正常返回 profiles。
12. 浏览器 console 无 JS error。
13. `PixelOffice._render()` 无异常。
14. 所有 actor 坐标 finite。

---

## 4. V21-M2：Daily Metrics Dashboard 预留决策

### 4.1 目标

把右侧服务器区从“累计状态卡”升级为“每日指标仪表盘”。

### 4.2 必须保留

现有指标必须继续存在：

- 状态
- 消息总数
- 累计 token
- 工具调用总数
- 模型名

### 4.3 新增指标候选

- 今日 token
- 今日消息数
- 今日工具调用
- 当前状态持续时间
- 最近活跃时间
- 最近 5 分钟 token/min
- 最近 5 分钟 message/min
- Monitor Health / Collector Health

### 4.4 后端允许改造

V21 允许较大后端改造，包括：

- 新增 `/api/metrics/daily`
- 扩展 `/api/state`
- 引入 `/root/.hermes/monitor/monitor.db`
- 新增 metric_snapshots 表
- 新增 health_events 表
- 新增 watchdog 或上报接口

### 4.5 布局策略

当前布局为：

```text
左侧办公室 85%
右侧服务器区 15%
```

M2 若右侧仪表盘空间不足，允许调整为：

```text
左侧办公室 80%
右侧仪表盘 20%
```

即 8:2。

触发 8:2 的判断标准：

1. 今日 token + 累计 token 放不下。
2. 状态持续时间显示拥挤。
3. 模型名被压缩严重。
4. profile 卡片纵向信息密度过高。
5. 需要加入 mini sparkline。
6. 需要显示 Monitor Health / Watchdog 状态。

---

## 5. V21-M3：Visual Experience 场景体验增强预留决策

### 5.1 核心原则

M3 不只是增加动作数量，而是提升：

```text
事件丰富度 + 事件合理性
```

### 5.2 新增单人事件候选

- `corridor_pace`：走廊来回踱步
- `window_think`：窗边思考
- `coffee_break`：倒咖啡
- `water_break`：接水
- `stretch`：伸懒腰
- `whiteboard_solo`：独自白板思考
- `read_doc`：看文档
- `search_idle`：检索等待
- `sofa_rest`：沙发短休
- `sofa_nap`：沙发小憩
- `restroom`：上厕所
- `sleep_bed`：卧室睡觉
- `micro_nap`：工位短暂闭眼

### 5.3 走廊踱步规则

`corridor_pace` 应表现为：

```text
当前位置 → 走廊某点 → 来回 2~4 次 → 返回合理 home/persona
```

适用状态：

- thinking
- offwork
- work 中短暂离席

不适用：

- sleeping 且在卧室
- error
- 被多人事件锁定中

睡觉窗口内应降低触发权重。

### 5.4 多人事件必须有对象

聊天、同步、评审、白板协作不能对空气发生。

禁止：

```text
一个人走到沙发旁显示“聊两句”，但周围没有任何参与者。
```

必须：

- 显式声明 participants
- 至少两个非 sleeping/error 参与者
- 双方处于可打断状态
- 双方有合理目标点和朝向
- 文案匹配角色组合

### 5.5 多人事件分类

- `chat_pair`：两人聊天
- `sync_pair`：两人同步
- `whiteboard_pair`：两人白板协作
- `review_pair`：PM/tech 评审
- `debug_pair`：tech/default 查问题
- `brief_pair`：PM/default 简短问答
- `standup_group`：三人短会
- `review_group`：三方方案评审
- `incident_group`：异常时三方确认

### 5.6 Scene Event Scheduler

M3 需要在 Persona Scheduler 之上新增 Scene Event Scheduler：

```text
Scene Event Scheduler
  ↓
选择 paired/group event
  ↓
锁定多个 actor
  ↓
分配目标点、朝向、文案、持续时间
  ↓
gather → interact → release
```

多人事件不能由单个 actor 自发生成，否则会出现 A 在聊天而 B 仍在睡觉/工作/离开的不合理画面。

### 5.7 多人事件生命周期

```text
candidate  候选筛选
reserve    锁定参与者
gather     多人走向会合点
interact   开始互动
release    释放参与者，各自返回合理状态
```

所有事件必须有 timeout 和 release，防止 actor 卡死。

---

## 6. 回滚策略

V21 每个阶段实施前必须创建备份目录，至少包含：

- frontend/index.html
- frontend/pixel-office.js
- frontend/server-panel.js
- frontend/data/
- backend/
- SPEC-v20*.md
- SPEC-v21.md
- RESTORE.sh

回滚命令必须在执行汇报中给出。

---

## 7. M1 实施范围文件

预计涉及：

- `frontend/pixel-office.js`
- `frontend/server-panel.js`（仅右侧卡片 click/selected 联动需要时）
- `frontend/index.html`（版本文案、可能的轻量 CSS）

M1 不改：

- backend/hermes_collector.py
- backend/monitor_server.py
- monitor.db / state.db

---

## 8. 验证命令

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
curl -sS --max-time 3 http://localhost:8899/health
curl -s -o /dev/null -w 'root HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/
curl -s -o /dev/null -w 'pixel HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/static/pixel-office.js
curl -s -o /dev/null -w 'server HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/static/server-panel.js
```

浏览器验证：

```js
(() => ({
  ready: !!window.PixelOffice,
  ver: [...document.querySelectorAll('.ver')].map(e => e.textContent),
  conn: document.querySelector('#conn')?.textContent,
  hasInspector: typeof PixelOffice._drawInspector === 'function',
  hasSleepWindow: typeof PixelOffice._isSleepWindow === 'function',
  actorsFinite: Object.values(PixelOffice._actors || {}).every(a => Number.isFinite(a.x) && Number.isFinite(a.y)),
  profiles: PixelOffice._data?.profiles?.map(p => [p.profile, p.status, p.location]) || []
}))()
```

---

## 9. 决策记录

- 主人确认 V21 主目标：监控实用性优先 + 视觉体验优先。
- 主人确认 V21 允许较大后端改造：新数据表 / 上报接口 / watchdog 均可。
- 主人确认执行顺序：先 M1 Inspector，再 M2 Daily Metrics。
- 主人补充 M3：需要更丰富人物事件，例如走廊来回踱步。
- 主人补充 M3：事件必须合理，聊天必须有对象，不能对空气说。
- 主人补充 M2：右侧升级为仪表盘后如空间不足，可布局调整为 8:2。
