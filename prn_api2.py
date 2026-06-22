import requests

from datetime import datetime

import pyautogui, time

import clipboard

import win32print

import win32ui

import win32con





API = "https://bb-api.enic.workers.dev"

WEEK = ['월','화','수','목','금','토','일']



orders = requests.get(f"{API}/api/orders/export", params={"status": "주문확정"}).json()



#ans = pyautogui.getWindowsWithTitle('2024-06-29-토_16.20.55')[0]

#ans.activate()



for o in orders:

    d = datetime.strptime(o["created_at"][:10], "%Y-%m-%d")

    date_str = f"{d.month:02d}/{d.day:02d}({WEEK[d.weekday()]})"



    qty        = o.get("total_qty") or 1

    item_total = o["total_amount"] - o["shipping_fee"]

    unit_price = item_total // qty

    price_str  = f"{unit_price // 10000:.1f}만".replace(".0만", "만")



    recipient_name  = o["recipient_name"]  or o["orderer_name"]

    recipient_phone = o["recipient_phone"] or o["orderer_phone"]



    msg = f"""{o['delivery_type']}  {o['order_no']}

[{date_str}] 입력

{price_str} * {qty}kg



[주문]{o['orderer_name']}/

[수취]{recipient_name}

{o['address'] or ''}

{recipient_phone}"""



    # 2. 윈도우 기본 프린터 가져오기

    printer_name = win32print.GetDefaultPrinter()

    

    # 3. 프린터 드라이버 및 작업 세션 열기

    hdc = win32ui.CreateDC()

    hdc.CreatePrinterDC(printer_name)

    hdc.StartDoc(f"Order_{o['order_no']}") # 인쇄 작업 이름

    hdc.StartPage()

# ================= [설정 구역] =================

    # 1. 여백 설정 (단위: 픽셀 / 프린터 해상도에 따라 다름)

    margin_left = 10  # 왼쪽 여백

    margin_top  = 10  # 위쪽 여백

    line_height = 65   # 줄 간격 (폰트 크기보다 커야 겹치지 않음)



    # 2. 폰트 설정

    # CreateFont 매개변수: (크기(높이), 너비, 각도,Orientation, 두께, 이탤릭, 밑줄, ...)

    font_size = 50     # 폰트 크기 (원하는 대로 조절)

    font = win32ui.CreateFont({

        "name": "배달의민족 도현",               # 폰트 종류 (굴림, 돋움 등)

        "height": font_size,               # 글자 높이

        "weight": win32con.FW_BOLD,        # 글자 두께 (FW_NORMAL은 일반, FW_BOLD는 굵게)

        "charset": win32con.DEFAULT_CHARSET

    })

    hdc.SelectObject(font)                 # 프린터 컨텍스트에 폰트 적용

    # ===============================================



    # 3. 텍스트 인쇄 진행

    y_pos = margin_top

    for line in msg.split('\n'):

        #지정한 왼쪽 여백(margin_left)과 현재 줄 위치(y_pos)에 글자 출력

        hdc.TextOut(margin_left, y_pos, line)

        y_pos += line_height  # 다음 줄 위치 계산



    hdc.EndPage()

    hdc.EndDoc()

    hdc.DeleteDC()

    time.sleep(1)



    # 출력 완료 → printed_at 기록 + status = '주문출력'

    resp = requests.put(

        f"{API}/api/orders/{o['id']}/printed",

        json={"printed": 1}

    )

    if resp.ok:

        print(f"✅ {o['order_no']} 주문출력 처리 완료")

    else:

        print(f"❌ {o['order_no']} 상태 업데이트 실패: {resp.text}")



이거고