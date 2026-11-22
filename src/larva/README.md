# Fly larva view

Live view of a real insect brain simulated by the native engine (`native/`). The browser connects to
`ws://127.0.0.1:8787` (see `src/brainlink/protocol.ts`).

Run the real engine:

    cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release && cmake --build native/build -j
    ./native/build/larva_server

Or exercise the UI with fake data (no dependencies, port optional):

    node tools/mock-engine.mjs [port]

The mock has 3,016 invented neurons in six groups and two odours; `approach` moves toward reward or
punishment given together with an odour (learning must be on). It is not biology.

Layout: `link.ts` (store, worker handle, newest-frame buffer), `worker.ts` (WebSocket, reconnect with backoff),
`frames.ts` (pure parsing), `sentence.ts`, `sequence.ts` (teach/test plans), `BrainScene.tsx` (one `Points`
object, per-neuron data in typed arrays), `Panel.tsx` and friends (side panel). Tests: `larva.test.ts`.
