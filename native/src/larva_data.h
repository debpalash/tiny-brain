// Loader for the larva connectome CSVs (native/data/larva). Plain C++20.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace larva {

struct NeuronRec {
  std::string name, hemisphere, broad_class, all_classes, cell_type, modality, transmitter;
  double x = 0, y = 0, z = 0;  // nanometres, CATMAID project space (raw)
};

struct Connectome {
  std::vector<NeuronRec> neurons;
  // One entry per connected ordered pair (same order as synapses.csv).
  std::vector<uint32_t> pre, post;
  std::vector<uint32_t> count;
  uint64_t total_synapses = 0;  // sum of count
};

// Returns false and fills `err` on any problem (missing file, bad row, index out of range).
bool load_connectome(const std::string& dir, Connectome& out, std::string& err);

}  // namespace larva
