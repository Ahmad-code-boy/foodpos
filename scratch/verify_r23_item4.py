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
    res = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
    return res.get('result', {}).get('value')

def capture_screenshot(path):
    res = send('Page.captureScreenshot', {'format': 'png'})
    with open(path, 'wb') as f:
        f.write(base64.b64decode(res['data']))

print('Navigating to Desk Served KOT Exception List report...')
send('Page.navigate', {'url': 'http://localhost:8001/app/query-report/Served%20KOT%20Exception%20List'})

# Poll document.title repeatedly every 20ms during load to check for any 'undefined' flash
titles_sampled = []
start = time.time()
while time.time() - start < 3.0:
    t = eval_expr('document.title')
    if t:
        titles_sampled.append(t)
    time.sleep(0.02)

print('Titles sampled during load (unique):', list(dict.fromkeys(titles_sampled)))
has_undefined = any('undefined' in str(t).lower() for t in titles_sampled)
print('Any undefined title observed:', has_undefined)

# Wait for report datatable to render
time.sleep(2)
final_title = eval_expr('document.title')
print('Final document title:', final_title)

capture_screenshot('/home/shahid/.gemini/antigravity/brain/bec9e9b1-b042-4900-aea7-d86cec648797/r23_item4_desk_report_static_title_proof.png')

ws.close()
assert not has_undefined, f'FAILED: "undefined" flashed during report load: {titles_sampled}'
assert 'Served KOT Exception List' in final_title, f'FAILED: Expected "Served KOT Exception List" in title, got {final_title}'
print('Item 4 proof PASS: Zero "undefined" flash observed, static title enforced!')
