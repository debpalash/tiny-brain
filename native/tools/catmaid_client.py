"""Minimal anonymous client for the public L1 larval CATMAID server (stdlib only).
Read-only queries; generic User-Agent; no credentials."""
import http.cookiejar, json, urllib.parse, urllib.request

BASE = "https://l1em.catmaid.virtualflybrain.org"
UA = "Mozilla/5.0 (compatible; data-fetch)"


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.op.addheaders = [("User-Agent", UA)]
        self.op.open(BASE + "/").read()  # sets csrftoken cookie
        self.tok = next(c.value for c in self.cj if "csrf" in c.name.lower())

    def post(self, path, data):
        body = urllib.parse.urlencode(data, doseq=True).encode()
        req = urllib.request.Request(BASE + path, data=body, headers={
            "X-CSRFToken": self.tok, "Referer": BASE + "/",
            "Content-Type": "application/x-www-form-urlencoded"})
        return json.load(self.op.open(req, timeout=300))

    def get(self, path):
        return json.load(self.op.open(BASE + path, timeout=300))
