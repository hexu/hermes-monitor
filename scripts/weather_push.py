#!/usr/bin/env python3
"""每天晚上生成成都明天天气。

No-agent cron 模式：脚本只把最终消息打印到 stdout，
由 Hermes cron 统一投递到飞书助手群；脚本内部不直接调用飞书 API，
避免重复推送、错投 DM、以及把 SUCCESS/ERROR 当正文推到群里。
"""
import requests
from datetime import date, timedelta

def get_weather():
    """用 wttr.in 获取成都天气，完全免费无需 key"""
    resp = requests.get("https://wttr.in/Chengdu?format=j1", timeout=10)
    data = resp.json()
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

if __name__ == '__main__':
    w = get_weather()

    tomorrow_str = (date.today() + timedelta(days=1)).strftime("%m月%d日")

    # 生成穿衣建议
    max_t = int(w['max_temp'])
    min_t = int(w['min_temp'])
    if max_t >= 30:
        clothes = "气温较高（30°C+），建议穿短袖、短裤或透气衣物，注意防暑"
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
    if rain == 0:
        travel = "无降雨，适宜出行"
    else:
        travel = f"有少量降雨（{rain}mm），建议带伞"

    msg = f"""@何旭 主人，明天（{tomorrow_str}）成都天气已出炉 👇

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

    print(msg)
