import urllib.request
import json
import websocket
import time
import base64

res = urllib.request.urlopen('http://127.0.0.1:9222/json')
tabs = json.loads(res.read().decode())
pos_tab = [p for p in tabs if p.get('type') == 'page' and 'food-pos' in p.get('url', '')][0]
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
    res = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
    return res.get('result', {}).get('value')

def capture_screenshot(path):
    res = send('Page.captureScreenshot', {'format': 'png'})
    with open(path, 'wb') as f:
        f.write(base64.b64decode(res['data']))

def get_page_targets():
    r = urllib.request.urlopen('http://127.0.0.1:9222/json')
    t = json.loads(r.read().decode())
    return [p for p in t if p.get('type') == 'page']

# Reload page to get fresh bundle
eval_expr('window.location.reload()')
time.sleep(4)

# Wait for foodpos to initialize
for _ in range(15):
    ready = eval_expr('Boolean(window.cur_pos && window.cur_pos.wrapper)')
    if ready: break
    time.sleep(1)

print('POS ready:', eval_expr('Boolean(window.cur_pos)'))

initial_tabs = get_page_targets()
print('Initial page tabs count:', len(initial_tabs))

# Show Recent Orders drawer
eval_expr('cur_pos.show_recent_orders_drawer()')
time.sleep(1.5)

# Click View Slip for BR1-2026-00039
eval_expr("""$('.fpos-recent-card:contains("BR1-2026-00039")').find('.fpos-view-slip-btn').click()""")
time.sleep(1.5)

receipt_visible = eval_expr('$(".fpos-slip-modal-container").is(":visible")')
print('Receipt modal visible:', receipt_visible)

# Click Print Slip button ONCE
print('Clicking Print Slip button once...')
eval_expr("""$('.fpos-print-slip-btn').click()""")
time.sleep(1.5)

after_print_tabs = get_page_targets()
print('After click page tabs count:', len(after_print_tabs))
new_tabs = [t for t in after_print_tabs if t['id'] not in [x['id'] for x in initial_tabs]]
print('Number of newly opened tabs:', len(new_tabs))

for idx, nt in enumerate(new_tabs):
    print(f'New tab {idx+1}: id={nt.get("id")}, title={nt.get("title")}, url={nt.get("url")}')

capture_screenshot('/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/r23_item3_single_print_tab_proof.png')

# Clean up opened tabs
for nt in new_tabs:
    try:
        urllib.request.urlopen(f'http://127.0.0.1:9222/json/close/{nt["id"]}')
    except Exception as e:
        pass

ws.close()
assert len(new_tabs) == 1, f'Expected exactly 1 new tab, found {len(new_tabs)}'
print('Item 3 proof PASS: One click opened strictly ONE tab!')
