#include "network_builder.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <thread>

namespace snn {
namespace {

struct SplitMix {
  uint64_t s;
  explicit SplitMix(uint64_t seed, uint64_t stream)
      : s(seed * 0x9E3779B97F4A7C15ull + (stream + 1) * 0xD1B54A32D192ED03ull) { next(); }
  uint64_t next() {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  double u01() { return (next() >> 11) * (1.0 / 9007199254740992.0); }
};

float quant_w(double w) {
  return float(std::llround(w * kWeightScale)) * kWeightUnit;
}

template <class F>
void parallel_for(uint32_t n, unsigned threads, F f) {
  if (threads <= 1) { f(0u, n); return; }
  std::vector<std::thread> ts;
  uint32_t chunk = (n + threads - 1) / threads;
  for (unsigned t = 0; t < threads; ++t) {
    uint32_t a = t * chunk, b = std::min(n, a + chunk);
    if (a >= b) break;
    ts.emplace_back([=] { f(a, b); });
  }
  for (auto& t : ts) t.join();
}

}  // namespace

Network build_network(const NetConfig& cfg) {
  Network net;
  const uint32_t n = cfg.n;
  net.n = n;
  unsigned threads = cfg.threads ? cfg.threads : std::max(1u, std::thread::hardware_concurrency());
  net.w0 = cfg.wj / std::sqrt(cfg.mean_degree);
  net.w_max = cfg.wmax_mult * net.w0;

  net.is_exc.resize(n);
  for (uint32_t i = 0; i < n; ++i) {
    SplitMix r(cfg.seed, 0x1000000000ull + i);
    net.is_exc[i] = r.u01() < cfg.exc_fraction ? 1 : 0;
  }

  // Out-degrees: log-normal, rescaled so the total matches n*mean_degree.
  std::vector<double> raw(n);
  double sum = 0;
  for (uint32_t i = 0; i < n; ++i) {
    SplitMix r(cfg.seed, 0x2000000000ull + i);
    double u1 = std::max(r.u01(), 1e-300), u2 = r.u01();
    double z = std::sqrt(-2.0 * std::log(u1)) * std::cos(6.283185307179586 * u2);
    raw[i] = std::exp(cfg.degree_sigma * z);
    sum += raw[i];
  }
  double target_total = double(n) * cfg.mean_degree;
  double scale = target_total / sum;
  uint32_t max_deg = std::max<uint32_t>(1, n / 2);
  net.row_ptr.assign(n + 1, 0);
  uint64_t total = 0;
  for (uint32_t i = 0; i < n; ++i) {
    uint32_t d = uint32_t(std::clamp<double>(std::llround(raw[i] * scale), 1.0, double(max_deg)));
    d = std::min<uint32_t>(d, n - 1);
    total += d;
    net.row_ptr[i + 1] = uint32_t(total);  // total must fit u32 (documented limit)
  }
  net.m = total;
  net.col.resize(total);
  net.w.resize(total);

  parallel_for(n, threads, [&](uint32_t a, uint32_t b) {
    for (uint32_t i = a; i < b; ++i) {
      SplitMix r(cfg.seed, 0x3000000000ull + i);
      uint32_t s = net.row_ptr[i], e = net.row_ptr[i + 1];
      for (uint32_t k = s; k < e; ++k) {
        uint32_t t = uint32_t(r.next() % (n - 1));
        if (t >= i) ++t;  // no self-connections
        net.col[k] = t;
      }
      std::sort(net.col.begin() + s, net.col.begin() + e);  // locality for scatter
      for (uint32_t k = s; k < e; ++k) {
        double u = 0.5 + r.u01();
        net.w[k] = net.is_exc[i] ? quant_w(net.w0 * u) : -quant_w(cfg.inh_ratio * net.w0 * u);
      }
    }
  });

  // By-postsynaptic index over excitatory synapses.
  net.in_ptr.assign(n + 1, 0);
  for (uint32_t i = 0; i < n; ++i)
    if (net.is_exc[i])
      for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) ++net.in_ptr[net.col[k] + 1];
  for (uint32_t j = 0; j < n; ++j) net.in_ptr[j + 1] += net.in_ptr[j];
  uint32_t mexc = net.in_ptr[n];
  net.in_pos.resize(mexc);
  net.in_src.resize(mexc);
  std::vector<uint32_t> fill(net.in_ptr.begin(), net.in_ptr.end() - 1);
  for (uint32_t i = 0; i < n; ++i)
    if (net.is_exc[i])
      for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) {
        uint32_t d = fill[net.col[k]]++;
        net.in_pos[d] = k;
        net.in_src[d] = i;
      }
  return net;
}

SimParams default_params(const Network& net) {
  SimParams p;
  p.ext_rate_hz = 100.0;
  p.w_ext = 12.5 * net.w0;
  p.a_plus = 0.05 * net.w0;
  p.a_minus = 0.0525 * net.w0;
  p.w_max = net.w_max;
  return p;
}

FixedParams make_fixed(const SimParams& p, uint32_t n) {
  FixedParams f{};
  auto q16 = [](double x) { return int32_t(std::llround(x * 65536.0)); };
  f.n = n;
  f.seed = p.seed;
  f.dI_q = q16(std::exp(-p.dt_ms / p.tau_syn_ms));
  f.dv_q = q16(std::exp(-p.dt_ms / p.tau_m_ms));
  f.Kq = q16(p.dt_ms);
  f.vth = q16(p.v_th_mv);
  f.vreset = q16(p.v_reset_mv);
  f.vmin = q16(-80.0);
  f.ref_steps = int32_t(std::llround(p.t_ref_ms / p.dt_ms));
  double pe = std::min(1.0, p.ext_rate_hz * p.dt_ms * 1e-3);
  f.pext_q = uint32_t(std::min(4294967295.0, std::floor(pe * 4294967296.0)));
  f.wext_q = int32_t(std::llround(p.w_ext * kWeightScale));
  f.dx_q = q16(std::exp(-p.dt_ms / p.tau_pre_ms));
  f.dy_q = q16(std::exp(-p.dt_ms / p.tau_post_ms));
  f.one = 65536;
  f.Ap_q = int32_t(std::llround(p.a_plus * kWeightScale));
  f.Am_q = int32_t(std::llround(p.a_minus * kWeightScale));
  f.wmax_q = int32_t(std::llround(p.w_max * kWeightScale));
  f.learning = !p.learning ? 0 : (p.deferred ? 2 : 1);
  f.interval = p.stdp_interval;
  return f;
}

std::vector<int32_t> make_stdp_tables(const SimParams& p) {
  const uint32_t L = p.stdp_interval;
  std::vector<int32_t> t(2 * (L + 1));
  for (uint32_t k = 0; k <= L; ++k) {
    t[k] = int32_t(std::llround(65536.0 * std::exp(-double(k) * p.dt_ms / p.tau_pre_ms)));
    t[L + 1 + k] = int32_t(std::llround(65536.0 * std::exp(-double(k) * p.dt_ms / p.tau_post_ms)));
  }
  return t;
}

}  // namespace snn
