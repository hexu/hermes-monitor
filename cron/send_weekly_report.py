import requests
import smtplib
import ssl
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from collections import defaultdict

# ========== 配置 ==========
app_id = 'cli_YOUR_APP_ID'
app_secret = 'YOUR_APP_SECRET'
spreadsheet_token = 'YOUR_TOKEN'
members_java = ['肖渊', '郭能清', '祝小娟', '袁钞', '高雷', '何灿', '何永辉', '徐彬杰']

# ========== 获取token ==========
token_resp = requests.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                          json={'app_id': app_id, 'app_secret': app_secret})
tenant_token = token_resp.json()['tenant_access_token']
headers = {'Authorization': f'Bearer {tenant_token}'}

# ========== 获取最新sheet ==========
sheets_resp = requests.get(f'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query', headers=headers)
sheets_list = [s for s in sheets_resp.json()['data']['sheets']
               if not s.get('hidden', False)
               and s['title'] not in ['数据模板', '填写示例']]
latest_sheet = sorted(sheets_list, key=lambda x: x['title'], reverse=True)[0]
latest_sheet_id = latest_sheet['sheet_id']
date_str = latest_sheet['title'] if latest_sheet['title'] else datetime.now().strftime("%Y-%m-%d")

# ========== 读取分类映射表 ==========
cat_resp = requests.get(f'https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/{spreadsheet_token}/values/mhopvH', headers=headers)
cat_data = cat_resp.json()['data']['valueRange']['values']
category_map = {}
for row in cat_data[1:]:
    if len(row) >= 2 and row[0] and row[1]:
        category_map[str(row[1]).strip()] = str(row[0]).strip()

# ========== 读取数据 ==========
values_resp = requests.get(f'https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/{spreadsheet_token}/values/{latest_sheet_id}', headers=headers)
raw_data = values_resp.json()['data']['valueRange']['values']
rows = raw_data[1:]

# ========== 数据分组 ==========
java_this_week = defaultdict(lambda: {'category': '', 'project': '', 'progress': [], 'members': set(), 'risks': []})
java_next_week = defaultdict(lambda: {'category': '', 'project': '', 'plan': [], 'members': set()})

for m in rows:
    if len(m) < 5:
        continue
    name = str(m[0]).strip() if m[0] else ''
    if name not in members_java:
        continue

    this_proj = str(m[1]).strip() if len(m) > 1 and m[1] else '-'
    this_progress = str(m[2]).replace('\n', '；') if len(m) > 2 and m[2] else ''
    risk = str(m[3]).strip() if len(m) > 3 and m[3] else ''
    next_proj = str(m[4]).strip() if len(m) > 4 and m[4] else '-'
    next_plan = str(m[5]).replace('\n', '；') if len(m) > 5 and m[5] else ''

    category = category_map.get(this_proj, '')
    if not category:
        if '运维' in this_proj or '数仓' in this_proj: category = '运维'
        elif 'AI' in this_proj or '阿里云' in this_proj: category = '基建'
        elif '会员' in this_proj or '小助手' in this_proj or 'CDP' in this_proj or '小程序' in this_proj: category = '业务需求'
        else: category = '业务支持'

    if this_proj and this_proj != '-':
        java_this_week[this_proj]['category'] = category
        java_this_week[this_proj]['project'] = this_proj
        if this_progress:
            java_this_week[this_proj]['progress'].append((name, this_progress))
        java_this_week[this_proj]['members'].add(name)
        if risk and risk != '暂无':
            java_this_week[this_proj]['risks'].append(risk)

    if next_proj and next_proj != '-':
        java_next_week[next_proj]['category'] = category
        java_next_week[next_proj]['project'] = next_proj
        if next_plan:
            java_next_week[next_proj]['plan'].append((name, next_plan))
        java_next_week[next_proj]['members'].add(name)

# ========== 智能汇总函数（业务需求用） ==========
def smart_summarize(items):
    """业务需求：去序号、聚类合并、提取最大进度"""
    if not items:
        return ''
    cleaned = []
    for name, text in items:
        for line in text.split('；'):
            line = line.strip().rstrip('；')
            line = re.sub(r'^\d+[.、]\s*', '', line)
            if line:
                cleaned.append(line)

    if not cleaned:
        return ''

    clusters = {}
    for item in cleaned:
        progress_match = re.search(r'进度(\d+)%', item)
        progress = int(progress_match.group(1)) if progress_match else None
        base = re.sub(r'，进度\d+%|，进度\d+', '', item).strip()

        found = False
        for key in clusters:
            common = sum(1 for a, b in zip(base, key) if a == b)
            if common >= max(len(base), len(key)) * 0.7:
                if progress is not None:
                    existing = clusters[key]['progress']
                    clusters[key]['progress'] = max(existing, progress) if existing else progress
                clusters[key]['items'].append(item)
                found = True
                break
        if not found:
            clusters[base] = {'items': [item], 'progress': progress}

    result = []
    for base, data in clusters.items():
        if data['progress'] is not None:
            result.append(f"{base}，进度{data['progress']}%")
        else:
            result.append(base)

    return '；'.join(result)

# ========== 格式化内容 ==========
def format_content(items, category):
    """业务需求：汇总；业务支持/基建/运维：按人汇总换行"""
    if category == '业务需求':
        return smart_summarize(items)
    else:
        member_items = defaultdict(list)
        for name, text in items:
            for line in text.split('；'):
                line = line.strip()
                if line:
                    member_items[name].append(line)
        lines = []
        for name in sorted(member_items.keys()):
            texts = '；'.join(member_items[name])
            lines.append(f"{name}：{texts}")
        return '<br>'.join(lines)

# ========== 生成HTML ==========
html = f"""<html>
<head><meta charset="utf-8"></head>
<body>
<h1>JAVA组 周工作总结</h1>
<p>汇总日期：{date_str}</p>
<hr>

<h2>一、本周进展</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">
<tr style="background-color: #4CAF50; color: white;">
    <th style="width:70px; white-space:nowrap;">分类</th>
    <th style="width:140px; white-space:nowrap;">重点工作</th>
    <th>具体事项及进展</th>
    <th style="width:100px; white-space:nowrap;">参与人</th>
    <th style="width:150px;">协助/风险</th>
</tr>
"""

for key, info in sorted(java_this_week.items(), key=lambda x: x[1]['category']):
    members_text = '、'.join(sorted(info['members']))
    progress_text = format_content(info['progress'], info['category'])
    risk_text = '、'.join(info['risks']) if info['risks'] else '-'
    html += f"""<tr>
    <td style="white-space:nowrap;">{info['category']}</td>
    <td style="white-space:nowrap;">{info['project']}</td>
    <td style="word-wrap:break-word; white-space:normal;">{progress_text}</td>
    <td style="white-space:nowrap;">{members_text}</td>
    <td style="word-wrap:break-word; white-space:normal;">{risk_text}</td>
</tr>
"""

html += """</table>

<h2>二、下周计划</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">
<tr style="background-color: #2196F3; color: white;">
    <th style="width:70px; white-space:nowrap;">分类</th>
    <th style="width:140px; white-space:nowrap;">重点工作</th>
    <th>具体事项及计划进展</th>
    <th style="width:100px; white-space:nowrap;">相关人</th>
</tr>
"""

for key, info in sorted(java_next_week.items(), key=lambda x: x[1]['category']):
    members_text = '、'.join(sorted(info['members']))
    plan_text = format_content(info['plan'], info['category'])
    if not plan_text:
        plan_text = '-'
    html += f"""<tr>
    <td style="white-space:nowrap;">{info['category']}</td>
    <td style="white-space:nowrap;">{info['project']}</td>
    <td style="word-wrap:break-word; white-space:normal;">{plan_text}</td>
    <td style="white-space:nowrap;">{members_text}</td>
</tr>
"""

html += f"""</table>
<hr>
<p style="color: #666; font-size: 12px;">由 Hermes Agent 自动汇总生成 | 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>
</body>
</html>"""

# ========== 发送邮件 ==========
msg = MIMEMultipart('alternative')
msg['Subject'] = f'JAVA组 周工作总结 - {date_str}'
msg['From'] = 'hexu@songtsam.com'
msg['To'] = 'digital-center@songtsam.com'
msg.attach(MIMEText(html, 'html', 'utf-8'))

context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE

with smtplib.SMTP_SSL('smtp.songtsam.com', 465, context=context) as server:
    server.login('hexu@songtsam.com', 'Tj5QdZnMJTpxOfho')
    server.sendmail('hexu@songtsam.com', ['digital-center@songtsam.com'], msg.as_string())

print(f"已发送，主题: JAVA组 周工作总结 - {date_str}，字符数: {len(html)}")
