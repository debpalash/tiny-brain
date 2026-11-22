# Native spiking-network engine (Metal first, CUDA later)

Fruit-fly-sized synthetic network (139,255 neurons, 50.0 M synapses) with pair-based STDP,
simulated on the Apple M2 GPU through Metal. Everything that is not Metal-specific is plain C++20.

## Build and run

    cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
    cmake --build native/build -j
    ctest --test-dir native/build                       # CPU vs Metal equivalence test
    native/build/snn_bench                              # main table -> native/results/bench.json
    native/build/snn_bench --mode all                   # main table + batch / group / size sweeps
    native/build/snn_bench --mode verify --seconds 2    # full-size CPU vs Metal bitwise check
    native/build/snn_bench --mode tune --n 10000        # CPU-only rate/weight check, any size

    native/build/snn_bench --mode deferred              # timing table: off / per-spike / deferred L=20,50,100,200 -> bench.json "deferred"
    native/build/snn_bench --mode fidelity --stdp-interval 50   # per-spike vs deferred weights -> bench.json "fidelity_L50"

Useful flags: `--stdp per-spike|deferred` (learning mode, default per-spike), `--stdp-interval <steps>` (deferred, 1..256, default 100), `--n`, `--deg`, `--seconds`, `--warmup`, `--batch`, `--group`, `--rate`, `--wext`, `--inh`, `--ap`, `--amr`.
Kernels are compiled at runtime from `kernels/snn.metal` (path baked in at build time; override with `SNN_KERNEL_DIR`).
metal-cpp (v26 zip, newest published at the time; SDK here is 27) lives in `third_party/metal-cpp/`.

## Layout

- `src/types.h` network/params/`FixedParams` (all-32-bit struct shared with kernels), counter-based hash RNG.
- `src/network_builder.*` seeded synthetic network (result independent of thread count).
- `src/backend.h` the engine interface: `upload`, `run(steps)`, `sync`, `snapshot`, `device_bytes`.
- `src/cpu_backend.cpp` single-threaded reference; defines the semantics.
- `src/metal_backend.*`, `kernels/snn.metal` Metal implementation. A `CudaBackend` would implement `Backend` and port the 4 kernels.
- `tests/test_equivalence.cpp`, `bench/bench.cpp`.

## Design

**Network.** Out-degree per neuron is log-normal (sigma 1.0, max 24,642 here), rescaled so the total is 50,000,061 synapses
(mean 359.1); targets uniform random, no self-connections, sorted within each row. 80% of neurons excitatory, sign fixed per
presynaptic neuron. Storage is CSR by presynaptic neuron (`u32 col`, `f32 w`) plus a by-postsynaptic index over excitatory
synapses only (`in_pos` = position in the CSR arrays, `in_src` = presynaptic id). Cost: **14.45 bytes/synapse** on the host
(8 CSR + ~6.4 index + row pointers); 727 MB (693.7 MiB) of Metal buffers incl. neuron state, 14.55 B/synapse. Row pointers are
`u32`, so the limit is 4.29 G synapses per network.

**Neuron / learning.** LIF (tau_m 20 ms, tau_syn 5 ms, threshold 20 mV, 2 ms refractory, dt 1 ms, 1-step synaptic delay) with
independent Poisson drive (100 Hz, kick 12.5*w0) from `hash(seed, neuron, step)`. STDP: one pre trace and one post trace per
neuron (tau 20 ms). Pass A (kernel `deliver`): for each spiking neuron, walk its CSR row, add the weight to the target's input and,
if excitatory and learning is on, depress the synapse by `A- * post_trace[target]`. Pass B (kernel `potentiate`): for each spiking
neuron, walk its incoming excitatory synapses and potentiate by `A+ * pre_trace[source]`. Two passes because a synapse could
otherwise be written by both its pre and post neuron in the same step; each synapse is written by at most one thread per pass.
Weights clipped to [0, 3*w0]. Learning is a flag.

**Exactness.** All arithmetic is integer: input accumulation is fixed-point (`atomic_int`, weight*2^20), membrane/current/traces are
integers with q16 decay factors, and weights are f32 values that are always exact multiples of 2^-20, so every update is
float->int->float with no rounding. Integer atomics commute, so GPU results do not depend on thread order and are bit-identical
to the CPU. Fast-math is off.

**GPU schedule.** Per step: `neuron_update` (one thread per neuron; appends spikers to a ping-pong list with an atomic counter),
`prep` (one thread: turns the counter into indirect dispatch args), `deliver` and `potentiate` (indirect dispatch, one
threadgroup of 128 threads per spike, lanes stride over the row). All steps of a batch go into one compute encoder / one command
buffer; buffers are bound once per encoder; nothing is read back until the end of a 1 s chunk. Command buffers are committed
without waiting (pipelined).

## Results (MacBook Air M2, 8 GPU cores, 16 GB; `results/bench.json`)

Full size, 10 simulated seconds after 1 s warm-up (CPU: 1 s, no warm-up). Network build 0.59 s (8 threads), upload 0.05-0.08 s.

| config | wall s | real-time factor | mean rate | synaptic events/s | buffers |
|---|---|---|---|---|---|
| Metal, learning off | 0.80 | **12.5x** | 4.29 Hz | 2.6e9 | 694 MiB |
| Metal, learning on  | 7.19 | **1.39x** (before: 13.13 s, 0.76x) | 4.32 Hz | 3.0e8 | 694 MiB |
| CPU 1 thread, learning off | 0.96 | 1.04x | 4.08 Hz | 2.1e8 | |
| CPU 1 thread, learning on  | 2.52 | 0.40x | 4.12 Hz | 8.2e7 | |

"Synaptic events" = spikes times out-degree (deliveries); learning-on adds a comparable number of potentiation touches not counted.
Process peak RSS 1.6 GB for a single full-size run (3.9 GB in the `all` run, which also builds the 278k-neuron network).
Run-to-run spread is roughly +-10% (learning-off 10.7-12.3x across runs).

Stability: rate stays 4.2-4.4 Hz in every simulated second, learning on and off. With learning on, excitatory weights go
0.07916 -> 0.07930 mean, range [0, 0.189], bound 0.2376; essentially none at the bounds. Learning is real but weak at these rates
(A+ = 0.05*w0, A-/A+ = 1.05); weights changed on ~82% of synapses in the 2 s test.

Correctness: `ctest` runs a 2,000-neuron, 199k-synapse network on both backends (learning on 2 s, off 1 s, other batch/group sizes,
and a ~37 Hz stress case): spike counts, v, I, traces and **all weights are bit-identical** at every 250-step checkpoint (tolerance 0).
`--mode verify` repeats this at full size (50 M synapses, 2 s, learning on, 1.16 M spikes): 0 differences.

## Deferred STDP (second learning mode, `--stdp deferred`)

The per-spike mode is unchanged. Deferred mode does **no weight access on spikes**: `deliver` only delivers, `potentiate` is not
run. A spiking neuron sets one bit in its per-neuron spike mask (bit `step mod L`, `ceil(L/32)` u32 words per neuron, L <= 256).
Every L steps (global multiples of L, independent of how `run()` is chunked) three kernels run:
`stdp_prep` (per neuron: carry sums), `stdp_sweep` (all synapses in CSR order, one threadgroup of 128 threads per 1024
consecutive synapses, lanes stride over each row's slice; one writer per synapse, no atomics) and `stdp_finish` (per neuron:
snapshot traces `x0,y0`, clear masks). `CpuBackend::sweep()` defines the semantics; the kernels mirror it.

**Rule.** Interval window = steps t0..t0+L-1, offsets a (pre spikes of neuron i) and b (post spikes of neuron j) in 0..L-1.
`Dx[k]`, `Dy[k]` = round(65536 * exp(-k dt / tau)) for tau_pre, tau_post (table shared by all backends; `Dx[0]=65536`). `x0,y0` = traces at the
start of the window. For each excitatory-source synapse i -> j:

    X = (x0_i * SX_j >> 16)  +  sum over pre a, post b with b >= a of Dx[b-a]        SX_j = sum over post spikes b of Dx[b+1]
    Y = (y0_j * RY_i >> 16)  +  sum over pre a, post b with a >= b of Dy[a-b]        RY_i = sum over pre spikes a of Dy[a+1]
    w <- clip(w + (Ap*X >> 16) - (Am*Y >> 16), 0, w_max)       (64-bit integers, Ap, Am, w_max in 2^-20 units as before)

X is exactly the per-spike rule's sum over post spikes of the pre trace (including a same-step pre spike and the carried-in
pre trace), Y the sum over pre spikes of the post trace; same tau, same Ap, Am, same equal-time convention (a pair at the same
step counts for both potentiation and depression). Inhibitory-source synapses are not learned. Exact skips (results identical
to computing everything): rows of non-spiking neurons whose carried trace cannot give a non-zero update
(`Ap * (x0_i * max_j SX_j >> 16) < 65536`), synapses with zero net change (no write), only the mask-flagged targets enter the pair loops.

**Approximation relative to per-spike (the complete list).**
1. Delivery uses weights that are stale by up to L steps (updates are applied at the end of the window). Per-spike's delivery sees them
   immediately. Within a window the weight read at delivery is also not depressed before use (same as per-spike, where depression follows the read).
2. Rounding is once per synapse per window (`>> 16` of the summed X, Y) instead of floor per event, and the clip to [0, w_max] is applied once per window instead of per event
   (a weight cannot be clipped mid-window and then recover).
3. Traces carried across a window boundary use the exact-exponential table (`Dx[k]`) instead of the per-step floor decay of the live traces
   (differences of order 1 part in 2^16 per step).
4. Spike times are known to the step (same as per-spike); no further quantisation. Bit-identity holds only between CPU and Metal *in deferred mode*,
   not against per-spike.

### Deferred results (MacBook Air M2, same session, 10 simulated s after 1 s warm-up, full size; `results/bench.json` keys `deferred`, `fidelity_*`)

| config | wall s | real-time factor | mean rate |
|---|---|---|---|
| Metal, learning off | 0.95 (earlier run 0.80) | 10.6x (12.5x earlier; spread +-10%) | 4.29 Hz |
| Metal, per-spike STDP | 7.16 | **1.40x** (1.37-1.39x in other runs) | 4.32 Hz |
| deferred, L = 20  | 3.37 | 2.96x | 4.31 Hz |
| deferred, L = 50  | 2.10 | 4.76x | 4.30 Hz |
| deferred, L = 100 | 1.84 | **5.43x** (default) | 4.31 Hz |
| deferred, L = 200 | 2.25 | 4.45x | 4.31 Hz |

(An earlier session of the same build gave 3.0 / 4.7 / 5.4 / 4.6 x with learning off at 12.4x.) Deferred learning costs
2.3x (L=100) relative to learning off, versus 9x for per-spike.

**What limits the sweep (measured).** With the sweep dispatch skipped but the mask bits, `stdp_prep` and `stdp_finish` still running,
wall time equals learning off (0.79 s at L=50, 0.83 s at L=100), so all added cost is the sweep. Per sweep: about 5 ms (L=20), 6.7 ms (L=50),
10 ms (L=100), 27 ms (L=200); sweeps in total 1.3 s (L=50) and 1.0 s (L=100) per 10 s. Cost per sweep grows with L because the fraction of
rows that spiked in the window grows (1 - exp(-4.3 Hz * L): 19% at 50, 35% at 100, 58% at 200) and those rows run the per-synapse pair loops and read/write weights;
per-sweep total traffic is the CSR `col` array (200 MB when all rows are active) plus weight reads/writes. The floor at L=20 (5 ms, about 40 GB/s
effective on 200 MB) says even mostly-idle sweeps are limited by streaming `col` for rows whose carried trace is above the skip bound, plus gathers of `sxf[j]`
(0.5 MB, cached). Less frequent sweeps amortise this until the active-row fraction takes over (best at 100). I did not read hardware counters; the attribution to bandwidth/active rows is inferred from these timings.

### Fidelity versus per-spike (full size, 10 simulated s from the same seed, Metal both; `fidelity_L*` in bench.json)

Excitatory synapses only (40.0 M). Per-spike: rate 4.3058 Hz, weight mean 0.079284, sd 0.024263 (initial 0.07916, 0.022853), mean |dw| 0.005696.

| L | rate Hz | exc w mean | exc w sd | mean abs dw | corr(dw) | mean abs diff of dw |
|---|---|---|---|---|---|---|
| 20 | 4.2991 | 0.079285 | 0.024257 | 0.005687 | 0.365 | 0.00639 |
| 50 | 4.2769 | 0.079285 | 0.024242 | 0.005657 | 0.365 | 0.00637 |
| 100 | 4.2964 | 0.079284 | 0.024255 | 0.005684 | 0.364 | 0.00639 |
| 200 | 4.2887 | 0.079283 | 0.024250 | 0.005673 | 0.364 | 0.00639 |

Reference "noise ceiling": per-spike vs per-spike with a different Poisson-drive seed: corr 0.002, mean abs diff 0.00803 (rate 4.248 Hz).
Population statistics (rate, weight mean, sd, mean |dw|) agree with per-spike to within about 0.5% at every L. The per-synapse correlation of 0.36 looks low but is **not**
the rule disagreeing: the network is chaotic, and any one-unit difference in a delivered weight changes later spike trains, so even a tiny
difference in dynamics decorrelates per-synapse changes. Evidence, L=50, full size, correlation of dw vs per-spike after
0.05 s: **1.0000** (mean abs diff 6e-10, 0.4% of synapses changed); 0.1 s: 0.998; 0.2 s: 0.715; 0.5 s: 0.481; 1 s: ~0.42; then flat at ~0.36 at 10 s. The same
decay happens with a 5x smaller learning rate (1 s: 0.42), so it comes from spike-train divergence, not from the learning rule. The rule itself matches per-spike essentially exactly
when spike trains are the same (first window). Distribution-level agreement (rate, weight statistics) is what the table supports; per-synapse trajectories over seconds cannot be compared
beyond that, in either direction. Learning is weak at these rates (mean |dw| is about 23% of the weight sd), so these runs say little about longer-term or
high-rate behaviour; in the small high-rate stress case the rates were 36.8 Hz (per-spike) and 35.5 Hz (deferred L=50) after 1 s (single run, not analysed further).

### Tests
`ctest` (snn_test) additionally runs deferred mode CPU vs Metal at tolerance 0 on the 2,000-neuron network: L = 20, 30 (checkpoints
fall mid-window, batch 37), 50, 100 (4 mask words) for 2 s, and L = 50 on the high-rate stress case; all bit-identical. Full-size
`--mode verify --stdp deferred` (L=100, 2 s; also L=30, 2.01 s): 0 differing spike counts, v, weights of 50 M. Per-spike verify (1 s) still bit-identical.

## What limits speed (measured)

- **Command-buffer batching** (2 s runs, full size). Pipelined: RTF 8.0 at 1 step/buffer, 9.7 at 5, 10.6 at 20, flat ~10.7 from 20 to 1000.
  Waiting after every buffer: 2.6 at 1 step (0.29 ms lost per round trip), 8.9 at 20, 10.0 at 50, flat above ~100. Learning on: no
  effect at any batch size (RTF 1.1-1.45 now) (GPU busy time equals wall time). Batch >= 20 with pipelining is enough.
- **GPU is the bottleneck, not CPU encoding**: GPU busy time is 95-100% of wall for batch >= 20.
- **Learning on costs ~9x learning off** at full size (was ~15x; learning-on RTF 0.76 before, 1.39 now). The earlier explanation
  (one GPU thread per spiking neuron walking a serial 360-iteration loop) was wrong: `potentiate` already uses one 128-thread
  threadgroup per spike, ~3 iterations per lane. Measured per-pass split (2 simulated s, full size, wall = GPU busy; each
  variant temporarily edited the kernel, not kept):

  | potentiate variant | wall s | RTF |
  |---|---|---|
  | pass not run / body returns immediately | 0.20 | ~9.9 (depression included, rate 3.86 Hz: no potentiation) |
  | index reads + trace read only (no weight access) | 0.25 | 8.1 |
  | + read `w[p]` | 1.28 | 1.56 |
  | + read and write `w[p]` (the original) | 2.50 | 0.80 |
  | read+write, skipping synapses with dw == 0 | 1.45 | 1.38 |

  So index and trace reads cost ~0.05 s, the random weight read ~1.0 s, the random write ~1.2 s per 2 sim s: about 3 ns per
  random read (~345 M/s, i.e. ~44 GB/s if a 128 B line is fetched per access) and as much again for the write-back. Depression
  (coalesced row walk) is cheap. Changing the thread layout does not help: threadgroup size 32/64/128/256/512 for the pass gives
  RTF 1.38/1.24/1.38/1.36/1.39, and a 4-way unrolled load-first variant gave 1.2-1.4. All lanes are already busy; the pass is
  limited by random cache-line traffic into the 200 MB weight array (an inference: I did not read hardware counters).
  Kept (bit-identical): skip the weight read/write when `dw == 0` (pre trace decayed below one weight unit; about 40% of touches)
  and skip the write when the clipped value is unchanged. Valid because weights never exceed `w_max` (initial excitatory
  weights are below it, depression only lowers).
  Not tried further: compacting spikers into (spike, chunk) work items (same number of memory operations in flight as the
  threadgroup-per-spike scheme, and the group-size test shows no sensitivity); chunked delivery (delivery is not the cost);
  sorting each incoming list by CSR position (the builder already fills it in that order).
  Learning-on cost per step still grows with network size: RTF 50 (5k), 33 (10k), 22 (20k), 5.7 (40k), 2.3 (80k),
  1.35 (139k), 0.70 (278k).
- **Learning off** scales ~1/N above 20k neurons (RTF 63, 37, 22, 13, 4.5 for 20k, 40k, 80k, 139k, 278k), i.e. work proportional
  to spikes x degree. Below ~10k neurons it saturates at RTF ~70 (about 13 us/step, a fixed per-step cost of 3-4 dispatches).
  Threadgroup size matters: 32 -> 6.8, 64 -> 9.2, 128 -> 10.7, 256 -> 10.7 (hubs with up to 24k synapses serialise on one group).
- Small networks are not tuned to 3-8 Hz (5k neurons: ~20 Hz) because drive was tuned at full size and in-degree.

## Ideas not done

(Update: the deferred rule described above was implemented; the paragraphs below are the original plan. It reaches 5.4x, not
the 'exact reconstruction' variant sketched there: spike-time bitmasks are used instead of last-spike times.)

The 3x goal for learning on was **not reached** with result-preserving changes (1.39x measured). A deferred/approximate STDP
would be the next step: keep a list of (post spike, step) events, and every K steps (say 50-100) sweep the synapses in memory
order, applying the accumulated potentiation with the pre traces reconstructed analytically from stored last-spike times
(trace = exp decay of the last spike; with all-integer traces the reconstruction can be exact for one spike per window but
not for several). That replaces ~100k random line touches per step by one sequential 200 MB pass per window, probably
reaching or exceeding 3x. It changes results: delivery would see weights that lag by up to K steps, spikes in a window would be
paired in a different order, and CPU-vs-Metal bit-identity would hold only against an equally deferred CPU reference, not
against the current rule.

Earlier note: deferred STDP (sweep all synapses every ~50-100 steps with sorted access instead of per-spike random access) would
probably remove the learning-on penalty but changes the algorithm from the trace-based rule requested; a second weight copy in
post order would just move the random access to the delivery side; indirect command buffers could cut the per-step floor.

## Larva (live brain from a real connectome, CPU)

`larva_server` loads the *Drosophila* larva brain connectome in `data/larva/` (3,016 neurons, 107,388 connected pairs, 337,264
synapses; Winding, Pedigo et al., Science 2023, public L1 CATMAID server; see `data/SOURCES.md` for the licence warning), simulates
it live on the CPU (one simulation thread), lets a viewer teach it an odour through its mushroom body, and serves the viewer over
WebSocket exactly as `src/brainlink/protocol.ts` (mirrored in `src/protocol.h`).

### Run

    cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
    cmake --build native/build -j
    ./native/build/larva_server                  # ws://127.0.0.1:8787, ~4 s start-up calibration
    ./native/build/larva_server --port 9000 --data native/data/larva
    ./native/build/larva_server --bench          # max real-time factor, learning on and off
    ./native/build/larva_experiment --seeds 8    # learning experiment report, no viewer
    ctest --test-dir native/build                # existing snn_test + larva_loader / _stability / _learning / _protocol

Server behaviour: binds 127.0.0.1 only; one viewer at a time (a second connection gets `503`); a browser connection whose `Origin`
is not `http://localhost[:port]` or `http://127.0.0.1[:port]` gets `403` (and so does a foreign `Host`); activity frames at up to
30/s, `stats` at about 5/s, `neuronDetail` about 1/s while a neuron is inspected. The simulation never waits for the viewer: binary frames keep only the
newest unsent frame (older ones are dropped), the text queue is bounded (64). All `seconds` fields (`odour`, `reward`,
`stimulate`, and `secondsLeft` in stats) are **simulated** seconds. `setSpeed` is clamped to 0.05-64 (simulated s per wall s; the
engine may fall short, `realtimeFactor` reports what was achieved). The frame `sequence` increases across `reset` and restarts only when the process restarts.
The WebSocket server is hand-written (RFC 6455 text/binary/ping/close, SHA-1 and base64 included, `src/ws_server.*`; no dependency).

### Files
`src/larva_data.*` CSV loader; `src/larva_brain.*` model: layout, synapse store, integer LIF step (reuses `snn::make_fixed` and
`snn::hash3` from `types.h`), calibration, commands, readout, and the `LearningRule` interface with the
`DopamineGatedDepression` implementation (a Metal version of the rule or the neuron step can replace it later; nothing here is Metal-specific);
`src/larva_experiment.*` the learning protocol; `src/ws_server.*`, `src/mini_json.h`, `src/protocol.h`, `src/larva_server.cpp`;
tests in `tests/larva_test.cpp`, `tests/test_protocol.py` (standard-library Python client, run with `python3 -I`), CLI `tests/larva_experiment_main.cpp`.

### Model and every assumption

* **Neurons**: the existing integer LIF (tau_m 20 ms, tau_syn 5 ms, threshold 20 mV, 2 ms refractory, dt 1 ms, one-step delay).
  Every neuron also receives independent Poisson background events (kick 1.0 mV/ms).
* **Groups** (from the connectome's `broad_class`/modality): Smell sensors (ORNs, 42), Other senses (392), Relay neurons (PNs, 80),
  Memory cells (Kenyon cells, 222), Output neurons (MBONs, 48), Reward neurons (all 26 mushroom-body input neurons: 14 dopamine, 2 octopamine,
  10 with no transmitter label), Body output neurons (descending, 348), Everything else (1,858, includes the two APL neurons).
* **Signs** (by presynaptic transmitter): acetylcholine = excitatory (data); GABA = inhibitory (data); **glutamate = inhibitory
  (assumption)**; conflicting GABA/glutamate = inhibitory, conflicting acetylcholine/glutamate = excitatory (assumed); **no label
  (85% of neurons) = excitatory (assumption)**, reported with `signKnown = 0`. Dopamine and octopamine neurons have **no fast synapses**
  (weight 0): they act only as the teaching signal. Their `sign` is sent as 1 with `signKnown = 0`.
* **Weights** = synapse count x gain (mV/ms of input current per synapse; all gains are my choice, not measured):
  excitatory 0.06, inhibitory 0.10; class multipliers ORN->PN x1, PN->KC x3, KC->MBON x3, KC->KC x0.1, APL->KC x4. Self-connections (757 synapses) are kept.
* **Stabilisers (added by me)**: (1) *homeostatic background drive*: during a 240 simulated-second start-up (about 4 s of wall time) the Poisson
  background rate of every neuron is adapted (integral controller, annealed to zero) toward a target of 2 Hz (Kenyon cells 1 Hz); then it is frozen
  and the last 30 s measure each neuron's resting rate. (2) *synaptic scaling*: a neuron whose background drive is already at the floor (<3 Hz) but that still fires above target
  has all its incoming weights multiplied by a factor in [0.02, 1] (same calibration phase, frozen afterwards). (3) *Global feedback inhibition*: every neuron gets
  a current of -0.05 mV/ms per Hz of the mean population rate (20 ms smoothing), always on. (4) *Input cap*: for weighting, a neuron's total incoming
  synapse count is capped at 300 (weights scaled down above that). Consequence: resting rates are set **by design**, about 2 Hz almost everywhere, not measured.
  Without (2) the loop Kenyon cells - output neurons - input neurons ran away to 20-50 Hz (first attempt).
* **Odours** (invented): the 21 olfactory receptor types (e.g. `22c`, `1a`; same type on both sides) are sorted alphabetically and alternate between
  Odour A (11 types, 22 neurons) and Odour B (10 types, 20 neurons); no overlap. Presenting an odour injects Poisson spikes (60 Hz, strong kick, about one spike per event)
  into those sensors. Overlap in the memory cells still occurs through shared relay/memory-cell wiring.
* **Reward / punishment dopamine neurons (assumption)**: I could not map the connectome's lineage names (MBE1b, MBE4a, ...) to the published names
  (Eichler 2017, Saumweber 2018, Eschbach 2020) reliably (no literature access in this run), so each dopamine type is assigned from the valence label
  the dataset gives to the output neurons it synapses on (fly rule, Aso 2014: reward dopamine depresses KC->MBON of avoidance-driving output neurons, punishment dopamine depresses
  those of approach-driving ones). A type needs >=10 synapses to labelled output neurons and >2x more on one valence. Result: **reward = MBE1b, MBE1c (4 neurons)**,
  **punishment = MBE4f, MBE4h (4 neurons)**; MBE1d, MBE4g, MBE4a are not used by the `reward` command. This assignment may be opposite to the literature (medial vs vertical lobe) and is unverified. `reward` value > 0 drives the reward neurons with Poisson input at
  80 Hz x value, value < 0 drives the punishment neurons at 80 Hz x |value|, for the given simulated seconds.
* **Learning rule (dopamine-gated depression, KC->MBON only, 17,778 synapses)**, applied in a sweep every 100 ms (deferred style; per-window spike counts):
  `kc[k] = kc[k] * exp(-0.1/0.5) + spikes_k` (Kenyon cell trace, tau 0.5 s);
  `dan[d] = low-pass(rate_d, tau 0.3 s)`, `D_d = max(0, dan[d] - rest_d - 6 Hz)` (activity above its calibrated resting rate plus a margin);
  `gate[m] = sum_d min(1, syn(d->m)/20) * D_d` over all 14 dopamine neurons that synapse on output neuron m (direct DAN->MBON synapses define the compartment);
  per synapse k->m: `mult *= exp(-eta * max(0, kc[k] - 1.5) * gate[m])` with `eta = 1e-5`, then slow recovery `mult += (1-mult)*0.1/600`, `mult in [0.05, 1]`.
  Weight = start weight x mult. The threshold 1.5 (spontaneous 1 Hz firing must not count as "recently active") and eta were chosen by me in a first
  exploratory run (eta 3e-5 and 1e-5 tried, kc threshold 0 vs 1.5; the first version without a threshold depressed every memory cell during unpaired reward); there is no literature value behind them.
  `setLearning(false)` freezes weights; `forget` restores them.
* **Readout `approach`** (`stats.approach`): `a_P = sum of rates of punishment-taught output neurons / sum of their resting rates`, `a_R` the same for
  reward-taught output neurons, `approach = (a_P - a_R) / (a_P + a_R)`. Rates use a 0.5 s smoothing. Compartments are defined by connectivity: an output neuron is
  reward-taught (4 neurons: MBON 5a, 5b) if >=10 synapses come from reward dopamine neurons and more than from punishment ones; punishment-taught (10 neurons: MBON 6, 15a, 15b, 26 on both sides, 20 and 30 on the right only) likewise.
  Pairing an odour with reward weakens its drive onto the reward-taught outputs, so `a_R` falls and `approach` rises; punishment lowers `a_P` and `approach` falls.
  It is the engine's summary, not behaviour; before training it is not exactly 0 and differs per odour (-0.14 for A, -0.05 for B at start), so changes matter, not absolute values.
* **Pathways** in `hello`: 0 memory cells -> output neurons (plastic, 17,778 synapses, strength = mean current weight / start weight), 1 smell sensors -> relay (5,656),
  2 relay -> memory cells (3,680), 3 reward (input) neurons -> memory cells (4,697 data synapses; the dopamine ones carry no fast weight).
* `neurons`: positions are raw CATMAID nanometres minus the centroid; sensory neurons sit at their axon entry point, not a soma; axis directions unchecked.

### Evidence (all run on the MacBook Air M2, CPU, single thread)

Tests (`ctest --test-dir native/build`): `larva_loader` (counts vs CSVs and `checks_report.txt`), `larva_stability`, `larva_learning` (8 seeds x 4 conditions, about 80 s),
`larva_protocol` (child server on a free port, standard-library client; checks hello, neurons, binary frames, stats, odour/reward/pause/inspect/forget/setLearning, simulated-time seconds, origin and single-viewer rules).

**Resting rates, 20 simulated s (learning on):** whole brain 1.92 Hz; Smell sensors 2.07, Other senses 1.98, Relay 1.99, Memory cells 1.02, Output 2.09, Reward 2.05, Body output 1.98, Everything else 1.99 Hz; no silent neurons.
Odour A: smell sensors 31 Hz, memory cells 3.7 Hz (rest 1.0), whole brain 3.2 Hz; Odour B: 29 Hz, 3.4 Hz, 3.4 Hz.

**Learning experiment** (`larva_experiment --seeds 8`; 8 seeds, 5 pairings; the seed only changes the noise, the wiring is fixed. Pairing: odour A 4 s with reward/punishment
from 1.0 s to 3.5 s; odour B 4 s alone, 3 s rests. Control: same odours and the same signal, but the signal 5 s away from any odour. Approach is measured with learning off, 2 presentations per odour, last 2 s of each.)
Change in approach (post - pre), mean +- sd over seeds:

| condition | odour A (trained / first) | odour B (untrained) | KC->MBON strength after |
|---|---|---|---|
| A + reward (paired) | **+0.728 +- 0.050** | +0.154 +- 0.059 | 0.960 |
| A + punishment (paired) | **-0.458 +- 0.033** | -0.004 +- 0.062 | 0.957 |
| reward unpaired (control) | +0.036 +- 0.064 | +0.026 +- 0.070 | 0.995 |
| punishment unpaired (control) | +0.033 +- 0.061 | +0.016 +- 0.072 | 0.995 |

The trained odour moves in the right direction in all 8 seeds, far more than the untrained odour and the controls. The untrained odour B also rises
with reward (+0.15): generalisation through shared memory cells (and through the shared approach readout). The controls move by about +0.03, i.e. within noise
(sd ~0.06) but not exactly zero. The test assertions (trained change has the right sign and beats untrained and control, for both reward and punishment) were fixed before the run and not adjusted.
Seeds share noise streams across conditions, so rows are not independent samples.

**Speed** (`larva_server --bench`, 60 simulated s with an odour on, after 2 s settle): learning on 62.5-62.9x real time, learning off 62.8-63.0x (the 100 ms learning sweep is negligible next to the neuron loop, about 16 us per step).
