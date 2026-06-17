#!/usr/bin/env python3
"""每天晚上推送成都明天天气到飞书 — no_agent cron job 专用脚本
用法: python weather_push.py
无需任何 API Key（wttr.in 免费），飞书凭证硬编码在脚本中。
"""
import requests
import json
from datetime import date, timedelta

# =============================================
# 飞书凭证（硬编码，不依赖环境变量）
# =============================================
FEISHU_APP_ID = 'cli_YOUR_APP_ID'
FEISHU_APP_SECRET = 'ziZAkavTw4sa7DHJCblBuewhNpUFpwv2'
FEISHU_CHAT_ID = 'oc_YOUR_CHAT_ID'  # 助手群


def get_weather():
    """用 wttr.in 获取成都天气，完全免费无需 key"""
    resp = requests.get("https://wttr.in/Chengdu?format=j1", timeout=10)
    data = resp.json()
    # weather[0]=今天, weather[1]=明天, weather[2]=后天
    tomorrow = data['weather'][1]
    return {
        'desc': tomorrow['hourly'][4]['weatherDesc'][0]['value'],
        'max_temp': tomorrow['maxtempC'],
        'min_temp': tomorrow['mintempC'],
        'rain': tomorrow['hourly'][4]['precipMM'],
        'humidity': tomorrow['hourly'][4]['humidity'],
        'wind': tomorrow['hourly'][4]['windspeedKmph'],
        'wind_dir': tomorrow['hourly'][4]['winddir16Point'],
        'uv': tomorrow['uvIndex'],
    }


def get_feishu_token():
    resp = requests.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        json={'app_id': FEISHU_APP_ID, 'app_secret': FEISHU_APP_SECRET},
        timeout=15
    )
    return resp.json()['tenant_access_token']


def send_feishu(token, text):
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    msg = {
        "receive_id": FEISHU_CHAT_ID,
        "msg_type": "text",
        "content": json.dumps({"text": text})
    }
    resp = requests.post(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
        headers=headers, json=msg, timeout=15
    )
    return resp.json()


def build_message(w, tomorrow_str):
    max_t = int(w['max_temp'])
    min_t = int(w['min_temp'])

    # 穿衣建议
    if max_t >= 30:
        clothes = f"气温较高（{max_t}°C+），建议穿短袖、短裤或透气衣物，注意防暑"
    elif max_t >= 25:
        clothes = f"气温适中（{min_t}~{max_t}°C），建议穿长袖或薄外套，方便增减"
    else:
        clothes = f"气温较低（{min_t}~{max_t}°C），建议穿外套或薄毛衣"

    # 防晒建议
    uv = int(w['uv'])
    if uv >= 8:
        sun = f"紫外线指数{uv}（极强），务必涂抹SPF50+防晒霜、戴遮阳帽"
    elif uv >= 5:
        sun = f"紫外线指数{uv}（较强），户外活动建议涂抹防晒霜"
    else:
        sun = "紫外线指数较低，户外活动正常防晒即可"

    # 出行建议
    rain = float(w['rain'])
    travel = "无降雨，适宜出行" if rain == 0 else f"有少量降雨（{rain}mm），建议带伞"

    return f"""@何旭 主人，明天（{tomorrow_str}）成都天气已出炉 👇

🌤️ 成都明日天气预报

天气状况：{w['desc']}
气温：{w['min_temp']}°C ~ {w['max_temp']}°C
降水：{w['rain']}mm（{'无降雨' if rain == 0 else '有雨'}）
湿度：{w['humidity']}%
风速：{w['wind_dir']} {w['wind']}km/h

🧥 穿衣建议
{clothes}

☀️ 防晒提醒
{sun}

🚗 出行建议
{travel}

祝主人明天出行愉快！"""


if __name__ == '__main__':
    w = get_weather()
    token = get_feishu_token()
    tomorrow_str = (date.today() + timedelta(days=1)).strftime("%m月%d日")
    msg = build_message(w, tomorrow_str)
    result = send_feishu(token, msg)
    if result.get('code') == 0:
        print("SUCCESS: 天气推送成功！")
    else:
        print(f"ERROR: 推送失败: {result}")
