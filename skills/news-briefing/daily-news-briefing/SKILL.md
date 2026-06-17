---
title: Daily News Briefing Workflow
emoji: 📈⚔️💻
name: daily-news-briefing
description: Automates the generation and delivery of a daily news briefing covering finance, military, and technology sectors.
usage: Use this skill to generate and push a daily news briefing covering finance, military, and technology sectors.
input_schema:
  type: object
  properties:
    schedule_time:
      type: string
      description: The time to send the briefing (default is '10:00 AM').
    sections:
      type: array
      items:
        type: string
      description: List of sections to include (default is ['finance', 'military', 'technology']).
  required: []
---

# Daily News Briefing Workflow

This skill automates the process of generating and pushing a daily news briefing with real-time updates across multiple sectors.

## Prerequisites

This user's environment uses **Firecrawl API v2** (key: `fc-5805f00749234abf8c75c682748a2633`, endpoint: `/v2/search`) for supplemental search. **Sina Feed API is the primary source** for same-day news due to Firecrawl's unreliable date filtering. The `productivity/news-briefing` skill has additional Feishu push details.

For weather jobs: free wttr.in API requires no key.

## News Sources & Working APIs

### Finance & Tech — Sina Feed API (reliable, fast)
```
https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid={lid}&k=&num=15&page=1&r=0.5
```

| Section | lid  | Notes |
|---------|------|-------|
| Finance | 2516 | Returns ~50 items, timestamps in Unix epoch |
| Tech    | 2515 | Returns ~50 items, timestamps in Unix epoch |
| General | 2517 | ⚠️ Returns finance content — NOT reliable for military. Use browser for military. |

Response shape: `{"result": {"data": [{"title", "intro", "ctime" (Unix timestamp), "url"}]}}`

**Filtering for military content** from `lid=2517`: keywords include `军, 武, 舰, 导, 战, 部队, 军事, 国防, 伊朗, 以色列, 俄罗斯, 乌克兰, 北约`.

### Military — Browser Scraping Required (API returns stale data)
⚠️ **Critical**: The Sina military API (`lid=2514`) returns cached data from 2023. Do NOT use it. Instead:
1. Use `browser_navigate('https://mil.news.sina.com.cn/')` 
2. Use `browser_snapshot()` to extract the news list — headings and timestamps are in the page accessibility tree
3. Use `browser_click(ref)` to open individual articles
4. Extract article content via `browser_console("JSON.stringify([...document.querySelectorAll('p')].map(p=>p.textContent))")`

The military page renders dates as "今天 HH:MM" (today) or "6月9日 HH:MM" (recent).

## Steps

1. **Fetch Finance News**
   ```python
   # Use lid=2516, iterate items and convert ctime
   import subprocess, json
   from datetime import datetime
   result = subprocess.run(['curl', '-s', '--max-time', '15',
       'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num=15&page=1&r=0.5',
       '-H', 'Referer: https://news.sina.com.cn/'],
       capture_output=True, text=True, timeout=20)
   data = json.loads(result.stdout)
   for i in data['result']['data']:
       ts = int(i['ctime'])
       dt = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M')
       print(f"[{dt}] {i['title']} | {i['intro']} | {i['url']}")
   ```

2. **Fetch Tech News** — same API with `lid=2515`

3. **Fetch Military News** — browser only (see above)

4. **Extract Article Detail** (optional, for fuller summaries):
   ```python
   # Sina article pages may use GB2312 encoding
   result = subprocess.run(['curl', '-s', '--max-time', '15', URL,
       '-H', 'User-Agent: Mozilla/5.0'], capture_output=True, text=True, timeout=20)
   text = result.stdout  # bytes — decode with errors='ignore'
   paras = re.findall(r'<p[^>]*>([^<]+)</p>', text)
   article = ' '.join(p.strip() for p in paras if len(p.strip()) > 30)
   ```

5. **Format & Output** — use the template below.

## Output Template

```
📰 每日新闻速报 | YYYY年MM月DD日

@何旭

## 💰 财经要闻

**① 新闻标题**
正文摘要约300字，涵盖事件核心信息及各方反应。
*来源：新浪财经 | YYYY年MM月DD日*

## ⚔️ 军事动态

**① 新闻标题**
正文摘要约300字，涵盖事件核心信息及各方反应。
*来源：新浪军事 | YYYY年MM月DD日*

## 💻 科技前沿

**① 新闻标题**
正文摘要约300字，涵盖事件核心信息及各方反应。
*来源：新浪科技 | YYYY年MM月DD日*
```

## Troubleshooting

### Cron job 报 401 AuthenticationError / 群里只看到 401 或 `01`
这是**模型/搜索服务 API Key 在 cron 子进程中不可见或失效**，通常不是飞书凭证问题。最稳方案是绕开 LLM 调用：
- 对每日新闻简报，优先使用 `no_agent=True` 脚本模式，让脚本 stdout 直接作为推送内容，避免模型 API Key 401 导致任务失败。
- 当前可复用脚本路径：`/root/.hermes/scripts/daily_news_briefing_noagent.py`。它使用新浪 Feed API 拉取财经/科技，并从新闻流关键词筛选军事相关新闻；无需大模型或 Firecrawl Key。
- 更新 job 示例：`cronjob(action='update', job_id='<id>', no_agent=True, script='daily_news_briefing_noagent.py', prompt='', skills=[], deliver='feishu:oc_YOUR_CHAT_ID')`
- 对助手群投递不要长期用 `origin` 或 `feishu:助手群`，优先用明确 chat_id：`feishu:oc_YOUR_CHAT_ID`，避免 DM/群/topic 名称解析歧义。
- `no_agent` 脚本内部**不要再直接调用飞书发送 API**。脚本只 `print()` 最终正文，由 Hermes cron 统一投递；否则会出现脚本自发到错误 chat（如 DM）+ cron 再把 `SUCCESS/ERROR` 当正文发群的错乱。
- 不要尝试仅通过环境变量传递密钥 — cron 进程不稳定继承 `.env` 或 `/etc/environment`。
- 验证不能只看 `last_status=ok`。必须：
  1. 本地运行脚本确认 stdout 是用户要看的正文，不是 `SUCCESS`/`ERROR`/401；
  2. `cronjob(action='run', job_id=...)` 手动触发；
  3. 等 scheduler tick 后查 `cronjob(action='list')`，确认 `last_status=ok` 且 `last_delivery_error=null`；
  4. 查 `~/.hermes/logs/agent.log`，确认 `Job '<id>': delivered to feishu:oc_YOUR_CHAT_ID via live adapter`。

See `productivity/news-briefing` skill for full cron 401 fix patterns (prompt embedding + no_agent script).

### Cron job 报 "Response truncated due to output length limit"
这是**模型生成的响应超出了输出长度限制**，不是 API 或认证问题。症状：输出文件只有 ~1800-2000 字节，job 状态显示 `error`，`last_error` 为 `RuntimeError: Response truncated due to output length limit`。

修复方法（已验证有效）：
1. **严格限制新闻数量**：每板块只选 **2-3 条**，不要选太多
2. **严格限制摘要长度**：每条 **150-200 字**，不要写 300 字
3. **设置总字数上限**：整个简报控制在 **2500 字以内**
4. **精简模板**：移除冗余的说明文字和格式化符号
5. **附加技能**：确保 cron job 关联了 `daily-news-briefing` 技能

### Firecrawl returns old dates despite date in query
Firecrawl API `/v2/search` does **not** reliably filter by date. Searching "2026年6月13日 财经" may return articles from 2026-06-11 or earlier. Use **Sina Feed API as primary** for same-day news (lid=2516 finance, lid=2515 tech). Reserve Firecrawl for supplemental search or when Sina Feed API is unavailable.

### Sina API returns empty items
- Try different `lid` values near the target range (e.g., 2514–2525)
- Try adding `k={keyword}` parameter for search-based retrieval
- If all lids return 0 items, fall back to `lid=2516` (finance) and filter

### Sina article URLs return "页面没有找到"
- This is a **known recurring issue** — many Sina article URLs are stale even when the article exists
- Workaround: use `web_search(query="site:mil.news.sina.com.cn 2026年6月12日 军事")` to find the live URL
- For military articles, URLs under `/zonghe/` subdirectory are more reliable than those under other paths
- If `web_extract` fails, fall back to `browser_navigate` + `browser_snapshot` to read the article content directly

### Military page renders as "页面没有找到"
- The `rollxml` endpoint is deprecated. Always use the HTML page (`https://mil.news.sina.com.cn/`) via browser.
- If the browser times out, retry — the page loads JS content and may need a moment.

### Article text has encoding issues
- Sina uses GB2312 or GBK encoding on some pages. Use `decode('gb2312', errors='ignore')` or `errors='ignore'` with UTF-8.

## Example Output

### Finance 📈

**① Kospi指数暴跌逾3% 地缘风险重创芯片股**
韩国基准股指周三大幅下跌，芯片股延续跌势且受美国袭击伊朗等地缘政治因素影响……Kospi 200波动性指数周二首度突破90创下纪录。
*来源：新浪财经 | 2026年6月10日*

### Military ⚔️

**① 罗斯福号航母领衔参加2026环太军演**
以罗斯福号航母为核心的海军编队已领衔参加2026年环太平洋军事演习……演习涵盖海上补给、反潜作战、多国舰艇协同等科目。
*来源：新浪军事 | 2026年6月9日*

### Technology 💻

**① iOS 27体验：App冷启动快30% 4K滑动加载提升70%**
WWDC 2026发布的iOS 27虽被吐槽"挤牙膏"，实测数据却显示其性能提升显著：App冷启动速度平均快30%……
*来源：苹果汇 / 新浪科技 | 2026年6月10日*
