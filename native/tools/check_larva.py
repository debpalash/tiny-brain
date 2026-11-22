"""Stage 3: sanity checks and counts on data/larva/*.csv.  Usage: python3 -I check_larva.py <larva_dir>"""
import csv, collections, statistics, sys
d = sys.argv[1]
N = list(csv.DictReader(open(d + "/neurons.csv")))
S = list(csv.DictReader(open(d + "/synapses.csv")))
n = len(N)
def P(*a): print(*a)
P("== totals (paper: ~3,016 neurons, ~548,000 synapses)")
tot = sum(int(r["count"]) for r in S)
P("neurons", n, "| connected pairs", len(S), "| total synapses (sum of count)", tot)
P("type sums:", {k: sum(int(r[k]) for r in S) for k in ["axon_dendrite", "axon_axon", "dendrite_dendrite", "dendrite_axon"]})
ids = [r["skeleton_id"] for r in N]
P("duplicate skeleton ids", n - len(set(ids)), "| index dense 0..n-1:", [int(r["index"]) for r in N] == list(range(n)))
P("self-connections (pairs / synapses)", sum(r["pre_index"] == r["post_index"] for r in S), sum(int(r["count"]) for r in S if r["pre_index"] == r["post_index"]))
P("duplicate (pre,post) rows", len(S) - len({(r["pre_index"], r["post_index"]) for r in S}))
bad = sum(1 for r in S if int(r["count"]) != sum(int(r[k]) for k in ["axon_dendrite", "axon_axon", "dendrite_dendrite", "dendrite_axon"]))
P("rows where count != sum of types", bad)
cls = {r["index"]: r for r in N}
outd, ind, outs, ins = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
for r in S:
    outd[r["pre_index"]] += 1; ind[r["post_index"]] += 1
    outs[r["pre_index"]] += int(r["count"]); ins[r["post_index"]] += int(r["count"])
def summ(name, c):
    v = sorted(c.get(r["index"], 0) for r in N)
    P(f"{name}: min {v[0]} median {statistics.median(v)} mean {sum(v)/n:.1f} p90 {v[int(.9*n)]} p99 {v[int(.99*n)]} max {v[-1]} zeros {sum(x==0 for x in v)}")
P("== degree (distinct partners / synapse totals)")
summ("out-degree", outd); summ("in-degree", ind); summ("out-synapses", outs); summ("in-synapses", ins)
P("isolated neurons (no in or out edges, self excluded):", sum(1 for r in N if r["index"] not in outd and r["index"] not in ind))
P("== broad classes (total / left / right)")
c = collections.Counter(r["broad_class"] for r in N)
for k, v in c.most_common():
    P(f"{k:34s}{v:5d}{sum(1 for r in N if r['broad_class']==k and r['hemisphere']=='left'):6d}{sum(1 for r in N if r['broad_class']==k and r['hemisphere']=='right'):6d}")
P("== sensory modality"); P(collections.Counter(r["sensory_modality"] or "(none)" for r in N if r["broad_class"] == "sensory"))
P("== mushroom-body pathway pieces, per hemisphere")
def grp(f): return [r for r in N if f(r)]
orn = grp(lambda r: r["cell_type"] == "ORN" and r["broad_class"] == "sensory")
pn = grp(lambda r: r["broad_class"] == "projection neuron")
olf_pn = grp(lambda r: r["broad_class"] == "projection neuron" and r["cell_type"] in ("uPN", "mPN (olfactory)", "tPN", "vPN") )
kc = grp(lambda r: r["broad_class"] == "Kenyon cell")
mbon = grp(lambda r: r["broad_class"] == "MBON")
mbin = grp(lambda r: r["broad_class"] == "MBIN")
dan = [r for r in mbin if r["cell_type"] == "DAN"]
for name, g in [("ORN", orn), ("PN (all)", pn), ("  uPN", [r for r in pn if r["cell_type"] == "uPN"]), ("KC", kc), ("MBON", mbon), ("MBIN (all)", mbin), ("  DAN", dan), ("  OAN", [r for r in mbin if r["cell_type"] == "OAN"]), ("APL", grp(lambda r: r["broad_class"] == "APL"))]:
    P(f"{name:12s} total {len(g):4d} left {sum(r['hemisphere']=='left' for r in g):4d} right {sum(r['hemisphere']=='right' for r in g):4d}")
def edge_sum(A, B):
    a = {r["index"] for r in A}; b = {r["index"] for r in B}
    es = [r for r in S if r["pre_index"] in a and r["post_index"] in b]
    return len(es), sum(int(r["count"]) for r in es)
P("== pathway edges (pairs, synapses)")
P("ORN->PN ", edge_sum(orn, pn)); P("ORN->uPN", edge_sum(orn, [r for r in pn if r["cell_type"] == "uPN"]))
P("PN->KC  ", edge_sum(pn, kc)); P("KC->MBON", edge_sum(kc, mbon)); P("MBIN->KC", edge_sum(mbin, kc)); P("MBIN->MBON", edge_sum(mbin, mbon))
P("DAN->KC ", edge_sum(dan, kc)); P("DAN->MBON", edge_sum(dan, mbon)); P("KC->KC  ", edge_sum(kc, kc)); P("MBON->MBIN", edge_sum(mbon, mbin))
P("ORN->any", edge_sum(orn, N)); P("PN->any", edge_sum(pn, N))
P("== coverage")
P("transmitter known:", sum(1 for r in N if r["transmitter"]), "of", n, collections.Counter(r["transmitter"] for r in N if r["transmitter"]))
P("transmitter conflicts:", sum(1 for r in N if r["transmitter"].startswith("conflict")))
for k in ("KC", "MBON", "MBIN"):
    g = {"KC": kc, "MBON": mbon, "MBIN": mbin}[k]; P(f"  transmitter known in {k}:", sum(1 for r in g if r["transmitter"]), "of", len(g))
P("positions present:", sum(1 for r in N if r["x"] != ""), "missing:", sum(1 for r in N if r["x"] == ""), collections.Counter(r["position_source"] for r in N))
P("hemisphere:", collections.Counter(r["hemisphere"] or "(none)" for r in N))
P("with left/right partner:", sum(1 for r in N if r["pair_partner_index"] != ""), collections.Counter(r["pair_source"] for r in N if r["pair_partner_index"] != ""))
for h in ("left", "right"):
    xs = [float(r["x"]) for r in N if r["hemisphere"] == h and r["position_source"].startswith("soma")]
    P(f"mean soma x for {h}: {sum(xs)/len(xs):.0f} nm (n={len(xs)})")
