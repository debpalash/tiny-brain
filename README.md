# tiny-brain

Small simulated brains you can watch and interact with in the browser. The long-term aim is a
digital brain that develops from experience the way a baby's does. This repo holds the first steps.

## What is here

| Part | What it is | Where |
| --- | --- | --- |
| Bacterium | A 9-neuron brain steering a cell toward food and away from toxin. It can evolve over generations and learn within a lifetime. Runs entirely in the browser. | `src/sim`, `src/scene`, `src/brain`, `src/ui` |
| Native engine | A C++ spiking-network engine for the Apple GPU (Metal). Benchmarked on a fruit-fly-sized synthetic network: 139,255 neurons, 50 million connections. | `native/` |
| Fly larva | The real wiring of a fruit-fly larva brain (3,016 neurons, Winding et al. 2023), simulated by the native engine and shown live in the web app. It can learn to approach or avoid a smell paired with reward or punishment. | `native/src/larva_*`, `src/larva` |

The web app and the native engine talk over a local WebSocket. The message format is defined in
`src/brainlink/protocol.ts` and mirrored in `native/src/protocol.h`; change the two together.

## Requirements

- Node.js and pnpm for the web app
- macOS on Apple silicon, Xcode command line tools and CMake for the native engine
- Python 3 only if you want to re-download the larva data

## Run the web app

    pnpm install
    ./node_modules/.bin/vp dev

Open the address it prints. The Bacterium view works on its own. Use the switch in the top bar to
change to the Fly larva view, which needs the engine below.

## Run the fly larva engine

    cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
    cmake --build native/build -j
    ./native/build/larva_server

It listens on `ws://127.0.0.1:8787` (local connections only, one viewer at a time). Startup takes a
few seconds while the network settles to its resting activity.

To work on the viewer without the engine, run the fake one instead (same port, so not both at once):

    node tools/mock-engine.mjs

## Checks

    ./node_modules/.bin/tsc --noEmit        # types (the build does not check them)
    ./node_modules/.bin/vp test             # web tests
    ./node_modules/.bin/vp build            # production build
    ctest --test-dir native/build           # native tests (one takes about 80 s)

## Measured so far

On an Apple M2, fruit-fly-sized synthetic network:

- learning off: about 10–12x real time
- learning on (deferred mode, the default choice): about 5.4x real time
- CPU and Metal results are bit-identical

The larva brain runs at up to about 63x real time on one CPU thread. Details and method are in
`native/README.md`; raw numbers are in `native/results/bench.json`.

## What is real and what is assumed

The larva wiring and neuron positions are real data. Much of the rest is not, and the app says so
in its Guide tab:

- whether a neuron excites or inhibits is known for only about 15% of neurons; the rest is assumed
- the two odours are invented patterns over the real smell sensors
- which dopamine neurons signal reward and which signal punishment was assigned from the wiring and
  has not been checked against the published papers
- resting activity is held in range by stabilising rules, not produced by the wiring alone
- the "approach / avoid" reading is a summary of output neurons, not measured behaviour

## Data

`native/data/larva/` holds the processed connectome (neurons and connections as CSV). It was
downloaded from the Virtual Fly Brain public server; see `native/data/SOURCES.md`. No licence is
stated for it, so do not redistribute this data publicly without checking with the source. The raw
download (123 MB) is not in the repo and can be re-fetched with `native/tools/fetch_catmaid.py`.

## More detail

- `native/README.md` — engine design, benchmarks, larva model
- `src/larva/README.md` — the larva viewer
- `native/data/larva/README.md` — the data files and their columns
- `tools/README.md` — the fake engine
