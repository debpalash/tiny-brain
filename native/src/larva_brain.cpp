#include "larva_brain.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <set>
#include "types.h"  // snn::FixedParams / make_fixed / hash3: the existing integer LIF arithmetic

namespace larva {

const char* group_label(int g) {
  static const char* s[] = {"Smell sensors", "Other senses", "Relay neurons", "Memory cells", "Output neurons",
                            "Reward neurons", "Body output neurons", "Everything else"};
  return s[g];
}
const char* group_scientific(int g) {
  static const char* s[] = {"Olfactory sensory neurons (ORNs)", "Other sensory neurons (taste, touch, light, temperature, gut)",
                            "Projection neurons (PNs)", "Kenyon cells (KCs)", "Mushroom body output neurons (MBONs)",
                            "Mushroom body input neurons (dopamine neurons and other MBINs)",
                            "Descending neurons (to the nerve cord and the feeding centre)",
                            "Interneurons, lateral horn, convergence and unclassified neurons"};
  return s[g];
}
const char* group_description(int g) {
  static const char* s[] = {"Detect odour molecules and send the first smell signal into the brain.",
                            "Sense taste, touch, light, temperature and the gut, not smell.",
                            "Carry the smell signal on to the memory cells.",
                            "Each smell switches on a small, sparse set of these cells; they store what the smell was paired with.",
                            "Read out the memory cells and push the animal towards or away from a smell.",
                            "Dopamine and related neurons that tell the memory cells and output neurons that something good or bad happened.",
                            "Send commands from the brain down to the body.",
                            "All other brain neurons, including the lateral horn, convergence and unclassified neurons."};
  return s[g];
}
const char* group_kind(int g) {
  static const char* s[] = {"sensor", "sensor", "inter", "inter", "motor", "reward", "motor", "other"};
  return s[g];
}

namespace {

constexpr float kQ = 1048576.0f;

std::string strip_side(const std::string& s) {
  for (const char* suf : {" left", " right"}) {
    std::string x(suf);
    if (s.size() > x.size() && s.compare(s.size() - x.size(), x.size(), x) == 0) return s.substr(0, s.size() - x.size());
  }
  return s;
}

// -------------------------------------------------------------------------------- layout
Layout build_layout(const Connectome& c) {
  Layout L;
  const uint32_t n = uint32_t(c.neurons.size());
  L.group.assign(n, G_REST);
  L.sign.assign(n, 1);
  L.sign_known.assign(n, 0);
  L.mbon_comp.assign(n, 0);
  for (uint32_t i = 0; i < n; ++i) {
    const NeuronRec& r = c.neurons[i];
    int g = G_REST;
    const std::string& b = r.broad_class;
    if (b == "sensory") g = (r.modality == "olfactory") ? G_SMELL : G_OTHER_SENSE;
    else if (b == "projection neuron") g = G_RELAY;
    else if (b == "Kenyon cell") g = G_KENYON;
    else if (b == "MBON") g = G_OUTPUT;
    else if (b == "MBIN") g = G_REWARD;
    else if (b == "descending to VNC" || b == "descending to SEZ" || b == "descending unknown") g = G_DESCENDING;
    L.group[i] = g;
    L.members[g].push_back(i);
    const std::string& t = r.transmitter;
    if (t == "acetylcholine") { L.sign[i] = 1; L.sign_known[i] = 1; }
    else if (t == "GABA" || t == "glutamate") { L.sign[i] = -1; L.sign_known[i] = 1; }
    else if (t == "conflict:GABA/glutamate") { L.sign[i] = -1; L.sign_known[i] = 0; }
    else { L.sign[i] = 1; L.sign_known[i] = 0; }  // unknown, conflict ACh/glutamate, dopamine, octopamine
    if (r.cell_type == "ORN" && g == G_SMELL) {}
  }
  // Odours: receptor types alternate (alphabetical order) between A and B; same types on both sides.
  std::set<std::string> types;
  for (uint32_t i : L.members[G_SMELL]) types.insert(strip_side(c.neurons[i].name));
  L.orn_types.assign(types.begin(), types.end());
  for (uint32_t i : L.members[G_SMELL]) {
    auto it = std::find(L.orn_types.begin(), L.orn_types.end(), strip_side(c.neurons[i].name));
    int ti = int(it - L.orn_types.begin());
    L.odour_sensors[ti % 2].push_back(i);
  }
  for (int ti = 0; ti < int(L.orn_types.size()); ++ti) L.odour_types[ti % 2].push_back(ti);
  // Dopamine neurons and their reward / punishment role, from valence-annotated MBON connectivity.
  std::vector<uint32_t> dan;
  for (uint32_t i = 0; i < n; ++i) if (c.neurons[i].transmitter == "dopamine") dan.push_back(i);
  L.dans = dan;
  std::map<std::string, std::pair<double, double>> av_ap;  // lineage name -> (synapses to aversive MBONs, to appetitive)
  std::vector<int> dan_idx(n, -1);
  for (size_t k = 0; k < dan.size(); ++k) dan_idx[dan[k]] = int(k);
  for (size_t e = 0; e < c.pre.size(); ++e) {
    if (dan_idx[c.pre[e]] < 0 || L.group[c.post[e]] != G_OUTPUT) continue;
    const std::string& v = c.neurons[c.post[e]].cell_type;
    auto& p = av_ap[c.neurons[c.pre[e]].name];
    if (v == "aversive") p.first += c.count[e];
    else if (v == "appetitive") p.second += c.count[e];
  }
  for (uint32_t d : dan) {
    auto p = av_ap[c.neurons[d].name];
    std::string role = "unassigned";
    // Fly logic (Aso et al. 2014): reward dopamine depresses KC->MBON of avoidance-driving MBONs and vice versa.
    if (p.first >= 10 && p.first > 2 * p.second) { role = "reward"; L.reward_dans.push_back(d); }
    else if (p.second >= 10 && p.second > 2 * p.first) { role = "punishment"; L.punish_dans.push_back(d); }
    L.dan_role.push_back(role);
  }
  std::vector<double> rs(n, 0), ps(n, 0);
  std::vector<int> role_of(n, 0);
  for (uint32_t d : L.reward_dans) role_of[d] = 1;
  for (uint32_t d : L.punish_dans) role_of[d] = -1;
  for (size_t e = 0; e < c.pre.size(); ++e) {
    if (L.group[c.post[e]] != G_OUTPUT) continue;
    if (role_of[c.pre[e]] == 1) rs[c.post[e]] += c.count[e];
    else if (role_of[c.pre[e]] == -1) ps[c.post[e]] += c.count[e];
  }
  for (uint32_t m : L.members[G_OUTPUT]) {
    L.mbons.push_back(m);
    if (rs[m] >= 10 && rs[m] > ps[m]) { L.mbon_comp[m] = 1; L.reward_mbons.push_back(m); }
    else if (ps[m] >= 10 && ps[m] > rs[m]) { L.mbon_comp[m] = -1; L.punish_mbons.push_back(m); }
  }
  return L;
}

// -------------------------------------------------------------------------------- learning rule
class DopamineGatedDepression final : public LearningRule {
 public:
  DopamineGatedDepression(const Connectome& c, const Layout& L, const Params& P, const std::vector<float>& dan_rest_hz)
      : L_(L), P_(P), dan_rest_(dan_rest_hz) {
    const uint32_t n = uint32_t(c.neurons.size());
    kc_x_.assign(n, 0.f);
    dan_x_.assign(L.dans.size(), 0.f);
    gate_.assign(n, 0.f);
    std::vector<int> dan_idx(n, -1);
    for (size_t k = 0; k < L.dans.size(); ++k) dan_idx[L.dans[k]] = int(k);
    mb_in_.resize(n);
    for (size_t e = 0; e < c.pre.size(); ++e)
      if (dan_idx[c.pre[e]] >= 0 && L.group[c.post[e]] == G_OUTPUT)
        mb_in_[c.post[e]].push_back({dan_idx[c.pre[e]], float(std::min(1.0, c.count[e] / P.dan_syn_ref))});
  }
  const char* name() const override { return "dopamine-gated depression (KC->MBON)"; }
  void reset() override {
    std::fill(kc_x_.begin(), kc_x_.end(), 0.f);
    std::fill(dan_x_.begin(), dan_x_.end(), 0.f);
    std::fill(gate_.begin(), gate_.end(), 0.f);
  }
  void sweep(const WindowActivity& act, SynapseStore& syn) override {
    const double aK = std::exp(-act.seconds / P_.tau_kc_s), aD = std::exp(-act.seconds / P_.tau_dan_s);
    for (uint32_t k : L_.members[G_KENYON]) kc_x_[k] = float(kc_x_[k] * aK + act.spikes[k]);
    std::vector<float> D(L_.dans.size());
    for (size_t d = 0; d < L_.dans.size(); ++d) {
      dan_x_[d] = float(dan_x_[d] * aD + (1 - aD) * (act.spikes[L_.dans[d]] / act.seconds));
      D[d] = std::max(0.f, dan_x_[d] - dan_rest_[d] - float(P_.dan_margin_hz));
    }
    for (uint32_t m : L_.mbons) {
      float g = 0;
      for (auto& e : mb_in_[m]) g += e.second * D[e.first];
      gate_[m] = g;
    }
    const float kc_thr = float(P_.kc_threshold);
    const float rec = float(act.seconds / P_.tau_rec_s), eta = float(P_.eta), mmin = float(P_.m_min);
    for (size_t p = 0; p < syn.p_idx.size(); ++p) {
      float m = syn.p_mult[p];
      const float g = gate_[syn.p_post[p]], x = std::max(0.f, kc_x_[syn.p_pre[p]] - kc_thr);
      if (g > 0.f && x > 0.f) m *= std::exp(-eta * x * g);
      m += (1.f - m) * rec;
      m = std::min(1.f, std::max(mmin, m));
      syn.p_mult[p] = m;
      syn.w_q[syn.p_idx[p]] = int32_t(std::lround(double(syn.base_q[syn.p_idx[p]]) * m));
    }
  }

 private:
  const Layout& L_;
  Params P_;
  std::vector<float> dan_rest_, kc_x_, dan_x_, gate_;
  std::vector<std::vector<std::pair<int, float>>> mb_in_;
};

}  // namespace

// -------------------------------------------------------------------------------- Brain
struct Stim { int group; double rate; double end_ms; };

struct Brain::Impl {
  const Connectome& conn;
  Params P;
  Layout L;
  SynapseStore S;
  std::vector<PathwayDef> paths;
  snn::FixedParams F{};
  uint32_t n = 0;
  // state
  std::vector<int32_t> I, v, ref, inbuf;
  std::vector<uint32_t> bgp_q, stimp_q, win_count;
  std::vector<float> bg_rate, act, rd, rest_hz;
  std::vector<uint64_t> totals;
  std::vector<uint32_t> list;
  int32_t wbg_q = 0, wstim_q = 0;
  uint32_t seed_bg = 1, seed_st = 2;
  uint64_t step_ = 0;
  double pop_ema = 0;  // spikes per step, tau 20 ms
  double act_decay = 0, rd_decay = 0, pop_decay = 0;
  bool learning = true;
  std::unique_ptr<LearningRule> rule;
  std::vector<float> dan_rest, in_scale;
  // stimuli
  std::vector<Stim> stims;
  int odour = -1; double odour_end_ms = 0;
  double reward = 0, reward_end_ms = 0;
  double next_expiry_ms = 1e300;
  bool dirty = false;
  // snapshot after calibration
  std::vector<int32_t> snapI, snapV, snapRef;
  double snap_pop = 0;
  uint64_t calib_steps = 0;
  std::string calib_log;

  Impl(const Connectome& c, const Params& p) : conn(c), P(p) {}

  double t_ms() const { return double(step_) * P.dt_ms; }

  void build() {
    n = uint32_t(conn.neurons.size());
    L = build_layout(conn);
    snn::SimParams sp;
    sp.dt_ms = P.dt_ms; sp.tau_m_ms = P.tau_m_ms; sp.tau_syn_ms = P.tau_syn_ms;
    sp.v_th_mv = P.v_th_mv; sp.t_ref_ms = P.t_ref_ms;
    F = snn::make_fixed(sp, n);
    wbg_q = int32_t(std::lround(P.bg_kick * kQ));
    wstim_q = int32_t(std::lround(P.stim_kick * kQ));
    act_decay = std::exp(-P.dt_ms / 100.0);
    rd_decay = std::exp(-P.dt_ms * 1e-3 / P.readout_tau_s);
    pop_decay = std::exp(-P.dt_ms / 20.0);
    build_synapses();
    I.assign(n, 0); v.assign(n, 0); ref.assign(n, 0); inbuf.assign(n, 0);
    bgp_q.assign(n, 0); stimp_q.assign(n, 0); win_count.assign(n, 0);
    bg_rate.assign(n, float(P.bg_rate_init));
    act.assign(n, 0.f); rd.assign(n, 0.f); rest_hz.assign(n, 0.f);
    totals.assign(n, 0);
    set_bg();
  }

  void set_bg() {
    for (uint32_t i = 0; i < n; ++i) {
      double pe = std::min(1.0, double(bg_rate[i]) * P.dt_ms * 1e-3);
      bgp_q[i] = uint32_t(std::min(4294967295.0, std::floor(pe * 4294967296.0)));
    }
  }

  void build_synapses() {
    const size_t m = conn.pre.size();
    S.n = n;
    S.row_ptr.assign(n + 1, 0);
    for (size_t e = 0; e < m; ++e) ++S.row_ptr[conn.pre[e] + 1];
    for (uint32_t i = 0; i < n; ++i) S.row_ptr[i + 1] += S.row_ptr[i];
    S.col.resize(m); S.cnt.resize(m); S.src.resize(m);
    std::vector<uint32_t> fill(S.row_ptr.begin(), S.row_ptr.end() - 1);
    for (size_t e = 0; e < m; ++e) {
      uint32_t d = fill[conn.pre[e]]++;
      S.col[d] = conn.post[e]; S.cnt[d] = conn.count[e]; S.src[d] = conn.pre[e];
    }
    // Incoming-synapse totals for the weight cap (only synapses that carry a weight).
    std::vector<double> in_tot(n, 0);
    auto modulatory = [&](uint32_t i) {
      const std::string& t = conn.neurons[i].transmitter;
      return t == "dopamine" || t == "octopamine";
    };
    for (size_t s = 0; s < m; ++s) if (!modulatory(S.src[s])) in_tot[S.col[s]] += S.cnt[s];
    S.base_q.assign(m, 0);
    for (size_t s = 0; s < m; ++s) {
      const uint32_t a = S.src[s], b = S.col[s];
      if (modulatory(a)) continue;  // neuromodulators: teaching signal only, no fast synapse
      double g = L.sign[a] > 0 ? P.g_exc : -P.g_inh;
      const int ga = L.group[a], gb = L.group[b];
      if (ga == G_SMELL && gb == G_RELAY) g *= P.g_orn_pn;
      else if (ga == G_RELAY && gb == G_KENYON) g *= P.g_pn_kc;
      else if (ga == G_KENYON && gb == G_OUTPUT) g *= P.g_kc_mbon;
      else if (conn.neurons[a].broad_class == "APL" && gb == G_KENYON) g *= P.g_apl_kc;
      else if (ga == G_KENYON && gb == G_KENYON) g *= P.g_kc_kc;
      const double scale = in_tot[b] > P.in_cap ? P.in_cap / in_tot[b] : 1.0;
      S.base_q[s] = int32_t(std::lround(g * S.cnt[s] * scale * kQ));
    }
    S.base0_q = S.base_q;
    S.w_q = S.base_q;
    S.in_ptr.assign(n + 1, 0);
    for (size_t s = 0; s < m; ++s) ++S.in_ptr[S.col[s] + 1];
    for (uint32_t i = 0; i < n; ++i) S.in_ptr[i + 1] += S.in_ptr[i];
    S.in_syn.resize(m);
    std::vector<uint32_t> f2(S.in_ptr.begin(), S.in_ptr.end() - 1);
    for (size_t s = 0; s < m; ++s) S.in_syn[f2[S.col[s]]++] = uint32_t(s);
    for (size_t s = 0; s < m; ++s)
      if (L.group[S.src[s]] == G_KENYON && L.group[S.col[s]] == G_OUTPUT) {
        S.p_idx.push_back(uint32_t(s)); S.p_pre.push_back(S.src[s]); S.p_post.push_back(S.col[s]);
      }
    S.p_mult.assign(S.p_idx.size(), 1.f);
    struct PD { const char* label; int a, b; bool plastic; };
    for (PD d : {PD{"Memory cells to output neurons (plastic)", G_KENYON, G_OUTPUT, true},
                 PD{"Smell sensors to relay neurons", G_SMELL, G_RELAY, false},
                 PD{"Relay neurons to memory cells", G_RELAY, G_KENYON, false},
                 PD{"Reward neurons to memory cells", G_REWARD, G_KENYON, false}}) {
      PathwayDef pd{d.label, d.a, d.b, d.plastic, {}, 0};
      for (size_t s = 0; s < m; ++s)
        if (L.group[S.src[s]] == d.a && L.group[S.col[s]] == d.b) { pd.syn_idx.push_back(uint32_t(s)); pd.synapses += S.cnt[s]; }
      paths.push_back(std::move(pd));
    }
  }

  void recompute_stim() {
    std::vector<double> rate(n, 0.0);
    double next = 1e300;
    const double now = t_ms();
    for (auto& s : stims)
      for (uint32_t i : L.members[s.group]) rate[i] += s.rate;
    if (odour >= 0) for (uint32_t i : L.odour_sensors[odour]) rate[i] += P.odour_rate_hz;
    if (reward != 0) {
      const auto& set = reward > 0 ? L.reward_dans : L.punish_dans;
      for (uint32_t i : set) rate[i] += std::fabs(reward) * P.reward_rate_hz;
    }
    for (auto& s : stims) next = std::min(next, s.end_ms);
    if (odour >= 0) next = std::min(next, odour_end_ms);
    if (reward != 0) next = std::min(next, reward_end_ms);
    (void)now;
    next_expiry_ms = next;
    for (uint32_t i = 0; i < n; ++i) {
      double pe = std::min(1.0, rate[i] * P.dt_ms * 1e-3);
      stimp_q[i] = uint32_t(std::min(4294967295.0, std::floor(pe * 4294967296.0)));
    }
    dirty = false;
  }

  void expire() {
    const double now = t_ms();
    stims.erase(std::remove_if(stims.begin(), stims.end(), [&](const Stim& s) { return s.end_ms <= now; }), stims.end());
    if (odour >= 0 && odour_end_ms <= now) odour = -1;
    if (reward != 0 && reward_end_ms <= now) reward = 0;
    recompute_stim();
  }

  void step1(bool adapt_counts) {
    (void)adapt_counts;
    const uint32_t t = uint32_t(step_++);
    if (dirty || t_ms() >= next_expiry_ms) expire();
    const int32_t fb = int32_t(std::lround(-P.fb_gain * (pop_ema * (1.0 - pop_decay) * 1000.0 / n) * kQ));
    list.clear();
    for (uint32_t i = 0; i < n; ++i) {
      int32_t cur = int32_t((int64_t(I[i]) * F.dI_q) >> 16) + inbuf[i];
      inbuf[i] = 0;
      if (snn::hash3(seed_bg, i, t) < bgp_q[i]) cur += wbg_q;
      if (stimp_q[i] && snn::hash3(seed_st, i, t) < stimp_q[i]) cur += wstim_q;
      int32_t vv = v[i], r = ref[i];
      bool spike = false;
      if (r > 0) --r;
      else {
        vv = int32_t((int64_t(vv) * F.dv_q) >> 16) + int32_t((int64_t(cur + fb) * F.Kq) >> 20);
        vv = std::max(vv, F.vmin);
        if (vv >= F.vth) { spike = true; vv = F.vreset; r = F.ref_steps; }
      }
      I[i] = cur; v[i] = vv; ref[i] = r;
      float a = float(act[i] * act_decay);
      if (spike) { a += 1.f; list.push_back(i); ++win_count[i]; ++totals[i]; }
      act[i] = a;
    }
    pop_ema = pop_ema * pop_decay + double(list.size());
    for (uint32_t i : list)
      for (uint32_t s = S.row_ptr[i]; s < S.row_ptr[i + 1]; ++s) inbuf[S.col[s]] += S.w_q[s];
    // MBON readout trace
    const float rdd = float(rd_decay);
    for (uint32_t m : L.mbons) rd[m] *= rdd;
    for (uint32_t i : list) if (L.group[i] == G_OUTPUT) rd[i] += 1.f;
    if (step_ % P.window_steps == 0) {
      if (learning && rule) rule->sweep(WindowActivity{win_count.data(), P.window_steps * P.dt_ms * 1e-3}, S);
      std::fill(win_count.begin(), win_count.end(), 0u);
    }
  }

  double rate_of_act(uint32_t i) const { return double(act[i]) * (1.0 - act_decay) * 1000.0 / P.dt_ms; }
  double rate_of_rd(uint32_t i) const { return double(rd[i]) * (1.0 - rd_decay) * 1000.0 / P.dt_ms * 1.0; }

  void calibrate(bool verbose) {
    const uint64_t total = uint64_t(P.calib_seconds * 1000.0 / P.dt_ms);
    const uint64_t measure = std::min<uint64_t>(total / 4, uint64_t(30000.0 / P.dt_ms));
    const uint64_t adapt = total - measure;
    std::vector<float> est(n, float(P.target_hz));
    std::vector<uint32_t> cnt10(n, 0);
    std::vector<uint32_t> prev(n, 0);
    seed_bg = 0xCA11B; seed_st = 0xCA11C;
    learning = false;
    const double a_est = std::min(1.0, 0.01 / P.calib_tau_s);
    std::vector<uint64_t> base_tot;
    in_scale.assign(n, 1.f);
    for (uint64_t k = 0; k < total; ++k) {
      if (k == adapt) base_tot = totals;
      step1(false);
      if (k < adapt && (k + 1) % 10 == 0) {
        const double ki = P.calib_ki * (1.0 - double(k) / double(adapt));
        for (uint32_t i = 0; i < n; ++i) {
          const double inst = double(totals[i] - prev[i]) / 0.01;
          prev[i] = uint32_t(totals[i]);
          est[i] += float(a_est * (inst - est[i]));
          const double tgt = (L.group[i] == G_KENYON) ? P.target_kc_hz : P.target_hz;
          double r = bg_rate[i] + ki * (tgt - est[i]) * 0.01;
          bg_rate[i] = float(std::min(P.bg_rate_max, std::max(0.0, r)));
        }
        set_bg();
      }
      if (k < adapt && (k + 1) % 1000 == 0) {  // synaptic scaling only for neurons whose background drive is already at the floor
        for (uint32_t i = 0; i < n; ++i) {
          if (bg_rate[i] > P.scale_floor_hz) continue;
          const double tgt = (L.group[i] == G_KENYON) ? P.target_kc_hz : P.target_hz;
          const double ns = std::min(1.0, std::max(P.scale_min, double(in_scale[i]) * std::exp(0.3 * (tgt - est[i]) / tgt)));
          if (std::fabs(ns - in_scale[i]) < 0.01) continue;
          in_scale[i] = float(ns);
          for (uint32_t q = S.in_ptr[i]; q < S.in_ptr[i + 1]; ++q) {
            const uint32_t s = S.in_syn[q];
            S.base_q[s] = int32_t(std::lround(double(S.base0_q[s]) * ns));
            S.w_q[s] = S.base_q[s];
          }
        }
      }
      if (verbose && (k + 1) % 20000 == 0) {
        double s = 0; for (uint32_t i = 0; i < n; ++i) s += est[i];
        std::fprintf(stderr, "  calibration %.0f/%.0f s, mean est rate %.2f Hz\n", double(k + 1) * 1e-3, double(total) * 1e-3, s / n);
      }
    }
    const double secs = double(measure) * P.dt_ms * 1e-3;
    for (uint32_t i = 0; i < n; ++i) rest_hz[i] = float(double(totals[i] - base_tot[i]) / secs);
    dan_rest.resize(L.dans.size());
    for (size_t d = 0; d < L.dans.size(); ++d) dan_rest[d] = rest_hz[L.dans[d]];
    calib_steps = total;
    snapI = I; snapV = v; snapRef = ref; snap_pop = pop_ema;
    char buf[160];
    std::snprintf(buf, sizeof buf, "calibration: %.0f simulated s (adapt %.0f s, measure %.0f s)", double(total) * 1e-3, double(adapt) * 1e-3, secs);
    calib_log = buf;
  }

  void do_reset(uint64_t seed) {
    I = snapI; v = snapV; ref = snapRef; pop_ema = snap_pop;
    std::fill(inbuf.begin(), inbuf.end(), 0);
    std::fill(win_count.begin(), win_count.end(), 0u);
    std::fill(totals.begin(), totals.end(), 0ull);
    std::fill(rd.begin(), rd.end(), 0.f);
    for (uint32_t i = 0; i < n; ++i) act[i] = float(rest_hz[i] * 0.001 / (1.0 - act_decay));
    for (uint32_t m : L.mbons) rd[m] = float(rest_hz[m] * 1e-3 / (1.0 - rd_decay));
    step_ = 0;
    seed_bg = uint32_t(seed * 2654435761u + 17);
    seed_st = uint32_t(seed * 40503u + 99991);
    stims.clear(); odour = -1; reward = 0;
    do_forget();
    recompute_stim();
  }

  void do_forget() {
    std::fill(S.p_mult.begin(), S.p_mult.end(), 1.f);
    for (size_t p = 0; p < S.p_idx.size(); ++p) S.w_q[S.p_idx[p]] = S.base_q[S.p_idx[p]];
    if (rule) rule->reset();
  }

  double readout(const std::vector<double>& rate) const {
    auto a = [&](const std::vector<uint32_t>& set) {
      double r = 0, b = 0;
      for (uint32_t m : set) { r += rate[m]; b += std::max(0.1, double(rest_hz[m])); }
      return b > 0 ? r / b : 0.0;
    };
    const double aP = a(L.punish_mbons), aR = a(L.reward_mbons);
    return (aP - aR) / (aP + aR + 1e-9);
  }
};

Brain::Brain(const Connectome& c, const Params& p, bool verbose) : d_(new Impl(c, p)) {
  d_->build();
  d_->calibrate(verbose);
  d_->rule = std::make_unique<DopamineGatedDepression>(c, d_->L, d_->P, d_->dan_rest);
  d_->learning = true;
  d_->do_reset(1);
}
Brain::~Brain() = default;

void Brain::reset(uint64_t seed) { d_->do_reset(seed); }
void Brain::step(uint32_t steps) { for (uint32_t s = 0; s < steps; ++s) d_->step1(false); }
double Brain::sim_time() const { return d_->t_ms() * 1e-3; }
uint64_t Brain::step_count() const { return d_->step_; }
void Brain::set_learning(bool on) { d_->learning = on; }
bool Brain::learning() const { return d_->learning; }
void Brain::forget() { d_->do_forget(); }

void Brain::stimulate(int group, double rate_hz, double seconds) {
  if (group < 0 || group >= G_COUNT || rate_hz <= 0 || seconds <= 0) return;
  d_->stims.push_back({group, rate_hz, d_->t_ms() + seconds * 1000.0});
  d_->dirty = true;
}
void Brain::present_odour(int odour, double seconds) {
  if (odour < 0 || odour > 1 || seconds <= 0) return;
  d_->odour = odour; d_->odour_end_ms = d_->t_ms() + seconds * 1000.0;
  d_->dirty = true;
}
void Brain::give_reward(double value, double seconds) {
  value = std::max(-1.0, std::min(1.0, value));
  if (seconds <= 0 || value == 0) { d_->reward = 0; d_->dirty = true; return; }
  d_->reward = value; d_->reward_end_ms = d_->t_ms() + seconds * 1000.0;
  d_->dirty = true;
}
void Brain::clear_stimuli() {
  d_->stims.clear(); d_->odour = -1; d_->reward = 0; d_->dirty = true;
}

const Layout& Brain::layout() const { return d_->L; }
const Connectome& Brain::connectome() const { return d_->conn; }
const Params& Brain::params() const { return d_->P; }
const SynapseStore& Brain::synapses() const { return d_->S; }
const std::vector<PathwayDef>& Brain::pathways() const { return d_->paths; }
const std::vector<uint64_t>& Brain::spike_totals() const { return d_->totals; }
double Brain::rest_rate_hz(uint32_t i) const { return d_->rest_hz[i]; }
const std::vector<float>& Brain::bg_rates() const { return d_->bg_rate; }
uint64_t Brain::calibration_steps() const { return d_->calib_steps; }
const std::string& Brain::calibration_log() const { return d_->calib_log; }
double Brain::neuron_rate_hz(uint32_t i) const { return d_->rate_of_act(i); }

Stats Brain::stats() const {
  Stats s;
  const auto& D = *d_;
  s.sim_time = sim_time();
  for (int g = 0; g < G_COUNT; ++g) {
    double r = 0;
    for (uint32_t i : D.L.members[g]) r += D.rate_of_act(i);
    s.group_rate_hz.push_back(D.L.members[g].empty() ? 0.0 : r / D.L.members[g].size());
  }
  for (const auto& p : D.paths) {
    double r = 0; size_t k = 0;
    for (uint32_t i : p.syn_idx) {
      if (D.S.base_q[i] == 0) continue;
      r += double(D.S.w_q[i]) / double(D.S.base_q[i]); ++k;
    }
    s.pathway_strength.push_back(k ? r / k : 1.0);
  }
  s.reward = D.reward;
  s.odour = D.odour;
  s.odour_seconds_left = D.odour >= 0 ? std::max(0.0, (D.odour_end_ms - D.t_ms()) * 1e-3) : 0.0;
  for (const auto& st : D.stims) s.stimuli.push_back({st.group, st.rate, std::max(0.0, (st.end_ms - D.t_ms()) * 1e-3)});
  std::vector<double> rate(D.n, 0.0);
  for (uint32_t m : D.L.mbons) rate[m] = D.rate_of_rd(m);
  s.approach = D.readout(rate);
  return s;
}

double Brain::approach_from_counts(const std::vector<uint64_t>& a, const std::vector<uint64_t>& b, double seconds) const {
  std::vector<double> rate(d_->n, 0.0);
  for (uint32_t m : d_->L.mbons) rate[m] = double(b[m] - a[m]) / seconds;
  return d_->readout(rate);
}

NeuronDetail Brain::detail(uint32_t i) const {
  NeuronDetail nd{};
  const auto& D = *d_;
  nd.neuron = i;
  if (i >= D.n) return nd;
  nd.rate_hz = D.rate_of_act(i);
  auto strength = [&](uint32_t s) { return D.S.base_q[s] != 0 ? double(D.S.w_q[s]) / double(D.S.base_q[s]) : 1.0; };
  std::vector<uint32_t> out, in;
  for (uint32_t s = D.S.row_ptr[i]; s < D.S.row_ptr[i + 1]; ++s) out.push_back(s);
  for (uint32_t k = D.S.in_ptr[i]; k < D.S.in_ptr[i + 1]; ++k) in.push_back(D.S.in_syn[k]);
  nd.out_degree = uint32_t(out.size()); nd.in_degree = uint32_t(in.size());
  auto top = [&](std::vector<uint32_t>& v, bool outgoing, std::vector<LinkPartnerInfo>& dst) {
    std::stable_sort(v.begin(), v.end(), [&](uint32_t a, uint32_t b) { return D.S.cnt[a] > D.S.cnt[b]; });
    for (size_t k = 0; k < v.size() && k < 12; ++k)
      dst.push_back({outgoing ? D.S.col[v[k]] : D.S.src[v[k]], D.S.cnt[v[k]], strength(v[k])});
  };
  top(out, true, nd.outputs);
  top(in, false, nd.inputs);
  return nd;
}

void Brain::activity_bytes(uint8_t* out) const {
  for (uint32_t i = 0; i < d_->n; ++i) {
    double r = d_->rate_of_act(i) / 50.0;
    out[i] = uint8_t(std::lround(255.0 * std::min(1.0, std::max(0.0, r))));
  }
}

}  // namespace larva
