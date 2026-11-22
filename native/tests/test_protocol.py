"""Protocol test: starts larva_server on a free port, talks to it with a minimal RFC 6455 client (standard library only).
Run:  python3 -I tests/test_protocol.py /path/to/larva_server
"""
import base64, hashlib, json, os, signal, socket, struct, subprocess, sys, time

SERVER = sys.argv[1]
MAGIC = 0x314E5242
fails = []

def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        fails.append(msg)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

class Client:
    def __init__(self, port, origin=None):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET / HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n" % (port, key))
        if origin: req += "Origin: %s\r\n" % origin
        self.s.sendall((req + "\r\n").encode())
        while b"\r\n\r\n" not in self.buf:
            d = self.s.recv(4096)
            if not d: break
            self.buf += d
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        self.status = head.split(b"\r\n")[0].decode(errors="replace")
        self.accept_ok = False
        if " 101 " in self.status:
            exp = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.accept_ok = ("Sec-WebSocket-Accept: " + exp) in head.decode()
    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        hdr = bytes([0x81])
        n = len(data)
        hdr += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
        self.s.sendall(hdr + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))
    def recv(self, timeout=5.0):
        """Return ('text', dict) or ('bin', bytes) or None on timeout."""
        end = time.time() + timeout
        while True:
            if len(self.buf) >= 2:
                b0, b1 = self.buf[0], self.buf[1]
                ln = b1 & 0x7F; off = 2
                if ln == 126 and len(self.buf) >= 4: ln = struct.unpack(">H", self.buf[2:4])[0]; off = 4
                elif ln == 127 and len(self.buf) >= 10: ln = struct.unpack(">Q", self.buf[2:10])[0]; off = 10
                elif ln in (126, 127): ln = None
                if ln is not None and len(self.buf) >= off + ln:
                    payload = self.buf[off:off + ln]; self.buf = self.buf[off + ln:]
                    op = b0 & 0x0F
                    if op == 1: return ("text", json.loads(payload.decode()))
                    if op == 2: return ("bin", payload)
                    if op == 8: return None
                    continue
            left = end - time.time()
            if left <= 0: return None
            self.s.settimeout(left)
            try:
                d = self.s.recv(1 << 20)
            except socket.timeout:
                return None
            if not d: return None
            self.buf += d
    def next_text(self, typ=None, timeout=5.0, where=None):
        end = time.time() + timeout
        while time.time() < end:
            m = self.recv(max(0.05, end - time.time()))
            if m and m[0] == "text" and (typ is None or m[1].get("type") == typ) and (where is None or where(m[1])):
                return m[1]
        return None
    def latest_stats(self, wait=0.5):
        last = None
        end = time.time() + wait
        while time.time() < end:
            m = self.recv(0.1)
            if m and m[0] == "text" and m[1].get("type") == "stats": last = m[1]
        return last
    def fresh_stats(self, timeout=3.0):
        return self.next_text("stats", timeout)

port = free_port()
proc = subprocess.Popen([SERVER, "--port", str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    c = None
    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            c = Client(port)
            break
        except OSError:
            if proc.poll() is not None: break
            time.sleep(0.5)
    check(c is not None and " 101 " in c.status and c.accept_ok, "websocket handshake succeeds with a correct Sec-WebSocket-Accept")
    if c is None or " 101 " not in c.status:
        raise SystemExit(1)

    # ---- hello + neurons
    hello = c.next_text("hello")
    check(hello is not None, "first message is hello")
    check(hello["protocol"] == 1, "protocol version 1")
    net = hello["network"]
    check(net["neurons"] == 3016 and net["synapses"] == 337264, "hello network counts 3016 / 337264")
    check(len(net["caveats"]) >= 5 and all(isinstance(x, str) for x in net["caveats"]), "caveats present")
    check(hello["dtMs"] == 1, "dtMs")
    groups = hello["groups"]
    check(len(groups) == 8 and [g["id"] for g in groups] == list(range(8)), "8 groups with ids 0..7")
    check(sum(g["count"] for g in groups) == 3016, "group counts sum to neuron count")
    check(all(g["kind"] in ("sensor", "inter", "motor", "reward", "other") and isinstance(g["stimulable"], bool) for g in groups), "group kinds valid")
    check(groups[0]["kind"] == "sensor" and groups[5]["kind"] == "reward", "smell group is sensor, reward group is reward")
    plastic = [p for p in hello["pathways"] if p["plastic"]]
    check(len(plastic) == 1 and plastic[0]["fromGroup"] == 3 and plastic[0]["toGroup"] == 4 and plastic[0]["synapses"] == 17778, "exactly one plastic pathway: Kenyon cells -> output neurons (17778 synapses)")
    check(len(hello["pathways"]) >= 4, "at least 4 pathways")
    check(len(hello["odours"]) >= 2 and all(o["sensors"] > 0 for o in hello["odours"]), "at least two odours with sensors")
    neurons = c.next_text("neurons")
    check(neurons is not None, "neurons message follows hello")
    N = 3016
    keys = ["group", "side", "x", "y", "z", "hasPosition", "sign", "signKnown", "name"]
    check(all(len(neurons[k]) == N for k in keys), "neurons arrays all length 3016")
    check(set(neurons["sign"]) <= {1, -1} and set(neurons["signKnown"]) <= {0, 1}, "sign / signKnown values valid")
    check(sum(neurons["signKnown"]) < 700 and -1 in neurons["sign"], "signKnown minority; some inhibitory")

    # ---- binary frames
    frames = []
    stats_msgs = []
    t_end = time.time() + 2.0
    while time.time() < t_end:
        m = c.recv(0.2)
        if m is None: continue
        if m[0] == "bin": frames.append(m[1])
        elif m[1].get("type") == "stats": stats_msgs.append(m[1])
    check(len(frames) >= 10, "binary frames arrive (%d in 2 s, <= 30/s)" % len(frames))
    check(len(frames) <= 70, "frame rate bounded")
    ok = True; seqs = []
    for f in frames:
        magic, seq, st, count = struct.unpack("<IIdI", f[:20])
        ok = ok and magic == MAGIC and count == N and len(f) == 20 + N
        seqs.append(seq)
    check(ok, "frames: magic BRN1, count 3016, length 20+3016")
    check(all(b > a for a, b in zip(seqs, seqs[1:])), "frame sequence strictly increasing")
    check(len(stats_msgs) >= 4, "stats about 5/s (%d in 2 s)" % len(stats_msgs))
    s = stats_msgs[-1]
    check(len(s["groupRateHz"]) == 8 and len(s["pathwayStrength"]) == len(hello["pathways"]), "stats array lengths")
    check(0.3 < sum(s["groupRateHz"]) / 8 < 10 and s["learning"] is True and s["paused"] is False and s["odour"] is None, "stats sane at rest")
    check(0.8 < s["realtimeFactor"] < 1.3, "realtimeFactor ~1 at speed 1 (%.2f)" % s["realtimeFactor"])
    check(abs(s["pathwayStrength"][0] - 1.0) < 1e-3, "plastic pathway starts at strength 1")

    # ---- odour: seconds are SIMULATED seconds
    base = c.latest_stats(0.6)
    rest_smell = base["groupRateHz"][0]
    c.send({"type": "setSpeed", "speed": 4})
    c.send({"type": "odour", "odour": 0, "seconds": 8})
    s1 = c.next_text("stats", 3, lambda m: m["odour"] == 0)
    check(s1 is not None and s1["odourSecondsLeft"] <= 8.0, "odour shows in stats")
    t_a = time.time()
    time.sleep(1.5)
    s2 = c.latest_stats(0.3)
    elapsed = time.time() - t_a
    used = s1["odourSecondsLeft"] - s2["odourSecondsLeft"]
    check(s2["speed"] == 4 and 4.0 <= used <= 4.0 * (elapsed + 0.4) and used > 1.5 * elapsed, "odour seconds are simulated time: %.2f simulated s used in %.2f wall s at speed 4" % (used, elapsed))
    check(s2["groupRateHz"][0] > rest_smell + 5, "odour raises smell-sensor rate (%.1f -> %.1f Hz)" % (rest_smell, s2["groupRateHz"][0]))
    check(s2["stimuli"] == [], "odour is not listed among group stimuli")
    c.send({"type": "clearStimuli"})
    s3 = c.next_text("stats", 3, lambda m: m["odour"] is None)
    check(s3 is not None, "clearStimuli stops odour")
    c.send({"type": "setSpeed", "speed": 1})

    # ---- stimulate
    c.send({"type": "stimulate", "group": 1, "rateHz": 40, "seconds": 30})
    s4 = c.next_text("stats", 3, lambda m: len(m["stimuli"]) == 1)
    check(s4 is not None and s4["stimuli"][0]["group"] == 1 and s4["stimuli"][0]["rateHz"] == 40 and s4["stimuli"][0]["secondsLeft"] > 20, "stimulate listed in stats")
    time.sleep(0.8)
    s5 = c.latest_stats(0.3)
    check(s5["groupRateHz"][1] > 5, "stimulated group fires faster (%.1f Hz)" % s5["groupRateHz"][1])
    c.send({"type": "clearStimuli"})
    check(c.next_text("stats", 3, lambda m: m["stimuli"] == []) is not None, "clearStimuli empties stimuli")

    # ---- reward / punishment + learning + forget
    c.send({"type": "setSpeed", "speed": 16})
    c.send({"type": "odour", "odour": 0, "seconds": 40})
    c.send({"type": "reward", "value": 1, "seconds": 40})
    s6 = c.next_text("stats", 3, lambda m: m["reward"] == 1)
    check(s6 is not None, "reward value reported in stats")
    time.sleep(1.0)
    s7 = c.latest_stats(0.4)
    check(s7["groupRateHz"][5] > 10, "reward drives the reward-neuron group (%.1f Hz)" % s7["groupRateHz"][5])
    c.send({"type": "clearStimuli"})
    s8 = c.next_text("stats", 20, lambda m: m["odour"] is None and m["reward"] == 0)
    check(s8 is not None and s8["pathwayStrength"][0] < 0.99, "pairing odour + reward weakens KC->MBON (strength %.4f)" % (s8["pathwayStrength"][0] if s8 else -1))
    c.send({"type": "forget"})
    s9 = c.next_text("stats", 3, lambda m: abs(m["pathwayStrength"][0] - 1.0) < 1e-3)
    check(s9 is not None, "forget restores starting weights")
    c.send({"type": "setLearning", "on": False})
    sl = c.next_text("stats", 3, lambda m: m["learning"] is False)
    check(sl is not None, "setLearning off is reported")
    c.send({"type": "odour", "odour": 0, "seconds": 6}); c.send({"type": "reward", "value": 1, "seconds": 6})
    time.sleep(1.0)
    c.send({"type": "reward", "value": -1, "seconds": 1})
    sp = c.next_text("stats", 3, lambda m: m["reward"] == -1)
    check(sp is not None, "punishment value reported")
    s10 = c.next_text("stats", 20, lambda m: m["odour"] is None and m["reward"] == 0)
    check(s10 is not None and abs(s10["pathwayStrength"][0] - 1.0) < 1e-3, "no learning while learning is off")
    c.send({"type": "setLearning", "on": True})
    c.send({"type": "setSpeed", "speed": 1})

    # ---- pause
    c.send({"type": "setPaused", "paused": True})
    sp1 = c.next_text("stats", 3, lambda m: m["paused"] is True)
    check(sp1 is not None, "paused reported")
    time.sleep(0.5)
    a = c.latest_stats(0.5); time.sleep(1.0); b = c.latest_stats(0.5)
    check(a["simTime"] == b["simTime"], "simTime frozen while paused")
    c.send({"type": "setPaused", "paused": False})
    sr = c.next_text("stats", 3, lambda m: m["paused"] is False)
    time.sleep(0.6)
    d = c.latest_stats(0.4)
    check(d["simTime"] > b["simTime"], "simTime advances after resume")

    # ---- inspect
    # pick a Kenyon cell (group 3)
    kc = neurons["group"].index(3)
    c.send({"type": "inspect", "neuron": kc})
    det = c.next_text("neuronDetail", 3)
    check(det is not None and det["neuron"] == kc, "inspect replies with neuronDetail")
    check(det["inDegree"] > 0 and 0 < len(det["inputs"]) <= 12 and len(det["outputs"]) <= 12, "detail has partners (<=12 each)")
    check(all(det["inputs"][i]["synapses"] >= det["inputs"][i + 1]["synapses"] for i in range(len(det["inputs"]) - 1)), "inputs strongest first")
    check(all(abs(p["strength"] - 1.0) < 1e-6 for p in det["inputs"] + det["outputs"]), "strengths 1 before learning")
    det2 = c.next_text("neuronDetail", 2.5)
    check(det2 is not None, "neuronDetail resent about once a second")
    c.send({"type": "inspect", "neuron": None})
    drain_end = time.time() + 0.5
    while time.time() < drain_end: c.recv(0.1)
    ndet = c.next_text("neuronDetail", 1.8)
    check(ndet is None, "inspect null stops neuronDetail")
    c.send({"type": "inspect", "neuron": 99999})
    check(c.next_text("error", 3) is not None, "out-of-range inspect gives error")
    c.send({"type": "odour", "odour": 7, "seconds": 1})
    check(c.next_text("error", 3) is not None, "bad odour id gives error")

    # ---- reset keeps sequence monotonic, restarts time
    last_seq = None
    for _ in range(40):
        m = c.recv(0.1)
        if m and m[0] == "bin": last_seq = struct.unpack("<I", m[1][4:8])[0]
    c.send({"type": "reset"})
    time.sleep(0.5)
    pre = None; post_seqs = []; post_t = []
    end = time.time() + 1.0
    while time.time() < end:
        m = c.recv(0.1)
        if m and m[0] == "bin":
            sq, st = struct.unpack("<Id", m[1][4:16]); post_seqs.append(sq); post_t.append(st)
    check(post_seqs and last_seq is not None and min(post_seqs) > last_seq, "frame sequence keeps increasing across reset")
    check(post_t and max(post_t) < 5.0, "reset restarts simulated time (t=%.2f)" % max(post_t))

    # ---- one viewer at a time, Origin check
    c2 = Client(port)
    check(" 503 " in c2.status, "second viewer is refused while one is connected (%s)" % c2.status)
    c.s.close()
    time.sleep(0.5)
    bad = Client(port, origin="http://evil.example")
    check(" 403 " in bad.status, "foreign Origin rejected (%s)" % bad.status)
    bad2 = Client(port, origin="http://localhost.evil.example")
    check(" 403 " in bad2.status, "look-alike Origin rejected (%s)" % bad2.status)
    good = Client(port, origin="http://localhost:5173")
    check(" 101 " in good.status, "http://localhost:5173 Origin accepted")
    good.s.close(); time.sleep(0.5)
    good2 = Client(port, origin="http://127.0.0.1:3000")
    check(" 101 " in good2.status, "http://127.0.0.1:3000 Origin accepted")
    good2.s.close()
finally:
    proc.send_signal(signal.SIGTERM)
    try: proc.wait(10)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
print("FAILED: %d" % len(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
