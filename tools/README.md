# tools

## mock-engine.mjs

A fake brain engine for working on the Fly larva viewer without building the native one. It speaks
the same protocol as `larva_server` (`src/brainlink/protocol.ts`) but all of its data is invented:
3,016 made-up neurons in six groups, two odours, and an "approach" value that drifts toward reward
or punishment.

    node tools/mock-engine.mjs [port]

Plain Node, no dependencies. The default port is 8787, the same as the real engine, so run one or
the other, not both.

Nothing shown while the mock is running is a result about a real brain.
