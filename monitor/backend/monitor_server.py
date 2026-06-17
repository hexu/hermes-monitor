"""
Hermes Monitor Server
FastAPI + WebSocket，监听 8899，提供：
- GET /            → index.html
- GET /static/*    → 前端资源
- GET /health      → 健康检查
- GET /api/state   → 当前状态 JSON
- WS  /ws          → 实时推送（每3秒）
"""
import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from hermes_collector import collect, collect_daily_metrics

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Hermes Monitor")
app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

# ── Laptop / 外部客户端指标内存缓存 ──────────────────────────────────────
# key: profile name (e.g. "laptop") → dict of accumulated metrics
_metrics_file = ROOT / "external_metrics.json"

def _today_date() -> str:
    """返回 'YYYY-MM-DD' 格式的今日日期字符串（北京时间）。"""
    import datetime
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")

def _reset_metrics_entry() -> dict:
    """返回一个当天的 metrics 条目。
    包含当日统计（按天重置）和历史累计（永不重置）。
    """
    return {
        "date": _today_date(),
        "today_input_tokens": 0,
        "today_output_tokens": 0,
        "today_tokens": 0,
        "today_message_count": 0,
        "today_tool_call_count": 0,
        # 历史累计（永不重置）
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_tokens": 0,
        "total_message_count": 0,
        "total_tool_call_count": 0,
        "last_active": None,
    }

def _ensure_fresh_metrics(profile: str) -> dict:
    """确保 _external_metrics[profile] 数据格式最新，有正确的累计字段。
    如果是旧格式 → 迁移历史数据。
    如果是新的一天 → 只重置今日计数器，保留历史累计。
    调用方负责写回（_save_external_metrics）。
    """
    import time
    today = _today_date()

    if profile not in _external_metrics:
        _external_metrics[profile] = _reset_metrics_entry()
        return _external_metrics[profile]

    m = _external_metrics[profile]

    # ── 升级迁移：旧格式没有 today_message_count/total_message_count 字段 ──
    # 旧格式特征：有 message_count 但无 today_message_count
    if "today_message_count" not in m:
        m["total_input_tokens"] = m.get("today_input_tokens", 0)
        m["total_output_tokens"] = m.get("today_output_tokens", 0)
        m["total_tokens"] = m.get("today_tokens", 0)
        m["total_message_count"] = m.get("message_count", 0)
        m["total_tool_call_count"] = m.get("tool_call_count", 0)
        # 删除旧字段
        m.pop("message_count", None)
        m.pop("tool_call_count", None)
        # 初始化今日字段
        m["today_message_count"] = m["total_message_count"]
        m["today_tool_call_count"] = m["total_tool_call_count"]

    # ── 新的一天：只重置今日，累计保留 ──
    if m.get("date") != today:
        m["date"] = today
        m["today_input_tokens"] = 0
        m["today_output_tokens"] = 0
        m["today_tokens"] = 0
        m["today_message_count"] = 0
        m["today_tool_call_count"] = 0

    return m

def _load_external_metrics() -> dict:
    """加载外部 metrics 文件。
    注意：这里只负责加载，不做日期校验（避免重启时误清）。
    日期校验在 _ensure_fresh_metrics() 中进行。
    """
    if _metrics_file.exists():
        try:
            return json.loads(_metrics_file.read_text())
        except Exception:
            pass
    return {}

def _save_external_metrics(data: dict):
    try:
        _metrics_file.write_text(json.dumps(data, indent=2))
    except Exception:
        pass

_external_metrics: dict = _load_external_metrics()

@app.post("/api/metrics/ingest")
async def ingest_metrics(body: dict):
    """接收外部客户端（Claude Code 等）上报的 token 使用量。

    Body: {
        "profile":  "laptop",
        "input_tokens":  1234,
        "output_tokens": 567,
        "timestamp": 1781577600,   # unix second，缺省用当前时间
        "message_count": 1,         # 可选
        "tool_call_count": 0       # 可选
    }
    """
    profile = str(body.get("profile", "laptop"))
    now_ts = int(body.get("timestamp", 0)) or int(__import__("time").time())

    # 按天重置检查：新的一天自动清零当日计数器，历史累计不动
    m = _ensure_fresh_metrics(profile)
    input_tok = max(0, int(body.get("input_tokens", 0)))
    output_tok = max(0, int(body.get("output_tokens", 0)))
    msg_cnt = max(0, int(body.get("message_count", 1)))
    tool_cnt = max(0, int(body.get("tool_call_count", 0)))

    # 今日
    m["today_input_tokens"]  += input_tok
    m["today_output_tokens"] += output_tok
    m["today_tokens"]         = m["today_input_tokens"] + m["today_output_tokens"]
    m["today_message_count"]  += msg_cnt
    m["today_tool_call_count"] += tool_cnt
    # 历史累计
    m["total_input_tokens"]   += input_tok
    m["total_output_tokens"]  += output_tok
    m["total_tokens"]          = m["total_input_tokens"] + m["total_output_tokens"]
    m["total_message_count"]  += msg_cnt
    m["total_tool_call_count"] += tool_cnt
    m["last_active"]           = now_ts

    _save_external_metrics(_external_metrics)
    return {"ok": True, "profile": profile, "date": m["date"], "today_tokens": m["today_tokens"]}


@app.get("/")
async def root():
    return FileResponse(str(FRONTEND / "index.html"))


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/state")
async def get_state():
    state = collect()
    # 注入 claude-code 外部上报分身
    if "claude-code" in _external_metrics:
        ext = _ensure_fresh_metrics("claude-code")
        last_ts = ext.get("last_active")
        now_ts = int(__import__("time").time())
        idle_sec = (now_ts - last_ts) if last_ts else 99999
        # idle < 5min → working, 5-30min → idle, > 30min → sleeping
        if idle_sec < 300:
            cc_status = "working"
        elif idle_sec < 1800:
            cc_status = "idle"
        else:
            cc_status = "sleeping"
        state["profiles"].append({
            "profile": "claude-code",
            "status": cc_status,
            "location": "laptop",
            "message_count": ext.get("total_message_count", 0),
            "tool_call_count": ext.get("total_message_count", 0),  # CC: 调用=消息
            "total_tokens": ext.get("total_tokens", 0),
            "input_tokens": ext.get("total_input_tokens", 0),
            "output_tokens": ext.get("total_output_tokens", 0),
            "today_tokens": ext.get("today_tokens", 0),
            "last_active": last_ts or "N/A",
            "current_tool": None,
            "_raw_model": True,
            "_is_claude_code": True,
            "_idle_seconds": idle_sec,
            "metadata": {"model": "MiniMax-M3"},
        })
    return JSONResponse(state)


@app.get("/api/metrics/daily")
async def get_daily_metrics():
    result = collect_daily_metrics()
    now_ts = int(__import__("time").time())
    # 注入外部客户端指标（claude-code 等）
    for ext_profile in list(_external_metrics.keys()):
        m = _ensure_fresh_metrics(ext_profile)
        last_ts = m.get("last_active")
        idle_sec = (now_ts - last_ts) if last_ts else 99999
        if idle_sec < 300:
            status = "working"
        elif idle_sec < 1800:
            status = "idle"
        else:
            status = "sleeping"
        # active_minutes: 基于 idle 时长估算（idle 越长说明越久没活动，活跃分钟取一个合理上限）
        # 思路：假设 claude-code 每次活跃持续 ~5min，idle 5min 内 → 活跃 5min；idle 每增加 1h，额外增加 10min
        if last_ts and idle_sec < 300:
            active_min = 5  # < 5min idle，说明刚活跃过，给 5min
        elif last_ts and idle_sec < 3600:
            active_min = max(1, int((idle_sec - 300) * 0.05))  # 5min~1h：少量活跃
        elif last_ts:
            active_min = max(1, min(120, int(idle_sec / 60 * 0.12)))  # > 1h：按 12% 估算
        else:
            active_min = 0
        result["profiles"].append({
            "profile": ext_profile,
            # 今日
            "today_tokens":         m["today_tokens"],
            "today_input_tokens":   m["today_input_tokens"],
            "today_output_tokens":  m["today_output_tokens"],
            "today_message_count":  m["today_message_count"],
            # CC工具不上报调用，调用数=消息数
            "today_tool_call_count": m["today_message_count"],
            # 历史累计
            "total_tokens":         m["total_tokens"],
            "total_input_tokens":   m["total_input_tokens"],
            "total_output_tokens":  m["total_output_tokens"],
            "total_message_count":  m["total_message_count"],
            "total_tool_call_count": m["total_message_count"],
            # 其他
            "active_minutes_today": active_min,
            "message_count":        m["total_message_count"],
            "tool_call_count":      m["total_message_count"],  # CC: 调用=消息
            "last_active":          last_ts,
            "status":               status,
            "location":             "laptop",
        })
    return JSONResponse(result)


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    try:
        # 立即推一次
        state = collect()
        _inject_external_profiles(state)
        await ws.send_text(json.dumps({"type": "state", "data": state}, default=str))
        while True:
            await asyncio.sleep(3)
            state = collect()
            _inject_external_profiles(state)
            await ws.send_text(json.dumps({"type": "state", "data": state}, default=str))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ws] error: {e}")


def _inject_external_profiles(state: dict):
    """把外部客户端（laptop）profile 注入到 metrics，但不注入到场景 profiles。

    PixelOffice 只处理 profiles[] 里的分身，无坐标的分身会乱放。
    因此 laptop 不进 profiles，只在右面板 metrics 里展示。
    """
    pass  # 不再注入 — laptop 的 state 在 server-panel.js 的 _tokenHistory 中独立管理


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8899, log_level="info")
