# Feishu API 凭证

> ⚠️ 如果 API 调用报 401，先检查这里的值是否和飞书开放平台一致。
> 最近更新：2026-06-12（App Secret 过期后重置）

## 当前有效凭证

| 项目 | 值 |
|------|-----|
| App ID | `cli_a96f565687789cd4` |
| App Secret | `ziZAkavTw4sa7DHJCblBuewhNpUFpwv2` |
| Spreadsheet Token | `KYghscfQth2isytvD39c7FQUn3c` |

## 验证命令

```bash
curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d '{"app_id": "cli_a96f565687789cd4", "app_secret": "ziZAkavTw4sa7DHJCblBuewhNpUFpwv2"}'
```

- ✅ 成功返回：`{"code":0, "tenant_access_token": "t-..."}`
- ❌ 失败返回：`{"code":10014, "msg":"app secret invalid"}` → Secret 已过期，需从飞书开放平台重置

## 凭证同步位置（必须同时更新）

1. `/root/.hermes/cron/send_weekly_report.py` 第12行 `app_secret = '...'`
2. Hermes memory 中的 App Secret 条目

## 常见 401 排查

| 错误信息 | 原因 | 解决 |
|---------|------|------|
| `app secret invalid` | App Secret 与 App ID 不匹配 | 重置 Secret |
| `invalid param` | 请求体格式错误 | 检查 JSON 格式 |
| Feishu Bot 聊天正常但 API 401 | 两套认证体系分开 | Bot 不依赖 App Secret，API 才依赖 |

## 飞书认证体系说明

- **飞书 Bot 消息**（Gateway WebSocket 长连接）：不依赖 App Secret，飞书服务器直接建立连接
- **飞书 REST API**（Sheets/文档/日历等）：必须用 tenant_access_token（通过 App ID + App Secret 换取）

这解释了为什么"飞书上能正常聊天但 cron job 报 401"。
