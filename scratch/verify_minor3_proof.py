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

print("Reloading page with ignoreCache...")
cdp.send("Page.reload", {"ignoreCache": True})
time.sleep(4)

# Test 1: Route to List of Food POS Held Order
print("Navigating to List Food POS Held Order...")
cdp.eval('frappe.set_route(["List", "Food POS Held Order"])')
time.sleep(3)

route = cdp.eval('frappe.get_route()')
print("Active route:", route)
assert "Food POS Held Order" in route, f"Expected Food POS Held Order in route, got {route}"

# Test 2: Verify FP-HOLD-2026-00015 presence and status
rows = cdp.eval('$(".list-row").length')
print("Total rows loaded:", rows)
assert rows > 0, "No held orders found in list view!"

row_15_found = cdp.eval('$(".list-row:contains(\'FP-HOLD-2026-00015\')").length')
print("Is FP-HOLD-2026-00015 in DOM:", row_15_found)

# Filter specifically for 00015 to show clean verification
cdp.eval('cur_list.filter_area.add([["Food POS Held Order", "name", "like", "%00015%"]])')
time.sleep(2)

cur_rows = cdp.eval('$(".list-row").length')
row_15_text = cdp.eval('$(".list-row").first().text().replace(/\\s+/g, " ").trim()')
print(f"Filtered rows: {cur_rows}, First row details: {row_15_text}")

assert "FP-HOLD-2026-00015" in row_15_text, "Filtered row does not contain FP-HOLD-2026-00015!"
assert "Resumed" in row_15_text, f"Expected status Resumed, got {row_15_text}"

# Test 3: Verify the alias route 'food-pos-hold-order' (which used to 404)
print("Testing route alias from food-pos-hold-order...")
cdp.eval('frappe.set_route("food-pos-hold-order")')
time.sleep(2)
alias_route = cdp.eval('frappe.get_route()')
print("Route after navigating to food-pos-hold-order:", alias_route)
assert "Food POS Held Order" in alias_route, f"Alias navigation failed: {alias_route}"

modal_err = cdp.eval('$(".msgprint:visible, .modal-title:contains(\'Not found\'):visible").length')
assert modal_err == 0, "404 'Not found' dialog appeared on food-pos-hold-order!"

# Clear filter to show all rows in final screenshot
cdp.eval('cur_list.filter_area.clear(); cur_list.refresh();')
time.sleep(2)

screenshot_path = "/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/minor3_held_order_desk_list.png"
cdp.screenshot(screenshot_path)
print("Saved screenshot to:", screenshot_path)

cdp.close()
print("Minor 3 verification SUCCESSFUL!")
