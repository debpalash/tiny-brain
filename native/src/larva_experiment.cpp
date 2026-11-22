#include "larva_experiment.h"
#include <cmath>

namespace larva {

const char* condition_name(Condition c) {
  switch (c) {
    case Condition::PairedReward: return "A + reward (paired)";
    case Condition::PairedPunish: return "A + punishment (paired)";
    case Condition::ControlReward: return "reward unpaired with A (control)";
    case Condition::ControlPunish: return "punishment unpaired with A (control)";
  }
  return "";
}

static uint32_t steps(const Brain& b, double s) { return uint32_t(std::llround(s * 1000.0 / b.params().dt_ms)); }

// Mean approach readout over `repeats` presentations of each odour (learning off, weights frozen).
static void measure(Brain& b, const ExperimentConfig& cfg, double out[2]) {
  b.set_learning(false);
  double sum[2] = {0, 0};
  for (int r = 0; r < cfg.measure_repeats; ++r)
    for (int o = 0; o < 2; ++o) {
      b.present_odour(o, cfg.measure_odour_s);
      b.step(steps(b, cfg.measure_skip_s));
      auto before = b.spike_totals();
      const double len = cfg.measure_odour_s - cfg.measure_skip_s;
      b.step(steps(b, len));
      sum[o] += b.approach_from_counts(before, b.spike_totals(), len);
      b.clear_stimuli();
      b.step(steps(b, cfg.measure_rest_s));
    }
  out[0] = sum[0] / cfg.measure_repeats;
  out[1] = sum[1] / cfg.measure_repeats;
}

RunResult run_one(Brain& b, Condition c, uint64_t seed, const ExperimentConfig& cfg) {
  RunResult R;
  R.seed = seed; R.cond = c;
  b.reset(seed);
  b.step(steps(b, 3.0));  // settle
  measure(b, cfg, R.pre);
  const double sig = (c == Condition::PairedReward || c == Condition::ControlReward) ? 1.0 : -1.0;
  const bool paired = (c == Condition::PairedReward || c == Condition::PairedPunish);
  b.set_learning(true);
  for (int k = 0; k < cfg.pairings; ++k) {
    // odour A
    b.present_odour(0, cfg.odour_s);
    if (paired) {
      b.step(steps(b, cfg.signal_start_s));
      b.give_reward(sig, cfg.signal_s);
      b.step(steps(b, cfg.odour_s - cfg.signal_start_s));
    } else {
      b.step(steps(b, cfg.odour_s));
    }
    b.clear_stimuli();
    b.step(steps(b, cfg.rest_s));
    if (!paired) {  // the same signal, far from any odour
      b.step(steps(b, cfg.control_gap_s));
      b.give_reward(sig, cfg.signal_s);
      b.step(steps(b, cfg.signal_s));
      b.clear_stimuli();
      b.step(steps(b, cfg.control_gap_s));
    }
    // odour B, never paired
    b.present_odour(1, cfg.odour_s);
    b.step(steps(b, cfg.odour_s));
    b.clear_stimuli();
    b.step(steps(b, cfg.rest_s));
  }
  R.kc_mbon_strength = b.stats().pathway_strength[0];
  measure(b, cfg, R.post);
  return R;
}

Summary summarise(const std::vector<double>& v) {
  Summary s;
  s.n = int(v.size());
  if (!s.n) return s;
  for (double x : v) s.mean += x;
  s.mean /= s.n;
  if (s.n > 1) {
    for (double x : v) s.sd += (x - s.mean) * (x - s.mean);
    s.sd = std::sqrt(s.sd / (s.n - 1));
    s.sem = s.sd / std::sqrt(double(s.n));
  }
  return s;
}

}  // namespace larva
