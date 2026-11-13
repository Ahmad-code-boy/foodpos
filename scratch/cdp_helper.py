import urllib.request, json, websocket

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

    def close(self):
        self.ws.close()
