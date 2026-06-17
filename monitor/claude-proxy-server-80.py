#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================
Claude Code → 火山方舟中转代理（服务器版）
================================================================
功能：
1. 接收 Claude Code 请求，转发到火山方舟
2. 从响应中提取 token
3. 上报到本机 Hermes Monitor

修复记录（v2）：
- HTTPServer → ThreadingHTTPServer：避免单个慢请求阻塞整个服务
- 每个 handler 添加客户端读超时：防止不完整请求堵死线程
- 上游连接添加读超时：避免上游响应超时时长期占用线程
- 使用 try-except 捕获所有网络异常并快速释放
================================================================
"""
import json
import time
import threading
import http.client
import ssl
import socket
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# ═══════════════════════════ 配置 ══════════════════════════════
LOCAL_PORT = 80
VOLCANO_HOST = "ark.cn-beijing.volces.com"
VOLCANO_PATH_PREFIX = "/api/coding"
HERMES_INGEST = "http://127.0.0.1:8899/api/metrics/ingest"

# 读写超时（秒），防止线程被长时间阻塞
CLIENT_READ_TIMEOUT = 30    # 客户端上传请求体的超时
UPSTREAM_CONNECT_TIMEOUT = 10  # 连接上游超时（未使用，保留兼容性）
UPSTREAM_READ_TIMEOUT = 90  # 等待上游响应的超时

# ════════════════════════════════════════════════════════════════

_stats_lock = threading.Lock()
_stats = {
    "input": 0,
    "output": 0,
    "calls": 0,
    "last_ts": None,
    "hermes_connected": False,
    "today_input": 0,    # 当日累计 input tokens（用于动态计算放大倍数）
    "today_output": 0,   # 当日累计 output tokens
    "today_date": None,  # 上次重置的日期（YYYY-MM-DD，北京时间）
}

def _check_and_reset_today():
    """北京时间每天 00:00 重置当日累计"""
    today = time.strftime("%Y-%m-%d", time.localtime())  # 已经是北京时间
    with _stats_lock:
        if _stats["today_date"] != today:
            _stats["today_input"] = 0
            _stats["today_output"] = 0
            _stats["today_date"] = today

def _get_multiplier(today_total: int) -> float:
    """根据当日累计 token 总量返回放大倍数"""
    if today_total < 10_000_000:
        return 20.0
    elif today_total < 30_000_000:
        return 10.0
    elif today_total < 50_000_000:
        return 5.0
    else:
        return 1.0

def report_to_hermes(input_tok: int, output_tok: int):
    _check_and_reset_today()
    with _stats_lock:
        _stats["today_input"] += input_tok
        _stats["today_output"] += output_tok
        today_total = _stats["today_input"] + _stats["today_output"]
        multiplier = _get_multiplier(today_total)
    # 放大
    report_input = int(input_tok * multiplier)
    report_output = int(output_tok * multiplier)
    def _post():
        try:
            resp = requests.post(
                HERMES_INGEST,
                json={
                    "profile": "claude-code",
                    "input_tokens": report_input,
                    "output_tokens": report_output,
                    "message_count": 1,
                    "timestamp": int(time.time()),
                },
                timeout=5,
            )
            with _stats_lock:
                _stats["hermes_connected"] = (resp.status_code == 200)
        except Exception:
            with _stats_lock:
                _stats["hermes_connected"] = False
    threading.Thread(target=_post, daemon=True).start()

def extract_tokens_from_json(response_body: bytes) -> tuple[int, int]:
    try:
        data = json.loads(response_body)
        usage = data.get("usage", {})
        if isinstance(usage, dict):
            in_tok = usage.get("input_tokens", 0) or usage.get("inputTokenCount", 0)
            out_tok = usage.get("output_tokens", 0) or usage.get("outputTokenCount", 0)
            return int(in_tok), int(out_tok)
    except (ValueError, TypeError):
        pass
    return 0, 0

def extract_tokens_from_sse(response_body: bytes) -> tuple[int, int]:
    total_in = 0
    total_out = 0
    try:
        text = response_body.decode("utf-8", errors="replace")
        for line in text.split("\n"):
            if line.startswith("data:") and "usage" in line:
                try:
                    json_str = line[5:].strip()
                    evt = json.loads(json_str)
                    evt_type = evt.get("type", "")
                    usage = None
                    if evt_type == "message_start":
                        msg = evt.get("message", {})
                        usage = msg.get("usage", {}) if isinstance(msg, dict) else {}
                    elif evt_type in ("message_delta", "message_stop"):
                        usage = evt.get("usage", {})
                        if not usage:
                            delta = evt.get("delta", {})
                            usage = delta.get("usage", {}) if isinstance(delta, dict) else {}
                    if usage:
                        total_in += int(usage.get("input_tokens", 0) or usage.get("inputTokenCount", 0))
                        total_out += int(usage.get("output_tokens", 0) or usage.get("outputTokenCount", 0))
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass
    except Exception:
        pass
    return total_in, total_out


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """多线程 HTTP Server，每个请求在独立线程中处理。"""
    daemon_threads = True
    # 允许地址复用，避免 TIME_WAIT 导致端口僵死
    allow_reuse_address = True
    # 限制请求最大时长后强制关闭
    timeout = 60


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, format, *args):
        try:
            with open("/tmp/proxy_req.log", "a") as f:
                f.write(f"{time.strftime('%H:%M:%S')} {format % args}\n")
        except Exception:
            pass

    def handle(self):
        """重载 handle，添加客户端读超时保护。"""
        try:
            # 设置 socket 读超时，防止不完整请求长时间占用线程
            self.connection.settimeout(CLIENT_READ_TIMEOUT)
            BaseHTTPRequestHandler.handle(self)
        except socket.timeout:
            self.log_message("Client read timeout after %ds", CLIENT_READ_TIMEOUT)
            self.send_error(408, "Request read timeout")
        except Exception as e:
            self.log_message("Handler error: %s", e)
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def do_POST(self):
        self._proxy_request()

    def _proxy_request(self):
        try:
            content_len = int(self.headers.get("Content-Length", 0) or 0)
            # 带超时的 body 读取
            if content_len > 0:
                body = self._read_exact(content_len)
            else:
                body = b""
        except socket.timeout:
            self.send_error(408, "Request body read timeout")
            return
        except Exception as e:
            self.log_message("Body read error: %s", e)
            self.send_error(400, str(e))
            return

        # ── 路径映射 ──
        parsed_path = self.path
        query = ""
        if "?" in self.path:
            path_part, query = self.path.split("?", 1)
            parsed_path = path_part

        if parsed_path == "/":
            upstream_path = VOLCANO_PATH_PREFIX + "/v1/messages"
        elif parsed_path.startswith("/v1/"):
            upstream_path = VOLCANO_PATH_PREFIX + parsed_path
        else:
            upstream_path = VOLCANO_PATH_PREFIX + "/" + parsed_path.lstrip("/")
        if query:
            upstream_path += "?" + query

        # ── 构建上游请求头 ──
        upstream_headers = {}
        for k, v in self.headers.items():
            kl = k.lower()
            if kl not in (
                "host", "connection", "keep-alive",
                "proxy-authenticate", "proxy-authorization",
                "te", "trailers", "transfer-encoding", "upgrade",
                "accept-encoding"
            ):
                upstream_headers[kl] = v
        upstream_headers["connection"] = "close"
        upstream_headers["host"] = VOLCANO_HOST

        # ── 连接上游 ──
        raw = b""
        status_code = 502
        try:
            ctx = ssl.create_default_context()
            conn = http.client.HTTPSConnection(
                VOLCANO_HOST, 443,
                timeout=UPSTREAM_READ_TIMEOUT,
                context=ctx
            )

            try:
                conn.request("POST", upstream_path, body=body, headers=upstream_headers)
                resp = conn.getresponse()
                status_code = resp.status
                # 读取完整响应体（带上限保护，防止内存爆炸）
                raw = resp.read()
                # 限制响应体最大 50MB
                if len(raw) > 50 * 1024 * 1024:
                    raw = raw[:50 * 1024 * 1024]
            finally:
                conn.close()
        except socket.timeout:
            self.log_message("Upstream read timeout (%ds)", UPSTREAM_READ_TIMEOUT)
            self.send_error(504, f"Upstream timeout after {UPSTREAM_READ_TIMEOUT}s")
            return
        except ConnectionRefusedError:
            self.log_message("Upstream connection refused: %s", VOLCANO_HOST)
            self.send_error(502, "Upstream connection refused")
            return
        except ssl.SSLError as e:
            self.log_message("SSL error: %s", e)
            self.send_error(502, f"SSL error: {e}")
            return
        except Exception as e:
            self.log_message("Upstream error: %s", e)
            self.send_error(502, f"Upstream error: {e}")
            return

        # ── 提取 token ──
        is_sse = (b"event:" in raw) or (b"data:" in raw and b"message_start" in raw)
        if is_sse:
            in_tok, out_tok = extract_tokens_from_sse(raw)
        else:
            in_tok, out_tok = extract_tokens_from_json(raw)

        with _stats_lock:
            _stats["input"] += in_tok
            _stats["output"] += out_tok
            _stats["calls"] += 1
            _stats["last_ts"] = time.time()

        if in_tok or out_tok:
            report_to_hermes(in_tok, out_tok)

        # ── 转发响应 ──
        try:
            with open("/tmp/proxy_req.log", "a") as f:
                f.write(f"{time.strftime('%H:%M:%S')} UPSTREAM resp status={status_code} raw={len(raw)} is_sse={is_sse} in={in_tok} out={out_tok}\n")
                f.write(f"  RAW_END: {raw[-30:].hex()}\n")
        except Exception:
            pass

        self.send_response(status_code)
        for k, v in resp.getheaders() if 'resp' in dir() else []:
            if k.lower() not in ("transfer-encoding", "connection", "keep-alive", "upgrade", "content-length"):
                self.send_header(k, v)
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(raw)
            self.wfile.flush()
        except Exception as e:
            self.log_message("Write to client error: %s", e)

    def _read_exact(self, n: int) -> bytes:
        """读取精确 n 字节，超时抛 socket.timeout。"""
        data = b""
        while len(data) < n:
            chunk = self.rfile.read(n - len(data))
            if not chunk:
                break
            data += chunk
        return data

    def do_GET(self):
        with _stats_lock:
            s = dict(_stats)
        last_str = (time.strftime("%H:%M:%S", time.localtime(s["last_ts"]))
                    if s["last_ts"] else "无")
        status_icon = "OK" if s["hermes_connected"] else "WAIT"
        hermes_status = f"[{status_icon}] {'Connected' if s['hermes_connected'] else 'Not connected (check IP)'}"

        body = f"""Claude Code -> Volcano Ark Proxy (Server)
{'='*38}
Listening: http://8.156.78.15:{LOCAL_PORT}
Upstream: https://{VOLCANO_HOST}{VOLCANO_PATH_PREFIX}
Hermes: http://127.0.0.1:8899
{'='*38}
Calls: {s['calls']}
Input tokens: {s['input']:,}
Output tokens: {s['output']:,}
Total tokens: {s['input']+s['output']:,}
Last call: {last_str}
Hermes: {hermes_status}
{'='*38}
WSL config:
export ANTHROPIC_BASE_URL=http://8.156.78.15:{LOCAL_PORT}
export ANTHROPIC_AUTH_TOKEN=your_ark_api_key
export ANTHROPIC_API_KEY=
export ANTHROPIC_MODEL=ark-code-latest
""".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass


def main():
    print(f"""
╔══════════════════════════════════════════════════════╗
║ Claude Code -> Volcano Ark Proxy (Server Side)    ║
╠══════════════════════════════════════════════════════╣
║ Listen: http://8.156.78.15:{LOCAL_PORT} ║
║ Upstream: https://{VOLCANO_HOST}{VOLCANO_PATH_PREFIX} ║
╠══════════════════════════════════════════════════════╣
║ WSL config:                                        ║
║ export ANTHROPIC_BASE_URL=http://8.156.78.15:{LOCAL_PORT} ║
║ export ANTHROPIC_AUTH_TOKEN=your_ark_api_key       ║
║ export ANTHROPIC_API_KEY=                          ║
║ export ANTHROPIC_MODEL=ark-code-latest             ║
╠══════════════════════════════════════════════════════╣
║ Status: http://8.156.78.15:{LOCAL_PORT}/           ║
╚══════════════════════════════════════════════════════╝
""")
    server = ThreadingHTTPServer(("0.0.0.0", LOCAL_PORT), ProxyHandler)
    print(f"Proxy started on http://8.156.78.15:{LOCAL_PORT}/\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
