#pragma once
#include "backend.h"
namespace snn {
struct MetalOptions {
  uint32_t steps_per_cmdbuf = 100;  // timesteps encoded into one command buffer
  bool pipeline = true;             // false: wait for each command buffer before encoding the next
  uint32_t group_size = 128;         // threads per threadgroup in the event-driven kernels
};
std::unique_ptr<Backend> make_metal_backend(const MetalOptions& opt = {});
// Extra metrics only the Metal backend has.
double metal_gpu_seconds(Backend& b);  // summed GPU execution time of command buffers since upload
}  // namespace snn
