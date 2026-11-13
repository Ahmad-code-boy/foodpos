import urllib.request
import json
import websocket
import time

pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
ws_url = [p["webSocketDebuggerUrl"] for p in pages if p.get("type") == "page"][0]
ws = websocket.create_connection(ws_url)

call_id = 1
def eval_expr(expr):
    global call_id
    call_id += 1
    ws.send(json.dumps({"id": call_id, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True}}))
    while True:
        d = json.loads(ws.recv())
        if d.get("id") == call_id:
            return d.get("result", {}).get("result", {}).get("value")

print("Clicking Next Order (Close)...")
eval_expr("$('.fpos-close-slip-btn').click()")
time.sleep(1)

print("Receipt overlay visible:", eval_expr("$('.fpos-slip-modal-overlay:visible').length"))
print("Cart items count:", eval_expr("window.cur_food_pos.cart_items.length"))
print("Current view:", eval_expr("window.cur_food_pos.current_view"))
