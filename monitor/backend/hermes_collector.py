"""
Hermes State Collector
扫描 ~/.hermes/profiles/{default,pm,tech} 的 state.db 和 session_*.json
返回各分身的状态、消息数、token 数、工具调用数、当前模型等数据
"""
from datetime import datetime, timedelta
import os
import sqlite3
import json
import glob
import time
from pathlib import Path

HERMES_HOME = Path("/root/.hermes")
STATE_DB = HERMES_HOME / "state.db"
PROFILES_DIR = HERMES_HOME / "profiles"

PROFILES_DIR = HERMES_HOME / "profiles"


def _discover_profiles():
    """动态扫描 profiles 目录，自动发现所有分身"""
    profiles = ["default"]  # default profile 直接在 ~/.hermes/
    subdir = PROFILES_DIR
    if subdir.exists():
        for d in sorted(subdir.iterdir()):
            if d.is_dir() and d.name not in ("default", "shared", "skills", "scripts", ":q"):
                profiles.append(d.name)
    return profiles


PROFILES = _discover_profiles()

def _norm_model(name):
    """统一模型名称格式"""
    if not name or name == "unknown":
        return name
    n = name.lower()
    if "minimax" in n:
        return "MiniMax-M2.7"
    if "qwen" in n and "vl" in n:
        return "Qwen-VL-Max"
    if "qwen" in n:
        return "Qwen-Max"
    return name  # 其他保持原样


def _get_gateway_status(profile):
    """检查 gateway 是否在跑"""
    pid_file = PROFILES_DIR / profile / "gateway.pid" if profile != "default" else HERMES_HOME / "gateway.pid"
    if not os.path.exists(pid_file):
        return False
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def _find_latest_session_default():
    """default profile: 从 /root/.hermes/state.db 读取 + 从 config.yaml 读取当前模型"""
    if not STATE_DB.exists():
        return None
    try:
        conn = sqlite3.connect(str(STATE_DB))
        cur = conn.cursor()
        # 最新 session
        cur.execute("""
            SELECT id, message_count, tool_call_count,
                   input_tokens, output_tokens, reasoning_tokens,
                   model, started_at
            FROM sessions ORDER BY id DESC LIMIT 1
        """)
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        sid, msg, calls, it, ot, rt, model, started = row

        # Lifetime 聚合
        cur.execute("""
            SELECT SUM(message_count), SUM(tool_call_count),
                   SUM(input_tokens+output_tokens+COALESCE(reasoning_tokens,0))
            FROM sessions
        """)
        lt_msg, lt_calls, lt_tokens = cur.fetchone()

        # 最新消息时间
        try:
            cur.execute("SELECT MAX(timestamp) FROM messages")
            last_msg_ts = cur.fetchone()[0]
        except Exception:
            last_msg_ts = started

        conn.close()

        # 优先从 config.yaml 读取当前模型（state.db 里的 model 可能是旧值）
        try:
            cfg_path = HERMES_HOME / "config.yaml"
            if cfg_path.exists():
                with open(cfg_path) as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("default:") and "model" not in line:
                            cur_model = line.split(":", 1)[1].strip()
                            if cur_model:
                                model = cur_model
                            break
        except Exception:
            pass

        return {
            "session_id": sid,
            "message_count": lt_msg or 0,
            "tool_call_count": lt_calls or 0,
            "total_tokens": lt_tokens or 0,
            "last_active": last_msg_ts or started,
            "metadata": {"model": model or "unknown"},
        }
    except Exception as e:
        print(f"[collector] default error: {e}")
        return None


def _find_latest_session_from_profile_db(profile):
    """pm/tech: 从 ~/.hermes/profiles/{profile}/state.db 读取 lifetime 数据"""
    db = PROFILES_DIR / profile / "state.db"
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(str(db))
        cur = conn.cursor()
        cur.execute("""
            SELECT id, message_count, tool_call_count, model, started_at
            FROM sessions ORDER BY started_at DESC LIMIT 1
        """)
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        sid, msg, calls, model, started = row

        cur.execute("""
            SELECT SUM(message_count), SUM(tool_call_count),
                   SUM(input_tokens+output_tokens+COALESCE(reasoning_tokens,0))
            FROM sessions
        """)
        lt_msg, lt_calls, lt_tokens = cur.fetchone()
        conn.close()

        result = {
            "session_id": sid,
            "message_count": lt_msg or 0,
            "tool_call_count": lt_calls or 0,
            "total_tokens": lt_tokens or 0,
            "last_active": started,
            "metadata": {"model": model or "unknown"},
            "lt_input_tokens": True,
        }

        # 覆盖 model 为 session_*.json 中的最新值
        try:
            sess_dir = PROFILES_DIR / profile / "sessions"
            if sess_dir.exists():
                files = list(sess_dir.glob("session_*.json"))
                if files:
                    latest_file = max(files, key=lambda p: p.stat().st_mtime)
                    with open(latest_file) as f:
                        sj = json.load(f)
                    cur_model = sj.get("model")
                    if cur_model:
                        result["metadata"]["model"] = cur_model
                    # 用 mtime 作为 last_active（更准）
                    result["last_active"] = datetime.fromtimestamp(latest_file.stat().st_mtime).isoformat()
        except Exception:
            pass

        return result
    except Exception as e:
        print(f"[collector] {profile} error: {e}")
        return None


def _find_latest_session(profile):
    if profile == "default":
        return _find_latest_session_default()
    return _find_latest_session_from_profile_db(profile)


def _derive_status_location(profile, sess):
    """根据 session 数据推断状态和位置（按时间判断，不依赖 gateway PID）"""
    if not sess or not sess.get("last_active"):
        return "idle", "couch"

    # 解析 last_active
    try:
        la = sess["last_active"]
        if isinstance(la, (int, float)):
            la_dt = datetime.fromtimestamp(la)
        else:
            la_dt = datetime.fromisoformat(str(la).replace("Z", "+00:00").split("+")[0])
        now = datetime.now()
        idle_secs = (now - la_dt).total_seconds()
    except Exception:
        idle_secs = 9999

    if idle_secs < 60:
        return "working", "workstation"
    if idle_secs < 300:
        return "thinking", "workstation"
    return "sleeping", "bedroom"




def _parse_dt(value):
    """Parse Hermes timestamps defensively. Returns naive local datetime or None."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value)
        txt = str(value).strip()
        if not txt or txt == 'N/A':
            return None
        return datetime.fromisoformat(txt.replace('Z', '+00:00').split('+')[0])
    except Exception:
        return None


def _profile_db_path(profile):
    return STATE_DB if profile == 'default' else PROFILES_DIR / profile / 'state.db'


def _daily_message_stats(cur, today_start, now):
    """Count today's messages from the messages table.

    Hermes does NOT store tool result messages in the messages table, so tool_call_count
    comes from the sessions table (which IS updated in real-time by Hermes API).
    This function only returns message counts; token counts use sessions tokens.
    """
    today_ts = today_start.timestamp()
    now_ts = now.timestamp()
    try:
        cur.execute(
            "SELECT COUNT(*) FROM messages WHERE timestamp >= ? AND timestamp <= ?",
            (today_ts, now_ts))
        msg_row = cur.fetchone()
        msg_count = msg_row[0] if msg_row else 0
        return msg_count
    except Exception:
        return 0


def _daily_active_minutes(cur, today_start, now):
    """Calculate today's active minutes from session message timestamps.

    Uses message timestamps (from the messages table) to determine when a session
    was actually active today, rather than wall-clock session duration.

    Algorithm:
    - Collect all message timestamps from today for this profile
    - Sort them; sum gaps between consecutive messages
    - Cap each gap at MAX_GAP_SECONDS (300s = 5 min) to avoid counting
      long idle periods as active time
    - Add first message time from session start (if session started today)
    - Cap total at MAX_DAILY_MINUTES (480 min = 8h) for reasonability

    This gives a realistic "hands-on-keyboard" estimate rather than
    counting entire session duration including sleep/meetings/lunch.
    """
    today_ts = today_start.timestamp()
    now_ts = now.timestamp()
    MAX_GAP_SECONDS = 300   # 5 min max between messages to count as active
    MAX_DAILY_MINUTES = 480  # 8 hour daily cap

    try:
        # Get message timestamps for today (these prove actual activity)
        cur.execute("""
            SELECT timestamp FROM messages
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp
        """, (today_ts, now_ts))
        msg_times = [row[0] for row in cur.fetchall() if row[0]]

        if not msg_times:
            return 0

        # Sum realistic active gaps between messages
        total = 0.0
        prev = None
        for t in msg_times:
            if prev is not None:
                gap = t - prev
                total += min(gap, MAX_GAP_SECONDS)
            prev = t

        # Add final gap from last message to now (cap at MAX_GAP)
        if msg_times:
            total += min(now_ts - msg_times[-1], MAX_GAP_SECONDS)

        # Cap at reasonability limit
        return min(int(total // 60), MAX_DAILY_MINUTES)

    except Exception:
        # Fallback: session overlap method (with reasonable cap)
        try:
            cur.execute("""
                SELECT started_at, COALESCE(ended_at, ?)
                FROM sessions
                WHERE ended_at IS NULL AND started_at < ?
            """, (now_ts, today_ts - 86400))
            # zombie sessions excluded

            cur.execute("""
                SELECT started_at, COALESCE(ended_at, ?)
                FROM sessions
                WHERE NOT (ended_at IS NULL AND started_at < ?)
            """, (now_ts, today_ts - 86400))
        except Exception:
            return 0

        total = 0.0
        for started, ended in cur.fetchall():
            eff_start = max(started, today_ts)
            eff_end = min(ended or now_ts, now_ts)
            if eff_end > eff_start:
                total += eff_end - eff_start

        return min(int(total // 60), MAX_DAILY_MINUTES)


def _daily_metrics_for_profile(profile, today_start, now):
    """Aggregate today's metrics from the profile state.db without changing schema."""
    db = _profile_db_path(profile)
    base = {
        'profile': profile,
        'today_messages': 0,
        'today_tokens': 0,
        'today_input_tokens': 0,
        'today_output_tokens': 0,
        'today_reasoning_tokens': 0,
        'today_tool_calls': 0,
        'latest_started_at': None,
        'active_minutes_today': 0,
        'status_duration_seconds': None,
        'last_active': None,
    }
    if not db.exists():
        base['error'] = 'state.db not found'
        return base
    try:
        conn = sqlite3.connect(str(db))
        cur = conn.cursor()

        # Messages from messages table
        today_msg = _daily_message_stats(cur, today_start, now)

        # Active minutes from session durations
        active_minutes = _daily_active_minutes(cur, today_start, now)

        # Tokens, tool_calls, and latest_started from sessions
        cur.execute("""
            SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
                   COALESCE(SUM(COALESCE(reasoning_tokens,0)),0),
                   COALESCE(SUM(tool_call_count),0),
                   MAX(started_at)
            FROM sessions
            WHERE started_at >= ?
        """, (today_start.timestamp(),))
        tok_row = cur.fetchone()
        base['today_input_tokens'] = int(tok_row[0]) if tok_row else 0
        base['today_output_tokens'] = int(tok_row[1]) if tok_row else 0
        base['today_reasoning_tokens'] = int(tok_row[2]) if tok_row else 0
        base['today_tool_calls'] = int(tok_row[3]) if tok_row else 0
        base['latest_started_at'] = tok_row[4] if tok_row and tok_row[4] else None

        conn.close()
    except Exception as e:
        base['error'] = str(e)
        return base

    base['today_messages'] = today_msg
    base['today_tokens'] = base['today_input_tokens'] + base['today_output_tokens'] + base['today_reasoning_tokens']
    base['active_minutes_today'] = active_minutes
    return base


def _cron_metrics_from_output_files(today_start, now):
    """Parse cron output files to build a pseudo-profile for no_agent system cron jobs.

    These jobs run as scripts (no_agent=True) and do NOT create sessions in any DB.
    We reconstruct today's activity from /root/.hermes/cron/output/{job_id}/*.md files.

    Each file's stem encodes the execution start time: {YYYY-MM-DD_HH-MM-SS}.md
    File mtime = when the job finished writing its output.

    Returns:
        dict with keys: run_count, active_seconds, file_count (all-time)
    """
    import os
    from pathlib import Path
    from datetime import datetime as dt

    base = {
        "run_count": 0,
        "active_seconds": 0.0,
        "file_count": 0,
        "jobs_today": [],   # list of (job_id, run_dt) for display
    }

    cron_base = Path("/root/.hermes/cron/output")
    if not cron_base.exists():
        return base

    today_date = today_start.date()
    now_ts = now.timestamp()
    total_seconds = 0.0
    run_count = 0
    file_count = 0
    jobs_today = []

    for job_dir in cron_base.iterdir():
        if not job_dir.is_dir():
            continue
        job_id = job_dir.name
        for f in job_dir.glob("*.md"):
            file_count += 1
            fname = f.stem  # e.g. "2026-06-16_10-00-14"
            try:
                run_dt = dt.strptime(fname, "%Y-%m-%d_%H-%M-%S")
            except ValueError:
                # Fallback: use file mtime as job end time
                run_dt = dt.fromtimestamp(f.stat().st_mtime)

            if run_dt.date() != today_date:
                continue

            run_ts = run_dt.timestamp()
            end_ts = f.stat().st_mtime  # mtime = job completion time
            # Duration: no_agent jobs have unreliable mtime (file written after
            # script completes, not when LLM finished). Use minimum 60s per run
            # to indicate meaningful activity; cap at 300s for outlier safety.
            dur = min(300.0, max(60.0, end_ts - run_ts))
            total_seconds += dur
            run_count += 1
            jobs_today.append((job_id, run_dt.strftime("%H:%M:%S")))

    base["run_count"] = run_count
    base["active_seconds"] = total_seconds
    base["file_count"] = file_count
    base["jobs_today"] = jobs_today
    return base


def collect_daily_metrics():
    """Collect per-profile daily metrics visible to Hermes Monitor.

    Includes:
    - All profiles from state.db (default, pm, tech)
    - Cron job activity from output files is attributed to 'default' (AI助手)
    """
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    state = collect()
    state_by_profile = {p.get("profile"): p for p in state.get("profiles", [])}
    profiles = []

    for profile in _discover_profiles():
        item = _daily_metrics_for_profile(profile, today_start, now)
        live = state_by_profile.get(profile) or {}
        last_active = live.get("last_active")
        item["last_active"] = last_active
        la_dt = _parse_dt(last_active)
        if la_dt:
            item["status_duration_seconds"] = max(0, int((now - la_dt).total_seconds()))
        item["status"] = live.get("status")
        item["location"] = live.get("location")

        # Attribute today's cron job runs to the default (AI助手) profile.
        # These are assistant tasks (新闻/天气) that run as no_agent scripts
        # and do not create LLM sessions, so tokens=0 but runs should be visible.
        if profile == "default":
            cron_data = _cron_metrics_from_output_files(today_start, now)
            item["cron_run_count"] = cron_data["run_count"]
            item["cron_jobs_today"] = cron_data["jobs_today"]
            # no_agent scripts consume no LLM tokens; add run count as activity signal
            # active_minutes already reflects message-based hands-on time
            # If no session activity but cron ran, mark as working briefly
            if item["active_minutes_today"] == 0 and cron_data["run_count"] > 0:
                item["active_minutes_today"] = max(
                    item["active_minutes_today"],
                    int(cron_data["run_count"] * 1)  # 1 min per cron run
                )

        profiles.append(item)

    return {
        "date": today_start.date().isoformat(),
        "generated_at": now.isoformat(),
        "profiles": profiles,
    }


def collect():
    """收集所有分身的状态"""
    profiles = []
    for p in PROFILES:
        sess = _find_latest_session(p)
        status, location = _derive_status_location(p, sess)
        item = {
            "profile": p,
            "status": status,
            "location": location,
            "message_count": (sess or {}).get("message_count", 0),
            "tool_call_count": (sess or {}).get("tool_call_count", 0),
            "total_tokens": (sess or {}).get("total_tokens", 0),
            "last_active": (sess or {}).get("last_active") or "N/A",
            "current_tool": None,
            "metadata": (sess or {}).get("metadata", {"model": "unknown"}),
            "_raw_model": True,
        }
        # 标准化模型名称
        if item["metadata"].get("model"):
            item["metadata"]["model"] = _norm_model(item["metadata"]["model"])
        profiles.append(item)

    return {
        "ts": datetime.now().isoformat(),
        "profiles": profiles,
    }


if __name__ == "__main__":
    import json as _j
    print(_j.dumps(collect(), indent=2, ensure_ascii=False, default=str))
