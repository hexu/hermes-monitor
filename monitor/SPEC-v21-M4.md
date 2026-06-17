# Hermes Monitor v21-M4 SPEC：Rule Config Extraction / 规则配置化

> 状态：冻结执行版  
> 日期：2026-06-14  
> 基线：v21-M3 Scene Event Scheduler  
> 目标：把左侧办公室的 Persona / Scene Event / 文案规则从硬编码函数中抽离到前端 JSON 配置文件，降低后续调参风险，同时保持右侧真实监控数据完全不变。

---

## 0. 背景

v21-M3 已经完成 Scene Event Scheduler：多人聊天、同步、白板、评审、debug 等事件由统一调度器创建，避免单个 actor “对空气说话”。但当前规则仍硬编码在 `frontend/pixel-office.js` 中：

- `_maybeStartPersona()` 内部写死 work/offwork persona 候选池、权重、坐标、hold、cooldown；
- `_maybeStartSceneEvent()` 写死 scene event 类型、参与者组合、权重；
- `_sceneLayout()` 写死 scene event center / offsets / phrases；
- `_profileThought()` 写死 profile + context 的动作短语。

这些规则会随着视觉调优频繁变化。如果每次都修改 JS 主逻辑，容易引入运行时错误，尤其影响 canvas 渲染主循环。

M4 的目标是：**逻辑保留在 JS，规则迁移到 JSON**。

---

## 1. 非目标

M4 不做以下事情：

1. 不改后端 collector；
2. 不改 `backend/monitor_server.py` API；
3. 不改数据库 schema；
4. 不改右侧 Daily Metrics Dashboard 数据结构；
5. 不引入构建工具或打包流程；
6. 不追求配置热更新，页面刷新加载即可；
7. 不把全部绘制代码配置化，只配置规则和文案。

---

## 2. 文件范围

### 2.1 新增

- `frontend/data/rules-v21-m4.json`

### 2.2 修改

- `frontend/pixel-office.js`
  - 加载 rules JSON；
  - 增加规则读取与 fallback；
  - 改造 persona 候选池生成；
  - 改造 scene event 候选池与 layout；
  - 改造 profile thought 文案读取；
  - 更新顶部注释为 v21 M4。
- `frontend/index.html`
  - 版本文案从 `v21 · M3` 更新为 `v21 · M4`。

### 2.3 不修改

- `frontend/server-panel.js`
- `backend/hermes_collector.py`
- `backend/monitor_server.py`

---

## 3. 配置文件结构

`rules-v21-m4.json` 顶层结构：

```json
{
  "version": "v21-m4",
  "persona": {
    "scheduler": {
      "initial": { "work": [120, 720], "offwork_day": [180, 900], "offwork_night": [360, 1200] },
      "next": { "work": [900, 1800], "offwork_day": [700, 1700], "offwork_night": [1200, 2400] },
      "actor_jitter_mod": 180
    },
    "cooldowns": {
      "finish": { "work": 1500, "offwork": 1200, "phone": 3600, "restroom": 4200, "sleep_bed": 2400, "sofa_nap": 2400 },
      "global": { "phone": 2400, "restroom": 3000 }
    },
    "pools": {
      "work": [],
      "offwork": []
    }
  },
  "sceneEvents": {
    "scheduler": { "initial": [240, 900], "next": [1200, 2600], "cooldown": 3600 },
    "events": [],
    "layouts": {}
  },
  "thoughts": {}
}
```

---

## 4. Persona 规则表达

### 4.1 条件字段

persona item 支持：

- `type`: 事件类型；
- `weight`: 默认权重；
- `weights`: 按 profile / role 的权重覆盖；
- `when`: 条件，可包含：
  - `night`: true/false；
  - `profile`: `default|pm|tech|*`；
  - `profileIn`: 数组；
- `target`: 坐标表达；
- `hold`: 默认停留帧数；
- `holdByProfile`: 按 profile 覆盖；
- `facing`: 朝向；
- `phase`: 初始阶段；
- `hiddenHold`: restroom 隐藏时长；
- `timeout`: 超时帧数。

### 4.2 target 表达

M4 支持的 target：

- `{ "ref": "hard" }`：使用 hard target 坐标；
- `{ "ref": "bed" }`：使用当前 profile 分配的床；
- `{ "ref": "loungeProp", "name": "coffee_machine", "dx": 0, "dy": 1 }`；
- `{ "x": 24, "y": 4 }`：固定坐标；
- `{ "xByProfile": { "pm": 14, "default": 16, "tech": 16 }, "y": 2 }`；
- corridor_pace 可保留 `waypoints`。

### 4.3 行为边界

配置化后仍必须由 JS enforce：

- `offwork` 规则不得进入工位区；
- `restroom` 例外；
- sleep window 下非 work actor 不参加 scene event；
- `thinking` 必须仍属于 work；
- `error` 不启动 persona。

M4 可保留显式 rule review 注释，但不新增复杂 validator。若配置异常，JS 必须 fallback 到 hard target，不能让坐标 NaN 污染 canvas。

---

## 5. Scene Event 规则表达

### 5.1 event item

scene event item 支持：

- `type`: `chat_pair|sync_pair|whiteboard_pair|review_pair|debug_pair` 等；
- `weight`: 权重；
- `participants`: 声明式选择方式：
  - `names`: 固定 profile 名列表，如 `["pm", "tech"]`；
  - `fallbackNames`: 备用 profile 名；
  - `from`: `all|work`；
  - `count`: 参与人数，默认 2；
- `when`: 条件，如 `notSleepWindow`, `workCountAtLeast`, `allCountAtLeast`。

### 5.2 多人事件硬约束

无论配置如何，JS 必须强制：

1. participants 至少 2 人；
2. participants profile name 必须去重后至少 2 个；
3. `chat_pair/sync_pair/whiteboard_pair/review_pair/debug_pair` 不允许单 actor 创建；
4. `forcedType` 调试也只能从合法 candidates 里选。

### 5.3 layout

`sceneEvents.layouts[type]` 支持：

- `center`: `{x,y}`；
- `offsets`: 二维数组；
- `phrases`: 文案数组。

若某 type 没配置，使用内置 fallback：center 白板区、双人左右偏移、phrases `同步/OK`。

---

## 6. 加载策略与 fallback

### 6.1 加载

`PixelOffice.init()` 当前并行加载：

- `/static/data/tilemap.json`
- `/static/data/seats.json`

M4 改为并行加载：

- `/static/data/tilemap.json`
- `/static/data/seats.json`
- `/static/data/rules-v21-m4.json`

rules 加载失败不应阻止页面启动；应使用 `_defaultRules()`。

### 6.2 fallback

新增：

- `_rules: null`
- `_defaultRules()`
- `_loadRules()` 或 init 内 fetch + fallback
- `_ruleRange(section, fallback)`
- `_resolvePersonaSpec(...)`
- `_personaOptionsFromRules(...)`
- `_sceneCandidatesFromRules(...)`
- `_sceneParticipantsFromRule(...)`
- `_sceneLayoutFromRules(...)`
- `_thoughtFromRules(...)`

如配置字段缺失/非法：

- 权重非法：跳过该 item；
- 坐标非法：退回 hard target；
- layout 缺失：用 fallback；
- thoughts 缺失：用旧 `_profileThought()` fallback。

---

## 7. 验证要求

### 7.1 静态验证

```bash
cd /root/.hermes/monitor
node --check frontend/pixel-office.js
node --check frontend/server-panel.js
python3 -m json.tool frontend/data/rules-v21-m4.json >/dev/null
python3 -m py_compile backend/monitor_server.py backend/hermes_collector.py
```

### 7.2 HTTP/API 验证

```bash
curl -sS --max-time 3 http://localhost:8899/health
curl -s -o /dev/null -w 'root HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/
curl -s -o /dev/null -w 'rules HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/static/data/rules-v21-m4.json
curl -sS --max-time 5 http://localhost:8899/api/state -o /tmp/hermes-monitor-state.json
curl -sS --max-time 5 http://localhost:8899/api/metrics/daily -o /tmp/hermes-monitor-daily.json
```

### 7.3 浏览器验证

访问：

- `http://localhost:8899/?debug=1&hour=12`
- `http://localhost:8899/?debug=1&hour=21`

检查：

- 顶栏显示 `v21 · M4`；
- `PixelOffice._rules.version === 'v21-m4'`；
- `PixelOffice._sceneEvent` forced 启动时 participants >= 2；
- actor 坐标 finite；
- console error = 0；
- Daily Metrics Dashboard 仍加载；
- 右侧点击联动 Inspector 保持可用。

---

## 8. 回滚

执行前必须创建：

- `archive/v21-m3-before-v21-m4-<timestamp>/`
- `archive/v21-m3-before-v21-m4-<timestamp>.tar.gz`
- `archive/v21-m3-before-v21-m4-<timestamp>.tar.gz.sha256`
- `RESTORE.sh`

回滚命令：

```bash
cd /root/.hermes/monitor/archive/v21-m3-before-v21-m4-<timestamp>
bash RESTORE.sh
```

---

## 9. 成功标准

M4 完成后：

1. 左侧 Persona / Scene Event 的主要权重、坐标、短语来自 JSON；
2. 页面在 rules JSON 缺失时仍能启动；
3. 多人事件仍不会单人触发；
4. offwork 仍不会跑到工位区；
5. 右侧数据、Daily Metrics、API 均无退化；
6. 版本文案、语法检查、浏览器验证全部通过。
