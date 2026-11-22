// Backend-neutral engine interface. A CudaBackend slots in beside CpuBackend/MetalBackend.
#pragma once
#include <cstddef>
#include <memory>
#include "types.h"

namespace snn {

struct Snapshot {
  std::vector<uint32_t> spike_count;  // cumulative per neuron since upload
  std::vector<int32_t> v, I, x, y;    // neuron state / traces
  std::vector<float> w;               // only filled if weights requested
};

class Backend {
 public:
  virtual ~Backend() = default;
  virtual const char* name() const = 0;
  // Copies the network and parameters to the device and resets all state.
  virtual void upload(const Network& net, const SimParams& p) = 0;
  // Advance the simulation; may return before work completes. Steps continue across calls.
  virtual void run(uint32_t steps) = 0;
  // Block until all submitted work is finished.
  virtual void sync() = 0;
  virtual Snapshot snapshot(bool with_weights) = 0;
  // Bytes allocated for network + state on the device (or host for CpuBackend).
  virtual size_t device_bytes() const = 0;
};

std::unique_ptr<Backend> make_cpu_backend();

}  // namespace snn
