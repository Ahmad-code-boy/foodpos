import urllib.request
import json
import websocket
import time

# 1. Login via API to get valid sid
login_data = urllib.parse.urlencode({"usr": "Administrator", "pwd": "admin"}).encode()
req = urllib.request.Request("http://localhost:8001/api/method/login", data=login_data)
resp = urllib.request.urlopen(req)
cookie_headers = resp.headers.get_all("Set-Cookie")
sid = None
for ch in cookie_headers:
    if "sid=" in ch:
        sid = ch.split("sid=")[1].split(";")[0]
        break
print("Got authenticated sid:", sid)

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
cdp("Network.setCookie", {
    "name": "sid",
    "value": sid,
    "domain": "localhost",
    "path": "/"
})
print("Set sid cookie in Chrome.")

print("Navigating to Food POS...")
cdp("Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos"})
time.sleep(5)

# If branch selection modal is visible, choose Branch 1
is_branch_modal = eval_expr("Boolean(window.cur_food_pos && window.cur_food_pos.branch_select_dialog)")
print("Branch select dialog visible:", is_branch_modal)
if is_branch_modal:
    eval_expr("window.cur_food_pos.select_pos_profile('Branch 1 - Gulberg POS Profile')")
    time.sleep(3)

print("POS URL:", eval_expr("window.location.href"))
print("cur_food_pos exists:", eval_expr("Boolean(window.cur_food_pos)"))
print("pos_profile:", eval_expr("window.cur_food_pos ? window.cur_food_pos.pos_profile : null"))

# Open Kitchen Drawer
print("\nOpening Kitchen Drawer...")
eval_expr("window.cur_food_pos.show_kitchen_drawer();")
time.sleep(2)

print("Drawer active:", eval_expr("$('.fpos-kitchen-drawer').hasClass('active')"))
print("Drawer body text:", eval_expr("$('.fpos-kitchen-body').text().trim()"))
print("Modals visible count:", eval_expr("$('.modal:visible').length"))
if eval_expr("$('.modal:visible').length"):
    print("Modal titles:", eval_expr("$('.modal:visible .modal-title').map(function() { return $(this).text(); }).get()"))
    print("Modal bodies:", eval_expr("$('.modal:visible .modal-body').map(function() { return $(this).text(); }).get()"))
print("Kitchen tickets rendered:", eval_expr("$('.fpos-recent-card').length"))
