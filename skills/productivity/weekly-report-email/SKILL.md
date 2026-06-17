---
name: weekly-report-email
description: 从飞书表格读取周报数据（JAVA组），汇总整理后通过邮件发送
triggers:
  - "汇总周报"
  - "发送周报邮件"
  - "周报发送"
---

# 飞书周报汇总与邮件发送（JAVA组）

## 功能描述
从飞书电子表格读取周报数据（JAVA组），按表格格式汇总整理，并通过邮件发送。

## 触发条件
用户说：「汇总周报」或类似表达

---

## 飞书配置信息

| 项目 | 值 |
|------|-----|
| Spreadsheet Token | KYghscfQth2isytvD39c7FQUn3c |
| App ID | cli_YOUR_APP_ID |
| App Secret | `ziZAkavTw4sa7DHJCblBuewhNpUFpwv2` |
| 目标群 chat_id | `oc_YOUR_CHAT_ID`（助手群） |
| JAVA组成员 | 肖渊、郭能清、祝小娟、袁钞、高雷、何灿、何永辉、徐彬辉 |

> ⚠️ **凭证适用范围**：这些 Feishu API 凭证（App ID / App Secret）不仅用于 Sheets API 读取，也可用于 `im/v1/messages` 发送消息、搜索聊天等。不同操作可能需要不同的 API scope，确保 Bot 已开通对应权限。

| App Secret | `ziZAkavTw4sa7DHJCblBuewhNpUFpwv2` |

> ⚠️ **凭证同步规则（重要）**：App Secret 变更时必须同步更新：
> 1. `/root/.hermes/cron/send_weekly_report.py` 第12行 `app_secret = '...'`
> 2. Hermes memory 中的 App Secret 条目
>
> 飞书消息（Bot/Gateway）与 API 调用（Sheets/文档）是**两套独立认证**：
> - Bot 聊天正常 ≠ API 凭证有效
> - API 报 401 时请先验证凭证：`POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`

## Sheet读取规则

### 用户指定sheet
用户说「读取sheet XXX」或「读取XXX」，直接使用指定sheet ID。

### 用户未指定sheet
自动获取所有sheet列表，按title日期排序，取最新且hidden=false的sheet_id。

---

## 表格列结构

| 列索引 | 列名 |
|--------|------|
| 0 | 成员 |
| 1 | 本周参与项目 |
| 2 | 本周关键进展（工作内容及进度百分比） |
| 3 | 协助、风险及应对措施 |
| 4 | 下周参与项目 |
| 5 | 下周重点工作（工作内容及进度百分比） |

---

## 分类映射表

项目分类统一从sheet **mhopvH** 读取。

### mhopvH列顺序
- A列 = 项目分类（业务需求/基建/业务支持/运维/数仓）
- B列 = 项目列表（实际项目名称）

### 正确代码
```python
category_map[str(row[1]).strip()] = str(row[0]).strip()
```

---

## API调用

### 获取token
```
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Body: {"app_id": "cli_YOUR_APP_ID", "app_secret": "<APP_SECRET>"}
```

### 获取最新sheet
```
GET https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/KYghscfQth2isytvD39c7FQUn3c/sheets/query
```

### 读取数据
```
GET https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/KYghscfQth2isytvD39c7FQUn3c/values/{sheet_id}
```

---

## 邮件格式

### 主题
**默认格式**：`JAVA组 周工作总结 - 日期`（如 `JAVA组 周工作总结 - 2026-05-29`）

**重要**：用户每次可能指定不同主题，以用户当次指令为准。

### 内容（HTML表格格式）

#### 本周进展表格
| 分类 | 重点工作 | 具体事项及进展 | 参与人 | 协助/风险 |
|------|---------|--------------|---------|---------|

- 分类列：固定宽度70px，white-space:nowrap，不换行
- 重点工作列：固定宽度140px，white-space:nowrap，不换行
- 参与人列：固定宽度100px，white-space:nowrap，不换行
- 协助/风险列：固定宽度150px，内容自动换行（word-wrap:break-word; white-space:normal）
- 具体事项及进展列：自适应宽度（width:auto），内容自动换行（word-wrap:break-word; white-space:normal）

#### 下周计划表格
| 分类 | 重点工作 | 具体事项及计划进展 | 相关人 |
|------|---------|-----------------|-------|

- 分类列：固定宽度70px，white-space:nowrap，不换行
- 重点工作列：固定宽度140px，white-space:nowrap，不换行
- 相关人列：固定宽度100px，white-space:nowrap，不换行
- 具体事项列：自适应宽度（width:auto），内容自动换行（word-wrap:break-word; white-space:normal）

#### HTML模板关键样式
```html
<!-- 表头 -->
<tr style="background-color: #4CAF50; color: white;">
    <th style="width:70px; white-space:nowrap;">分类</th>
    <th style="width:140px; white-space:nowrap;">重点工作</th>
    <th>具体事项及进展</th>
    <th style="width:100px; white-space:nowrap;">参与人</th>
    <th style="width:150px;">协助/风险</th>
</tr>

<!-- 数据行 -->
<td style="white-space:nowrap;">分类</td>
<td style="white-space:nowrap;">重点工作</td>
<td style="word-wrap:break-word; white-space:normal;">具体事项及进展内容...</td>
<td style="white-space:nowrap;">参与人</td>
<td style="word-wrap:break-word; white-space:normal;">协助/风险内容...</td>
```

---

## 数据整理规则

### 数据结构
解析时按项目聚合数据：
```python
this_week = defaultdict(lambda: {'members': set(), 'content': [], 'assist_risk': []})
next_week = defaultdict(lambda: {'members': set(), 'content': []})
```

### 业务需求智能汇总（smart_summarize）
- 具体事项及进展：调用 `smart_summarize()` 智能汇总
- 汇总算法：
  1. **按换行拆分**：把每条内容按 `\n` 拆分成独立的行
  2. **去行首序号**：每行只去掉开头的序号（如"1、"、"1."、"2、"），保留行内其他内容
  3. **按描述内容聚类**：相似描述（共享70%以上字符）合并，提取进度信息，多个进度取最大值
  4. **统一连贯序号**：合并后重新编号，用 `1、2、3、...` 格式输出
- 示例：
  - 输入（多行混合序号）："1、联调bug\n2、修改bug" + "1、完成开发"
  - 输出："1、联调bug<br>2、修改bug<br>3、完成开发"

### 基建 & 业务支持 & 运维
- 具体事项及进展：调用 `summarize_by_person()` 按成员分别描述
- 同一成员的多行内容用分号合并，不同成员之间用`<br>`换行
- 成员与事项之间用冒号分隔
- 示例：
  ```
  何灿：配置前端部署环境；编写jenkins构建脚本
  郭能清：AI工具平台已完成第一个版本开发部署到测试环境
  ```

### 风险事项聚合（⚠️ 关键点）
- 原始数据中"协助/风险"列（列索引3）需要按项目聚合
- 同一项目可能有多行数据，每行都可能有风险内容
- 聚合逻辑：
  1. 遍历所有行，收集非空且非"暂无"的风险内容
  2. 按项目聚合：`this_week[proj]['assist_risk'].append(assist)`
  3. 输出时用`<br>`合并：`'<br>'.join(data['assist_risk'])`
- 示例：
  - 用户关系小助手需求项目有2行，分别来自高雷和何永辉
  - 聚合后："销售目标完成情况企微推送...（高雷）<br>CDP配置...（何永辉）"

### 参与人/相关人
- 同一项目/分类的参与人用顿号合并

### ⚠️ 关键：按人分组逻辑
基建/业务支持/运维分类必须按 `(项目, 成员)` 组合直接分组，不能在内容中查找人名！

原因：原始数据每行已记录成员姓名（列0），但进展内容（列2）中不一定包含成员姓名。
- ❌ 错误做法：在内容文本中搜索"郭能清"等姓名关键字
- ✅ 正确做法：直接使用 row[0] 的成员姓名，按 (项目+成员) 组合聚合

```python
# 正确代码示例
this_week = defaultdict(lambda: defaultdict(lambda: {'content': [], 'assist_risk': []}))
for row in sheet_rows[1:]:
    member = str(row[0]).strip()  # 直接从列0获取成员名
    proj_this = str(row[1]).strip()
    content_this = str(row[2]).strip()
    # ...
    this_week[proj_this][member]['content'].append(content_this)
```

### 序号换行但无空白行
原始数据中包含换行符（如 `1、xxx\n2、xxx`），需要转换为 `<br>`，但要避免产生空白行：
- 先压缩连续换行为单个：`re.sub(r'\n{2,}', '\n', content)`
- 去掉开头和结尾换行：`content.strip()`
- 最后替换换行为 `<br>`：`content.replace('\n', '<br>')`

### 风险内容必须正确填充
风险内容从列3读取，非空且非"暂无"才记录。原始数据中每行的风险内容需要正确归属到对应项目。

---

## 邮件发送配置

| 项目 | 值 |
|------|-----|
| 发件人/默认收件人 | hexu@songtsam.com |
| 可追加收件人 | digital-center@songtsam.com（用户曾要求确认内容无误后将同一份周报追加发送到该邮箱；是否作为默认收件人需用户明确确认） |
| SMTP | smtp.songtsam.com:465 (SSL/TLS 1.2) |

---

## 执行步骤

1. 获取tenant_access_token
2. 用户未指定sheet：调用sheets/query API获取最新sheet_id；用户指定sheet：使用指定sheet_id
3. 读取分类映射表mhopvH
4. 读取目标sheet数据
5. 筛选JAVA组成员数据，按项目分组
6. 按上述规则整理成表格
7. **先发送预览给用户确认，用户回复"发送"后再发送邮件**
8. 发送HTML格式邮件（使用TLS 1.2协议）

### ⚠️ 必须先预览再发送
用户明确要求：**发送邮件前必须先展示预览内容，确认后再发送**。
- 第一步：生成预览内容并展示给用户
- 第二步：用户确认后，再执行邮件发送
- 不要直接发送，必须等用户回复"发送"确认

### ⚠️ 重要：cron脚本必须同步
如果存在cron脚本 `/root/.hermes/cron/send_weekly_report.py`，**每次修改凭证后必须同步更新该脚本**：
- 检查第12行 `app_secret` 是否为最新值
- 检查第11行 `app_id` 是否正确
- 凭证变更未同步 → cron job 报 401（App Secret invalid）

cron触发时执行的是脚本文件，不是技能文档。即使 skill 更新了，脚本里写死的旧凭证仍然会导致失败。

## 核心函数定义

### format_content - 换行格式化
```python
def format_content(content):
    """换行符转<br>，压缩连续空白行"""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    content = re.sub(r'\n{2,}', '\n', content)  # 压缩连续空行
    content = content.strip()
    content = content.replace('\n', '<br>')
    return content
```

### smart_summarize - 业务需求智能汇总
```python
def smart_summarize(items):
    """智能汇总：按换行拆分、去行首序号、聚类合并、提取进度、统一连贯序号"""
    if not items:
        return ''
    
    # 第一步：按换行拆分成独立行
    all_lines = []
    for item in items:
        item = item.strip().rstrip('；').rstrip('；').rstrip(';')
        item = item.replace('\r\n', '\n').replace('\r', '\n')
        lines = item.split('\n')
        for line in lines:
            line = line.strip()
            if line:
                # 只去掉行首的序号（如 "1、" 或 "1. "），保留行内其他内容
                line = re.sub(r'^(\d+[.、]\s*)+', '', line)
                if line:
                    all_lines.append(line)
    
    if not all_lines:
        return ''
    
    # 第二步：按描述内容聚类合并
    clusters = {}
    for line in all_lines:
        progress_match = re.search(r'进度(\d+)%', line)
        progress = int(progress_match.group(1)) if progress_match else None
        base = re.sub(r'，进度\d+%|，进度\d+', '', line).strip()
        
        if not base:
            continue
        
        found = False
        for key in clusters:
            if len(base) > 5 and len(key) > 5:
                common = sum(1 for a, b in zip(base, key) if a == b)
                if common >= max(len(base), len(key)) * 0.7:
                    if progress is not None:
                        existing = clusters[key]['progress']
                        clusters[key]['progress'] = max(existing, progress) if existing else progress
                    clusters[key]['items'].append(line)
                    found = True
                    break
        if not found:
            clusters[base] = {'items': [line], 'progress': progress}
    
    # 第三步：构建结果，统一用连贯序号 1、2、3...
    result = []
    for i, (base, data) in enumerate(clusters.items(), 1):
        if data['progress'] is not None:
            result.append(f"{i}、{base}，进度{data['progress']}%")
        else:
            result.append(f"{i}、{base}")
    
    return '<br>'.join(result)
```

### TLS 1.2 邮件发送代码

---

## 注意事项

1. 只发送JAVA组，不包含AI组
2. 项目分类从mhopvH读取，不要硬编码
3. 使用HTML表格格式发送，固定宽度列不换行
4. 不同成员描述用`<br>`换行
