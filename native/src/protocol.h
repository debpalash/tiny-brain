// Mirror of src/brainlink/protocol.ts (READ-ONLY contract owned by the project lead). Keep the two in step.
// TEXT frames are JSON objects discriminated by "type"; BINARY frames are activity frames (little-endian).
#pragma once
#include <cstdint>

namespace protocol {

constexpr int kProtocolVersion = 1;           // PROTOCOL_VERSION
constexpr int kDefaultPort = 8787;            // DEFAULT_URL = ws://127.0.0.1:8787
constexpr uint32_t kActivityMagic = 0x314e5242;  // "BRN1" (ACTIVITY_MAGIC)
constexpr int kActivityHeaderBytes = 20;      // ACTIVITY_HEADER_BYTES
constexpr double kActivityFullScaleHz = 50;   // ACTIVITY_FULL_SCALE_HZ

// Binary frame, little-endian: u32 magic, u32 sequence, f64 simTime, u32 count, then u8[count]
// with activity = round(255 * min(1, rate / kActivityFullScaleHz)), rate smoothed over ~100 ms of simulated time.

// Server -> viewer (JSON "type"): "hello", "neurons", "stats", "neuronDetail", "error".
// Viewer -> server (JSON "type"): "setPaused"{paused}, "setSpeed"{speed}, "setLearning"{on},
//   "stimulate"{group,rateHz,seconds}, "odour"{odour,seconds}, "reward"{value,seconds}, "clearStimuli",
//   "inspect"{neuron|null}, "forget", "reset".
// All `seconds` and `secondsLeft` values are SIMULATED seconds.
// GroupKind: "sensor" | "inter" | "motor" | "reward" | "other".

}  // namespace protocol
