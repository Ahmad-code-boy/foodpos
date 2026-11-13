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

# Click first item card
item_name = eval_expr("$('.fpos-item-card:first .fpos-item-card-name').text().trim()")
print(f"Clicking first item: {item_name}")
eval_expr("$('.fpos-item-card:first').click();")
time.sleep(1)
print("Cart items count:", eval_expr("window.cur_food_pos.cart_items.length"))

# Open Payment Page
print("Opening payment page...")
eval_expr("$('.fpos-pay-btn').click();")
time.sleep(1)

# Check the print slip checkbox
print("Checking 'Generate & Print POS Slip on Settlement'...")
eval_expr("$('#fpos-auto-print-slip').prop('checked', true).trigger('change');")
print("auto_print_slip is:", eval_expr("window.cur_food_pos.auto_print_slip"))

# Click Exact cash
eval_expr("$('.fpos-quick-cash-btn[data-amount=\"Exact\"]').click();")
time.sleep(1)
print("Tendered amount:", eval_expr("window.cur_food_pos.payment_tendered"))

# Complete order
print("Clicking Complete Order & Settle...")
eval_expr("$('.fpos-confirm-payment-btn').click();")
time.sleep(4)

print("Receipt container visible:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))
print("Receipt modal title/text:", eval_expr("$('.fpos-slip-card').text().slice(0, 100).trim()"))

all_pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
print("Open targets count:", len(all_pages))
for p in all_pages:
    print(f"  Target: type={p.get('type')}, title={p.get('title')}, url={p.get('url')[:60]}")

# Try clicking Close on receipt modal
print("Clicking '.fpos-close-slip-btn'...")
eval_expr("$('.fpos-close-slip-btn').click();")
time.sleep(1)
print("Receipt container visible after Close click:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))
print("Cart items count after Close click:", eval_expr("window.cur_food_pos.cart_items.length"))

ws.close()
