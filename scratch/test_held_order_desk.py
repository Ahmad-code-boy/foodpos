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

print('Current route before:', eval_expr('frappe.get_route()'))
eval_expr('frappe.set_route(["List", "Food POS Held Order"])')
time.sleep(2)
print('Current route after:', eval_expr('frappe.get_route()'))
print('Title:', eval_expr('$(".title-text:visible").text()'))
print('List rows:', eval_expr('$(".list-row").length'))
print('First 3 row names:', eval_expr('$(".list-row .list-subject").map(function() { return $(this).text().trim(); }).get().slice(0, 5)'))
ws.close()
