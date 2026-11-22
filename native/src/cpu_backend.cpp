// Single-threaded reference implementation. Deliberately simple; defines the semantics.
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include "backend.h"

namespace snn {
namespace {

class CpuBackend final : public Backend {
 public:
  const char* name() const override { return "cpu"; }

  void upload(const Network& net, const SimParams& p) override {
    net_ = &net;
    F_ = make_fixed(p, net.n);
    if (F_.learning == 2) {
      if (p.stdp_interval < 1 || p.stdp_interval > 256) throw std::runtime_error("stdp interval must be 1..256");
      tab_ = make_stdp_tables(p);
      words_ = (p.stdp_interval + 31) / 32;
      masks_.assign(size_t(net.n) * words_, 0);
      x0_.assign(net.n, 0); y0_.assign(net.n, 0); sxf_.assign(net.n, 0); ry_.assign(net.n, 0);
    }
    w_ = net.w;
    const size_t n = net.n;
    I_.assign(n, 0); v_.assign(n, 0); ref_.assign(n, 0); x_.assign(n, 0); y_.assign(n, 0);
    inbuf_.assign(n, 0); count_.assign(n, 0);
    list_.clear(); list_.reserve(n);
    step_ = 0;
  }

  void run(uint32_t steps) override {
    for (uint32_t s = 0; s < steps; ++s) step();
  }
  void sync() override {}

  Snapshot snapshot(bool with_weights) override {
    Snapshot s;
    s.spike_count = count_;
    s.v = v_; s.I = I_; s.x = x_; s.y = y_;
    if (with_weights) s.w = w_;
    return s;
  }

  size_t device_bytes() const override {
    return w_.size() * 4 + net_->bytes() - net_->w.size() * 4 + net_->n * (4 * 7);
  }

 private:
  void step() {
    const FixedParams& P = F_;
    const uint32_t t = step_++;
    list_.clear();
    for (uint32_t n = 0; n < P.n; ++n) {
      int32_t I = int32_t((int64_t(I_[n]) * P.dI_q) >> 16);
      I += int32_t(inbuf_[n]);
      inbuf_[n] = 0;
      if (hash3(P.seed, n, t) < P.pext_q) I += P.wext_q;
      int32_t v = v_[n], r = ref_[n];
      bool spike = false;
      if (r > 0) {
        --r;
      } else {
        v = int32_t((int64_t(v) * P.dv_q) >> 16) + int32_t((int64_t(I) * P.Kq) >> 20);
        v = std::max(v, P.vmin);
        if (v >= P.vth) { spike = true; v = P.vreset; r = P.ref_steps; }
      }
      int32_t x = int32_t((int64_t(x_[n]) * P.dx_q) >> 16);
      int32_t y = int32_t((int64_t(y_[n]) * P.dy_q) >> 16);
      if (spike) {
        x += P.one; y += P.one; ++count_[n]; list_.push_back(n);
        if (P.learning == 2) { uint32_t off = t % P.interval; masks_[size_t(n) * words_ + off / 32] |= 1u << (off % 32); }
      }
      I_[n] = I; v_[n] = v; ref_[n] = r; x_[n] = x; y_[n] = y;
    }
    // Pass A: delivery (+ depression of the presynaptic neuron's outgoing synapses).
    for (uint32_t i : list_) {
      const bool dep = (P.learning == 1) && net_->is_exc[i];
      for (uint32_t s = net_->row_ptr[i]; s < net_->row_ptr[i + 1]; ++s) {
        uint32_t j = net_->col[s];
        int32_t wi = int32_t(w_[s] * kWeightScale);
        inbuf_[j] += uint32_t(wi);
        if (dep) {
          int32_t dw = int32_t((int64_t(P.Am_q) * y_[j]) >> 16);
          wi = std::max(wi - dw, 0);
          w_[s] = float(wi) * kWeightUnit;
        }
      }
    }
    // Pass B: potentiation of incoming excitatory synapses of postsynaptic spikers.
    if (P.learning == 1) {
      for (uint32_t j : list_) {
        for (uint32_t k = net_->in_ptr[j]; k < net_->in_ptr[j + 1]; ++k) {
          uint32_t p = net_->in_pos[k];
          int32_t dw = int32_t((int64_t(P.Ap_q) * x_[net_->in_src[k]]) >> 16);
          int32_t wi = std::min(int32_t(w_[p] * kWeightScale) + dw, P.wmax_q);
          w_[p] = float(wi) * kWeightUnit;
        }
      }
    }
    if (P.learning == 2 && (t + 1) % P.interval == 0) sweep();
  }

  // Deferred STDP sweep, end of every interval. Semantics are documented in README ("Deferred STDP");
  // kernels/snn.metal (stdp_prep / stdp_sweep / stdp_finish) must match this exactly.
  void sweep() {
    const FixedParams& P = F_;
    const uint32_t n = P.n, L = P.interval, W = words_;
    const int32_t* Dx = tab_.data();
    const int32_t* Dy = tab_.data() + L + 1;
    uint32_t sxmax = 0;
    for (uint32_t j = 0; j < n; ++j) {  // per-neuron carry-in sums
      const uint32_t* m = &masks_[size_t(j) * W];
      uint32_t sx = 0, ry = 0, any = 0;
      for (uint32_t k = 0; k < W; ++k) {
        uint32_t mm = m[k]; any |= mm;
        while (mm) { uint32_t b = k * 32 + __builtin_ctz(mm); mm &= mm - 1; sx += uint32_t(Dx[b + 1]); ry += uint32_t(Dy[b + 1]); }
      }
      sxf_[j] = (sx << 1) | (any ? 1u : 0u);
      ry_[j] = ry;
      sxmax = std::max(sxmax, sx);
    }
    for (uint32_t i = 0; i < n; ++i) {
      if (!net_->is_exc[i]) continue;
      const bool spiked = sxf_[i] & 1u;
      if (!spiked && !((int64_t(P.Ap_q) * ((int64_t(x0_[i]) * sxmax) >> 16)) >= 65536)) continue;
      const uint32_t* mi = &masks_[size_t(i) * W];
      for (uint32_t s = net_->row_ptr[i]; s < net_->row_ptr[i + 1]; ++s) {
        const uint32_t j = net_->col[s];
        const uint32_t sj = sxf_[j];
        int64_t X = (int64_t(x0_[i]) * (sj >> 1)) >> 16, Y = 0;
        if (spiked) {
          Y = (int64_t(y0_[j]) * ry_[i]) >> 16;
          if (sj & 1u) {
            const uint32_t* mj = &masks_[size_t(j) * W];
            for (uint32_t ka = 0; ka < W; ++ka) {
              uint32_t ma = mi[ka];
              while (ma) {
                uint32_t a = ka * 32 + __builtin_ctz(ma); ma &= ma - 1;
                for (uint32_t kb = 0; kb < W; ++kb) {
                  uint32_t mb = mj[kb];
                  while (mb) {
                    uint32_t b = kb * 32 + __builtin_ctz(mb); mb &= mb - 1;
                    if (b >= a) X += Dx[b - a];
                    if (a >= b) Y += Dy[a - b];
                  }
                }
              }
            }
          }
        }
        const int64_t dpot = (int64_t(P.Ap_q) * X) >> 16, ddep = (int64_t(P.Am_q) * Y) >> 16;
        if (dpot == 0 && ddep == 0) continue;
        int64_t wi = int64_t(int32_t(w_[s] * kWeightScale)) + dpot - ddep;
        wi = std::min<int64_t>(std::max<int64_t>(wi, 0), P.wmax_q);
        w_[s] = float(int32_t(wi)) * kWeightUnit;
      }
    }
    x0_ = x_; y0_ = y_;
    std::fill(masks_.begin(), masks_.end(), 0u);
  }

  const Network* net_ = nullptr;
  FixedParams F_{};
  std::vector<float> w_;
  std::vector<int32_t> I_, v_, ref_, x_, y_;
  std::vector<uint32_t> inbuf_, count_, list_;
  uint32_t step_ = 0;
  uint32_t words_ = 0;
  std::vector<int32_t> tab_, x0_, y0_;
  std::vector<uint32_t> masks_, sxf_, ry_;
};

}  // namespace

std::unique_ptr<Backend> make_cpu_backend() { return std::make_unique<CpuBackend>(); }

}  // namespace snn
