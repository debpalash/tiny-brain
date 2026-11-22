"""Stage 2: convert raw CATMAID downloads into data/larva/{neurons,synapses}.csv.
Usage: python3 -I build_larva.py <raw_catmaid_dir> <out_dir>
Standard library only. Nothing is imputed: fields that cannot be derived from the
downloaded data are left empty."""
import csv, collections, json, os, re, sys

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
meta = json.load(open(raw + "/neurons_annotations.json"))
ents = sorted(meta["entities"], key=lambda e: e["skeleton_ids"][0])
N = len(ents)
skid = [e["skeleton_ids"][0] for e in ents]
idx = {s: i for i, s in enumerate(skid)}
ann = [{a["name"] for a in e["annotations"]} for e in ents]

# ---- hemisphere (soma side annotation 'mw left' / 'mw right')
def hemi(a):
    l, r = "mw left" in a, "mw right" in a
    return "left" if l and not r else "right" if r and not l else "center" if not l and not r and False else ""

# ---- broad class: first match in priority order (mirrors the authors' priority map);
# all matching classes are also written to all_classes.
CLASS_ANN = [  # (broad_class, annotation)
    ("MBON", "mw MBON"), ("MBIN", "mw MBIN"), ("Kenyon cell", "mw KC"),
    ("projection neuron", "mw uPN"), ("projection neuron", "mw tPN"),
    ("projection neuron", "mw vPN"), ("projection neuron", "mw mPN"),
    ("sensory", "mw sens"), ("APL", "APL"),
    ("lateral horn neuron", "mw LHN"), ("convergence neuron", "mw CN"),
    ("descending to VNC", "mw dVNC"), ("descending to SEZ", "mw dSEZ"),
    ("ring gland", "mw RGN"), ("descending unknown", "mw dUnk"),
    ("MB feedback (FBN)", "mw FBN"), ("MB feedforward (FFN)", "mw FFN"),
    ("MB feedback-to-feedback (FB2N)", "mw FB2N"), ("MB feedback-to-anything (FAN)", "mw FAN"),
    ("A00c", "mw A00c"), ("local neuron", "mw LN"),
    ("ascending", "mw brain ascending from SEZ/VNC"), ("ascending", "mw ascending temp"),
    ("LON", "mw LON"),
]

def classes(a):
    out = []
    for c, k in CLASS_ANN:
        if k in a and c not in out:
            out.append(c)
    return out

def cell_type(cls, a):
    t = ""
    if cls == "sensory":
        for k, v in (("mw sens subclass_ORN", "ORN"), ("mw sens subclass_AN", "AN"), ("mw sens subclass_MN", "MN"),
                     ("mw sens subclass_photoRh5", "photoreceptor Rh5"), ("mw sens subclass_photoRh6", "photoreceptor Rh6"),
                     ("mw sens subclass_thermo", "thermo"), ("mw sens subclass_vtd", "vtd")):
            if k in a: t = v
    elif cls == "Kenyon cell":
        m = [k for k in a if k.startswith("mw KC_subclass_")]
        t = m[0].replace("mw KC_subclass_", "") if m else ""
    elif cls == "MBON":
        m = [k.replace("mw MBON subclass_", "") for k in a if k.startswith("mw MBON subclass_")]
        t = m[0] if m else ""
    elif cls == "MBIN":
        t = "DAN" if "mw MBIN subclass_DAN" in a else "OAN" if ("mw octopaminergic" in a or "OANs" in a) else ""
    elif cls == "projection neuron":
        t = next((n for n in ("uPN", "tPN", "vPN", "mPN") if "mw " + n in a), "")
        m = [k.replace("mw mPN subclass_", "") for k in a if k.startswith("mw mPN subclass_")]
        if m: t += " (" + m[0] + ")"
    elif cls == "ring gland":
        m = [k.replace("mw RGN subclass_", "") for k in a if k.startswith("mw RGN subclass_")]
        t = m[0] if m else ""
    elif cls == "local neuron":
        m = [k for k in ("mw broad LN subclass_Duet", "mw broad LN subclass_Trio", "mw picky LN", "mw choosy LN", "mw preliminary LN") if k in a]
        t = m[0].replace("mw ", "").replace("broad LN subclass_", "broad LN ") if m else ""
    return t

def modality(cls, a):
    if cls != "sensory": return ""
    if "mw sens subclass_ORN" in a or "mw ORN" in a: return "olfactory"
    if "mw photoreceptors" in a: return "visual"
    if "mw thermosensories" in a or "SH_thermo" in a or "mw sens subclass_thermo" in a: return "thermosensory"
    if "pharyngeal chemosensory" in a: return "gustatory (pharyngeal)"
    if "external chemosensory" in a: return "gustatory (external)"
    if "pharyngeal mechanosensory" in a or "PPS mechano" in a: return "mechanosensory (pharyngeal)"
    if "enteric sensory" in a or "mw AN enteric" in a: return "enteric"
    if "external somatosensory" in a: return "somatosensory (external)"
    return ""

TX = [("acetylcholine", "acetylcholine"), ("mw cholinergic", "acetylcholine"), ("GABA", "GABA"),
      ("mw GABAergic", "GABA"), ("glutamate", "glutamate"), ("mw glutamatergic", "glutamate"),
      ("dopamine", "dopamine"), ("mw dopaminergic", "dopamine"), ("octopamine", "octopamine"),
      ("mw octopaminergic", "octopamine")]

def transmitter(a):
    vals, src = [], []
    for k, v in TX:
        if k in a:
            src.append(k)
            if v not in vals: vals.append(v)
    return ("/".join(vals) if len(vals) < 2 else "conflict:" + "/".join(vals)), ";".join(src)

# ---- pairs: only explicit pair annotations that name exactly one left and one right neuron
pairs, psrc = {}, {}
members = collections.defaultdict(list)
for i, a in enumerate(ann):
    for k in a:
        if re.match(r"^hemilateral_pair_\d+_\d+$", k) or re.match(r"^mw paired \d+ \(ds mPNs\)$", k):
            members[k].append(i)
for k, m in members.items():
    if len(m) == 2 and {hemi(ann[m[0]]), hemi(ann[m[1]])} == {"left", "right"}:
        for x, y in (m, m[::-1]):
            if x in pairs and pairs[x] != y: pairs[x] = None   # conflicting evidence -> drop
            elif x not in pairs: pairs[x], psrc[x] = y, k.split("_")[0] if k.startswith("hemilateral") else "mw paired (ds mPNs)"
pairs = {k: v for k, v in pairs.items() if v is not None and pairs.get(v) == k}

# ---- positions
fields = ["index", "skeleton_id", "name", "hemisphere", "broad_class", "all_classes", "cell_type",
          "sensory_modality", "transmitter", "transmitter_source", "x", "y", "z", "position_source",
          "pair_partner_index", "pair_source"]
rows = []
for i, e in enumerate(ents):
    s = json.load(open(raw + "/skel/%d.json" % skid[i]))
    if s["soma_xyz"]: pos, src = s["soma_xyz"][0], "soma_tag" + ("" if len(s["soma_xyz"]) == 1 else "(first of %d)" % len(s["soma_xyz"]))
    elif s["root_xyz"]: pos, src = s["root_xyz"], "skeleton_root"
    else: pos, src = s["mean_xyz"], "node_mean"
    cl = classes(ann[i]); bc = cl[0] if cl else "unclassified"
    tx, txs = transmitter(ann[i])
    rows.append({"index": i, "skeleton_id": skid[i], "name": e["name"], "hemisphere": hemi(ann[i]),
                 "broad_class": bc, "all_classes": ";".join(cl), "cell_type": cell_type(bc, ann[i]),
                 "sensory_modality": modality(bc, ann[i]), "transmitter": tx, "transmitter_source": txs,
                 "x": round(pos[0], 1), "y": round(pos[1], 1), "z": round(pos[2], 1), "position_source": src,
                 "pair_partner_index": pairs.get(i, ""), "pair_source": psrc.get(i, "")})
with open(out + "/neurons.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(rows)

# ---- synapses: connector -> (pre links, post links); each (connector, post link) = one synapse
lab = {}
for i in range(N):
    lab[skid[i]] = json.load(open(raw + "/skel/%d.json" % skid[i]))["labels"]
def comp(sk, node):
    return lab[sk].get(str(node), "?")
pre = collections.defaultdict(list)
for l in json.load(open(raw + "/links_pre.json")): pre[l[1]].append((l[0], l[7]))
cnt = collections.Counter()
n_syn = n_unlabeled = n_multi_pre = 0
for l in json.load(open(raw + "/links_post.json")):
    sk, cid, tn = l[0], l[1], l[7]
    for psk, ptn in pre.get(cid, ()):
        n_syn += 1
        a, b = comp(psk, ptn), comp(sk, tn)
        if a == "?" or b == "?": n_unlabeled += 1; a = "d" if a == "?" else a; b = "d" if b == "?" else b
        cnt[(idx[psk], idx[sk], a + b)] += 1
    if len(pre.get(cid, ())) > 1: n_multi_pre += 1
edges = collections.defaultdict(lambda: {"ad": 0, "aa": 0, "dd": 0, "da": 0})
for (p, q, t), c in cnt.items(): edges[(p, q)][{"aa": "aa", "ad": "ad", "dd": "dd", "da": "da"}[t]] += c
# unsplit neurons are treated as 'dendrite' for the four-way split (authors' convention)
with open(out + "/synapses.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pre_index", "post_index", "count", "axon_dendrite", "axon_axon", "dendrite_dendrite", "dendrite_axon"])
    for (p, q) in sorted(edges):
        d = edges[(p, q)]
        w.writerow([p, q, sum(d.values()), d["ad"], d["aa"], d["dd"], d["da"]])
print("neurons", N, "edges", len(edges), "synapses", n_syn, "unlabeled-node synapses", n_unlabeled, "connectors with >1 pre in set", n_multi_pre)
