// Backend-neutral types. Plain C++20, no platform dependencies.
#pragma once
#include <cstdint>
#include <vector>

namespace snn {

// Weights are stored as f32 but are always exact multiples of 2^-20, so every
// weight update can be done in integer arithmetic and converted back exactly
// (|w| < 16). This is what makes CPU and GPU bit-identical.
constexpr int kWeightShift = 20;
constexpr float kWeightUnit = 1.0f / 1048576.0f;
constexpr float kWeightScale = 1048576.0f;

struct NetConfig {
  uint32_t n = 139255;
  double mean_degree = 50000000.0 / 139255.0;
  double degree_sigma = 1.0;   // log-normal sigma of out-degree
  double exc_fraction = 0.8;
  double wj = 1.5;             // w0 = wj / sqrt(mean_degree)
  double inh_ratio = 4.0;      // |w_inh| = inh_ratio * w0 (scaled by U(0.5,1.5))
  double wmax_mult = 3.0;      // w_max = wmax_mult * w0
  uint64_t seed = 1;
  unsigned threads = 0;        // 0 = hardware concurrency (does not change the result)
};

struct Network {
  uint32_t n = 0;
  uint64_t m = 0;
  double w0 = 0, w_max = 0;
  std::vector<uint8_t> is_exc;      // n
  std::vector<uint32_t> row_ptr;    // n+1, CSR by presynaptic neuron
  std::vector<uint32_t> col;        // m, target
  std::vector<float> w;             // m, signed (inhibitory < 0)
  // Second index for learning: incoming EXCITATORY synapses by postsynaptic neuron.
  std::vector<uint32_t> in_ptr;     // n+1
  std::vector<uint32_t> in_pos;     // position in CSR arrays
  std::vector<uint32_t> in_src;     // presynaptic neuron of that synapse
  size_t bytes() const {
    return is_exc.size() + 4 * (row_ptr.size() + col.size() + w.size() + in_ptr.size() +
                                in_pos.size() + in_src.size());
  }
};

struct SimParams {
  double dt_ms = 1.0;
  double tau_m_ms = 20.0, tau_syn_ms = 5.0;
  double v_th_mv = 20.0, v_reset_mv = 0.0, t_ref_ms = 2.0;
  double ext_rate_hz = 600.0;   // independent Poisson drive per neuron
  double w_ext = 0.0;           // kick added to synaptic current per external event
  double tau_pre_ms = 20.0, tau_post_ms = 20.0;
  double a_plus = 0.0, a_minus = 0.0;  // weight change per unit trace
  double w_max = 0.0;
  bool learning = false;
  bool deferred = false;          // learning mode: false = per-spike STDP, true = deferred (interval sweep)
  uint32_t stdp_interval = 100;   // deferred mode: steps between sweeps (1..256); 100 fastest measured
  uint32_t seed = 12345;
};

// Integer constants shared with the kernels. Every field is 32-bit so the
// layout is identical in C++ and MSL/CUDA. Keep in sync with kernels/snn.metal.
struct FixedParams {
  uint32_t n, seed;
  int32_t dI_q, dv_q, Kq;  // q16 decay factors; Kq = dt*65536
  int32_t vth, vreset, vmin;  // v units: 2^-16 mV
  int32_t ref_steps;
  uint32_t pext_q;            // P(ext event per step) * 2^32
  int32_t wext_q;             // 2^-20 units
  int32_t dx_q, dy_q;         // trace decays, q16
  int32_t one;                // trace increment per spike (65536)
  int32_t Ap_q, Am_q;         // weight units (2^-20) per unit trace
  int32_t wmax_q;
  uint32_t learning;          // 0 off, 1 per-spike STDP, 2 deferred STDP
  uint32_t interval;          // deferred: steps per sweep
};
static_assert(sizeof(FixedParams) == 19 * 4, "layout");

SimParams default_params(const Network& net);
FixedParams make_fixed(const SimParams& p, uint32_t n);
// Deferred STDP decay tables, q16: [0..L] pre-trace decay Dx[k]=exp(-k dt/tau_pre), then [L+1..2L+1]
// post-trace decay Dy[k]. Dx[0]=Dy[0]=65536. Shared verbatim by every backend.
std::vector<int32_t> make_stdp_tables(const SimParams& p);

// Counter-based RNG: pure function of (seed, neuron, step). Identical in kernels.
inline uint32_t fmix32(uint32_t h) {
  h ^= h >> 16; h *= 0x85ebca6bu; h ^= h >> 13; h *= 0xc2b2ae35u; h ^= h >> 16; return h;
}
inline uint32_t hash3(uint32_t seed, uint32_t n, uint32_t t) {
  uint32_t h = fmix32(seed + n * 0x9E3779B1u);
  return fmix32(h ^ (t * 0x85EBCA77u + 0x27D4EB2Fu));
}

}  // namespace snn
