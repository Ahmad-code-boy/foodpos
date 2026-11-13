import urllib.request
import urllib.parse
import json
import websocket
import time

login_data = urllib.parse.urlencode({"usr": "Administrator", "pwd": "admin"}).encode()
req = urllib.request.Request("http://localhost:8001/api/method/login", data=login_data)
resp = urllib.request.urlopen(req)
cookie_headers = resp.headers.get_all("Set-Cookie")
sid = [ch.split("sid=")[1].split(";")[0] for ch in cookie_headers if "sid=" in ch][0]

pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
ws_url = [p["webSocketDebuggerUrl"] for p in pages if p.get("type") == "page"][0]
ws = websocket.create_connection(ws_url)

call_id = 1
def cdp(method, params=None):
    global call_id
    call_id += 1
    cid = call_id
    ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
    while True:
        d = json.loads(ws.recv())
        if d.get("id") == cid:
            return d.get("result", {})

def eval_expr(expr):
    res = cdp("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    return res.get("result", {}).get("value")

cdp("Network.enable")
cdp("Network.setCookie", {"name": "sid", "value": sid, "domain": "localhost", "path": "/"})

print("Navigating to POS...")
cdp("Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos"})
time.sleep(5)

# Check auto_print_slip setting
print("auto_print_slip default:", eval_expr("window.cur_food_pos.auto_print_slip"))

# Set auto_print_slip = true
eval_expr("window.cur_food_pos.auto_print_slip = true;")

# Add an item to cart
eval_expr("window.cur_food_pos.add_to_cart('Club Sandwich');")
time.sleep(1)
print("Cart items count:", eval_expr("window.cur_food_pos.cart_items.length"))

# Open Payment Page
print("Opening payment page...")
eval_expr("window.cur_food_pos.show_payment_page();")
time.sleep(1)
print("Auto print slip checkbox state:", eval_expr("$('#fpos-auto-print-slip').is(':checked')"))

# Tender exact cash
eval_expr("$('.fpos-quick-cash-btn[data-amount=\"Exact\"]').click();")
time.sleep(1)

# Click Complete Order & Settle
print("Clicking Complete Order & Settle...")
eval_expr("$('.fpos-confirm-payment-btn').click();")
time.sleep(3)

print("Receipt container visible:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))
print("Receipt modal overlay exists:", eval_expr("$('.fpos-slip-modal-overlay').length"))

# Check all open pages/tabs in Chrome
all_pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
print("All Chrome targets:", [(p.get("type"), p.get("title"), p.get("url")) for p in all_pages])

# Try to click Close on the receipt modal
print("Attempting to click Close button...")
click_res = eval_expr("$('.fpos-close-slip-btn').click();")
time.sleep(1)
print("After click Close -> Receipt container visible:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))

ws.close()
