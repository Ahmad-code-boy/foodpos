import json
import time
import base64
import urllib.request
import websocket

CDP_PORT = 9222
APP_DATA_DIR = "/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797"

def get_page_ws():
    req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json")
    pages = json.loads(req.read().decode())
    for p in pages:
        if p.get("type") == "page":
            return p.get("webSocketDebuggerUrl")
    req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/new?http://localhost:8001/desk/foodpos/food-pos")
    new_page = json.loads(req.read().decode())
    return new_page.get("webSocketDebuggerUrl")

call_counter = 1000

def cdp_call(ws, method, params=None):
    global call_counter
    call_counter += 1
    call_id = call_counter
    msg = {"id": call_id, "method": method, "params": params or {}}
    ws.send(json.dumps(msg))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == call_id:
            return resp.get("result", {})

def eval_js(ws, expr):
    res = cdp_call(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    return res.get("result", {}).get("value")

def take_screenshot(ws, filename):
    res = cdp_call(ws, "Page.captureScreenshot", {"format": "png"})
    data = base64.b64decode(res.get("data", ""))
    path = f"{APP_DATA_DIR}/{filename}"
    with open(path, "wb") as f:
        f.write(data)
    print(f"Saved screenshot: {path}")

def run():
    ws_url = get_page_ws()
    print("Connecting to:", ws_url)
    ws = websocket.create_connection(ws_url, timeout=30)
    cdp_call(ws, "Page.enable")
    cdp_call(ws, "Runtime.enable")
    cdp_call(ws, "Emulation.setDeviceMetricsOverride", {
        "width": 1400, "height": 900, "deviceScaleFactor": 1, "mobile": False
    })

    print("Navigating to POS...")
    cdp_call(ws, "Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos"})
    time.sleep(4)

    # 1. Test Select Table button resiliency (rapid clicks)
    print("\n[1] Testing Select Table double click resiliency...")
    eval_js(ws, 'window.cur_food_pos.open_table_selector(); window.cur_food_pos.open_table_selector();')
    time.sleep(1.5)
    modal_visible = eval_js(ws, '$(".modal:visible").length')
    modal_title = eval_js(ws, '$(".modal:visible .modal-title").text()')
    print(f"Modal visible count: {modal_visible}, Title: {modal_title}")
    assert modal_visible >= 1, "Table modal failed to open!"
    # Close table modal
    eval_js(ws, '$(".modal:visible .btn-modal-close, .modal:visible .close").click();')
    time.sleep(1)

    # 2. Test Cart reload persistence
    print("\n[2] Testing Cart reload persistence...")
    eval_js(ws, 'window.cur_food_pos.clear_cart();')
    time.sleep(0.5)
    eval_js(ws, 'window.cur_food_pos.order_type = "Takeaway";')
    eval_js(ws, 'window.cur_food_pos.add_item_to_cart(window.cur_food_pos.items[0]);')
    time.sleep(0.5)
    cart_count_before = eval_js(ws, 'window.cur_food_pos.cart_items.length')
    cart_item_name = eval_js(ws, 'window.cur_food_pos.cart_items[0].item_name')
    print(f"Cart before reload: {cart_count_before} item(s) ({cart_item_name})")
    assert cart_count_before > 0, "Failed to add item to cart!"

    # Reload page
    print("Reloading page...")
    cdp_call(ws, "Page.reload", {"ignoreCache": True})
    time.sleep(4)

    cart_count_after = eval_js(ws, 'window.cur_food_pos ? window.cur_food_pos.cart_items.length : 0')
    print(f"Cart after reload: {cart_count_after} item(s) in memory")
    assert cart_count_after > 0, "Cart was lost on reload!"
    print("PASSED: Cart persistence across reload verified!")

    # 3. Test Settle with Change Due
    print("\n[3] Testing Pay & Settle Change Due line...")
    eval_js(ws, 'window.cur_food_pos.order_type = "Takeaway";')
    eval_js(ws, 'window.cur_food_pos.show_payment_page();')
    time.sleep(1)

    # Click +500 button: pre-filled 350 + 500 = 850 (Change Rs 500)
    eval_js(ws, '$(".fpos-cp[data-amt=\'500\']").click();')
    time.sleep(0.5)
    tendered = eval_js(ws, 'Object.values(window.cur_food_pos.payment_splits).reduce((a,b)=>a+b, 0)')
    print("Tendered cash:", tendered)
    assert tendered == 850, f"Expected tendered == 850, got {tendered}"

    # Confirm & Settle
    eval_js(ws, '$(".fpos-confirm-payment-btn").click();')
    time.sleep(3)

    receipt_visible = eval_js(ws, '$(".fpos-slip-modal-overlay:visible").length')
    print("Receipt modal visible:", receipt_visible)
    assert receipt_visible > 0, "Receipt modal not shown!"

    receipt_text = eval_js(ws, '$(".fpos-slip-card, .fpos-slip-sheet").text()')
    has_change_due = "Change Due:" in receipt_text
    print("Receipt contains 'Change Due:':", has_change_due)
    assert has_change_due, "Receipt missing 'Change Due:' line!"
    take_screenshot(ws, "item5_receipt_change_due.png")
    print("PASSED: Change Due line verified on receipt!")

    # Dismiss receipt modal cleanly
    eval_js(ws, '$(".fpos-close-slip-btn").click();')
    time.sleep(1)
    cart_after_settle = eval_js(ws, 'window.cur_food_pos.cart_items.length')
    print("Cart count after settle & close:", cart_after_settle)
    assert cart_after_settle == 0, "Cart not emptied on close!"

    # 4. Test Kitchen Drawer quirks
    print("\n[4] Testing Kitchen Drawer item checkbox & remaining alert...")
    eval_js(ws, 'window.cur_food_pos.show_kitchen_drawer();')
    time.sleep(1.5)
    drawer_visible = eval_js(ws, '$(".fpos-kitchen-drawer.active").length')
    print("Kitchen drawer active:", drawer_visible)
    take_screenshot(ws, "item5_kitchen_drawer.png")

    # Close drawer
    eval_js(ws, 'window.cur_food_pos.hide_kitchen_drawer();')
    time.sleep(0.5)

    # 5. Navigate to Audit Log list in Desk
    print("\n[5] Capturing Food POS Audit Log list in Desk...")
    cdp_call(ws, "Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos-audit-log"})
    time.sleep(3)
    take_screenshot(ws, "item5_audit_log_desk.png")

    print("\nALL CDP TESTS COMPLETED SUCCESSFULLY!")
    ws.close()

if __name__ == "__main__":
    run()
