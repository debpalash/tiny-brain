#include <sys/resource.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include "backend.h"
#include "network_builder.h"
#ifdef SNN_HAVE_METAL
#include "metal_backend.h"
#endif

using namespace snn;
using Clock = std::chrono::steady_clock;
static double since(Clock::time_point t) { return std::chrono::duration<double>(Clock::now() - t).count(); }

struct Result {
  std::string label, backend;
  uint32_t n = 0; uint64_t m = 0;
  bool learning = false;
  bool deferred = false; uint32_t interval = 0;
  uint32_t batch = 0; bool pipeline = true; uint32_t group = 0;
  double sim_s = 0, wall_s = 0, rtf = 0, rate_hz = 0, events_per_s = 0, gpu_busy_s = -1;
  double upload_s = 0;
  std::vector<double> rate_per_sec;
  double mean_exc_w = 0, frac_at_zero = 0, frac_at_max = 0, w_min = 0, w_max_seen = 0;
  double w_ref_mean = 0;
};

struct Ctx {
  uint32_t n = 139255;
  double mean_deg = 50000000.0 / 139255.0;
  double ap = -1, amr = -1;
  double rate = 100, wext = 12.5, wj = 1.5, inh = 4.0;
  uint32_t seed = 1;
  bool deferred = false;
  uint32_t interval = 100;
};

static uint64_t events_of(const Network& net, const std::vector<uint32_t>& c) {
  uint64_t e = 0;
  for (uint32_t i = 0; i < net.n; ++i) e += uint64_t(c[i]) * (net.row_ptr[i + 1] - net.row_ptr[i]);
  return e;
}
static uint64_t spikes_of(const std::vector<uint32_t>& c) { uint64_t s = 0; for (auto x : c) s += x; return s; }

// Warm-up (not timed), then run `sim_s` seconds in 1-second chunks, timing the whole run.
static Result measure(Backend& be, const Network& net, SimParams p, bool learning, double warm_s,
                      double sim_s, const std::string& label) {
  Result r;
  r.label = label; r.backend = be.name(); r.n = net.n; r.m = net.m; r.learning = learning;
  r.deferred = learning && p.deferred; r.interval = r.deferred ? p.stdp_interval : 0;
  p.learning = learning;
  auto t0 = Clock::now();
  be.upload(net, p);
  be.sync();
  r.upload_s = since(t0);
  const uint32_t spw = uint32_t(std::lround(1000.0 / p.dt_ms));
  be.run(uint32_t(std::lround(warm_s * spw)));
  be.sync();
  Snapshot s0 = be.snapshot(false);
  double gpu0 = 0;
#ifdef SNN_HAVE_METAL
  if (!std::strcmp(be.name(), "metal")) gpu0 = metal_gpu_seconds(be);
#endif
  uint64_t prev = spikes_of(s0.spike_count);
  uint32_t chunks = uint32_t(std::ceil(sim_s));
  double wall_acc = 0;
  for (uint32_t c = 0; c < chunks; ++c) {
    auto tc = Clock::now();
    double chunk_s = std::min(1.0, sim_s - c);
    be.run(uint32_t(std::lround(chunk_s * spw)));
    be.sync();
    wall_acc += since(tc);
    Snapshot s = be.snapshot(false);  // readback excluded from wall time
    uint64_t cur = spikes_of(s.spike_count);
    r.rate_per_sec.push_back((cur - prev) / (double(net.n) * chunk_s));
    prev = cur;
  }
  r.wall_s = wall_acc;
  r.sim_s = sim_s;
  r.rtf = sim_s / r.wall_s;
  Snapshot s1 = be.snapshot(learning);
  std::vector<uint32_t> d(net.n);
  for (uint32_t i = 0; i < net.n; ++i) d[i] = s1.spike_count[i] - s0.spike_count[i];
  r.rate_hz = spikes_of(d) / (double(net.n) * sim_s);
  r.events_per_s = events_of(net, d) / r.wall_s;
#ifdef SNN_HAVE_METAL
  if (!std::strcmp(be.name(), "metal")) r.gpu_busy_s = metal_gpu_seconds(be) - gpu0;
#endif
  if (learning) {
    double sum = 0, mn = 1e9, mx = -1e9; uint64_t cnt = 0, z = 0, at = 0;
    const float wmax = float(net.w_max);
    for (uint32_t i = 0; i < net.n; ++i) {
      if (!net.is_exc[i]) continue;
      for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) {
        float w = s1.w[k];
        sum += w; ++cnt; mn = std::min<double>(mn, w); mx = std::max<double>(mx, w);
        if (w <= 0) ++z;
        if (w >= wmax) ++at;
      }
    }
    r.mean_exc_w = sum / cnt; r.frac_at_zero = double(z) / cnt; r.frac_at_max = double(at) / cnt;
    r.w_min = mn; r.w_max_seen = mx;
    double s0w = 0; uint64_t c0 = 0;
    for (uint32_t i = 0; i < net.n; ++i) if (net.is_exc[i])
      for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) { s0w += net.w[k]; ++c0; }
    r.w_ref_mean = s0w / c0;
  }
  return r;
}

static std::string jnum(double v) { char b[64]; std::snprintf(b, sizeof b, "%.6g", v); return b; }
static std::string to_json(const Result& r) {
  std::ostringstream o;
  o << "{\"label\":\"" << r.label << "\",\"backend\":\"" << r.backend << "\",\"neurons\":" << r.n
    << ",\"synapses\":" << r.m << ",\"learning\":" << (r.learning ? "true" : "false") << ",\"stdp\":\"" << (!r.learning ? "off" : r.deferred ? "deferred" : "per-spike") << "\",\"stdp_interval\":" << r.interval
    << ",\"batch_steps\":" << r.batch << ",\"pipelined\":" << (r.pipeline ? "true" : "false")
    << ",\"group_size\":" << r.group << ",\"sim_seconds\":" << jnum(r.sim_s)
    << ",\"wall_seconds\":" << jnum(r.wall_s) << ",\"realtime_factor\":" << jnum(r.rtf)
    << ",\"mean_rate_hz\":" << jnum(r.rate_hz) << ",\"synaptic_events_per_s\":" << jnum(r.events_per_s)
    << ",\"gpu_busy_seconds\":" << jnum(r.gpu_busy_s) << ",\"upload_seconds\":" << jnum(r.upload_s)
    << ",\"rate_hz_per_sim_second\":[";
  for (size_t i = 0; i < r.rate_per_sec.size(); ++i) o << (i ? "," : "") << jnum(r.rate_per_sec[i]);
  o << "]";
  if (r.learning)
    o << ",\"exc_weight\":{\"initial_mean\":" << jnum(r.w_ref_mean) << ",\"final_mean\":" << jnum(r.mean_exc_w)
      << ",\"min\":" << jnum(r.w_min) << ",\"max\":" << jnum(r.w_max_seen)
      << ",\"frac_at_zero\":" << jnum(r.frac_at_zero) << ",\"frac_at_wmax\":" << jnum(r.frac_at_max) << "}";
  o << "}";
  return o.str();
}

static double peak_rss_mb() {
  rusage ru{}; getrusage(RUSAGE_SELF, &ru);
  return ru.ru_maxrss / 1048576.0;  // bytes on macOS
}

int main(int argc, char** argv) {
  Ctx c;
  std::string mode = "main";
  double seconds = 10, warm = 1, cpu_seconds = 1;
  uint32_t batch = 100, group = 128;
  std::string out = std::string(SNN_RESULTS_DIR) + "/bench.json";
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    auto val = [&]() { return std::string(argv[++i]); };
    if (a == "--mode") mode = val();
    else if (a == "--n") c.n = std::stoul(val());
    else if (a == "--deg") c.mean_deg = std::stod(val());
    else if (a == "--rate") c.rate = std::stod(val());
    else if (a == "--wext") c.wext = std::stod(val());
    else if (a == "--wj") c.wj = std::stod(val());
    else if (a == "--ap") c.ap = std::stod(val());
    else if (a == "--amr") c.amr = std::stod(val());
    else if (a == "--inh") c.inh = std::stod(val());
    else if (a == "--seconds") seconds = std::stod(val());
    else if (a == "--warmup") warm = std::stod(val());
    else if (a == "--cpu-seconds") cpu_seconds = std::stod(val());
    else if (a == "--batch") batch = std::stoul(val());
    else if (a == "--group") group = std::stoul(val());
    else if (a == "--stdp") { std::string v = val(); if (v == "deferred") c.deferred = true; else if (v == "per-spike") c.deferred = false; else { std::fprintf(stderr, "--stdp per-spike|deferred\n"); return 2; } }
    else if (a == "--stdp-interval") c.interval = std::stoul(val());
    else if (a == "--out") out = val();
    else { std::fprintf(stderr, "unknown arg %s\n", a.c_str()); return 2; }
  }
  auto make_net = [&](uint32_t n, double* secs) {
    NetConfig cfg; cfg.n = n; cfg.mean_degree = c.mean_deg; cfg.wj = c.wj; cfg.inh_ratio = c.inh; cfg.seed = c.seed;
    auto t = Clock::now();
    Network net = build_network(cfg);
    if (secs) *secs = since(t);
    return net;
  };
  auto params = [&](const Network& net) {
    SimParams p = default_params(net);
    p.ext_rate_hz = c.rate; p.w_ext = c.wext * net.w0;
    if (c.ap >= 0) { p.a_plus = c.ap * net.w0; p.a_minus = p.a_plus * (c.amr >= 0 ? c.amr : 1.05); }
    else if (c.amr >= 0) p.a_minus = p.a_plus * c.amr;
    p.deferred = c.deferred; p.stdp_interval = c.interval;
    return p;
  };

  std::vector<std::string> json;
  if (mode == "tune") {  // CPU only: print rates per second
    double bs; Network net = make_net(c.n, &bs);
    std::printf("n=%u m=%llu build %.2fs w0=%.4f\n", net.n, (unsigned long long)net.m, bs, net.w0);
    auto be = make_cpu_backend();
    for (bool l : {false, true}) {
      Result r = measure(*be, net, params(net), l, 0.5, seconds, l ? "tune-on" : "tune-off");
      std::printf("learning=%d rate/s:", l);
      for (double x : r.rate_per_sec) std::printf(" %.2f", x);
      if (l) std::printf(" | exc w mean %.4f -> %.4f  frac0 %.3f fracmax %.3f", r.w_ref_mean, r.mean_exc_w, r.frac_at_zero, r.frac_at_max);
      std::printf(" | rtf %.2f\n", r.rtf);
    }
    return 0;
  }
#ifdef SNN_HAVE_METAL
  double build_s = 0;
  Network net = make_net(c.n, &build_s);
  std::printf("network: n=%u synapses=%llu (mean out-degree %.1f, max %u) build %.2f s, host bytes/synapse %.2f\n",
              net.n, (unsigned long long)net.m, double(net.m) / net.n, [&] { uint32_t mx = 0; for (uint32_t i = 0; i < net.n; ++i) mx = std::max(mx, net.row_ptr[i + 1] - net.row_ptr[i]); return mx; }(),
              build_s, double(net.bytes()) / net.m);
  auto metal_run = [&](bool learning, uint32_t b, bool pipe, uint32_t g, double sec, double wm, const std::string& label, const Network& nt) {
    MetalOptions mo; mo.steps_per_cmdbuf = b; mo.pipeline = pipe; mo.group_size = g;
    auto be = make_metal_backend(mo);
    Result r = measure(*be, nt, params(nt), learning, wm, sec, label);
    r.batch = b; r.pipeline = pipe; r.group = g;
    r.upload_s = r.upload_s;
    return std::make_pair(r, be->device_bytes());
  };
  if (mode == "verify") {  // full-size CPU vs Metal, 1 simulated second with learning
    auto p = params(net); p.learning = true;
    auto cpu = make_cpu_backend(); auto gpu = make_metal_backend();
    cpu->upload(net, p); gpu->upload(net, p);
    uint32_t steps = uint32_t(seconds * 1000);
    cpu->run(steps); gpu->run(steps);
    Snapshot a = cpu->snapshot(true), b = gpu->snapshot(true);
    size_t dc = 0, dw = 0, dv = 0;
    for (size_t i = 0; i < a.spike_count.size(); ++i) { dc += a.spike_count[i] != b.spike_count[i]; dv += a.v[i] != b.v[i]; }
    for (size_t i = 0; i < a.w.size(); ++i) dw += std::memcmp(&a.w[i], &b.w[i], 4) != 0;
    std::printf("full-size verify (%.1f s, learning on): spikes=%llu, differing spike counts %zu/%u, differing v %zu, differing weights %zu/%llu -> %s\n",
                seconds, (unsigned long long)spikes_of(a.spike_count), dc, net.n, dv, dw, (unsigned long long)net.m, (dc | dv | dw) ? "MISMATCH" : "bit-identical");
    return (dc | dv | dw) ? 1 : 0;
  }
  if (mode == "deferred" || mode == "fidelity") {
    // Splices a "deferred" (timing) and/or "fidelity" entry into the existing bench.json, keeping the rest.
    std::string add;
    auto splice = [&](const std::string& key, const std::string& body) {
      std::string txt; { std::ifstream f(out); std::stringstream ss; ss << f.rdbuf(); txt = ss.str(); }
      if (txt.empty()) txt = "{\n}\n";
      std::string pat = ",\n  \"" + key + "\":";
      size_t at = txt.find(pat);
      if (at != std::string::npos) {  // drop the old entry (it is always last or followed by another spliced key)
        size_t end = txt.find(",\n  \"", at + 1);
        if (end == std::string::npos) end = txt.rfind("\n}");
        txt.erase(at, end - at);
      }
      size_t close = txt.rfind("\n}");
      txt.insert(close, pat + body);
      std::ofstream(out) << txt;
    };
    if (mode == "deferred") {
      std::vector<Result> rs;
      auto run1 = [&](bool l, bool def, uint32_t L, const std::string& label) {
        Ctx save = c; c.deferred = def; c.interval = L;
        auto [r, bytes] = metal_run(l, batch, true, group, seconds, warm, label, net);
        c = save; rs.push_back(r);
        std::printf("%-28s rtf %.2f  wall %.2fs  rate %.2f Hz  gpu busy %.2fs\n", label.c_str(), r.rtf, r.wall_s, r.rate_hz, r.gpu_busy_s);
      };
      run1(false, false, 0, "metal learning off");
      run1(true, false, 0, "metal per-spike STDP");
      for (uint32_t L : {20u, 50u, 100u, 200u}) run1(true, true, L, "metal deferred STDP L=" + std::to_string(L));
      std::string body = " [";
      for (size_t i = 0; i < rs.size(); ++i) body += (i ? ",\n    " : "\n    ") + to_json(rs[i]);
      splice("deferred", body + "]");
    }
    if (mode == "fidelity") {
      auto go = [&](bool def, uint32_t L, uint32_t seed_add = 0) {
        Ctx save = c; c.deferred = def; c.interval = L;
        SimParams p = params(net); c = save; p.learning = true; p.seed += seed_add;
        MetalOptions mo; mo.steps_per_cmdbuf = batch; mo.group_size = group;
        auto be = make_metal_backend(mo);
        be->upload(net, p);
        be->run(uint32_t(seconds * 1000));
        Snapshot s = be->snapshot(true);
        return s;
      };
      Snapshot a = go(false, 0);
      Snapshot b = go(true, c.interval);
      Snapshot a2 = go(false, 0, 1);  // noise ceiling: the per-spike rule again, only the Poisson drive seed differs
      auto corr_of = [&](const Snapshot& u, const Snapshot& v, double* mad) {
        long double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sad = 0; uint64_t cnt = 0;
        for (uint32_t i = 0; i < net.n; ++i) if (net.is_exc[i])
          for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) {
            double x = double(u.w[k]) - net.w[k], y = double(v.w[k]) - net.w[k];
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sad += std::fabs(x - y); ++cnt;
          }
        double mx = sx / cnt, my = sy / cnt;
        *mad = double(sad / cnt);
        return (sxy / cnt - mx * my) / std::sqrt((sxx / cnt - mx * mx) * (syy / cnt - my * my));
      };
      double mad_ref = 0; double corr_ref = double(corr_of(a, a2, &mad_ref));
      struct St { double rate, mean, sd; };
      auto stat = [&](const Snapshot& s) {
        double sum = 0, sq = 0; uint64_t cnt = 0;
        for (uint32_t i = 0; i < net.n; ++i) if (net.is_exc[i])
          for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) { double w = s.w[k]; sum += w; sq += w * w; ++cnt; }
        double mean = sum / cnt;
        return St{spikes_of(s.spike_count) / (double(net.n) * seconds), mean, std::sqrt(sq / cnt - mean * mean)};
      };
      St sa = stat(a), sb = stat(b), s0;
      { Snapshot z; z.w = net.w; z.spike_count.assign(net.n, 0); s0 = stat(z); }
      long double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sad = 0, sax = 0, say = 0; uint64_t cnt = 0, chx = 0, chy = 0;
      for (uint32_t i = 0; i < net.n; ++i) if (net.is_exc[i])
        for (uint32_t k = net.row_ptr[i]; k < net.row_ptr[i + 1]; ++k) {
          double x = double(a.w[k]) - net.w[k], y = double(b.w[k]) - net.w[k];
          sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sad += std::fabs(x - y);
          sax += std::fabs(x); say += std::fabs(y); chx += x != 0; chy += y != 0; ++cnt;
        }
      double mx = sx / cnt, my = sy / cnt;
      double vx = sxx / cnt - mx * mx, vy = syy / cnt - my * my, cov = sxy / cnt - mx * my;
      double corr = cov / std::sqrt(vx * vy);
      char buf[2000];
      std::snprintf(buf, sizeof buf,
        "{\"sim_seconds\":%g,\"interval\":%u,\"initial_exc_weight\":{\"mean\":%.6g,\"sd\":%.6g},"
        "\"per_spike\":{\"rate_hz\":%.4f,\"exc_w_mean\":%.6g,\"exc_w_sd\":%.6g,\"mean_dw\":%.4g,\"mean_abs_dw\":%.4g,\"frac_changed\":%.4f},"
        "\"deferred\":{\"rate_hz\":%.4f,\"exc_w_mean\":%.6g,\"exc_w_sd\":%.6g,\"mean_dw\":%.4g,\"mean_abs_dw\":%.4g,\"frac_changed\":%.4f},"
        "\"dw_correlation\":%.5f,\"dw_mean_abs_difference\":%.4g,"
        "\"per_spike_vs_per_spike_other_drive_seed\":{\"dw_correlation\":%.5f,\"dw_mean_abs_difference\":%.4g,\"rate_hz\":%.4f}}",
        seconds, c.interval, s0.mean, s0.sd, sa.rate, sa.mean, sa.sd, double(mx), double(sax / cnt), double(chx) / cnt,
        sb.rate, sb.mean, sb.sd, double(my), double(say / cnt), double(chy) / cnt, corr, double(sad / cnt), corr_ref, mad_ref, spikes_of(a2.spike_count) / (double(net.n) * seconds));
      std::printf("fidelity (%g s, L=%u):\n%s\n", seconds, c.interval, buf);
      splice("fidelity_L" + std::to_string(c.interval) + (seconds == 10 ? "" : "_" + std::to_string(int(seconds * 1000)) + "ms"), std::string(" ") + buf);
    }
    return 0;
  }
  std::vector<Result> main_results, sweep_batch, sweep_size, sweep_group;
  size_t dev_bytes = 0;
  if (mode == "main" || mode == "all") {
    for (bool l : {false, true}) {
      auto [r, bytes] = metal_run(l, batch, true, group, seconds, warm, l ? "metal learning on" : "metal learning off", net);
      dev_bytes = bytes;
      main_results.push_back(r);
      std::printf("%-20s rtf %.2f  wall %.2fs  rate %.2f Hz  events/s %.3g  gpu busy %.2fs\n", r.label.c_str(), r.rtf, r.wall_s, r.rate_hz, r.events_per_s, r.gpu_busy_s);
    }
    for (bool l : {false, true}) {
      auto be = make_cpu_backend();
      Result r = measure(*be, net, params(net), l, 0.0, cpu_seconds, l ? "cpu learning on" : "cpu learning off");
      main_results.push_back(r);
      std::printf("%-20s rtf %.3f  wall %.2fs  rate %.2f Hz  events/s %.3g\n", r.label.c_str(), r.rtf, r.wall_s, r.rate_hz, r.events_per_s);
    }
  }
  if (mode == "sweeps" || mode == "all") {
    for (bool l : {false, true})
      for (bool pipe : {true, false})
        for (uint32_t b : {1u, 5u, 20u, 50u, 100u, 200u, 500u, 1000u}) {
          if (!pipe && (b == 1000u)) continue;
          auto [r, bytes] = metal_run(l, b, pipe, group, 2.0, 0.5, "batch sweep", net);
          sweep_batch.push_back(r);
          std::printf("batch %4u pipe %d learn %d: rtf %.2f gpu_busy %.2f/%.2f s\n", b, pipe, l, r.rtf, r.gpu_busy_s, r.wall_s);
        }
    for (bool l : {false, true})
      for (uint32_t g : {32u, 64u, 128u, 256u}) {
        auto [r, bytes] = metal_run(l, 100, true, g, 2.0, 0.5, "group sweep", net);
        sweep_group.push_back(r);
        std::printf("group %u learn %d: rtf %.2f\n", g, l, r.rtf);
      }
    for (uint32_t n : {5000u, 10000u, 20000u, 40000u, 80000u, 139255u, 278510u}) {
      Network nt = make_net(n, nullptr);
      for (bool l : {false, true}) {
        auto [r, bytes] = metal_run(l, 100, true, group, 2.0, 0.5, "size sweep", nt);
        sweep_size.push_back(r);
        std::printf("n %6u learn %d: rtf %.2f rate %.2f Hz gpu_busy %.2f/%.2f s\n", n, l, r.rtf, r.rate_hz, r.gpu_busy_s, r.wall_s);
      }
    }
  }
  auto arr = [](const std::vector<Result>& v) {
    std::string s = "[";
    for (size_t i = 0; i < v.size(); ++i) s += (i ? ",\n    " : "\n    ") + to_json(v[i]);
    return s + "]";
  };
  std::ostringstream o;
  o << "{\n  \"network\":{\"neurons\":" << net.n << ",\"synapses\":" << net.m
    << ",\"build_seconds\":" << jnum(build_s) << ",\"host_bytes_per_synapse\":" << jnum(double(net.bytes()) / net.m)
    << ",\"device_bytes_allocated\":" << dev_bytes << ",\"device_bytes_per_synapse\":" << jnum(double(dev_bytes) / net.m)
    << ",\"process_peak_rss_mb\":" << jnum(peak_rss_mb()) << "},\n"
    << "  \"main\":" << arr(main_results) << ",\n  \"sweep_batch\":" << arr(sweep_batch)
    << ",\n  \"sweep_group_size\":" << arr(sweep_group) << ",\n  \"sweep_network_size\":" << arr(sweep_size) << "\n}\n";
  std::ofstream(out) << o.str();
  std::printf("wrote %s (peak RSS %.0f MB, device buffers %.0f MB)\n", out.c_str(), peak_rss_mb(), dev_bytes / 1048576.0);
#endif
  return 0;
}
