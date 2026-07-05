from flask import Flask, jsonify, request, make_response
import requests
from datetime import datetime
import threading
import win32print
import win32ui
import win32con

app = Flask(__name__)

@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return make_response('', 204)

API = "https://bb-api.enic.workers.dev"
WEEK = ['월', '화', '수', '목', '금', '토', '일']

# ── 출력 템플릿 ──────────────────────────────────────────────
# 사용 가능한 변수:
#   {delivery_type} {order_no} {items_summary} {memo}
#   {orderer_name} {orderer_phone}
#   {recipient_name} {recipient_phone}
#   {address} {date_str}
#
# BIG_LINES  : 큰 글씨로 출력 (한 줄씩)
# SMALL_LINES: 작은 글씨로 출력 (한 줄씩)
# 빈 문자열 ""은 줄바꿈으로 처리됨
# same_person(주문=수취) 일 때는 SMALL_LINES_SAME 사용

BIG_LINES = [
    "[{delivery_type}] / {order_no}",
    "{items_summary}kg",          # items_summary 없으면 자동 생략
]

SMALL_LINES = [
    "{memo}",                   # memo 없으면 자동 생략
    "[주문] {orderer_name}",
    "[수취] {recipient_name}",
    "----------",
    "{address}",
]

SMALL_LINES_SAME = [
    "{memo}",                   # memo 없으면 자동 생략
    "[주문] {recipient_name}",
    "----------",
    "{address}",
]
# ────────────────────────────────────────────────────────────

_running = False
_lock = threading.Lock()


def report(status, total=0, done=0, current_order=None, errors=None):
    try:
        requests.post(f"{API}/api/print-job", json={
            "status": status, "total": total, "done": done,
            "current_order": current_order, "errors": errors or []
        }, timeout=5)
    except Exception:
        pass


def print_order(o):
    d = datetime.strptime(o["created_at"][:10], "%Y-%m-%d")
    date_str = f"{d.month:02d}/{d.day:02d}({WEEK[d.weekday()]})"

    items_summary   = o['items_summary'] or ""
    memo            = o['memo'] or ""
    orderer_name    = o['orderer_name']
    orderer_phone   = o['orderer_phone'] or ''
    recipient_name  = o['recipient_name'] or orderer_name
    recipient_phone = o['recipient_phone'] or orderer_phone

    def fmt_phone(p):
        p = (p or '').replace('-', '')
        if len(p) == 11:
            return f"{p[:3]}-{p[3:7]}-{p[7:]}"
        if len(p) == 10:
            return f"{p[:3]}-{p[3:6]}-{p[6:]}"
        return p

    same_person = (orderer_name == recipient_name and orderer_phone == recipient_phone)

    ctx = dict(
        delivery_type=o['delivery_type'] or '',
        order_no=o['order_no'] or '',
        items_summary=items_summary,
        memo=memo,
        orderer_name=orderer_name,
        orderer_phone=fmt_phone(orderer_phone),
        recipient_name=recipient_name,
        recipient_phone=fmt_phone(recipient_phone),
        address=o['address'] or '',
        date_str=date_str,
    )

    # 빈 변수가 들어간 줄은 자동 생략 (memo, items_summary 등)
    AUTO_SKIP = {'memo', 'items_summary'}

    def render(tmpl_lines):
        result = []
        for tpl in tmpl_lines:
            if any(f'{{{k}}}' in tpl and ctx[k] == '' for k in AUTO_SKIP):
                continue
            result.append(tpl.format(**ctx))
        return result

    small_tmpl = SMALL_LINES_SAME if same_person else SMALL_LINES
    big_lines   = render(BIG_LINES)
    small_lines = render(small_tmpl)

    tagged = [(l, True) for l in big_lines] + [('', False)] + [(l, False) for l in small_lines]

    printer_name   = win32print.GetDefaultPrinter()
    hdc            = win32ui.CreateDC()
    hdc.CreatePrinterDC(printer_name)
    dpi_y          = hdc.GetDeviceCaps(win32con.LOGPIXELSY)

    def pt_to_height(pt, dpi):
        return -int(pt * dpi / 72)

    font_size_big_pt   = 19
    font_size_small_pt = 15
    line_height_big    = int(font_size_big_pt   * dpi_y / 72 * 1.3)
    line_height_small  = int(font_size_small_pt * dpi_y / 72 * 1.3)

    HANGEUL_CHARSET = 129
    font_big = win32ui.CreateFont({
        "name": "배달의민족 도현",
        "height": pt_to_height(font_size_big_pt, dpi_y),
        "weight": win32con.FW_BOLD,
        "charset": HANGEUL_CHARSET
    })
    font_small = win32ui.CreateFont({
        "name": "배달의민족 도현",
        "height": pt_to_height(font_size_small_pt, dpi_y),
        "weight": win32con.FW_BOLD,
        "charset": HANGEUL_CHARSET
    })

    margin_left    = 10
    margin_top     = 10
    margin_right   = 10
    page_width     = hdc.GetDeviceCaps(win32con.HORZRES)
    max_text_width = page_width - margin_left - margin_right

    def wrap_line(text, max_width):
        if not text:
            return ['']
        words = text.split(' ')
        rough_lines, current = [], ''
        for w in words:
            candidate = f"{current} {w}".strip() if current else w
            if not current or hdc.GetTextExtent(candidate)[0] <= max_width:
                current = candidate
            else:
                rough_lines.append(current)
                current = w
        if current:
            rough_lines.append(current)
        result = []
        for line in rough_lines:
            if hdc.GetTextExtent(line)[0] <= max_width:
                result.append(line)
                continue
            buf = ''
            for ch in line:
                if buf and hdc.GetTextExtent(buf + ch)[0] > max_width:
                    result.append(buf)
                    buf = ch
                else:
                    buf += ch
            if buf:
                result.append(buf)
        return result

    hdc.StartDoc(f"Order_{o['order_no']}")
    hdc.StartPage()

    old_font = hdc.SelectObject(font_big)
    y_pos = margin_top

    for line, is_big in tagged:
        if is_big:
            hdc.SelectObject(font_big)
            lh = line_height_big
        else:
            hdc.SelectObject(font_small)
            lh = line_height_small
        for wl in wrap_line(line, max_text_width):
            hdc.TextOut(margin_left, y_pos, wl)
            y_pos += lh

    hdc.SelectObject(old_font)
    hdc.EndPage()
    hdc.EndDoc()
    hdc.DeleteDC()


def run_print(orders):
    global _running
    total = len(orders)
    errors = []
    report("running", total=total, done=0, current_order=orders[0]['order_no'] if orders else None)
    try:
        for i, o in enumerate(orders):
            report("running", total=total, done=i, current_order=o['order_no'], errors=errors)
            try:
                print_order(o)
                requests.put(f"{API}/api/orders/{o['id']}/printed", json={"printed": 1}, timeout=5)
                print(f"✅ {o['order_no']}")
            except Exception as e:
                errors.append(o['order_no'])
                print(f"❌ {o['order_no']} 오류: {e}")
        report("done", total=total, done=total - len(errors), errors=errors)
    except Exception as e:
        report("error", total=total, done=0, errors=[str(e)])
    finally:
        with _lock:
            _running = False


@app.route("/print-memo", methods=["POST"])
def print_memo():
    text = (request.get_json() or {}).get("text", "")
    if not text:
        return jsonify({"status": "error", "message": "내용 없음"}), 400
    try:
        printer_name = win32print.GetDefaultPrinter()
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)
        dpi_y = hdc.GetDeviceCaps(win32con.LOGPIXELSY)
        font = win32ui.CreateFont({
            "name": "배달의민족 도현",
            "height": -int(font_size_small_pt * dpi_y / 72),
            "weight": win32con.FW_BOLD,
            "charset": 129
        })
        page_width = hdc.GetDeviceCaps(win32con.HORZRES)
        margin = 10
        max_width = page_width - margin * 2
        lh = int(font_size_small_pt * dpi_y / 72 * 1.4)
        hdc.StartDoc("Memo")
        hdc.StartPage()
        old = hdc.SelectObject(font)
        y = margin
        for line in text.splitlines():
            hdc.TextOut(margin, y, line if line else ' ')
            y += lh
        hdc.SelectObject(old)
        hdc.EndPage()
        hdc.EndDoc()
        hdc.DeleteDC()
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    printer = None
    try:
        printer = win32print.GetDefaultPrinter()
    except Exception:
        pass
    return jsonify({"status": "ok", "printer": printer, "busy": _running}), 200


@app.route("/trigger", methods=["GET", "POST"])
def trigger():
    global _running
    order_id = request.args.get("order_id")
    if not order_id and request.is_json:
        order_id = (request.get_json() or {}).get("order_id")

    with _lock:
        if _running and not order_id:
            return jsonify({"status": "busy", "message": "이미 출력 중입니다"}), 409
        _running = True

    try:
        params = {"order_id": order_id} if order_id else {"status": "주문확정"}
        resp = requests.get(f"{API}/api/orders/export", params=params, timeout=10)
        orders = resp.json() if resp.ok else []
        if not orders:
            with _lock:
                _running = False
            return jsonify({"status": "error", "message": "출력할 주문이 없습니다"}), 404

        t = threading.Thread(target=run_print, args=(orders,), daemon=True)
        t.start()
        msg = f"단건 출력 시작 ({orders[0]['order_no']})" if order_id else f"전체 출력 시작 ({len(orders)}건)"
        return jsonify({"status": "started", "message": msg, "total": len(orders)}), 200
    except Exception as e:
        with _lock:
            _running = False
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == "__main__":
    import os, subprocess, sys

    # cloudflared.exe가 같은 폴더에 있으면 터널 자동 시작
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    cloudflared = os.path.join(base_dir, "cloudflared.exe")
    if os.path.exists(cloudflared):
        subprocess.Popen([cloudflared, "tunnel", "run"],
                         creationflags=subprocess.CREATE_NEW_CONSOLE)
        print("✅ cloudflared 터널 시작됨")
    else:
        print("⚠️  cloudflared.exe 없음 — 터널 수동 시작 필요")

    app.run(host="0.0.0.0", port=3888)
