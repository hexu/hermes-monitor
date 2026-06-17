---
name: news-briefing
description: "搜索、提取当日财经/军事/科技新闻，格式化后通过飞书推送"
triggers:
  - "每日简报"
  - "新闻简报"
  - "财经要闻"
  - "推送新闻"
  - "生成简报"
---

# 新闻简报生成与推送

## 功能描述
搜索并提取当天最新的财经、军事和科技新闻，按模板格式化后通过飞书推送。

## 核心流程

### Step 1: 新闻搜索（Firecrawl API v2）

**API配置**：
- URL: `https://api.firecrawl.dev/v2/search`（必须用 v2，旧的 `/v0/search` 已废弃）
- Method: POST + Bearer token auth
- Body: `{"query": "搜索词 + 日期限定", "limit": 5}`

**认证Header**：
```
Authorization: Bearer fc-5805f00749234abf8c75c682748a2633
Content-Type: application/json
```

**分频道搜索 query 示例**（今日 = 2026年6月12日）：
```python
queries = {
    "finance": "site:xinhuanet.com OR site:kyodonews.net 2026年6月12日 财经 金融",
    "military": "site:mod.gov.cn OR site:sina.com.cn 军事 国防 2026年6月",
    "tech": "site:sina.com.cn OR site:36kr.com 2026年6月12日 科技 AI 芯片"
}
```

**⚠️ 日期过滤要求**：
- 用户明确要求只搜索**当年**新闻（今天是2026年6月12日）
- query 中必须加入日期限制："2026年6月12日" 或 "today"
- 如果搜索结果日期较早（如2025年），继续搜索直到找到当日新闻
- 优先选择最近24小时内发布的新闻

### Step 2: 内容提取

从搜索结果中选取权威来源（鉅亨網、国防部官网、新浪财经、证券日报、快科技、财联社等），用 `web_extract` 批量提取详情页内容。

**优先来源**：
- 财经：东方财富网、新浪财经、证券日报、中国证券报、财联社
- 军事：国防部官网(mod.gov.cn)、新浪军事
- 科技：新浪科技、快科技、36氪、澎湃新闻、工信部

### Step 3: 格式化简报

**三大板块**：
```
## 💰 财经要闻
## ⚔️ 军事动态
## 💻 科技前沿
```

**每条新闻格式**：
```
**标题**
📅 发布日期 | 来源: 来源名称

约300字详细摘要...
---
```

### Step 4: 飞书推送

**Feishu Bot 认证**：
```python
APP_ID = "cli_YOUR_APP_ID"
APP_SECRET = "ziZAkavTw4sa7DHJCblBuewhNpUFpwv2"

# 获取 token
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Body: {"app_id": "...", "app_secret": "..."}
```

**发送消息 API**：
```
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id
Authorization: Bearer {token}
Content-Type: application/json

{
    "receive_id": "chat_id",
    "msg_type": "text",
    "content": "{\"text\": \"消息内容\"}"
}
```

**查找 chat_id**：
```
GET https://open.feishu.cn/open-apis/chat/v4/list
Authorization: Bearer {token}
```

返回的 `groups` 列表中包含 `chat_id`（如 `oc_YOUR_CHAT_ID`）。

**长消息分片**：简报内容较长时，建议分成多条消息发送（每条约500-800字），用 `time.sleep(0.5)` 间隔避免频率限制。

## 完整执行脚本

```python
import json, urllib.request, concurrent.futures, time

API_KEY = "fc-5805f00749234abf8c75c682748a2633"
API_URL = "https://api.firecrawl.dev/v2/search"
FEISHU_APP_ID = "cli_YOUR_APP_ID"
FEISHU_APP_SECRET = "ziZAkavTw4sa7DHJCblBuewhNpUFpwv2"
CHAT_ID = "oc_YOUR_CHAT_ID"

def firecrawl_search(query, limit=5):
    data = json.dumps({"query": query, "limit": limit}).encode('utf-8')
    req = urllib.request.Request(
        API_URL, data=data,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def get_feishu_token():
    data = json.dumps({"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET}).encode('utf-8')
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read()).get("tenant_access_token")

def send_feishu(token, text, chat_id=CHAT_ID):
    msg = {"receive_id": chat_id, "msg_type": "text", "content": json.dumps({"text": text})}
    data = json.dumps(msg).encode('utf-8')
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

# 1. 搜索
queries = {
    "finance": "2026年6月12日 财经 金融 经济 股市",
    "military": "site:mod.gov.cn 2026年6月 军事 国防",
    "tech": "site:sina.com.cn 2026年6月12日 科技 AI"
}
results = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    futures = {executor.submit(firecrawl_search, q, 5): k for k, q in queries.items()}
    for future in concurrent.futures.as_completed(futures):
        results[futures[future]] = future.result()

# 2. 提取 + 格式化 + 推送
# ... (见上方 Step 2-4)
```

## 注意事项

1. **Firecrawl v2 必须用**：旧的 `/v0/search` 端点已废弃，v2 是当前版本
2. **日期过滤是硬要求**：用户明确指定只搜当年新闻，早期结果需继续搜索
3. **分片发送**：单条飞书消息有长度限制，长简报应分成多条发送
4. **优先权威来源**：国防部官网 > 新浪/鉅亨 > 其他
5. **每条新闻300字摘要**：摘要需包含核心信息而非标题复述

## ⚠️ Cron Job 环境隔离陷阱（重要）

Cron job 执行时运行在**完全隔离的子进程环境**中，不会继承任何父进程属性：

- ❌ shell 环境变量（`$FIRECRAWL_API_KEY` 等）
- ❌ `.env` 文件
- ❌ `/etc/environment`
- ❌ 父进程的任何环境属性

**症状**：即使在 `.env` 或系统环境变量中配置了 API Key，cron job 运行时也读不到，报：

```
RuntimeError: Error code: 401 - {'error': {'code': 'AuthenticationError', 
'message': "The API key doesn't exist. Request id: ..."}}
```

**方案一（适用于需要 LLM 推理的新闻简报）**：在 cron job 的 prompt 中**直接嵌入完整 API 凭证**：

```
**Firecrawl API 配置（必须使用）：**
- API Key: fc-5805f00749234abf8c75c682748a2633
- API URL: https://api.firecrawl.dev/v2/search（/v0 已废弃，必须用 v2）
- 认证: Authorization: Bearer {key}
- Body: {"query": "搜索词", "limit": 5}
```

**方案二（推荐用于每日新闻简报定时任务）**：将 job 改为 `no_agent` 模式，运行独立 Python 脚本，stdout 由 cron 直接推送。这样完全绕过 LLM 模型 API Key / Firecrawl Key 的 401 风险。当前可复用脚本：`/root/.hermes/scripts/daily_news_briefing_noagent.py`。

更新新闻任务示例：
```python
cronjob(
    action='update',
    job_id='<每日新闻简报 job id>',
    no_agent=True,
    script='daily_news_briefing_noagent.py',
    prompt='',
    skills=[],
    deliver='origin',
)
```

示例 — 天气推送脚本（使用免费的 wttr.in，无需任何 API Key）：
```python
# ~/.hermes/scripts/weather_push.py
import requests, json
# wttr.in 完全免费，无需认证
resp = requests.get("https://wttr.in/Chengdu?format=j1", timeout=10)
tomorrow = resp.json()['weather'][1]
# ... 生成消息并通过飞书 API 发送
```

设置 no_agent job：
```python
cronjob(action='update', job_id='...', no_agent=True, script='weather_push.py')
```

**什么时候用哪个方案**：
- 需要 LLM 总结/推理 → 方案一（prompt 嵌入 key）
- 纯数据拉取+格式化推送 → 方案二（no_agent 脚本）

## 飞书双通道认证区别

| 通道 | 认证方式 | 说明 |
|------|---------|------|
| 飞书 Bot 消息收发 | Feishu Gateway（长连接 WebSocket） | 与 app_secret 无关，即使 Secret 错误也不影响消息收发 |
| 飞书 REST API（读表格、发消息） | tenant_access_token（app_id + app_secret换取） | Secret 错误则 401 |

排查 401 时先确认是哪个通道的问题：消息收发正常但 API 失败 → 说明 app_secret 失效；两者都失败 → 可能是网络或权限问题。
