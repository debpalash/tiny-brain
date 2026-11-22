"""Stage 1: download the larval brain data from the public L1 CATMAID server.
Usage: python3 -I fetch_catmaid.py <raw_dir>
Writes into <raw_dir>: neurons_annotations.json, links_pre.json, links_post.json,
skel/<skid>.json (per-skeleton summary incl. compartment labels of connector nodes).
Resumable. Read-only, anonymous, 4 worker threads."""
import json, os, sys, time, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catmaid_client import Client

SET_NAME = "mw brain and inputs"   # 3016 neurons = the paper's brain neuron set
raw = sys.argv[1]
os.makedirs(raw + "/skel", exist_ok=True)
c = Client()

# 1. neuron set + annotations
p = raw + "/neurons_annotations.json"
if not os.path.exists(p):
    anns = c.get("/1/annotations/")["annotations"]
    aid = [a["id"] for a in anns if a["name"] == SET_NAME][0]
    r = c.post("/1/annotations/query-targets",
               {"annotated_with": aid, "types": "neuron", "with_annotations": "true"})
    json.dump({"set_annotation_id": aid, "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **r}, open(p, "w"))
ents = json.load(open(p))["entities"]
skids = sorted(e["skeleton_ids"][0] for e in ents)
print("neurons", len(skids), flush=True)

# 2. connector links (pre and post) in chunks
for rel, name in (("presynaptic_to", "links_pre.json"), ("postsynaptic_to", "links_post.json")):
    p = raw + "/" + name
    if os.path.exists(p):
        continue
    links = []
    for i in range(0, len(skids), 100):
        d = {"relation_type": rel}
        for j, s in enumerate(skids[i:i + 100]):
            d["skeleton_ids[%d]" % j] = s
        links += c.post("/1/connectors/links/", d)["links"]
        print(rel, i, len(links), flush=True)
    json.dump(links, open(p, "w"))

# 3. per-skeleton summaries
need = {}
for name in ("links_pre.json", "links_post.json"):
    for l in json.load(open(raw + "/" + name)):
        need.setdefault(l[0], set()).add(l[7])


def summarise(skid):
    out = raw + "/skel/%d.json" % skid
    if os.path.exists(out):
        return
    cl = Client()
    nodes, _, tags = cl.get("/1/skeletons/%d/compact-detail?with_tags=true" % skid)[:3]
    par = {n[0]: n[1] for n in nodes}
    loc = {n[0]: n[3:6] for n in nodes}
    root = [n[0] for n in nodes if n[1] is None][0]
    n = len(nodes)
    mean = [sum(v[k] for v in loc.values()) / n for k in range(3)]
    soma = tags.get("soma", [])
    split = tags.get("mw axon split", [])
    starts = tags.get("mw axon start", [])
    ends = tags.get("mw axon end", [])
    # label every node: 'd' at root; switch at split/start nodes -> 'a'; at end nodes -> 'd'
    sw = {t: "a" for t in split + starts}
    sw.update({t: "d" for t in ends})
    children = {}
    for k, pp in par.items():
        children.setdefault(pp, []).append(k)
    label = {root: sw.get(root, "d")}
    stack = [root]
    while stack:
        k = stack.pop()
        for ch in children.get(k, []):
            label[ch] = sw.get(ch, label[k])
            stack.append(ch)
    summ = {"skeleton_id": skid, "n_nodes": n, "root": root, "root_xyz": loc[root], "mean_xyz": mean,
            "soma_nodes": soma, "soma_xyz": [loc[t] for t in soma if t in loc],
            "split_nodes": split, "axon_start": starts, "axon_end": ends,
            "labels": {str(t): label[t] for t in need.get(skid, ()) if t in label}}
    json.dump(summ, open(out, "w"))


t0 = time.time()
todo = [s for s in skids if not os.path.exists(raw + "/skel/%d.json" % s)]
print("skeletons to fetch", len(todo), flush=True)
with cf.ThreadPoolExecutor(4) as ex:
    for k, _ in enumerate(ex.map(summarise, todo)):
        if k % 100 == 0:
            print("skel", k, round(time.time() - t0), "s", flush=True)
print("done", flush=True)
