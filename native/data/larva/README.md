# Drosophila larva brain connectome (Winding, Pedigo et al., Science 2023)

Built by `native/tools/{fetch_catmaid,build_larva,check_larva}.py` from the public L1 CATMAID server.
See `../SOURCES.md` for URLs, dates, checksums and the **licence warning (data licence unclear)**.
Re-run results: `checks_report.txt`.

Rows are neurons identified by the annotation `mw brain and inputs` (3,016 neurons = the paper's brain set,
including sensory neurons that enter the brain). This is a LIVE annotation on the CATMAID server, not a frozen
release; counts can differ from the published paper (see caveats).

## neurons.csv (3,016 rows, sorted by skeleton_id)
| column | meaning |
|---|---|
| index | dense 0-based id used by synapses.csv (row order = ascending skeleton_id) |
| skeleton_id | CATMAID skeleton id (original id) |
| name | CATMAID neuron name (free text from many contributors) |
| hemisphere | `left`/`right` from annotations `mw left`/`mw right` (soma side). No neuron has neither or both, so there are no `center` rows. |
| broad_class | one class per neuron: first match in this priority: MBON, MBIN, Kenyon cell, projection neuron (uPN/tPN/vPN/mPN), sensory, APL, lateral horn neuron, convergence neuron, descending to VNC, descending to SEZ, ring gland, descending unknown, MB FBN/FFN/FB2N/FAN, A00c, local neuron, ascending, LON; else `unclassified`. Derived from the authors' `mw ...` annotations; the priority order mirrors the authors' own `priority_map` but the exact mapping is mine. |
| all_classes | all matching classes, `;`-separated (some neurons belong to several) |
| cell_type | finer type where an annotation exists: sensory subclass (ORN, AN, MN, photoreceptor Rh5/Rh6, thermo, vtd); KC claw number (e.g. `4claw`); MBON appetitive/aversive/neither; MBIN `DAN`/`OAN` (10 of 26 MBINs have neither); PN uPN/tPN/vPN/mPN (+ subclass); ring gland subtype; LN subtype. Empty otherwise. |
| sensory_modality | sensory neurons only: olfactory, visual, thermosensory, gustatory (pharyngeal/external), mechanosensory (pharyngeal), somatosensory (external), enteric. 30 sensory neurons have no modality annotation (left empty). |
| transmitter | `acetylcholine`, `GABA`, `glutamate`, `dopamine`, `octopamine`, or `conflict:a/b` when annotations disagree; empty = unknown. Taken ONLY from CATMAID annotations (`acetylcholine`, `mw cholinergic`, `GABA`, `mw GABAergic`, ...). The server does not document how these were established (immunostaining, literature, or inference), so treat as curator labels. No sign (excitatory/inhibitory) is stored: that would be an assumption. |
| transmitter_source | the annotation names that produced the value, `;`-separated |
| x,y,z | position in CATMAID project coordinates, **nanometres** (see frame below) |
| position_source | `soma_tag` (node tagged `soma`; `(first of N)` if several), or `skeleton_root` (no soma tag; all 434 sensory neurons, whose somata lie outside the brain volume, so the root is where the axon enters) |
| pair_partner_index | `index` of the contralateral homologue, only when a public annotation pairs exactly one left and one right neuron; empty = no pair *recorded here* (not necessarily unpaired) |
| pair_source | `hemilateral` (annotation family `hemilateral_pair_*`) or `mw paired (ds mPNs)` |

Coordinate frame: raw CATMAID stack space (stack "L1 CNS 0-tilt", 3.8 x 3.8 x 50 nm voxels), no transform
applied. Measured: left-hemisphere somata have large x (mean 81.5 um), right have small x (mean 25.1 um), so
the midline is near x ~ 53 um. Axis directions beyond that (y up/down, z anterior/posterior) were not checked;
CATMAID convention has y pointing down in the image. Convert to a right-handed viewer frame if needed.

## synapses.csv (107,388 rows, one per connected ordered pair)
`pre_index, post_index, count, axon_dendrite, axon_axon, dendrite_dendrite, dendrite_axon`.
`count` = sum of the four. A synapse is one (presynaptic site, postsynaptic link) pair on a CATMAID connector;
a polyadic presynaptic site with k in-set postsynaptic targets yields k synapses. Compartment of each end:
"axon" = the part of the skeleton at/after the node tagged `mw axon split` (or between `mw axon start` and
`mw axon end` for special MBONs), "dendrite" = the rest. Neurons without a split tag (including all
sensory neurons) are treated entirely as dendrite, following the authors' code (`unsplit` -> `d`).
Only connections where BOTH neurons are in the 3,016 set are present. 528 rows (757 synapses) are
self-connections (pre_index == post_index); they are kept, filter them in the engine if unwanted.
No minimum-synapse threshold was applied (the paper's analyses typically used >=3 synapses or a % input cut-off).

## Caveats
* **Synapse total is 337,264, not the paper's ~548,000.** Likely reasons (not verified): the paper's figure counts
  synaptic contacts including partners outside this 3,016-neuron set (fragments, VNC/ascending, non-brain partners),
  while this file keeps only neuron-to-neuron links inside the set; the live server may also have changed.
* Sign is unknown for 2,553 of 3,016 neurons (84.7%); known for all 222 KCs, 32/48 MBONs, 16/26 MBINs.
* 9 neurons carry conflicting transmitter annotations (8 GABA/glutamate, 1 acetylcholine/glutamate).
* Partner/pair information covers only 972 neurons (32%); the paper reports ~93% have a homologue, but the full pair
  list is not public in CATMAID annotations.
* 1,170 neurons (39%) are `unclassified`: the public annotations do not assign them a class named above.
* Class counts depend on my annotation mapping; e.g. 80 projection neurons here vs 176 neurons annotated
  `mw all PNs` (which includes other second-order types).
* Hemisphere is soma side; many neurons are bilateral.
* Names and annotation text are curator free text and may contain errors.
