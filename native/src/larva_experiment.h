// Learning experiment on the larva brain: odour A (+ reward or punishment), odour B unpaired, plus unpaired controls.
#pragma once
#include <string>
#include <vector>
#include "larva_brain.h"

namespace larva {

enum class Condition { PairedReward, PairedPunish, ControlReward, ControlPunish };
const char* condition_name(Condition c);

struct ExperimentConfig {
  int pairings = 5;
  double odour_s = 4.0;        // length of each odour presentation during training
  double signal_start_s = 1.0; // reward/punishment starts this long after odour onset (paired)
  double signal_s = 2.5;       // reward/punishment duration
  double rest_s = 3.0;
  double control_gap_s = 5.0;  // control: gap between odour and the separated signal
  double measure_odour_s = 3.0, measure_skip_s = 1.0, measure_rest_s = 3.0;
  int measure_repeats = 2;
};

struct RunResult {
  uint64_t seed = 0;
  Condition cond{};
  double pre[2] = {0, 0}, post[2] = {0, 0};  // approach for odour A (0) and B (1)
  double kc_mbon_strength = 1;               // mean KC->MBON weight relative to start, after training
  double delta(int o) const { return post[o] - pre[o]; }
};

RunResult run_one(Brain& b, Condition c, uint64_t seed, const ExperimentConfig& cfg);

struct Summary { double mean = 0, sd = 0, sem = 0; int n = 0; };
Summary summarise(const std::vector<double>& v);

}  // namespace larva
