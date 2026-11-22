// Live CPU simulation of the Drosophila larva brain connectome with a mushroom-body learning rule.
// Plain C++20, no platform dependencies. Single simulation thread; not thread-safe (the server
// serialises all access on its simulation thread).
#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include "larva_data.h"

namespace larva {

enum GroupId : int {
  G_SMELL = 0, G_OTHER_SENSE, G_RELAY, G_KENYON, G_OUTPUT, G_REWARD, G_DESCENDING, G_REST, G_COUNT
};

struct Params {
  // Neuron model: same integer LIF as the synthetic engine (snn::FixedParams / make_fixed).
  double dt_ms = 1.0, tau_m_ms = 20.0, tau_syn_ms = 5.0, v_th_mv = 20.0, t_ref_ms = 2.0;
  // Synapse weight = count * g_class (mV/ms of input current per synapse).
  double g_exc = 0.06;       // default for excitatory presynaptic neurons
  double g_inh = 0.10;       // GABA / glutamate presynaptic neurons (negative)
  double g_orn_pn = 1.0;    // class multipliers on top of the default sign gain
  double g_pn_kc = 3.0;
  double g_kc_mbon = 3.0;
  double g_apl_kc = 4.0;
  double g_kc_kc = 0.1;
  double scale_floor_hz = 3.0, scale_min = 0.02;  // synaptic scaling during calibration
  double in_cap = 300.0;     // per-neuron cap on total incoming synapse count used for weights (scale down above)
  // Background drive and stabilisers.
  double bg_kick = 1.0;      // per-event current kick of the background Poisson drive
  double bg_rate_init = 100; // Hz, before calibration
  double bg_rate_max = 1500; // Hz
  double fb_gain = 0.05;     // global feedback inhibition, mV/ms per Hz of mean population rate
  double target_hz = 2.0;    // homeostatic target rate (all neurons unless overridden)
  double target_kc_hz = 1.0;
  double calib_seconds = 240.0;
  double calib_ki = 3.0;     // integral gain, Hz per Hz of error per second
  double calib_tau_s = 5.0;
  // Stimulus strength.
  double stim_kick = 8.0;    // per-event kick of externally injected spikes (about one spike per event)
  double odour_rate_hz = 60; // Poisson rate injected into each sensor neuron of the odour
  double reward_rate_hz = 80;// Poisson rate injected into each reward/punishment neuron at |value| = 1
  // Learning (dopamine-gated depression of KC -> MBON).
  uint32_t window_steps = 100;
  double tau_kc_s = 0.5;     // Kenyon-cell activity trace
  double kc_threshold = 1.5; // KC trace (spikes within ~0.5 s) must exceed this to count as 'recently active'
  double tau_dan_s = 0.3;    // dopamine-neuron activity trace
  double dan_margin_hz = 6.0;// dopamine activity counts only above resting rate + this margin
  double dan_syn_ref = 20.0; // DAN->MBON synapse count that gives full gating
  double eta = 1e-5;         // depression per (KC trace x dopamine Hz) per 100 ms window
  double tau_rec_s = 600.0;  // recovery time constant of weights toward their start
  double m_min = 0.05;       // weights never go below this fraction of their start
  double readout_tau_s = 0.5;
};

// Weights and connectivity (CSR by presynaptic neuron, CSC index by postsynaptic neuron).
struct SynapseStore {
  uint32_t n = 0;
  std::vector<uint32_t> row_ptr, col, cnt;
  std::vector<int32_t> base_q, w_q, base0_q;  // signed, 2^-20 units
  std::vector<uint32_t> in_ptr, in_syn;  // incoming: positions in the CSR arrays
  std::vector<uint32_t> src;             // presynaptic neuron per CSR position
  // Plastic synapses (KC -> MBON): CSR position, pre, post, multiplier in [m_min, 1].
  std::vector<uint32_t> p_idx, p_pre, p_post;
  std::vector<float> p_mult;
};

struct WindowActivity {
  const uint32_t* spikes;  // per neuron, spikes in this window
  double seconds;          // window length
};

// Learning rule behind an interface so another implementation (e.g. Metal) can follow.
class LearningRule {
 public:
  virtual ~LearningRule() = default;
  virtual const char* name() const = 0;
  virtual void reset() = 0;
  virtual void sweep(const WindowActivity& act, SynapseStore& syn) = 0;
};

// Static description derived from the data.
struct Layout {
  std::vector<int> group;           // per neuron
  std::vector<int> sign;            // +1 / -1 as used by the simulation
  std::vector<int> sign_known;      // 1 if from a transmitter label
  std::array<std::vector<uint32_t>, G_COUNT> members;
  std::vector<std::string> orn_types;           // 21 receptor types
  std::array<std::vector<uint32_t>, 2> odour_sensors;  // neuron ids per odour
  std::array<std::vector<int>, 2> odour_types;  // indices into orn_types
  std::vector<uint32_t> dans;                   // dopamine neurons (14)
  std::vector<uint32_t> reward_dans, punish_dans;
  std::vector<std::string> dan_role;            // per entry of dans: "reward", "punishment", "unassigned"
  std::vector<uint32_t> mbons;
  std::vector<int> mbon_comp;                   // per neuron: +1 reward-taught MBON, -1 punishment-taught, 0 other
  std::vector<uint32_t> reward_mbons, punish_mbons;
};

struct StimInfo { int group; double rate_hz, seconds_left; };

struct Stats {
  double sim_time = 0;
  std::vector<double> group_rate_hz, pathway_strength;
  double reward = 0, approach = 0;
  int odour = -1;
  double odour_seconds_left = 0;
  std::vector<StimInfo> stimuli;
};

struct LinkPartnerInfo { uint32_t neuron; uint32_t synapses; double strength; };
struct NeuronDetail {
  uint32_t neuron; double rate_hz;
  std::vector<LinkPartnerInfo> inputs, outputs;
  uint32_t in_degree, out_degree;
};

struct PathwayDef { std::string label; int from_group, to_group; bool plastic; std::vector<uint32_t> syn_idx; uint64_t synapses; };

class Brain {
 public:
  // Builds layout + synapses, then runs the homeostatic calibration (calib_seconds of simulated time).
  Brain(const Connectome& c, const Params& p, bool verbose = false);
  ~Brain();

  void reset(uint64_t seed);       // time 0, starting weights, calibrated drives kept
  void step(uint32_t steps);       // advance by steps * dt
  double sim_time() const;
  uint64_t step_count() const;

  // Commands (the server maps protocol messages onto these).
  void set_learning(bool on);
  bool learning() const;
  void forget();                   // weights back to start, learning traces cleared
  void stimulate(int group, double rate_hz, double seconds);
  void present_odour(int odour, double seconds);
  void give_reward(double value, double seconds);
  void clear_stimuli();

  // Observation.
  const Layout& layout() const;
  const Connectome& connectome() const;
  const Params& params() const;
  const SynapseStore& synapses() const;
  const std::vector<PathwayDef>& pathways() const;
  Stats stats() const;             // group rates are ~100 ms smoothed
  NeuronDetail detail(uint32_t neuron) const;
  void activity_bytes(uint8_t* out) const;      // protocol activity: 0..255 per neuron
  double neuron_rate_hz(uint32_t n) const;      // ~100 ms smoothed
  const std::vector<uint64_t>& spike_totals() const;  // cumulative spikes per neuron since reset
  double rest_rate_hz(uint32_t n) const;        // calibrated resting rate of a neuron
  const std::vector<float>& bg_rates() const;   // calibrated background drive (Hz)
  uint64_t calibration_steps() const;
  const std::string& calibration_log() const;

  // Approach readout from MBON rates (Hz, one per entry of layout().mbons order given by `rate_of`).
  // approach = (aP - aR) / (aP + aR + 1e-9), a = sum of rates of the group's MBONs divided by sum of their resting rates;
  // P = punishment-taught MBONs, R = reward-taught MBONs.
  double approach_from_counts(const std::vector<uint64_t>& counts_before,
                              const std::vector<uint64_t>& counts_after, double seconds) const;

 private:
  struct Impl;
  std::unique_ptr<Impl> d_;
};

const char* group_label(int g);
const char* group_scientific(int g);
const char* group_description(int g);
const char* group_kind(int g);

}  // namespace larva
