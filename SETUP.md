# 详细安装配置指南

## 目录

- [环境要求](#环境要求)
- [基础安装](#基础安装)
- [配置详解](#配置详解)
- [多分身配置](#多分身配置)
- [CC研发代理配置](#cc研发代理配置)
- [Hermes Agent 配置](#hermes-agent-配置)
- [启动与验证](#启动与验证)
- [故障排查](#故障排查)

---

## 环境要求

| 项目 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Python | 3.11 | 3.11+ |
| 内存 | 1 GB | 2 GB+ |
| 磁盘 | 5 GB | 10 GB+ |
| OS | CentOS 7+ / Ubuntu 20.04+ | Alibaba Cloud Linux 3 |

依赖包：
```
fastapi>=0.100
uvicorn[standard]>=0.23
websockets>=11.0
aiohttp>=3.8
```

---

## 基础安装

### 步骤 1：安装 Python 依赖

```bash
pip install fastapi uvicorn websockets aiohttp
```

### 步骤 2：配置环境变量

```bash
cp .env.template .env
nano .env
```

必须配置：
```bash
ALIBABA_CODING_PLAN_API_KEY=ark-xxxxxxxxxxxxxxxxxxxxx
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret
```

可选配置：
```bash
# CC研发代理上游（默认火山方舟）
ANTHROPIC_UPSTREAM_URL=https://ark.cn-beijing.volces.com/api/coding

# Hermes Agent metrics 上报地址
ANTHROPIC_INGEST_URL=http://127.0.0.1:8899/api/metrics/ingest
```

### 步骤 3：启动服务

```bash
cd monitor

# 启动监控后端（端口 8899）
python3 backend/monitor_server.py &

# 启动 CC研发中转代理（端口 80）
python3 claude-proxy-server-80.py &

# 验证服务
curl http://localhost:8899/health
# 应返回: {"ok":true}
```

### 步骤 4：访问面板

```
http://<your-server-ip>:8899/
```

---

## 配置详解

### config.yaml.template

核心配置文件，主要字段：

```yaml
model:
  default: MiniMax-M2.7          # 默认模型
  provider: custom
  base_url: https://ark.cn-beijing.volces.com/api/coding/v3
  api_key: YOUR_API_KEY_HERE    # ← 替换为真实 key

dashboard:
  port: 8899                    # 监控面板端口
  host: 0.0.0.0                 # 监听地址

platforms:
  api_server:
    port: 8642                  # Hermes API Server 端口
```

### external_metrics.json

历史累计指标数据文件，格式：

```json
{
  "claude-code": {
    "date": "2026-06-17",
    "today_tokens": 89038,
    "today_message_count": 17,
    "today_tool_call_count": 5,
    "total_tokens": 49089038,
    "total_message_count": 2817,
    "total_tool_call_count": 2805,
    "last_active": 1781663892
  }
}
```

> **注意**：此文件由程序自动写入，首次启动后生成。开源版可提交空模板或不提交。

---

## 多分身配置

Hermes 支持同时运行多个独立分身，每个分身有独立 gateway：

### 创建新分身

```bash
# 创建 tech 分身
hermes profile create tech --name "研发经理"

# 创建 pm 分身
hermes profile create pm --name "产品经理"
```

### 分身配置文件

每个分身有独立配置：

```bash
# 编辑 tech 分身配置
nano ~/.hermes/profiles/tech/config.yaml
```

关键配置项与主 `config.yaml` 相同。

### 分身端口

| 分身 | 默认端口 | 说明 |
|------|---------|------|
| default | 567424 | 主 gateway |
| pm | 567383 | PM 分身 |
| tech | 567384 | 研发分身 |

> 端口号在 gateway 首次启动时分配，重启后会变化。监控面板通过 WebSocket 动态发现端口。

---

## CC研发代理配置

Claude Code CLI 作为研发分身时，通过中转代理访问 API：

### 工作原理

```
Claude Code CLI
    ↓ (ANTHROPIC_BASE_URL)
claude-proxy-server-80.py (端口 80)
    ↓
火山方舟 / Anthropic API
    ↓ (metrics)
monitor_server.py (端口 8899)
```

### 启动代理

```bash
cd monitor
python3 claude-proxy-server-80.py &
```

### 验证代理

```bash
# 检查端口
ss -tlnp | grep :80

# 测试转发
curl -x http://localhost:80 https://ark.cn-beijing.volces.com/api/coding/v3/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Hermes Agent 配置

让 Hermes Agent 上报 metrics 到监控面板：

### 方式 1：环境变量

```bash
export ANTHROPIC_INGEST_URL=http://<monitor-ip>:8899/api/metrics/ingest
hermes gateway restart
```

### 方式 2：config.yaml

```yaml
agent:
  metrics_url: http://127.0.0.1:8899/api/metrics/ingest
```

---

## 启动与验证

### 完整启动顺序

```bash
# 1. 启动监控后端
cd /root/.hermes/monitor
python3 backend/monitor_server.py &
sleep 2

# 2. 启动 CC代理（可选）
python3 claude-proxy-server-80.py &
sleep 1

# 3. 启动 Hermes Gateway
hermes gateway start

# 4. 验证
curl http://localhost:8899/health
# {"ok":true}

curl http://localhost:8899/api/metrics/daily
# 返回各分身指标
```

### 验证面板功能

1. 打开浏览器访问 `http://<ip>:8899/`
2. 确认像素画布正常渲染
3. 确认右侧面板显示分身数据
4. 进行一次对话，检查数据是否更新

---

## 故障排查

### 面板无法访问

```bash
# 检查服务状态
ps aux | grep monitor_server

# 检查端口
ss -tlnp | grep 8899

# 查看日志
tail -f /tmp/monitor_v3.log
```

### 数据全为 0

1. 确认 `ANTHROPIC_INGEST_URL` 已配置
2. 确认 Hermes 能访问该 URL（无防火墙拦截）
3. 检查 `/api/metrics/ingest` 返回状态码

### CC代理连接失败

1. 检查端口 80 是否被占用：`ss -tlnp | grep :80`
2. 检查上游 URL 是否可达
3. 查看代理日志确认错误类型

### WebSocket 连接失败

前端 WebSocket 连接路径：`ws://<ip>:8899/ws`

检查 nginx 是否正确代理（如果用了反向代理）：
```nginx
location /ws {
    proxy_pass http://127.0.0.1:8899;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## 升级指南

### 从旧版本升级

```bash
# 1. 备份当前配置
cp -a /root/.hermes/monitor /root/.hermes/monitor_bak

# 2. 拉取新版本
git pull

# 3. 恢复自定义配置（如工位坐标、external_metrics.json）
cp /root/.hermes/monitor_bak/external_metrics.json /root/.hermes/monitor/

# 4. 重启服务
pkill -f monitor_server.py
python3 backend/monitor_server.py &
```
