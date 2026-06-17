# Hermes Monitor v20 SPEC

> 状态：方案冻结草案（待主人最终确认后进入编码）  
> 创建时间：2026-06-13  
> 适用目录：`/root/.hermes/monitor/`  
> 当前基线：v19 · M4 + 右侧服务器面板多轮微调  
> 原则：先讨论方案，确认后编码；服务器区数据准确性优先于办公室画面美观度。

---

## 0. v20 定位

### 0.1 版本名称

版本确定为：

```text
Hermes Monitor v20
```

### 0.2 核心定位

v20 是在 v19 M4 基础上的“监控办公室精修与行为系统升级版”。

它不推翻当前 v19 M4 架构，不做大规模前端模块化重构，不引入真实 LPC spritesheet，不新增复杂后端 API。

v20 重点解决当前观察到的三个问题：

1. 左侧办公室顶部/上半部分存在遮挡，需要智能视口优化。
2. 人物动作链太单一，主要停留在工位工作/思考或卧室睡觉。
3. 未工作时人物长期在卧室睡觉，导致休息区规划价值不足。

同时，v20 继续固化右侧 15% 服务器监控区的窄栏排版规范，确保核心数据清晰可读。

### 0.3 不做事项

v20 暂不做以下事项：

- 不做今日 / 总计切换。
- 不做右侧详情展开面板。
- 不做复杂新 API。
- 不改 collector 核心数据结构。
- 不引入本机 Claude Code / Cursor token 采集。
- 不引入真实 LPC spritesheet 资源包。
- 不做大规模 JS 模块拆分。
- 不改变 85% / 15% 布局比例。

---

## 1. 已确认决策

### 1.1 版本命名

```text
v20
```

### 1.2 实施优先级

按以下优先级推进：

1. 右侧服务器监控区精修。
2. 左侧办公室人物状态 / 动作链增强。
3. 行为系统稳定化。
4. 数据增强预研，只读字段增强。

### 1.3 今日 / 总计切换

暂不需要。

右侧服务器区保持简洁卡片，不新增切换，不新增展开详情。

### 1.4 布局比例

固定：

```text
左侧办公室：85%
右侧服务器区：15%
```

不做自适应比例，不做配置项。

### 1.5 后端扩展范围

允许 B：只读字段增强。

含义：

- 可以读取 `/api/state` 已有字段。
- 可以利用 `status`、`location`、`last_active`、`metadata.model`、`message_count`、`tool_call_count`、`total_tokens` 等现有字段。
- 不新增复杂 API。
- 不改后端数据结构。

### 1.6 sleeping 文案

选择 C：按昼夜切换。

规则：

```text
06:00 - 22:00：sleeping 显示为「休眠中」
22:00 - 06:00：sleeping 显示为「睡眠中」
```

### 1.7 白天无任务默认位置

选择 A：休息区沙发。

规则：

```text
白天 / 傍晚 sleeping 或 idle → 左侧默认去休息区
深夜 sleeping → 左侧默认去卧室
```

### 1.8 休息区生活化动作

选择 A：允许“看手机”等生活化动作。

表现方式需克制：

- 用小像素亮屏表示手机。
- 不画夸张现代娱乐界面。
- 动作仅作为待机/休息表现，不喧宾夺主。

### 1.9 顶部遮挡优化

选择 C：智能缩放，尽量不裁，但允许极少黑边。

目标：

- 顶部主体不被裁。
- 房间标签不被裁。
- 重要人物活动区不被裁。
- 尽量铺满左侧 85%。
- 如无法兼顾，允许极少黑边。

---

## 2. 当前基线

### 2.1 当前版本

当前线上前端为：

```text
v19 · M4
```

包含后续多轮微调：

- 左右比例已调整为 85% / 15%。
- 右侧服务器区消息 / 消耗 / 调用信息簇更紧凑。
- 模型名加大并放在右下角。
- 左侧 LED 小方块右移、加暗底和描边。
- 统计数据下方已添加弱分割线。

### 2.2 当前文件

核心文件：

```text
/root/.hermes/monitor/frontend/index.html
/root/.hermes/monitor/frontend/pixel-office.js
/root/.hermes/monitor/frontend/server-panel.js
/root/.hermes/monitor/frontend/data/tilemap.json
/root/.hermes/monitor/frontend/data/seats.json
```

v18 回退备份：

```text
/root/.hermes/monitor/archive/pixel-office.v18.js.bak
/root/.hermes/monitor/archive/index.v18.html.bak
```

### 2.3 不变底线

服务器区数据准确性优先：

```text
服务器区数据准确性 > 办公室画面美观度
```

如果 v20 任一阶段导致右侧数据展示退步，应停止继续扩展并回滚对应改动。

---

## 3. v20 核心架构原则

### 3.1 Data State 与 Scene State 分离

v20 的核心原则是：

```text
右侧服务器区显示 Data State
左侧办公室显示 Scene State
```

Data State 来自后端，表示真实监控状态：

```text
working
thinking
sleeping
idle
error
```

Scene State 由前端根据 Data State、当前时间、last_active、行为链等推导，表示左侧办公室的视觉状态。

### 3.2 为什么要分离

当前 v19 M4 中，`sleeping` 基本等价于左侧卧室睡觉。

这导致：

- 白天无任务时人物也躺床。
- 休息区使用率低。
- 视觉叙事不自然。

v20 中，`sleeping` 在右侧仍表示无活跃/休眠，但左侧白天可表现为休息区待机。

示例：

```text
右侧：休眠中
左侧：角色坐在沙发，看手机 / 喝咖啡 / 待机
```

这不矛盾，因为右侧是数据状态，左侧是场景演绎。

### 3.3 后端状态仍是硬约束

即使引入 Scene State，后端状态仍具有最高优先级。

规则：

- 后端变 working：打断当前休息行为，回工位。
- 后端变 thinking：打断当前普通休息行为，回工位/白板链。
- 后端变 sleeping 且深夜：进入卧室。
- 后端变 error：右侧显示异常，左侧可进入错误/离线表现。

---

## 4. Safe Camera 智能视口

### 4.1 当前问题

当前左侧画布为了铺满使用类似 cover 的缩放策略。

当左侧区域比例比地图更宽时，画布可能上下裁剪，导致：

- 上方房间标签被遮挡。
- 卧室 / 休息区 / 工位区顶部墙体被裁。
- 视觉上像办公室上方被截断。

### 4.2 v20 目标

Safe Camera 需要达到：

1. 左侧仍尽量铺满 85% 区域。
2. 顶部房间主体不被裁。
3. 房间标签不被裁。
4. 人物活动区不被裁。
5. 允许极少黑边。
6. 底部装饰区可比顶部更优先被裁，但不能裁掉主要走廊路径。

### 4.3 建议策略

Safe Camera 的计算顺序：

```text
1. 先计算 cover scale
2. 检查顶部安全区是否被裁
3. 检查主体安全区是否完整
4. 如果裁剪过多，逐步降低 scale
5. 在 cover 与 contain 之间取安全折中值
6. 允许极少黑边，优先保证主体完整
```

安全区建议：

```text
顶部安全区：0 ~ 2 tiles
主体安全区：0 ~ 18 tiles
底部装饰区：18 ~ 20 tiles
```

### 4.4 验收标准

- 顶部墙体可见。
- 房间标签可见。
- 卧室、休息区、工位区上方不被明显裁掉。
- 人物不会走到不可见区域。
- 85% / 15% 布局不变。
- 如出现黑边，黑边应极少且不影响整体观感。

---

## 5. 右侧服务器监控区 v20 规范

### 5.1 基本布局

右侧宽度固定 15%。

每个 profile 一张卡片，纵向堆叠。

卡片结构：

```text
顶部：名称 + 状态
左侧：LED 小方块列
中部：消息 / 消耗 / 调用
底部：Model + 模型名
```

### 5.2 状态文案

规则：

```text
working  → 工作中
thinking → 思考中
idle     → 待机中
error    → 异常
sleeping:
  06:00-22:00 → 休眠中
  22:00-06:00 → 睡眠中
```

### 5.3 LED 规则

LED 应清晰可见，不贴边，不与文字过近。

建议：

```text
ledX ≈ 15
dataX ≈ 40
```

第一个状态 LED：

- working：高亮。
- thinking：亮，但可略弱于 working。
- sleeping / idle：暗，但不能接近背景到不可见。
- 可保留暗底 + 描边。

### 5.4 数据区规则

中部保留三项：

```text
消息
消耗
调用
```

要求：

- 三项不要分得太开。
- 行距约 22px - 28px。
- 每项数据下方保留弱分割线。
- 数字右对齐。
- 标签左对齐。

### 5.5 模型区规则

模型名显示在右下角。

要求：

- 模型名比 `Model` 标签更醒目。
- 默认约 15px 起步。
- 长模型名自适应缩小。
- 不做滚动。
- 不做展开详情。

### 5.6 active 卡片微光

v20 可为 active 状态增加轻微视觉区别：

```text
working  → 边框轻微高亮
thinking → 边框微亮或 LED 弱脉冲
sleeping/idle → 低亮稳定
```

注意：微光不能影响数据可读性。

---

## 6. Scene State 映射规则

### 6.1 时间段

沿用 v19 昼夜系统：

```text
06:00-08:00  黎明
08:00-17:00  白天
17:00-19:00  黄昏
19:00-22:00  傍晚
22:00-06:00  深夜
```

### 6.2 working

Data State：

```text
working
```

默认 Scene State：

```text
work_type / work_sit
```

可触发短行为：

- 停顿思考。
- 伸懒腰。
- 接水。
- 咖啡。
- 深夜加班走动。

### 6.3 thinking

Data State：

```text
thinking
```

默认 Scene State：

```text
work_think
```

可触发：

- 坐着思考。
- 起身踱步。
- 去白板。
- 站窗边。
- 回工位。

### 6.4 sleeping 白天

时间：

```text
06:00 - 22:00
```

Data State：

```text
sleeping
```

Scene State：

```text
lounge_idle
```

默认目标：

```text
休息区沙发
```

可触发：

- 看手机。
- 喝咖啡。
- 接水。
- 站窗边。
- 上厕所。

### 6.5 sleeping 深夜

时间：

```text
22:00 - 06:00
```

Data State：

```text
sleeping
```

Scene State：

```text
sleep_bed
```

默认目标：

```text
卧室床位
```

可触发：

- Zzz。
- 翻身。
- 梦境泡。

### 6.6 idle

Data State：

```text
idle
```

Scene State：

```text
lounge_idle
```

默认目标：

```text
休息区沙发
```

右侧文案建议：

```text
待机中
```

### 6.7 error

Data State：

```text
error
```

右侧：

```text
异常
```

左侧可保守处理：

- 不做复杂错误动画。
- 可让角色停在当前点或回休息区。
- 服务器区数据优先显示异常。

---

## 7. 行为系统升级

### 7.1 目标

解决当前动作链太单一的问题。

v20 行为系统目标：

- 人物有更自然的行为链。
- 白天休息区使用率显著提升。
- 不出现所有角色同时乱跑。
- 后端状态变化时立即打断软行为。
- 行为卡死时可自动恢复。

### 7.2 actor 运行时字段建议

每个 actor 可扩展以下字段：

```js
actor.sceneState
actor.behavior
actor.behaviorPhase
actor.behaviorUntil
actor.cooldownUntil
actor.homeTarget
actor.lastHardTarget
actor.failSafeUntil
```

### 7.3 优先级

行为优先级：

```text
P0 后端硬状态变化
P1 错误 / 强制回目标
P2 当前行为链执行中
P3 深夜加班行为
P4 白天待机行为
P5 ambient 小动作
```

### 7.4 cooldown

建议：

```text
working  小行为间隔 90-180 秒
thinking 小行为间隔 45-120 秒
lounge   小行为间隔 60-180 秒
sleeping 只做床上小动作，不离床
```

### 7.5 卡死保护

每条行为链必须有 timeout。

规则：

```text
超过 N 秒未到达目标 → 清空 behavior → 回 homeTarget
```

禁止 actor 永久卡在：

- 走廊。
- 厕所出口。
- 咖啡机旁。
- 白板旁。
- 窗边。

---

## 8. 动作链设计

### 8.1 工作链

```text
工位坐下
→ 敲键盘
→ 停顿思考
→ 伸懒腰
→ 接水 / 咖啡
→ 回工位
```

表现：

- 敲键盘手部动效更明显。
- 思考时手停下，头顶气泡。
- 伸懒腰时手臂上举。
- 接水 / 咖啡后回工位。

### 8.2 思考链

```text
工位思考
→ 起身踱步
→ 去白板
→ 回工位
```

表现：

- 白板旁停留。
- 头顶可显示 `?` 或 `PLAN`。
- 不频繁触发，避免过度移动。

### 8.3 休息链

```text
沙发待机
→ 看手机
→ 喝咖啡
→ 接水
→ 回沙发
```

表现：

- 坐沙发。
- 手上小亮屏。
- 小屏幕轻微闪烁。
- 咖啡杯有热气。
- 接水后可回沙发或工位。

### 8.4 睡眠链

```text
床上睡觉
→ Zzz
→ 翻身
→ 梦境泡
```

表现：

- 深夜 sleeping 才进入完整睡眠链。
- 白天 sleeping 不默认进床，而是去休息区。

### 8.5 加班链

```text
深夜工作
→ 台灯增强
→ 困倦 / 烦躁 emoji
→ 起身走 2-3 tile
→ 回工位
```

表现：

- 工位灯更亮。
- 屏幕光更明显。
- emoji 使用像素绘制，不依赖系统 emoji 字体。

### 8.6 厕所链

```text
当前位置
→ 走廊右侧出口
→ 淡出 / hidden
→ 约 30 秒后淡入
→ 回 homeTarget
```

要求：

- hidden actor 不能从 `_actors` 删除。
- 返回后继续按 scene/home target 落位。
- 如后端状态变化，允许提前终止返回工作目标。

---

## 9. 休息区价值增强

### 9.1 目标

休息区成为白天默认待机区，而不是装饰区。

### 9.2 默认落位

白天 / 傍晚：

```text
sleeping / idle → lounge sofa
```

深夜：

```text
sleeping → bedroom bed
```

### 9.3 休息区行为

允许行为：

1. 沙发待机。
2. 看手机。
3. 喝咖啡。
4. 接水。
5. 窗边站立。
6. 厕所淡出 / 返回。

### 9.4 看手机表现

要求：

- 小像素亮屏。
- 不画真实手机 UI。
- 屏幕偶尔闪烁。
- 可配合坐姿手臂变化。

### 9.5 咖啡表现

要求：

- 角色走到咖啡机。
- 手中出现小杯子。
- 回沙发后杯子可冒热气。

### 9.6 接水表现

要求：

- 角色走到饮水机。
- 手中出现小水杯。
- 行为结束后回 homeTarget。

---

## 10. 角色差异化

### 10.1 AI助手 default

偏向行为：

- 沙发待机。
- 搜索屏幕。
- 咖啡。
- 看手机。

头顶短语候选：

```text
检索中
...
```

### 10.2 PM

偏向行为：

- 白板。
- PRD 屏幕。
- 沙发看文档 / 手机。
- 窗边思考。

头顶短语候选：

```text
PRD
排期
```

### 10.3 研发经理 tech

偏向行为：

- 工位代码。
- 白板架构。
- 接水 / 咖啡。
- 深夜加班概率更高。

头顶短语候选：

```text
debug
架构
```

### 10.4 新 profile

新 profile 沿用通用行为权重：

- 白天无任务去休息区。
- 工作时去工位。
- 深夜 sleeping 去床。
- 颜色按现有 palette 自动分配。

---

## 11. 工位屏幕内容增强

### 11.1 目标

让不同角色在工位上有差异，而不只是换颜色。

### 11.2 default 屏幕

显示：

- 搜索框。
- 加载点。
- 聊天气泡。

### 11.3 PM 屏幕

显示：

- PRD 文档。
- 列表项。
- 流程小块。

### 11.4 tech 屏幕

显示：

- 代码行。
- 终端输出。
- 架构小框。

### 11.5 thinking 屏幕

thinking 时屏幕不应像 working 那样高速变化。

表现：

- 光标慢闪。
- 内容停顿。
- 人物头顶思考气泡。

---

## 12. 只读字段增强

### 12.1 可用字段

优先利用 `/api/state` 已有字段：

```text
profile
status
location
last_active
message_count
tool_call_count
total_tokens
metadata.model
```

### 12.2 用途

字段用途：

- `status`：右侧真实状态，左侧硬触发来源。
- `location`：辅助判断工作/卧室/休息区。
- `last_active`：辅助判断休眠时长。
- `metadata.model`：右侧模型名。
- `message_count` / `tool_call_count` / `total_tokens`：右侧统计展示。

### 12.3 不做事项

不做：

- 新增数据库表。
- 新增今日统计 API。
- 新增 source 维度展示。
- 新增跨机器 IDE token 采集。

---

## 13. 里程碑计划

### 13.1 v20-M1：视口 + 右侧监控区稳定

目标：

- 实现 Safe Camera。
- 修复顶部遮挡。
- 固化右侧 15% 窄栏状态文案和卡片规范。
- sleeping 文案按昼夜切换。

交付：

- 左侧顶部不遮挡。
- 右侧状态文案：白天休眠中、夜间睡眠中。
- active 卡片轻微高亮。
- 现有数据展示不退步。

验收：

- 浏览器视觉检查通过。
- 85/15 比例保持。
- 右侧无文字重叠。
- `/health` 正常。
- `node --check` 通过。

### 13.2 v20-M2：Scene State + 休息区默认待机

目标：

- 引入 Data State / Scene State 分离。
- 白天 sleeping / idle 默认去休息区。
- 深夜 sleeping 去卧室。

交付：

- 白天无任务人物坐沙发。
- 夜间无任务人物睡床。
- 右侧真实状态不变。

验收：

- 白天 `sleeping` 左侧不再全员卧室睡觉。
- 休息区开始承载待机状态。
- 后端变 working 能打断并回工位。

### 13.3 v20-M3：动作链 + 行为稳定化

目标：

- 丰富人物动作链。
- 引入 cooldown。
- 引入 fail-safe。

交付：

- 工作链。
- 思考链。
- 休息链。
- 睡眠链。
- 加班链增强。

验收：

- 连续观察 5-10 分钟能看到不同动作。
- 不出现全员同时乱跑。
- 行为结束能回正确位置。
- 卡死保护生效。

### 13.4 v20-M4：角色差异化 + 场景细节增强

目标：

- 不同 profile 行为和屏幕内容有差异。
- 休息区、白板、窗边、咖啡机更有存在感。

交付：

- default / PM / tech 工位屏幕不同。
- 角色行为权重不同。
- 白板 / 咖啡 / 手机 / 饮水机细节增强。

验收：

- 三个角色不是同一套动作换颜色。
- 休息区和白板有明确使用价值。
- 整体不影响右侧监控区可读性。

---

## 14. 验证清单

### 14.1 基础验证

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
curl -s http://localhost:8899/health
curl -s -o /dev/null -w 'root HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/
curl -s -o /dev/null -w 'pixel HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/static/pixel-office.js
curl -s -o /dev/null -w 'server HTTP %{http_code} size=%{size_download}\n' http://localhost:8899/static/server-panel.js
```

### 14.2 浏览器验证

检查：

- 顶部是否遮挡。
- 85/15 是否保持。
- 右侧文案是否正确。
- 右侧无文字重叠。
- 人物与家具是否对齐。
- 人物路径是否穿墙。
- 行为结束是否回 homeTarget。

### 14.3 状态验证

覆盖状态：

```text
working
thinking
sleeping 白天
sleeping 深夜
idle
```

重点验证：

- thinking 不被当作 sleeping。
- 白天 sleeping → 右侧休眠中，左侧休息区。
- 深夜 sleeping → 右侧睡眠中，左侧卧室。
- working 打断休息行为并回工位。

---

## 15. 回退策略

v20 任何阶段效果不达标，应优先回退该阶段改动。

如果整体 v20 不达标，可回退到当前 v19 M4 状态或 v18 备份。

v18 备份：

```bash
cd /root/.hermes/monitor
cp archive/pixel-office.v18.js.bak frontend/pixel-office.js
cp archive/index.v18.html.bak frontend/index.html
```

注意：v18 回退会丢失 v19/v20 大画布办公室体验，但可恢复早期稳定监控结构。

---

## 16. SPEC 冻结后的实施原则

1. 编码前先确认 SPEC 已冻结。
2. 每个里程碑单独实施、单独验证。
3. 不跨 M1/M2/M3/M4 混改。
4. 不在未确认方案时直接编码。
5. 长代码改动优先用小 patch 分段执行。
6. 每次改完必须跑语法检查和 HTTP 检查。
7. 视觉改动必须用浏览器截图验证。
8. 如果服务器区数据展示退步，立即停止并回滚。

---

## 17. 决策记录

### 2026-06-13

主人确认：

- 下一版命名为 v20。
- 按建议路线推进。
- 今日 / 总计暂不需要。
- 布局固定 85% / 15%。
- 后端允许只读字段增强，不改数据结构。
- sleeping 文案选择 C：白天休眠中，夜间睡眠中。
- 白天无任务默认去休息区沙发。
- 允许休息区看手机。
- 顶部遮挡优化选择 C：智能缩放，尽量不裁，但允许极少黑边。
