# Hermes Monitor v22

像素办公室监控面板 + Hermes 指标收集系统，支持多分身（default / PM / 研发经理 / CC研发）实时状态追踪。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     浏览器 (8899)                           │
│  pixel-office.js (像素画布) + server-panel.js (右侧数据面板)  │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket / HTTP
┌─────────────────────▼───────────────────────────────────────┐
│  monitor_server.py (端口 8899)                               │
│  - /api/state          ← 实时分身状态                       │
│  - /api/metrics/daily  ← 今日/累计指标                      │
│  - /api/metrics/ingest ← Hermes push指标                   │
│  - external_metrics.json ← 历史累计数据持久化                │
└──────┬──────────────────────────┬────────────────────────────┘
       │                          │
       │ HTTP GET                 │ HTTP GET
┌──────▼──────┐          ┌────────▼────────┐
│ hermes      │          │ hermes_collector │
│ (gateway    │          │ .py (端口5674xx) │
│  WS API)    │          └──────────────────┘
└─────────────┘

┌─────────────────────────────────────────────────────────────┐
│  claude-proxy-server-80.py (端口 80)                        │
│  CC研发中转代理：Claude Code CLI → 火山方舟 Coding API      │
│  上游：https://ark.cn-beijing.volces.com/api/coding         │
└─────────────────────────────────────────────────────────────┘
```

## 组件说明

| 文件 | 说明 |
|------|------|
| `backend/monitor_server.py` | 监控后端服务（FastAPI + WebSocket，端口8899） |
| `backend/hermes_collector.py` | Hermes Gateway 数据采集器（连接各 gateway WS API） |
| `claude-proxy-server-80.py` | CC研发中转代理（ThreadingHTTPServer，端口80） |
| `frontend/index.html` | 面板入口页 |
| `frontend/pixel-office.js` | 像素画布 + 分身行为逻辑 |
| `frontend/server-panel.js` | 右侧数据面板渲染 |
| `frontend/data/seats.json` | 工位/床位坐标配置 |
| `external_metrics.json` | 各分身历史累计数据（自动持久化） |

## 快速启动

```bash
cd /root/.hermes/monitor

# 启动后端服务
python3 backend/monitor_server.py &

# 启动CC研发中转代理（如使用Claude Code CLI）
python3 claude-proxy-server-80.py &

# 访问面板
# http://<server-ip>:8899/
```

## CC研发代理配置

在运行 Claude Code CLI 的服务器上：

```bash
export ANTHROPIC_BASE_URL=http://<monitor-server-ip>:80
export ANTHROPIC_API_KEY=<your-api-key>
# 上报到监控
export ANTHROPIC_INGEST_URL=http://<monitor-server-ip>:8899/api/metrics/ingest
```

## 分身说明

| 分身 | Profile ID | 说明 |
|------|-----------|------|
| 默认助手 | default | 默认 gateway |
| PM | pm | PM 分身 gateway |
| 研发经理 | tech | 研发经理分身 gateway |
| CC研发 | claude-code | Claude Code CLI 模拟分身（通过代理） |

## 数据恢复

从本仓库恢复监控全套配置：

```bash
# 方法1：随 Hermes 整体恢复（推荐）
bash scripts/restore.sh

# 方法2：仅恢复监控部分
cd /root/.hermes
bash <(curl -fsSL https://gitee.com/pawn/hermes/raw/main/monitor/RESTORE.sh)
```

## 版本历史

- **v22** — CC研发分身集成、联合事件、Metrics双口径、响应式修复
- **v21** — Pixel Office 像素画布、M5 Inspector/Rule面板
- **v20** — 四分身支持、Data/Scene State分离
- **v19** — 像素办公室动态角色
- **v18** — 监控Dashboard基础

## 端口说明

| 端口 | 组件 | 说明 |
|------|------|------|
| 80 | claude-proxy-server-80.py | CC研发中转代理 |
| 8899 | monitor_server.py | 监控面板服务 |
| 567424 | default gateway | 主gateway |
| 567383 | pm gateway | PM分身gateway |
| 567384 | tech gateway | 研发分身gateway |
