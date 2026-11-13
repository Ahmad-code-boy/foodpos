import urllib.request, json, websocket, time, base64

class CDPClient:
    def __init__(self):
        pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read().decode())
        ws_url = [p['webSocketDebuggerUrl'] for p in pages if p.get('type') == 'page'][0]
        self.ws = websocket.create_connection(ws_url)
        self.call_id = 1

    def send(self, method, params=None):
        self.call_id += 1
        cid = self.call_id
        self.ws.send(json.dumps({'id': cid, 'method': method, 'params': params or {}}))
        while True:
            d = json.loads(self.ws.recv())
            if d.get('id') == cid:
                return d.get('result', {})

    def eval(self, expr):
        res = self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        return res.get('result', {}).get('value')

    def screenshot(self, path):
        res = self.send('Page.captureScreenshot', {'format': 'png'})
        data = base64.b64decode(res['data'])
        with open(path, 'wb') as f:
            f.write(data)

    def close(self):
        self.ws.close()

cdp = CDPClient()

print("Navigating to Food POS...")
cdp.eval('frappe.set_route("food-pos")')
time.sleep(3)

print("Hard reloading POS page...")
cdp.send("Page.reload", {"ignoreCache": True})
time.sleep(5)

# Wait for cur_food_pos
for _ in range(15):
    ready = cdp.eval('typeof cur_food_pos !== "undefined" && cur_food_pos.pos_profile != null && cur_food_pos.items && cur_food_pos.items.length > 0')
    if ready:
        break
    time.sleep(1)

# Ensure fresh held badge is refreshed
cdp.eval('cur_food_pos.refresh_held_badge()')
time.sleep(1)

init_badge = cdp.eval('$(".fpos-held-badge:visible").text() || "0"')
print(f"Initial held badge text: '{init_badge}'")
init_count = int(init_badge) if init_badge else 0

# Clear cart first
cdp.eval('cur_food_pos.clear_cart()')
time.sleep(1)

# Add item to cart
print("Adding item to cart...")
cdp.eval('cur_food_pos.add_item_to_cart(cur_food_pos.items[0])')
time.sleep(1)
cart_len = cdp.eval('cur_food_pos.cart_items.length')
print(f"Cart items count: {cart_len}")
assert cart_len > 0, "Cart items should be > 0"

# Hold order via hold_current_order flow
print("Holding order...")
cdp.eval('''
(async () => {
    const order_payload = {
        order_type: cur_food_pos.order_type,
        table: cur_food_pos.selected_table || "",
        customer: cur_food_pos.customer,
        customer_name: cur_food_pos.customer,
        phone: cur_food_pos.delivery_phone || "",
        delivery_address: cur_food_pos.delivery_address || "",
        delivery_charges: 0,
        pos_profile: cur_food_pos.pos_profile,
        branch: cur_food_pos.branch,
        pos_opening_entry: cur_food_pos.pos_opening,
        grand_total: cur_food_pos.totals.grand_total,
        items: cur_food_pos.cart_items
    };
    const res = await frappe.call({
        method: "foodpos.foodpos.page.food_pos.food_pos.hold_order",
        args: { order_data: order_payload, reason: "Regression sync test" }
    });
    if (res.message && res.message.held_count !== undefined) {
        cur_food_pos.update_held_badge_count(res.message.held_count);
    }
    cur_food_pos.clear_cart();
    await cur_food_pos.refresh_held_badge();
    window._last_held_res = res.message;
})();
''')
time.sleep(1.5)

# Verify badge updated immediately
new_badge = cdp.eval('$(".fpos-held-badge:visible").text()')
print(f"New held badge text immediately after hold: '{new_badge}'")
new_count = int(new_badge)
assert new_count == init_count + 1, f"Expected badge to increment from {init_count} to {init_count + 1}, got {new_count}"

# Open drawer to verify synchronization
print("Opening held orders drawer...")
cdp.eval('cur_food_pos.show_held_orders_drawer()')
time.sleep(2)

pill_text = cdp.eval('$(".fpos-held-count-pill:visible").text()')
badge_in_drawer = cdp.eval('$(".fpos-held-badge:visible").text()')
print(f"Drawer pill: '{pill_text}', Topbar badge: '{badge_in_drawer}'")

assert f"{new_count} held" in pill_text, f"Drawer pill should say '{new_count} held', got '{pill_text}'"
assert str(new_count) == badge_in_drawer, f"Topbar badge should be {new_count}, got {badge_in_drawer}"

# Capture screenshot with drawer open showing synced badge and pill
screenshot_path = "/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/minor4_held_badge_synced.png"
cdp.screenshot(screenshot_path)
print("Saved screenshot to:", screenshot_path)

# Close drawer and verify badge stays synced
cdp.eval('cur_food_pos.hide_held_orders_drawer()')
time.sleep(1)
post_close_badge = cdp.eval('$(".fpos-held-badge:visible").text()')
print(f"Badge after closing drawer: '{post_close_badge}'")
assert post_close_badge == str(new_count), "Badge changed incorrectly after closing drawer"

cdp.close()
print("Minor 4 verification SUCCESSFUL!")
