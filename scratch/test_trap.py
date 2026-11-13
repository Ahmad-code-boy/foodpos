import urllib.request
import json
import websocket
import time

res = urllib.request.urlopen('http://127.0.0.1:9222/json')
tabs = json.loads(res.read().decode())
pos_tab = [p for p in tabs if p.get('type') == 'page'][0]
ws = websocket.create_connection(pos_tab['webSocketDebuggerUrl'], origin='http://127.0.0.1:9222')

def cdp(method, params=None):
    ws.send(json.dumps({'id': 1, 'method': method, 'params': params or {}}))
    return json.loads(ws.recv())

cdp('Page.addScriptToEvaluateOnNewDocument', {
    'source': """
    (function() {
        window.frappe = window.frappe || {};
        frappe.views = frappe.views || {};
        let _qr = undefined;
        Object.defineProperty(frappe.views, "QueryReport", {
            get() { return _qr; },
            set(cls) {
                _qr = cls;
                if (cls && cls.prototype) {
                    const orig = cls.prototype.setup_defaults;
                    cls.prototype.setup_defaults = function() {
                        if (orig) orig.call(this);
                        this.route = (frappe.get_route && frappe.get_route()) || [];
                        this.report_name = this.route[1] || "";
                        this.page_title = __(this.report_name || "Served KOT Exception List");
                    };
                }
            },
            configurable: true
        });

        frappe.utils = frappe.utils || {};
        let _st = undefined;
        Object.defineProperty(frappe.utils, "set_title", {
            get() { return _st; },
            set(fn) {
                _st = function(title) {
                    if (!title || String(title) === "undefined") {
                        const r = (frappe.get_route && frappe.get_route()) || [];
                        if (r && r[1]) title = __(r[1]);
                        else if (window.location.href.includes("Served")) title = "Served KOT Exception List";
                        else return;
                    }
                    return fn.call(this, title);
                };
            },
            configurable: true
        });
    })();
    """
})

cdp('Page.navigate', {'url': 'http://localhost:8001/app/query-report/Served%20KOT%20Exception%20List'})

def eval_expr(expr):
    ws.send(json.dumps({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}))
    return json.loads(ws.recv()).get('result', {}).get('result', {}).get('value')

titles = []
start = time.time()
while time.time() - start < 3:
    t = eval_expr('document.title')
    if t: titles.append(t)
    time.sleep(0.02)

print('Sampled titles:', list(dict.fromkeys(titles)))
has_undef = any('undefined' in str(t).lower() for t in titles)
print('Any undefined title:', has_undef)

ws.close()
