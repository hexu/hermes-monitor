# Sina News API — Quick Reference

## Working Endpoints

### Feed API (no auth, free)
```
https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid={lid}&k=&num=15&page=1&r=0.5
```

Response: `{"result": {"data": [{title, intro, ctime (Unix epoch), url}], ...}}`

### Lid Map
| lid   | Section        | Reliability |
|-------|---------------|-------------|
| 2516  | Finance       | ✅ Good     |
| 2515  | Tech          | ✅ Good     |
| 2517  | General/mixed | ⚠️ Returns finance content, NOT military — do NOT rely on it for military |
| 2514  | Military      | ❌ Returns 2023 cached data — DO NOT USE |

**Military: browser-only** (see below). Lid 2517 gave finance news in practice (2026-06-13 session).

### Keyword Filter (k=)
- `k=军事` on lid=2516 searches finance feed for military-adjacent items
- Filter results by checking `url` for `mil.news.sina.com.cn` or keywords in title

## Military News — Browser Only
URL: `https://mil.news.sina.com.cn/`

- The `rollxml` API is deprecated (returns "页面没有找到")
- `browser_navigate` + `browser_snapshot` extracts the JS-rendered news list
- Dates appear as "今天 HH:MM" or "6月9日 HH:MM" (not ISO format)
- Headings are in `<h3>` elements, extract via `browser_console` or snapshot refs

## Sina Article URLs — Common Failure Pattern

Many Sina article URLs (especially tech/shenji and similar sub-sections) return **"页面没有找到"** even when the article exists in search results.

**Workaround**: When `web_extract` or `curl` returns "页面没有找到" for a Sina URL:
1. Use `web_search(query="site:mil.news.sina.com.cn 2026年6月12日 军事")` to find the correct URL
2. Alternative: search for the article title to find an archived or alternative URL
3. The correct military article URLs often follow: `https://mil.news.sina.com.cn/zonghe/2026-06-12/doc-xxxxx.shtml` (zonghe subdirectory)

**Verified working military URL pattern** (2026-06-13 session):
- `https://mil.news.sina.com.cn/zonghe/2026-06-12/doc-inicazrx3620480.shtml`
- `https://mil.news.sina.com.cn/zonghe/2026-06-12/doc-inicazrz0384635.shtml`
- `https://mil.news.sina.com.cn/zonghe/2026-06-12/doc-iniccfxv3530472.shtml`
- `https://mil.news.sina.com.cn/zonghe/2026-06-12/doc-inicazrz0383785.shtml`

## Article Content Extraction
```python
import subprocess, re
result = subprocess.run(['curl', '-s', '--max-time', '15', URL,
    '-H', 'User-Agent: Mozilla/5.0'], capture_output=True, text=True, timeout=20)
text = result.stdout  # may be bytes
paras = re.findall(r'<p[^>]*>([^<]+)</p>', text)
article = ' '.join(p.strip() for p in paras if len(p.strip()) > 30)
```

**Encoding**: Sina uses GB2312 on some pages — decode with `errors='ignore'`.

## Date Conversion (Unix → readable)
```python
from datetime import datetime
dt = datetime.fromtimestamp(int(ctime)).strftime('%Y-%m-%d %H:%M')
```

## Firecrawl API — Date Filtering Limitations

Firecrawl API (`/v2/search`) does **NOT** reliably filter by date. Searching for "2026年6月13日" often returns articles from 2026-06-11 or earlier. Use Sina Feed API as the **primary** news source for current-day content.

## Tested & Confirmed Working (2026-06-13)
- Finance API (lid=2516): ✅
- Tech API (lid=2515): ✅
- Military browser (mil.news.sina.com.cn): ✅
- Article extraction: ⚠️ Many URLs return "页面没有找到" — use web search fallback
- Firecrawl date filtering: ❌ Not reliable — prefer Sina Feed API
- Lid 2517 for military: ❌ Returns finance content
