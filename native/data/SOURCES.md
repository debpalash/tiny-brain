# Data sources

## LICENCE WARNING (read first)
**No explicit licence was found for the connectome data itself.** The data come from the public
L1 larval CNS CATMAID server hosted by Virtual Fly Brain; its documentation page
(https://virtualflybrain.org/about/hosted/l1em-catmaid/, checked 2026-11-22) states no licence or
reuse terms, only: "When using this data, please cite" the paper (below), CATMAID (Saalfeld et al.
2009, Bioinformatics 25(15)) and the publications behind individual neurons.
What is known:
* The paper text (author manuscript, Europe PMC PMC7614541) carries a CC BY 4.0 notice; the paper's
  data statement says "All data are available in the manuscript or the supplementary materials.
  Raw EM data and neuron reconstructions are publicly available through the CATMAID interface at
  https://catmaid.virtualflybrain.org/ (L1 Larval CNS)." That is a statement of public availability,
  not a redistribution licence for a derived dataset.
* The authors' code archives on Zenodo are tagged "other-open"; the GitHub repos are MIT
  (mwinding/connectome_tools, neurodata/maggot_connectome) and BSD-3-Clause (neurodata/maggot_models).
  These are code licences, not data licences.
Before redistributing `data/larva/*.csv` publicly, ask the authors / Virtual Fly Brain
(support@virtualflybrain.org) to confirm terms. Attribute at minimum: Winding, Pedigo et al.,
Science 379(6636):eadd9330 (2023), doi:10.1126/science.add9330, plus the CATMAID reference above.

## Primary source actually used for the data
* Server: https://l1em.catmaid.virtualflybrain.org (project 1 "L1 CNS"), CATMAID server version
  `2021.12.21.dev295+g30203a5f8`. Anonymous read-only access, generic User-Agent, no credentials.
* Downloaded 2026-11-21 22:23 to 22:26 UTC (annotations/links) and the following ~35 minutes
  (per-skeleton nodes). The server has no dataset version number; records are live and can change.
* Neuron set: annotation `mw brain and inputs` (annotation id 22293659; exactly 3,016 neurons, the
  paper's number). Endpoints used: `GET /1/annotations/`, `POST /1/annotations/query-targets`
  (types=neuron, with_annotations), `POST /1/connectors/links/` (pre/postsynaptic), `GET
  /1/skeletons/<id>/compact-detail?with_tags=true`.
* Raw files (in `raw/catmaid/`) and SHA-256:
  * neurons_annotations.json  64d6c5b36334d4f6fb8230e3679b92fe36c74a7f9d18713d4f5da159746662c4
  * links_pre.json            cc16136a30de891386ac5ba7b668af5d85bb496845aa675b305136a66cfd4140
  * links_post.json           c405e5bc3cbccd2092aa1c20616627710ed2b5379bf3ec5495c96bc8345c90a9
  * skel/<skeleton_id>.json   3,016 per-skeleton summaries produced by tools/fetch_catmaid.py (root, soma
    tag position, node mean, split tags, axon/dendrite label per connector node); not checksummed individually.
* Outputs (`larva/`) SHA-256:
  * neurons.csv   661b1040a291228b30e5627e3e5faee0cda70f60e6fe428871df363a00b34e11
  * synapses.csv  fdba7864696e80781a29747949f6a8e0b60e75d3e77dee6b75365e68768d3add

## Secondary downloads (read for method only; no data taken from them)
* Zenodo 10.5281/zenodo.7473710, mwinding/connectome_tools v1.0 (raw/ct/connectome_tools-v1.0.zip,
  md5 d999f464902df6eccf89546520632117, sha256 1d99b283...7bb9). Used to learn how the authors split
  axon/dendrite (`generate_adjs.py`).
* Zenodo 10.5281/zenodo.7473718, mwinding/connectome_analysis v1.0 (raw/ca/connectome_analysis-v1.0.zip,
  md5 573485c9787e5f574ced3acb6912d4cc, sha256 7bcb667a...b7f9). Contains NO adjacency matrix or full metadata.
* Not downloaded: Zenodo 10.5281/zenodo.7474133 (neurodata/maggot_models, 336 MB; only old 2019 graphs in
  repo; later processed data came from a private repo `Maggot-Brain-Connectome`, HTTP 404 anonymously).

## What was tried and not available
* Science supplementary data: not retrieved (no machine-readable adjacency or table located in the
  open full text; the paper states data are in CATMAID).
* The authors' full left/right pair table and the "paper" neuron-class table are in a private repo; only
  partial pair information is recoverable from public CATMAID annotations (see ../larva/README.md).
