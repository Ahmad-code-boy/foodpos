import urllib.request, json, websocket, time

pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read().decode())
ws_url = [p['webSocketDebuggerUrl'] for p in pages if p.get('type') == 'page'][0]
ws = websocket.create_connection(ws_url)
call_id = 1
def cdp(method, params=None):
    global call_id
    call_id += 1
    cid = call_id
    ws.send(json.dumps({'id': cid, 'method': method, 'params': params or {}}))
    while True:
        d = json.loads(ws.recv())
        if d.get('id') == cid:
            return d.get('result', {})

def eval_expr(expr):
    res = cdp('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
    return res.get('result', {}).get('value')

eval_expr('frappe.set_route(["List", "Food POS Hold Order"])')
time.sleep(2)
print('Route for Hold Order:', eval_expr('frappe.get_route()'))
print('Dialog/msg:', eval_expr('$(".msgprint:visible, .modal-title:visible").text()'))
ws.close()
