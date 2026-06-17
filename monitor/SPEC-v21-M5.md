# Hermes Monitor v21-M5 SPEC：Rule Inspector / Debug Controls

> 状态：冻结执行版  
> 日期：2026-06-14  
> 基线：v21-M4 Rule Config Extraction  
> 目标：在不改变真实监控数据和生产默认视觉的前提下，为规则配置、persona 调度、scene event 调度提供可观测调试入口。

---

## 0. 背景

V21-M4 已将 persona / scene event / thought 文案规则抽离到 `frontend/data/rules-v21-m4.json`。这让后续调参更安全，但也带来一个新问题：当人物做出某个行为、多人事件被触发或未触发时，需要能快速知道：

- 当前加载的 rules 版本是什么；
- 某个 actor 当前 workMode / persona / sceneEvent 状态是什么；
- 下一次 persona / scene event 会在多少帧后尝试；
- 当前 scene event 的类型、阶段、参与者是谁；
- 是否能在 debug 模式中强制触发某个 scene event 或 persona，验证配置和绘制效果。

M5 的目标是增加 **只在 debug 模式显示/启用** 的 Rule Inspector 与 Debug Controls。

---

## 1. 总原则

1. 右侧 Daily Metrics Dashboard 继续只展示真实数据，不显示调试态。
2. debug 控件只在 `?debug=1` 时出现。
3. 生产默认 URL 不增加遮挡、不增加交互控件。
4. Debug Controls 只能影响前端视觉运行态，不写后端、不写数据库、不修改 rules 文件。
5. 调试强制触发必须继续遵守 M3/M4 的安全约束：多人事件至少 2 人，offwork 不进工位，error 不参与。
6. 若 debug 控件发生异常，不得中断 canvas 主渲染。

---

## 2. 文件范围

### 修改

- `frontend/pixel-office.js`
  - 新增 debug controls 状态与方法；
  - 扩展 debug overlay；
  - 暴露安全的 debug API；
  - 增强 Inspector 信息。
- `frontend/index.html`
  - 版本文案从 `v21 · M4` 更新为 `v21 · M5`；
  - 底栏文案更新为 `Rule Inspector / Debug Controls`。

### 不修改

- `frontend/server-panel.js`
- `frontend/data/rules-v21-m4.json`
- `backend/hermes_collector.py`
- `backend/monitor_server.py`
- 数据库 schema

---

## 3. Debug API

在 `window.PixelOffice` 上新增/强化：

### 3.1 `debugSnapshot()`

返回一个纯对象，便于浏览器 console 检查：

```js
PixelOffice.debugSnapshot()
```

结构：

```js
{
  version: 'v21-m5',
  rulesVersion: 'v21-m4',
  frame: 12345,
  debug: true,
  timePhase: 'day',
  sleepWindow: false,
  profiles: [...],
  actors: [
    {
      name,
      label,
      status,
      workMode,
      mode,
      targetKey,
      persona,
      sceneEventId,
      sceneRole,
      nextPersonaIn,
      cooldownIn,
      x,
      y
    }
  ],
  sceneEvent: {...},
  nextSceneEventIn: 999
}
```

### 3.2 `forceSceneEvent(type)`

Debug 模式下强制尝试触发某个 scene event：

```js
PixelOffice.forceSceneEvent('review_pair')
```

规则：

- 如果当前已有 scene event，先正常 release；
- 仍通过 `_maybeStartSceneEvent(profiles, type)` 走合法候选池；
- 若参与者不足返回 `{ok:false, reason:'no-candidate'}`；
- 不得手工拼出非法单人事件。

### 3.3 `forcePersona(profile, type)`

Debug 模式下强制某个 actor 触发某 persona：

```js
PixelOffice.forcePersona('tech', 'coffee')
```

规则：

- 必须找到当前 profile 和 actor；
- 使用当前 hard target + `_personaOptionsFromRules()` 查合法 options；
- 只允许从合法 options 里选指定 type；
- 找不到返回 `{ok:false, reason:'not-allowed'}`；
- 触发后设置 `a.persona/a.behavior`，reason 标为 `v21-m5-force-persona`。

### 3.4 `clearDebugEvent()`

清理当前 debug 强制事件：

- release 当前 sceneEvent；
- 清理所有 actor 的 persona/behavior；
- 回到各自 hard/home target；
- 返回 `{ok:true}`。

---

## 4. Debug Overlay

只在 `?debug=1` 显示。内容位于画布左上，轻量半透明，不遮挡核心人物：

- `M5 Rule Inspector`；
- rules version；
- frame；
- time phase；
- sleep window；
- scene event：type/phase/participants；
- next scene event 倒计时；
- 选中 actor 的 persona / nextPersonaIn / cooldownIn。

Overlay 不能使用厚重方框，保持 v20-M5 以来“轻量、低遮挡”的视觉方向。

---

## 5. Inspector 增强

V21-M1 已支持 hover/click actor。M5 在现有 tooltip / selected profile 信息中补充：

- rules version；
- persona reason；
- current persona type；
- scene role / phrase；
- next persona in；
- cooldown in。

如果 tooltip 当前函数结构不适合大改，至少在 debug overlay 中展示选中 actor 的这些字段。

---

## 6. URL 参数快捷调试

支持以下 URL 参数，仅 debug 模式生效：

- `?debug=1&forceScene=review_pair`
- `?debug=1&forcePersona=tech:coffee`

触发策略：

- 页面初始化后延迟若干帧再尝试，避免 actors 尚未创建；
- 每次页面加载只自动触发一次；
- 失败只记录到 `_debugLastAction`，不抛异常。

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
curl -s -o /dev/null -w 'pixel HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/static/pixel-office.js
curl -s -o /dev/null -w 'rules HTTP %{http_code} size=%{size_download}\n' --max-time 5 http://localhost:8899/static/data/rules-v21-m4.json
curl -sS --max-time 5 http://localhost:8899/api/state -o /tmp/hermes-monitor-state.json
curl -sS --max-time 5 http://localhost:8899/api/metrics/daily -o /tmp/hermes-monitor-daily.json
```

### 7.3 浏览器验证

访问：

- `http://localhost:8899/?debug=1&hour=12`
- `http://localhost:8899/?debug=1&hour=12&forceScene=review_pair`
- `http://localhost:8899/?debug=1&hour=12&forcePersona=tech:coffee`

控制台检查：

```js
PixelOffice.debugSnapshot()
PixelOffice.forceSceneEvent('debug_pair')
PixelOffice.forcePersona('tech', 'coffee')
PixelOffice.clearDebugEvent()
```

必须满足：

- `debugSnapshot().version === 'v21-m5'`；
- `debugSnapshot().rulesVersion === 'v21-m4'`；
- forced scene event participants >= 2；
- forced persona 若不合法，应安全返回失败，不抛异常；
- actors 坐标 finite；
- Daily Metrics profiles = 3；
- console error = 0。

---

## 8. 回滚

执行前创建：

- `archive/v21-m4-before-v21-m5-<timestamp>/`
- `archive/v21-m4-before-v21-m5-<timestamp>.tar.gz`
- `archive/v21-m4-before-v21-m5-<timestamp>.tar.gz.sha256`
- `RESTORE.sh`

回滚命令：

```bash
cd /root/.hermes/monitor/archive/v21-m4-before-v21-m5-<timestamp>
bash RESTORE.sh
```

---

## 9. 成功标准

M5 完成后：

1. 默认页面仍是正常监控面板，无 debug 控件遮挡；
2. `?debug=1` 显示 M5 Rule Inspector；
3. 浏览器 console 可调用 debug API；
4. 强制 scene/persona 走合法规则，不绕过安全边界；
5. 右侧 Daily Metrics 和后端 API 无退化；
6. skill 文档记录 M5 实现和验证路径。
