import urllib.request
import urllib.parse
import json
import websocket
import time
import base64
import os

print("--- Step 1: Authenticate session via API ---")
login_data = urllib.parse.urlencode({"usr": "Administrator", "pwd": "admin"}).encode()
req = urllib.request.Request("http://localhost:8001/api/method/login", data=login_data)
resp = urllib.request.urlopen(req)
cookie_headers = resp.headers.get_all("Set-Cookie")
sid = None
for ch in cookie_headers:
    if "sid=" in ch:
        sid = ch.split("sid=")[1].split(";")[0]
        break
print("Authenticated sid:", sid)

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

def take_screenshot(filepath):
    res = cdp("Page.captureScreenshot", {"format": "png"})
    data = base64.b64decode(res["data"])
    with open(filepath, "wb") as f:
        f.write(data)
    print(f"Saved screenshot: {filepath} ({len(data)} bytes)")

cdp("Network.enable")
cdp("Network.setCookie", {
    "name": "sid",
    "value": sid,
    "domain": "localhost",
    "path": "/"
})

print("\n--- Step 2: Fresh navigation to Food POS ---")
cdp("Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos"})
time.sleep(5)

# If branch selection modal is visible, choose Branch 1
is_branch_modal = eval_expr("Boolean(window.cur_food_pos && window.cur_food_pos.branch_select_dialog)")
if is_branch_modal:
    eval_expr("window.cur_food_pos.select_pos_profile('Branch 1 - Gulberg POS Profile')")
    time.sleep(3)

print("POS active profile:", eval_expr("window.cur_food_pos ? window.cur_food_pos.pos_profile : null"))
print("POS branch:", eval_expr("window.cur_food_pos ? window.cur_food_pos.branch : null"))

print("\n--- Step 3: Open Kitchen Drawer ---")
eval_expr("$('.fpos-kitchen-track-btn').click();")
time.sleep(2)

drawer_active = eval_expr("$('.fpos-kitchen-drawer').hasClass('active')")
tickets_count = eval_expr("$('.fpos-recent-card').length")
modals_count = eval_expr("$('.modal:visible').length")
print(f"Drawer active: {drawer_active}, Tickets rendered: {tickets_count}, Visible modals: {modals_count}")
assert drawer_active, "Kitchen drawer should be active"
assert modals_count == 0, f"Expected 0 modals, found {modals_count}"

print("\n--- Step 4: Test Grill station filter switch ---")
eval_expr("$('.fpos-kds-station-btn[data-station=\"Grill\"]').click();")
time.sleep(2)
grill_tickets_count = eval_expr("$('.fpos-recent-card').length")
modals_count_grill = eval_expr("$('.modal:visible').length")
print(f"Grill station clicked -> Tickets: {grill_tickets_count}, Visible modals: {modals_count_grill}")
assert modals_count_grill == 0, "No modal should pop on station switch"

# Switch back to All Stations
eval_expr("$('.fpos-kds-station-btn[data-station=\"All\"]').click();")
time.sleep(1)

print("\n--- Step 5: Advance ticket Pending -> In Progress -> Ready -> Served inside drawer ---")
# Check FKOT-2026-00016 stage button
stage_btn_text = eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').text().trim()")
print(f"FKOT-2026-00016 stage button: '{stage_btn_text}'")

# Advance from Pending -> In Progress
print("Advancing to In Progress...")
eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').click();")
time.sleep(2)
print("FKOT-2026-00016 stage after 1st click:", eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').text().trim()"))

# Advance from In Progress -> Ready
print("Advancing to Ready...")
eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').click();")
time.sleep(2)
print("FKOT-2026-00016 stage after 2nd click:", eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').text().trim()"))

# Advance from Ready -> Served
print("Advancing to Served...")
eval_expr("$('.fpos-recent-card[data-kot=\"FKOT-2026-00016\"] .fpos-kot-stage-btn').click();")
time.sleep(2)

# Check active tickets: Served KOT should no longer be active in kitchen drawer
remaining_kots = eval_expr("$('.fpos-recent-card').map(function() { return $(this).data('kot'); }).get()")
print("Active KOTs in drawer after Served:", remaining_kots)
modals_count_after_stage = eval_expr("$('.modal:visible').length")
print(f"Visible modals after stage advance: {modals_count_after_stage}")
assert modals_count_after_stage == 0, "No modal should pop during/after stage transition"

artifact_dir = "/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797"
take_screenshot(os.path.join(artifact_dir, "bugA_kitchen_drawer_working.png"))

print("\n--- Step 6: Close drawer with × button ---")
eval_expr("$('.fpos-close-kitchen-drawer').click();")
time.sleep(1)

drawer_active_after_close = eval_expr("$('.fpos-kitchen-drawer').hasClass('active')")
overlay_active_after_close = eval_expr("$('.fpos-drawer-overlay').hasClass('active')")
print(f"After '×' click -> Drawer active: {drawer_active_after_close}, Overlay active: {overlay_active_after_close}")
assert not drawer_active_after_close, "Drawer must be closed after clicking ×"

print("\n--- Step 7: Test Escape key closes drawer ---")
eval_expr("window.cur_food_pos.show_kitchen_drawer();")
time.sleep(1)
print("Re-opened drawer, active:", eval_expr("$('.fpos-kitchen-drawer').hasClass('active')"))
# Dispatch Escape keydown
eval_expr("$(document).trigger($.Event('keydown', { key: 'Escape', keyCode: 27 }));")
time.sleep(1)
drawer_active_after_esc = eval_expr("$('.fpos-kitchen-drawer').hasClass('active')")
print(f"After Escape key -> Drawer active: {drawer_active_after_esc}")
assert not drawer_active_after_esc, "Drawer must be closed after pressing Escape"

take_screenshot(os.path.join(artifact_dir, "bugA_kitchen_drawer_closed.png"))
print("\n>>> ALL BUG A CHECKS PASSED SUCCESSFULLY! <<<")
ws.close()
