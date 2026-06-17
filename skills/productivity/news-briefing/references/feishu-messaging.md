# Feishu 即时消息发送参考

## 认证

```python
import json, urllib.request

APP_ID = "cli_YOUR_APP_ID"
APP_SECRET = "ziZAkavTw4sa7DHJCblBuewhNpUFpwv2"

def get_token():
    data = json.dumps({"app_id": APP_ID, "app_secret": APP_SECRET}).encode("utf-8")
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
        return result.get("tenant_access_token")
```

## 发送文本消息

```python
def send_text(token, text, receive_id):
    """receive_id_type = chat_id"""
    msg = {
        "receive_id": receive_id,
        "msg_type": "text",
        "content": json.dumps({"text": text})
    }
    data = json.dumps(msg).encode("utf-8")
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

# 成功响应: {"code": 0, "msg": "success", "data": {"message_id": "om_xxx"}}
```

## 查询可用群聊

```python
def list_chats(token):
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/chat/v4/list",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

# 返回: {"code": 0, "data": {"groups": [{"chat_id": "...", "name": "..."}]}}
```

## 常用 chat_id

| 群名 | chat_id |
|------|---------|
| 助手群 | `oc_YOUR_CHAT_ID` |

## 长消息分片

飞书单条消息有长度限制，长简报应分成多条发送：

```python
import time

sections = ["第1段内容...", "第2段内容...", "第3段内容..."]
for section in sections:
    send_text(token, section, chat_id)
    time.sleep(0.5)  # 避免频率限制
```

## 常见错误码

| code | 说明 |
|------|------|
| 0 | 成功 |
| 400 | 请求参数错误，检查 content 格式（需 JSON 字符串） |
| 401 | token 无效或过期，重新 get_token() |
| 404 | 群聊不存在或 Bot 不在群中 |
| 9499 | 参数类型错误，如 content 未用 json.dumps 包装 |
