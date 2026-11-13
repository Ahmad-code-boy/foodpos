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

# Clear any lingering cart
eval_expr("window.cur_food_pos.clear_cart();")
time.sleep(0.5)

# Add item to cart
print("\n--- Step 3: Add item and open Payment Page ---")
eval_expr("window.cur_food_pos.order_type = 'Takeaway';")
eval_expr("window.cur_food_pos.add_item_to_cart(window.cur_food_pos.items[0]);")
time.sleep(1)
cart_len = eval_expr("window.cur_food_pos.cart_items.length")
item_name = eval_expr("window.cur_food_pos.cart_items[0].item_name")
print(f"Cart has {cart_len} item: {item_name}")
assert cart_len > 0, "Cart should have at least 1 item"

eval_expr("window.cur_food_pos.show_payment_page();")
time.sleep(1)

# Check "Generate & Print POS Slip on Settlement"
eval_expr("$('#fpos-auto-print-slip').prop('checked', true).trigger('change');")
auto_print = eval_expr("window.cur_food_pos.auto_print_slip")
print(f"Auto print slip checkbox state: {auto_print}")
assert auto_print is True, "auto_print_slip should be True"

# Click Exact quick-cash button
eval_expr("$('.fpos-quick-cash-btn[data-amount=\"Exact\"]').click();")
time.sleep(0.5)
tendered = eval_expr("window.cur_food_pos.payment_tendered")
print(f"Tendered amount: {tendered}")

print("\n--- Step 4: Confirm & Settle Order with Print Checked ---")
eval_expr("$('.fpos-confirm-payment-btn').click();")

# Poll for receipt modal to appear
receipt_appeared = False
for i in range(20):
    time.sleep(0.5)
    if eval_expr("$('.fpos-slip-modal-overlay').is(':visible')"):
        receipt_appeared = True
        break

print(f"Receipt modal appeared: {receipt_appeared}")
assert receipt_appeared, "Receipt modal must appear after settlement"

receipt_text = eval_expr("$('.fpos-slip-card').text().trim()")
invoice_no = eval_expr("$('.fpos-slip-card strong:contains(\"BR1-\"), .fpos-slip-card strong:contains(\"INV-\")').text().trim()")
print(f"Receipt displayed for invoice: {invoice_no}")
print(f"Receipt contains Grand Total: {'TOTAL DUE:' in receipt_text}")

artifact_dir = "/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797"
take_screenshot(os.path.join(artifact_dir, "bugB_receipt_modal_settle_with_print.png"))

print("\n--- Step 5: Test 1-Click Close Dismisses Receipt Modal & Clears Cart ---")
close_btn_exists = eval_expr("$('.fpos-close-slip-btn:visible').length > 0")
print(f"Close/Next Order button exists: {close_btn_exists}")

# Click Next Order (Close) button in 1 click
eval_expr("$('.fpos-close-slip-btn').click();")
time.sleep(1)

receipt_visible_after = eval_expr("$('.fpos-slip-modal-overlay:visible').length > 0")
container_visible_after = eval_expr("$('.fpos-slip-modal-container').is(':visible')")
cart_len_after = eval_expr("window.cur_food_pos.cart_items.length")
print(f"After 1-click Close -> Overlay visible: {receipt_visible_after}, Container visible: {container_visible_after}, Cart items count: {cart_len_after}")

assert not receipt_visible_after, "Receipt modal must be dismissed in 1 click!"
assert not container_visible_after, "Container must be hidden after Close!"
assert cart_len_after == 0, "Cart must be emptied after Close!"

take_screenshot(os.path.join(artifact_dir, "bugB_after_1click_close.png"))

print("\n--- Step 6: Test '✕' Close Icon and 'Escape' Key Dismissal ---")
# Re-display receipt modal via show_pos_slip to test ✕ and Escape
eval_expr("""
window.cur_food_pos.show_pos_slip({
    invoice: 'BR1-TEST-0001',
    company: 'FOOD POS RESTAURANT',
    pos_profile: window.cur_food_pos.pos_profile,
    posting_date: '2026-11-12',
    posting_time: '11:30:00',
    grand_total: 350.0,
    paid_amount: 350.0,
    items: [{ item_name: 'Club Sandwich', qty: 1, rate: 350.0, amount: 350.0 }]
}, false);
""")
time.sleep(1)
print("Modal re-opened for ✕ test, visible:", eval_expr("$('.fpos-slip-modal-overlay:visible').length > 0"))

# Click ✕ icon
eval_expr("$('.fpos-slip-close-icon').click();")
time.sleep(0.5)
print("After ✕ click, visible:", eval_expr("$('.fpos-slip-modal-overlay:visible').length > 0"))
assert eval_expr("$('.fpos-slip-modal-overlay:visible').length == 0"), "✕ must dismiss receipt modal in 1 click"

# Re-open for Escape test
eval_expr("""
window.cur_food_pos.show_pos_slip({
    invoice: 'BR1-TEST-0002',
    company: 'FOOD POS RESTAURANT',
    pos_profile: window.cur_food_pos.pos_profile,
    posting_date: '2026-11-12',
    posting_time: '11:30:00',
    grand_total: 350.0,
    paid_amount: 350.0,
    items: [{ item_name: 'Club Sandwich', qty: 1, rate: 350.0, amount: 350.0 }]
}, false);
""")
time.sleep(1)
print("Modal re-opened for Escape test, visible:", eval_expr("$('.fpos-slip-modal-overlay:visible').length > 0"))

# Dispatch Escape key
eval_expr("$(document).trigger($.Event('keydown', { key: 'Escape', keyCode: 27 }));")
time.sleep(0.5)
print("After Escape key, visible:", eval_expr("$('.fpos-slip-modal-overlay:visible').length > 0"))
assert eval_expr("$('.fpos-slip-modal-overlay:visible').length == 0"), "Escape key must dismiss receipt modal in 1 click"

print("\n>>> ALL BUG B CHECKS PASSED SUCCESSFULLY! <<<")
ws.close()
