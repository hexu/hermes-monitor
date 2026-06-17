# Hermes Monitor v19 — SPEC

> 状态：方案归档（未实施）
> 创建：2026-06-13
> 作者：与主人协商一致后由 AI 助手记录
> 前置版本：v18（多 Canvas 4 zone + 动态分列），代码已备份至 `archive/pixel-office.v18.js.bak`

---

## 0. 目标定位

- **目标用户**：主人一人
- **核心理念**：办公室生活叙事 + 真实状态映射 + 服务器监控数据并存
- **总体分工**：
  - 左 80%：办公室大画布（叙事，单一连续空间）
  - 右 20%：服务器区面板（数据，沿用 v18 风格）
- **决策原则**：服务器区数据准确性是核心，办公室画面是装饰。任何升级若导致数据展示退步，立刻回滚。

---

## 1. 整体布局

### 1.1 屏幕分区

```
┌──────────────────────────────────────────────┬──────────────┐
│                                              │              │
│                                              │  ┌────────┐  │
│                                              │  │default │  │
│                                              │  └────────┘  │
│       办公室大画布                            │              │
│   (单一连续空间, top-down 俯视)              │  ┌────────┐  │
│                                              │  │  pm    │  │
│                                              │  └────────┘  │
│                                              │              │
│                                              │  ┌────────┐  │
│                                              │  │  tech  │  │
│                                              │  └────────┘  │
│                                              │              │
└──────────────────────────────────────────────┴──────────────┘
   左 80%                                         右 20%
```

### 1.2 办公室大画布内部结构

```
┌─────────────────────────────────────────────────────────┐
│  [卧室]    │ 走 │   [休息区]    │ 走 │   [工位区]      │
│   床1 床2 │ 廊 │  三人沙发      │ 廊 │  工位1 工位2    │
│   床3 床4 │ │ │  单沙1 单沙2   │ │ │  工位3 工位4    │
│   床5     │ │ │  咖啡机 饮水机 │ │ │  工位5          │
│   闹钟    │ │ │  绿植 跑步机   │ │ │  白板 打印机    │
│           │ │ │                │ │ │                 │
├───────────┴─┴─┴────────────────┴─┴─┴─────────────────┤
│           主走廊 (横向贯穿)                            │
│           ──→ 走廊尽头（厕所淡出点）                   │
└─────────────────────────────────────────────────────────┘
```

- 三个房间（卧室/休息区/工位区）由墙隔开，门洞相连
- 横向主走廊贯穿三个房间下方
- 走廊尽头作为"上厕所"行为的淡出点

### 1.3 Tile 网格规格

| 参数 | 值 |
|---|---|
| Tile 尺寸 | 32×32 px |
| 大画布宽 | ~30 tiles (960 px) |
| 大画布高 | ~20 tiles (640 px) |
| 各房间宽 | 卧室 8 + 走廊 2 + 休息 8 + 走廊 2 + 工位 10 |
| 各房间高 | 上区房间 12 + 主走廊 2 + 下走廊 6 |

### 1.4 视角与渲染

- 视角：正俯视 top-down（与 LPC 素材完全兼容）
- 渲染：整数倍 DPR 缩放，保持像素锐利
- 帧率：30 FPS
- 静态层（地板/墙/家具）渲染到离屏 canvas 缓存，每帧仅 blit 一次

---

## 2. 房间内部规格

### 2.1 工位区（5 个工位）

| 工位编号 | 用途 | 朝向 |
|---|---|---|
| 工位1 | 第 1 个分身（按进入顺序） | 朝下 |
| 工位2 | 第 2 个分身 | 朝下 |
| 工位3 | 第 3 个分身 | 朝下 |
| 工位4 | 预留 | 朝下 |
| 工位5 | 预留 | 朝下 |

每个工位包含：
- 桌子（2×1 tile）
- 椅子（1×1 tile，桌子下方）
- 显示器（在桌上，朝下显示屏幕）
- 台灯（每工位一盏，加班叙事时点亮）

工位区其他元素：
- 白板（2×3 tile，靠墙）：thinking >10min 软触发去站立
- 打印机（2×2 tile）：纯装饰
- 文件柜（2×4 tile）：纯装饰
- 1-2 盆绿植：纯装饰

### 2.2 卧室（5 张床）

| 床编号 | 用途 |
|---|---|
| 床1-3 | 当前 3 分身固定占用 |
| 床4-5 | 预留新分身 |

每张床包含：
- 床（2×3 tile）
- 床头柜（1×1 tile）
- 床头夜灯（深夜时该床有人则点亮）
- 闹钟（1×1 tile，全房间共用 1 个，靠墙）

### 2.3 休息区（1×三人沙发 + 2×单人沙发）

- 三人沙发（4×2 tile）：可坐 3 人位
- 单人沙发 ×2（2×2 tile each）：各坐 1 人
- 茶几（2×1 tile，三人沙发前）
- 咖啡机（1×1 tile，靠墙）：软触发"倒咖啡"目标点
- 饮水机（1×1 tile，靠墙）：软触发"接水"目标点
- 跑步机（2×3 tile）：纯装饰，未来可扩展
- 1-2 盆绿植：纯装饰

### 2.4 走廊系统

- 横向主走廊：宽 2 tile，贯穿大画布下方
- 纵向走廊：连接三个房间的门洞，宽 2 tile
- 走廊尽头（最右或最左）：留 3 tile 作为"厕所淡出区"
- 门洞：每个房间有 1-2 个门洞通向走廊，门洞宽 2 tile

---

## 3. 像素人系统

### 3.1 LPC 素材

- **来源**：Liberated Pixel Cup（CC-BY-SA 3.0 / GPL 3.0）
- **生成器**：https://sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator/
- **规格**：64×64 px/帧，人物在 32×32 tile 上居中
- **必备动作集**：walk(4 方向×9 帧)、idle(4 方向)、sit、sleep
- **License 合规**：在 `/root/.hermes/monitor/CREDITS.md` 列出资源作者

### 3.2 各分身 sprite 配色

| 分身 | 主色 | 衣服 | 头发 |
|---|---|---|---|
| default (AI助手) | #a78bfa 紫 | 紫色衫 | 紫色短发 |
| pm | #ff6b9d 粉 | 粉色衫 | 粉色长发 |
| tech (研发经理) | #00f5d4 青 | 青色衫 | 青色短发 |
| 新分身 | 调色板自动分配 | 模板衫 + 染色 | 模板发 + 染色 |

### 3.3 动画状态机

```
                  ┌──────────┐
                  │   IDLE   │  默认（站立呼吸）
                  └──┬───────┘
                     │
        ┌────────────┼────────────┬─────────────┐
        ↓            ↓            ↓             ↓
   ┌────────┐   ┌────────┐  ┌──────────┐  ┌──────────┐
   │  WALK  │   │  SIT   │  │  SLEEP   │  │  ACTION  │
   │(4 方向)│   │(工位/  │  │ (床上)   │  │ (喝咖啡 │
   │        │   │ 沙发)  │  │          │  │  /打哈欠)│
   └───┬────┘   └────────┘  └──────────┘  └──────────┘
       │
       └─→ 路径走完 → 切到目标动画
```

### 3.4 状态映射规则（backend → 前端）

| backend status | backend location | 前端目标位置 | 前端动画 |
|---|---|---|---|
| working | workstation | 该分身的工位坐位 | SIT + 敲键盘 |
| thinking | workstation | 同上 | SIT + 偶尔抬头 |
| sleeping | bedroom | 该分身的床位 | SLEEP |
| idle | couch | 沙发任一空位 | SIT + 偶尔喝咖啡 |

### 3.5 路径规划（A*）

- 算法：A* on tile grid（4 方向移动）
- 静态地图：墙=不可走，地板=可走，门=可走（权重 0.9 鼓励走门）
- 重新规划时机：仅在 backend status 变化或软触发时
- 走路速度：2 tile/秒
- 碰撞：角色之间不互相阻挡（穿过即可）
- 转弯：4 方向，不做斜走

### 3.6 帧动画细节

| 状态 | 帧数 | 帧率 |
|---|---|---|
| IDLE | 2 帧（呼吸） | 1 fps |
| WALK | 9 帧/方向 | 8-12 fps |
| SIT | 2-3 帧（敲键盘/抬头） | 4 fps |
| SLEEP | 2 帧（呼吸） | 0.5 fps |
| ACTION | 3-6 帧（具体动作而定） | 6 fps |

---

## 4. 行为系统

### 4.1 触发分层

**第一层：硬触发**（跟随 backend status 变化）

| backend 变化 | 角色行为 |
|---|---|
| → working/thinking | 走到该分身的工位 → SIT |
| → sleeping | 走到该分身的床 → SLEEP |
| → idle | 走到沙发空位 → SIT |

**第二层：软触发**（自主行为，让画面活起来）

仅在角色处于稳定状态（IDLE/SIT 持续 N 秒后）时按概率触发：

| 行为 | 概率 | 触发条件 | 动画流程 |
|---|---|---|---|
| 倒咖啡 | 0.3%/帧 | working >3min | 走到咖啡机 → 站 2s → 走回工位 |
| 接水 | 0.2%/帧 | working >5min | 走到饮水机 → 装水 → 走回 |
| 上厕所 | 0.1%/帧 | working >10min | 走到走廊尽头 → 淡出 → 30s 后淡入 → 走回 |
| 伸懒腰 | 1%/帧 | thinking >2min | 工位上播放 stretch 动画 |
| 打哈欠 | 0.5%/帧 | sleeping 时段 | 卧室/沙发上播放 yawn |
| 走窗边 | 0.1%/帧 | thinking >5min | 走到窗户 → 站 5s → 走回 |
| 走白板 | 0.05%/帧 | working >10min | 走到白板 → 站 3s → 走回 |
| 同事相遇 | 路径触发 | 走廊路径相遇 | 双方停 2s 互看 → 继续 |

总叠加触发率约 5-10%/秒，平均 10-20s 有一个角色做点小事。

### 4.2 上厕所淡出/淡入实现

- 走到走廊尽头最右 tile（或最左，随机）
- 在该 tile 上 alpha 从 1.0 → 0.0 渐变 1s
- 角色"消失"30s（仅触发该角色的计时器，不是真删除）
- alpha 从 0.0 → 1.0 渐变 1s
- 走回原坐位

---

## 5. 加班/熬夜叙事（22:00 后仍 working）

### 5.1 触发条件

`now.hours >= 22 || now.hours < 6` && `pr.status === 'working'`

### 5.2 视觉表现

| 元素 | 表现 |
|---|---|
| 该工位的台灯 | 保持点亮（其他工位灯熄灭） |
| 头顶 emoji | 每 30s 概率冒 `💢` 或 `😴` 像素图，持续 3s |
| 起身缓解 | 每 5min 起身走 2-3 tile 后回工位 |
| 整体滤镜 | 深夜蓝紫滤镜（来自昼夜系统） |
| 屏幕光 | 屏幕亮度比白天工作更亮（对比深夜环境） |

### 5.3 emoji 像素图

- 💢（红色怒气符）：working >2h 触发概率高
- 😴（蓝色困倦符）：working >4h 触发概率高
- 自己绘制 8×8 像素图，不依赖系统 emoji 字体

---

## 6. 昼夜系统

### 6.1 时间映射

直接使用本地系统时间（`new Date()`），不加速，与主人真实生活同步。

### 6.2 时段定义

| 时段 | 范围 | 滤镜 | 室内灯 | 窗外 |
|---|---|---|---|---|
| 黎明 | 06:00-08:00 | 暖橙 #ffd4a0 30% | 关 | 朝霞渐变 |
| 白天 | 08:00-17:00 | 无 | 关 | 蓝天云 |
| 黄昏 | 17:00-19:00 | 暖橙红 #ff8060 25% | 关 | 晚霞渐变 |
| 傍晚 | 19:00-22:00 | 蓝紫 #4060a0 20% | 开（全室） | 暮色 |
| 深夜 | 22:00-06:00 | 深蓝 #1a2050 50% | 关（仅夜灯/加班灯） | 深蓝月星 |

### 6.3 实现方式

- 滤镜：场景画完后叠半透明色块，`globalCompositeOperation = 'multiply'`
- 灯光：每盏灯独立判断（参考 5.2 加班灯逻辑）
- 窗外：窗户像素根据时段切换不同贴图

### 6.4 灯光独立控制

| 灯具 | 点亮条件 |
|---|---|
| 工位台灯 | 该工位有人 SIT + (傍晚 \|\| 深夜) 或加班 |
| 卧室夜灯 | 该床有人 SLEEP + 深夜时段 |
| 休息区灯 | 傍晚常亮，深夜微弱 |
| 走廊灯 | 傍晚后常亮 |

---

## 7. 新分身处理

### 7.1 发现流程

后端 `_discover_profiles()` 已实现：扫描 `~/.hermes/profiles/<name>/` 目录，自动加入 profile 列表。新分身添加后需 `pkill -f monitor_server.py && { python backend/monitor_server.py & }` 生效。

### 7.2 前端处理

| 项 | 处理方式 |
|---|---|
| sprite | 使用 `character-template.png` + Canvas 染色（衣服色） |
| 颜色分配 | 调用 `_allocColor(name)`，从 PALETTE 调色板按入场顺序取色 |
| 工位分配 | 工位 1-5 按进入顺序占用第一个空位 |
| 床位分配 | 床 1-5 同理 |
| 沙发位 | 三人沙发优先占满 → 单人沙发 1 → 单人沙发 2 |
| 显示名称 | 默认 profile 名首字母大写，去除前缀 (agent-/profile-/sub-/child-) |
| 服务器面板 | 自动新增一块面板（沿用 v18 动态生成逻辑） |

### 7.3 染色实现

- 加载 `character-template.png` 后，在离屏 canvas 上做颜色替换
- 模板 sprite 用特定基色（如纯白 #ffffff）作为衣服区域
- 用 `globalCompositeOperation = 'source-in'` 染成目标色
- 缓存染色后的 sprite，避免每帧重复处理

---

## 8. 技术架构

### 8.1 前端文件组织

```
frontend/
├── index.html               # 改为 2 区布局（office canvas + server panels）
├── pixel-office.js          # 重写：office 渲染主入口
├── server-panel.js          # 新增：服务器面板渲染（从 v18 抽取）
├── modules/
│   ├── tilemap.js           # 地图引擎 + A* 路径
│   ├── character.js         # 角色控制器 + 帧动画
│   ├── behavior.js          # 行为系统（硬/软触发）
│   ├── time-of-day.js       # 昼夜系统
│   └── sprite-loader.js     # spritesheet 加载 + 染色
├── assets/
│   ├── tilemap.png          # 地板/墙/家具 spritesheet
│   ├── character-default.png  # AI助手 LPC sprite
│   ├── character-pm.png       # PM LPC sprite
│   ├── character-tech.png     # tech LPC sprite
│   └── character-template.png # 新分身染色模板
└── data/
    ├── tilemap.json         # 地图数据（哪格是墙/地板/门）
    └── seats.json           # 工位/床位/沙发位坐标定义
```

### 8.2 核心模块伪代码

```js
// modules/tilemap.js
class TileMap {
  loadFromJSON(data)
  isWalkable(x, y)
  findPath(start, end)        // A* 实现
  drawStatic(ctx)              // 渲染到离屏 canvas（一次）
  blit(targetCtx)              // 每帧从离屏 blit 到主 canvas
}

// modules/character.js
class Character {
  constructor(profile, sprite, startTile)
  update(dt)                   // 推进路径 + 帧动画
  setGoal(targetTile, onArrive) // 改 targetTile，重算 path
  setAnimation(state, dir)     // SIT/WALK/SLEEP/ACTION
  draw(ctx, time)              // 按方向 + 状态绘当前帧
}

// modules/behavior.js
class BehaviorEngine {
  tick(characters, profileStates, time)
    // 硬触发：status 变化 → character.setGoal(targetSeat)
    // 软触发：稳定状态超时 → roll 概率 → 派遣临时 goal
}

// modules/time-of-day.js
class TimeOfDay {
  getPhase(now)                // 'dawn'|'day'|'dusk'|'evening'|'night'
  getFilter()                  // {color, alpha} 滤镜参数
  isLightOn(lightId, characters) // 各盏灯独立判断
  drawOverlay(ctx)             // 画完场景后叠滤镜
}

// pixel-office.js (主循环)
async function init() {
  await Promise.all([
    spriteLoader.load(),
    tileMap.load('data/tilemap.json'),
    seats.load('data/seats.json'),
  ])
  loop()
}

function loop(ts) {
  // 1. 每 3s fetch /api/state
  // 2. behaviorEngine.tick()
  // 3. characters.forEach(c => c.update(dt))
  // 4. tileMap.blit(officeCtx)
  //    → drawFurniture(officeCtx)
  //    → characters.forEach(c => c.draw(officeCtx))
  //    → drawLights(officeCtx)
  //    → timeOfDay.drawOverlay(officeCtx)
  // 5. serverPanel.render(serverCtx)
  // 6. requestAnimationFrame(loop)
}
```

### 8.3 性能预算

| 项 | 预算 | 备注 |
|---|---|---|
| 大画布尺寸 | 960×640 px (×DPR) | 1080P 屏幕够用 |
| 帧率 | 30 FPS | 静态背景+动态人物完全够 |
| 静态层缓存 | offscreen canvas 一次绘完 tilemap | 每帧仅 blit 1 次 |
| 动态层 | 仅人物 + 灯光叠加 + 滤镜 | 每帧重绘，~3-10 角色 |
| Sprite 加载 | ~500KB-1MB 初次加载 | 需 loading 状态 |
| 总 CPU | <5% (典型笔记本) | 远低于当前 v18 |

### 8.4 后端兼容性

后端 `hermes_collector.py` **保持不动**，仅前端重写。
后端字段不需扩展（status/location/last_active/metadata 已足够）。

---

## 9. 里程碑路线

### M1 — 大画布静态场景 + 服务器区分离

**完成后能看到**：一张静态办公室全景图（无人物），右侧服务器面板正常工作。

具体交付：
- `index.html` 改为 2 区布局
- `tilemap.json` + `tilemap.png` 完成（地板/墙/门/家具）
- `seats.json` 工位/床/沙发坐标定义完毕
- 静态层渲染到离屏 canvas
- `server-panel.js` 从 v18 抽出，独立渲染右侧
- 数据流（fetch /api/state）保持工作

**验收**：浏览器打开 http://localhost:8899/ 能看到完整办公室静态图 + 右侧 3 个服务器面板正确显示数据。

工期：1 会话。

### M2 — LPC 角色 + L1 帧动画 + 静态坐姿

**完成后能看到**：3 个像素人按状态坐在工位/床/沙发上，有呼吸和敲键盘动画。

具体交付：
- 用 LPC 生成器生成 default/pm/tech 三套 sprite + template
- `sprite-loader.js` 加载 + 染色（template 用）
- `character.js` 实现 IDLE/SIT/SLEEP 三个状态的帧动画
- 状态映射（backend status → 坐位 + 动画）
- 角色直接"出现"在目标位置（不走过去，瞬移）

**验收**：工位有人时能看到敲键盘动画，床上有人时能看到睡眠呼吸，沙发有人时能看到坐姿。

工期：1-2 会话。

### M3 — L2 状态过渡 + L3 A* 路径

**完成后能看到**：状态变化时角色会**走过去**，不再瞬移。

具体交付：
- `tilemap.js` 实现 `isWalkable` + A* `findPath`
- `character.js` 增加 WALK 状态 + 路径推进
- 状态变化触发路径规划（不再瞬移）
- 4 方向走路动画（LPC 9 帧/方向）
- 走廊路径正确（不穿墙）

**验收**：手动让一个分身从 working 切到 sleeping，能看到角色起身 → 走出工位区 → 经过走廊 → 进入卧室 → 躺到床上。

工期：1-2 会话。

### M4 — L4 行为系统 + 昼夜系统 + 加班叙事 + 新分身处理

**完成后能看到**：完整版，角色"活"起来。

具体交付：
- `behavior.js` 软触发系统（倒咖啡/接水/上厕所/伸懒腰/打哈欠/走窗边/走白板/同事相遇）
- 上厕所淡出/淡入实现
- `time-of-day.js` 昼夜系统 + 时段滤镜
- 各盏灯独立控制
- 22:00 后加班叙事（工位灯 + emoji + 起身缓解）
- 窗外景色昼夜变化
- 新分身自动占用空座位 + 染色
- `CREDITS.md` 列出 LPC 资源作者

**验收**：连续观察 30 分钟，能看到角色自主做小事、昼夜光线变化、深夜加班场景。新建一个 `~/.hermes/profiles/test-bot/` 后重启监控，能看到第 4 个像素人入场。

工期：2-3 会话。

### 推进原则

- 每个 MS 完成后是**完整可用的版本**，可随时叫停或调整方向
- v18 代码已备份在 `archive/`，不做向后兼容
- 每个 MS 验收完毕后，先合并再开下个 MS

---

## 10. 风险与权衡

### 10.1 工程量

约 **1500-2500 行新代码**（v18 是 466 行，提升 3-5 倍）。这是一个小型 2D 游戏的复杂度。

### 10.2 美术资源依赖

LPC 资源主人或 AI 助手下载，license 是 CC-BY-SA 3.0 / GPL 3.0。需 `CREDITS.md` 归档作者列表。

### 10.3 license 合规

- 自用：无需公开 attribution，但 `CREDITS.md` 内部归档
- 分享/开源：必须公开列出 LPC 作者，并保留同样 license

### 10.4 性能

设计预算 <5% CPU，初次加载 spritesheet 需 100-200ms loading 状态。
长时间运行无累积内存泄漏（角色对象固定数量）。

### 10.5 跑偏风险

⚠️ 最大风险：做着做着沉迷做游戏忘了监控本质。

**底线**：服务器区数据准确性是核心。如果某次升级让服务器区数据展示退步，立刻回滚。

### 10.6 SPEC 演化

本 SPEC 视为 v19 的冻结基线。若 M2-M4 期间发现规格不合理，应：
1. 在本文档底部追加"决策修订记录"
2. 标注修订原因和新决策
3. 不直接覆盖原条款

---

## 11. 决策修订记录

（暂无，预留位置）

---

## 12. 决策遗留待定

以下条款标注为"待定"，将在实施时再次与主人确认：

- (无，本 SPEC 决策已全部明确)

---

## 附录 A：关键参考路径

- v18 备份：`/root/.hermes/monitor/archive/pixel-office.v18.js.bak`
- 后端 collector：`/root/.hermes/monitor/backend/hermes_collector.py`
- 后端 server：`/root/.hermes/monitor/backend/monitor_server.py`
- LPC 生成器：https://sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator/
- Tiled 编辑器：https://www.mapeditor.org/

## 附录 B：主人决策时间线

- 2026-06-13：决策点 1-4 全部确认
  - 决策 1：方案 B（单画布大办公室）
  - 决策 2：L1+L2+L3+L4 完整动画
  - 决策 3：加昼夜
  - 决策 4：Canvas + LPC spritesheet
- 2026-06-13：决策点 6.1-6.5 全部确认
  - 6.1：5 工位 / 5 床 / 1 三人沙发 + 2 单沙发
  - 6.2：左 80% / 右 20%
  - 6.3：走廊尽头淡出 30s 淡入
  - 6.4：加班叙事需要
  - 6.5：模板 sprite 染色 + 按入场顺序占位
- 2026-06-13：v18 代码备份至 archive/
- 2026-06-13：本 SPEC 文档落地

---

*本 SPEC 由 AI 助手与主人协商一致后归档。任何代码改动必须以本 SPEC 为基线。*
