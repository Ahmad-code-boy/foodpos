import urllib.request
import urllib.parse
import json
import websocket
import time

login_data = urllib.parse.urlencode({"usr": "Administrator", "pwd": "admin"}).encode()
req = urllib.request.Request("http://localhost:8001/api/method/login", data=login_data)
resp = urllib.request.urlopen(req)
cookie_headers = resp.headers.get_all("Set-Cookie")
sid = [ch.split("sid=")[1].split(";")[0] for ch in cookie_headers if "sid=" in ch][0]

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

cdp("Network.enable")
cdp("Network.setCookie", {"name": "sid", "value": sid, "domain": "localhost", "path": "/"})

cdp("Page.navigate", {"url": "http://localhost:8001/desk/foodpos/food-pos"})
time.sleep(5)

# Test opening a blob print tab with noopener
test_js = """
(() => {
    const html = `<!DOCTYPE html>
    <html>
    <head><title>POS Receipt - TEST-001</title></head>
    <body>
        <h1>Receipt Slip TEST-001</h1>
        <p>Testing non-blocking print flow</p>
        <script>
            window.addEventListener('load', () => {
                setTimeout(() => {
                    try { window.print(); } catch(e) {}
                }, 200);
            });
        </script>
    </body>
    </html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener,noreferrer,width=400,height=600');
    return { url: url, opened: Boolean(win) };
})()
"""

res = eval_expr(test_js)
print("Blob window open result:", res)
time.sleep(2)

all_targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
print("Active targets in Chrome:")
for t in all_targets:
    print(" -", t.get("type"), t.get("title"), t.get("url")[:60])

# Verify parent page is completely responsive:
responsive_test = eval_expr("1 + 1")
print("Parent page responsive (1+1):", responsive_test)

ws.close()
