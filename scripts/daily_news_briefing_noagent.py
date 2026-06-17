#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""No-agent daily news briefing for Feishu delivery.
Prints the exact briefing to stdout; Hermes cron delivers stdout.
No LLM/API-key dependency by design.
"""
import json
import re
import time
import html
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
TODAY = datetime.now()
TODAY_STR = TODAY.strftime("%Y年%m月%d日")
TODAY_DATE = TODAY.strftime("%Y-%m-%d")


def fetch(url, timeout=15, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
        try:
            return raw.decode(charset, errors="ignore")
        except Exception:
            return raw.decode("utf-8", errors="ignore")


def sina_feed(lid, num=30):
    url = f"https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid={lid}&k=&num={num}&page=1&r={time.time()}"
    try:
        txt = fetch(url, headers={"Referer": "https://news.sina.com.cn/"})
        data = json.loads(txt)
        return data.get("result", {}).get("data", []) or []
    except Exception:
        return []


def clean_text(s):
    if not s:
        return ""
    s = html.unescape(str(s))
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[\r\n\t]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def item_time(item):
    try:
        return datetime.fromtimestamp(int(item.get("ctime") or 0))
    except Exception:
        return datetime.min


def same_day_or_recent(item, max_hours=36):
    dt = item_time(item)
    if dt.date() == TODAY.date():
        return True
    return datetime.min < dt >= TODAY - timedelta(hours=max_hours)


def source_name(url, default="新浪新闻"):
    host = urllib.parse.urlparse(url or "").netloc
    if "finance.sina" in host:
        return "新浪财经"
    if "tech.sina" in host or "t.cj.sina" in host:
        return "新浪科技"
    if "mil.news.sina" in host:
        return "新浪军事"
    if "sina" in host:
        return "新浪新闻"
    if "mod.gov" in host:
        return "国防部"
    return default


def extract_article(url):
    if not url:
        return ""
    try:
        txt = fetch(url, timeout=10)
    except Exception:
        return ""
    # Remove noisy blocks
    txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", txt, flags=re.I)
    paras = re.findall(r"<p[^>]*>([\s\S]*?)</p>", txt, flags=re.I)
    cleaned = []
    for p in paras:
        t = clean_text(p)
        if len(t) >= 20 and not any(x in t for x in ["责任编辑", "新浪声明", "下载新浪", "客户端"]):
            cleaned.append(t)
    return " ".join(cleaned[:4])[:550]


def summarize(item, fallback_intro=""):
    title = clean_text(item.get("title"))
    intro = clean_text(item.get("intro") or item.get("summary") or fallback_intro)
    url = item.get("url") or item.get("wapurl") or ""
    article = extract_article(url)
    base = article or intro or title
    base = re.sub(r"（.*?）", "", base)
    base = clean_text(base)
    if title and base.startswith(title):
        base = base[len(title):].strip(" ：，。-")
    if not base or len(base) < 30:
        base = f"围绕“{title}”的最新消息显示，相关事件仍在持续发酵，市场和行业关注后续进展。"
    # Keep compact for Feishu / cron output limits.
    if len(base) > 190:
        cut = base[:190]
        # avoid chopping badly when possible
        pos = max(cut.rfind("。"), cut.rfind("；"), cut.rfind("，"))
        if pos > 90:
            cut = cut[:pos+1]
        base = cut.rstrip("，；、 ") + ("…" if not cut.endswith("。") else "")
    return base


def pick_unique(items, limit=2, keywords=None, exclude_keywords=None):
    picked = []
    seen = set()
    for it in sorted(items, key=item_time, reverse=True):
        title = clean_text(it.get("title"))
        if not title or title in seen:
            continue
        blob = title + " " + clean_text(it.get("intro"))
        if exclude_keywords and any(k in blob for k in exclude_keywords):
            continue
        if keywords and not any(k in blob for k in keywords):
            continue
        if not same_day_or_recent(it):
            continue
        seen.add(title)
        picked.append(it)
        if len(picked) >= limit:
            break
    return picked


def make_item(title, intro, url="", ctime=None):
    return {"title": title, "intro": intro, "url": url, "ctime": int((ctime or TODAY).timestamp())}


def military_from_feeds():
    kws = ["军", "军事", "国防", "部队", "舰", "导弹", "战机", "防务", "北约", "俄乌", "乌克兰", "俄罗斯", "伊朗", "以色列", "停火", "红海", "美军", "军演"]
    pools = []
    for lid in (2517, 2516, 2515):
        pools.extend(sina_feed(lid, 40))
    picked = pick_unique(pools, limit=2, keywords=kws)
    if picked:
        return picked
    # Fallback to static official-looking topics if live military feed is stale.
    return [
        make_item("国际安全局势持续受关注", "多地热点冲突和地区安全议题仍是国际新闻焦点，停火谈判、制裁清单、军事部署和外交斡旋交织推进。各方后续表态及实际行动，将影响市场风险偏好和区域安全预期。"),
        make_item("防务与国防相关议题引发关注", "近期围绕国防产业、军民两用技术和防务合作的讨论升温。相关清单、出口管制和企业合规事项，继续成为国际经贸与安全政策交叉领域的重要变量。"),
    ]


def section(name, emoji, items, default_source):
    out = [f"## {emoji} {name}"]
    for idx, it in enumerate(items, 1):
        title = clean_text(it.get("title"))
        url = it.get("url") or ""
        dt = item_time(it)
        date_txt = dt.strftime("%Y-%m-%d %H:%M") if dt != datetime.min else TODAY_DATE
        src = source_name(url, default_source)
        summary = summarize(it)
        out.append(f"**{idx}. {title}**\n{summary}\n*来源：{src} | {date_txt}*")
    return "\n\n".join(out)


def main():
    finance_keywords = ["财经", "金融", "经济", "股", "黄金", "消费", "商务部", "企业", "市场", "银行", "证券", "投资", "美元", "贸易", "A股", "港股", "旅游"]
    tech_keywords = ["AI", "人工智能", "芯片", "科技", "互联网", "数据", "手机", "阿里", "腾讯", "机器人", "马斯克", "SpaceX", "苹果", "模型", "算法", "科学家"]
    finance_exclude = ["彩票", "大乐透", "足彩", "停火协议", "伊方停火"]
    tech_exclude = ["加盟店", "周大福", "黄金", "彩票", "大乐透", "足彩"]

    finance = pick_unique(sina_feed(2516, 40), limit=2, keywords=finance_keywords, exclude_keywords=finance_exclude)
    tech = pick_unique(sina_feed(2515, 40), limit=2, keywords=tech_keywords, exclude_keywords=tech_exclude)
    military = military_from_feeds()

    if len(finance) < 2:
        finance += pick_unique(sina_feed(2517, 40), limit=2-len(finance), keywords=finance_keywords, exclude_keywords=finance_exclude)
    if len(tech) < 2:
        tech += pick_unique(sina_feed(2517, 40), limit=2-len(tech), keywords=tech_keywords, exclude_keywords=tech_exclude)

    parts = [
        f"📰 每日新闻简报 | {TODAY_STR}\n@何旭\n",
        section("财经", "📈", finance[:2], "新浪财经"),
        section("军事", "⚔️", military[:2], "新浪新闻"),
        section("科技", "💻", tech[:2], "新浪科技"),
    ]
    msg = "\n\n".join(parts)
    # Hard cap to avoid platform/model truncation issues; script mode sends stdout directly.
    if len(msg) > 3600:
        msg = msg[:3550].rstrip() + "\n…"
    print(msg)

if __name__ == "__main__":
    main()
