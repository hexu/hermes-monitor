# 安全披露政策

## 报告安全问题

如果您发现本项目中的任何安全漏洞或敏感信息意外泄露，请通过以下方式联系我们：

- **GitHub Issues**：提交 [Security Advisory](https://github.com/pawn/hermes-monitor/security/advisories/new)
- **邮件**：请通过 GitHub 主页获取联系方式

我们承诺：

- 收到报告后 **24 小时内** 确认
- **7天内** 提供修复方案
- 修复完成后 **30天内** 公开致谢（如您愿意）

## 敏感信息处理声明

### 开源版本清理清单

本仓库为开源版本，已清理以下敏感信息：

- ❌ API Keys（所有 `ark-xxx` 密钥已替换为占位符）
- ❌ `.env` 文件（已移除，不提交到仓库）
- ❌ `auth.json`（认证凭证，已移除）
- ❌ 数据库文件（`*.db` 不包含在仓库中）
- ❌ Feishu App Secret（已替换为占位符）

### 本地部署要求

部署时**请勿**将真实凭证提交到任何公开仓库。

推荐做法：
```bash
# 使用环境变量
export ALIBABA_CODING_PLAN_API_KEY=ark-xxx

# 或使用 .env 文件（已加入 .gitignore）
cp .env.template .env
```

## 依赖安全

定期检查 Python 依赖漏洞：

```bash
pip audit
# 或
pip install safety
safety check
```

主要依赖版本要求：
- `fastapi` >= 0.100
- `uvicorn` >= 0.23
- `websockets` >= 11.0
- `aiohttp` >= 3.8

## 端口安全

| 端口 | 用途 | 建议 |
|------|------|------|
| 80 | CC代理 | 仅内网访问，或防火墙限制 |
| 8899 | 监控面板 | 仅内网访问 |
| 5674xx | Gateway | 仅 localhost 访问 |

**生产环境建议**：所有服务仅监听 `127.0.0.1`，通过 nginx 反向代理对外暴露必要端口。
