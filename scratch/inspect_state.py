import urllib.request
import json
import websocket

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

print("Current URL:", eval_expr("window.location.href"))
print("Current View:", eval_expr("window.cur_food_pos ? window.cur_food_pos.current_view : null"))
print("Is Payment Page Active:", eval_expr("$('.fpos-payment-page').hasClass('active')"))
print("Modal visible count:", eval_expr("$('.modal:visible').length"))
if eval_expr("$('.modal:visible').length"):
    print("Modal title:", eval_expr("$('.modal:visible .modal-title').text()"))
    print("Modal body:", eval_expr("$('.modal:visible .modal-body').text()"))

print("Cart items:", eval_expr("window.cur_food_pos.cart_items"))
print("Payment tendered:", eval_expr("window.cur_food_pos.payment_tendered"))
print("Container HTML snippet:", eval_expr("$('.fpos-slip-modal-container').html().slice(0, 300)"))
print("Overlay length:", eval_expr("$('.fpos-slip-modal-overlay').length"))
print("Overlay is visible:", eval_expr("$('.fpos-slip-modal-overlay').is(':visible')"))
print("Container is visible:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))

print("Clicking Close button...")
eval_expr("$('.fpos-close-slip-btn').click();")
import time
time.sleep(1)

print("After click:")
print("Overlay length:", eval_expr("$('.fpos-slip-modal-overlay').length"))
print("Container is visible:", eval_expr("$('.fpos-slip-modal-container').is(':visible')"))

ws.close()
