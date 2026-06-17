# Firecrawl API v2 — 新闻搜索参考

## 基础调用

```python
import json, urllib.request

API_KEY = "fc-5805f00749234abf8c75c682748a2633"
API_URL = "https://api.firecrawl.dev/v2/search"

def search(query, limit=5):
    data = json.dumps({"query": query, "limit": limit}).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=data,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

result = search("2026年6月12日 财经 金融 经济", limit=5)
print(result["data"]["web"])  # 列表，每项含 url/title/description/position
```

## 响应结构

```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://...",
        "title": "标题",
        "description": "描述摘要",
        "position": 1
      }
    ]
  },
  "creditsUsed": 2,
  "id": "<uuid>"
}
```

## 新闻搜索常用 query 模式

| 频道 | query 示例 |
|------|-----------|
| 财经 | `site:xinhuanet.com OR site:kyodonews.net 2026年6月12日 财经 金融` |
| 财经 | `site:finance.sina.com.cn OR site:eastmoney.com 2026年6月12日 股市 经济` |
| 军事 | `site:mod.gov.cn 军事 国防 2026年6月` |
| 军事 | `site:sina.com.cn 军事 国防 2026年6月12日` |
| 科技 | `site:sina.com.cn 2026年6月12日 科技 AI 人工智能` |
| 科技 | `site:36kr.com OR site:cls.com 2026年6月12日 科技 AI 芯片` |

## 注意事项

- **必须用 `/v2/search`**，旧的 `/v0/search` 已废弃
- `creditsUsed` 字段显示本次搜索消耗的 credits
- description 字段通常已有内容摘要，可直接使用
- 搜索结果按相关性排序，`position` 从 1 开始
