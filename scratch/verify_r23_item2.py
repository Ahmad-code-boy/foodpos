import urllib.request
import json
import websocket
import time
import base64

res = urllib.request.urlopen('http://127.0.0.1:9222/json')
tabs = json.loads(res.read().decode())
pos_tab = [p for p in tabs if p.get('type') == 'page'][0]
ws_url = pos_tab['webSocketDebuggerUrl']
ws = websocket.create_connection(ws_url, origin='http://127.0.0.1:9222', timeout=15)
msg_id = 0

def send(method, params=None):
    global msg_id
    msg_id += 1
    ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
    while True:
        resp = json.loads(ws.recv())
        if resp.get('id') == msg_id:
            return resp.get('result', {})

def eval_expr(expr):
    res = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
    return res.get('result', {}).get('value')

def capture_screenshot(path):
    res = send('Page.captureScreenshot', {'format': 'png'})
    with open(path, 'wb') as f:
        f.write(base64.b64decode(res['data']))

# Reload page to get fresh bundle
eval_expr('window.location.reload()')
time.sleep(4)

# Wait for foodpos to initialize
for _ in range(15):
    ready = eval_expr('Boolean(window.cur_pos && window.cur_pos.wrapper)')
    if ready: break
    time.sleep(1)

print('POS ready:', eval_expr('Boolean(window.cur_pos)'))

# Test Held Orders drawer for FP-HOLD-2026-00019/00020
eval_expr('cur_pos.show_held_orders_drawer()')
time.sleep(1.5)

held_text = eval_expr('$(".fpos-held-body").text()')
print('Held drawer contains Table 5:', 'Table 5' in str(held_text))
print('Held drawer contains raw Branch 1 - Gulberg-5:', 'Branch 1 - Gulberg-5' in str(held_text))

capture_screenshot('/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/r23_item2_held_drawer_table5.png')

# Hide held drawer
eval_expr('cur_pos.hide_held_orders_drawer()')
time.sleep(0.5)

# Test Recent Orders & Slip modal for BR1-2026-00039
eval_expr('cur_pos.show_recent_orders_drawer()')
time.sleep(1.5)

# Click View Slip for BR1-2026-00039 or first card
eval_expr("""$('.fpos-recent-card:contains("BR1-2026-00039")').find('.fpos-view-slip-btn').click()""")
time.sleep(1.5)

receipt_visible = eval_expr('$(".fpos-slip-modal-container").is(":visible")')
receipt_html = eval_expr('$(".fpos-slip-card").html()')
print('Receipt modal visible:', receipt_visible)
print('Receipt has Dine In (Table 3):', 'Dine In (Table 3)' in str(receipt_html))
print('Receipt has raw T-Branch 1 - Gulberg-3:', 'T-Branch 1 - Gulberg-3' in str(receipt_html))

capture_screenshot('/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/r23_item2_receipt_modal_table3.png')

ws.close()
print("Item 2 proof complete!")
