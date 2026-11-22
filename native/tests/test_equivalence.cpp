// CPU reference vs Metal: per-neuron spike counts, state and final weights must match exactly.
#include <cstdio>
#include <cstring>
#include "metal_backend.h"
#include "network_builder.h"

using namespace snn;

static int compare(const Snapshot& a, const Snapshot& b, const char* tag) {
  int bad = 0;
  auto cmp = [&](const char* what, const auto& x, const auto& y) {
    if (x.size() != y.size()) { std::printf("[%s] %s size mismatch\n", tag, what); ++bad; return; }
    size_t diff = 0;
    for (size_t i = 0; i < x.size(); ++i)
      if (std::memcmp(&x[i], &y[i], sizeof(x[i])) != 0) ++diff;  // bitwise
    if (diff) { std::printf("[%s] %s: %zu / %zu elements differ\n", tag, what, diff, x.size()); ++bad; }
  };
  cmp("spike_count", a.spike_count, b.spike_count);
  cmp("v", a.v, b.v); cmp("I", a.I, b.I); cmp("x", a.x, b.x); cmp("y", a.y, b.y);
  cmp("w", a.w, b.w);
  return bad;
}

static int run_case(const Network& net, SimParams p, bool learning, const MetalOptions& mo,
                    uint32_t seconds_steps, const char* tag) {
  p.learning = learning;
  auto cpu = make_cpu_backend();
  auto gpu = make_metal_backend(mo);
  cpu->upload(net, p);
  gpu->upload(net, p);
  int bad = 0;
  const uint32_t seg = 250;
  for (uint32_t done = 0; done < seconds_steps; done += seg) {
    cpu->run(seg);
    gpu->run(seg);
    bad += compare(cpu->snapshot(true), gpu->snapshot(true), tag);
    if (bad) break;
  }
  Snapshot s = cpu->snapshot(true);
  uint64_t spikes = 0;
  for (auto c : s.spike_count) spikes += c;
  size_t changed = 0;
  for (size_t i = 0; i < s.w.size(); ++i) if (s.w[i] != net.w[i]) ++changed;
  std::printf("[%s] spikes=%llu rate=%.2f Hz, weights changed=%zu/%zu -> %s\n", tag,
              (unsigned long long)spikes, spikes / (double(net.n) * seconds_steps * 1e-3), changed,
              s.w.size(), bad ? "MISMATCH" : "bit-identical");
  if (spikes == 0) { std::printf("[%s] no spikes: test is vacuous\n", tag); ++bad; }
  if (learning && changed == 0) { std::printf("[%s] learning changed nothing\n", tag); ++bad; }
  return bad;
}

int main() {
  NetConfig cfg;
  cfg.n = 2000;
  cfg.mean_degree = 100;
  cfg.seed = 7;
  Network net = build_network(cfg);
  std::printf("test net: n=%u synapses=%llu\n", net.n, (unsigned long long)net.m);
  SimParams p = default_params(net);
  p.seed = 99;
  SimParams hot = p;  // default drive: ~35 Hz at this small in-degree (stress case)
  p.w_ext = 7.0 * net.w0;  // ~6 Hz at in-degree 100
  int bad = 0;
  MetalOptions mo;
  mo.steps_per_cmdbuf = 100;
  bad += run_case(net, p, true, mo, 2000, "learning on, batch 100, 2 s");
  bad += run_case(net, p, false, mo, 1000, "learning off, batch 100, 1 s");
  mo.steps_per_cmdbuf = 37; mo.group_size = 64;
  bad += run_case(net, p, true, mo, 1000, "learning on, batch 37, group 64, 1 s");
  bad += run_case(net, hot, true, mo, 1000, "learning on, high-rate stress, 1 s");
  // Deferred STDP: interval 20 and 50 (divide the 250-step checkpoints), 30 and 100 (checkpoints fall
  // mid-interval; 100 needs 4 mask words), plus the high-rate stress case.
  for (uint32_t L : {20u, 30u, 50u, 100u}) {
    SimParams d = p; d.deferred = true; d.stdp_interval = L;
    mo.steps_per_cmdbuf = (L == 30) ? 37 : 100; mo.group_size = 128;
    char tag[96]; std::snprintf(tag, sizeof tag, "deferred L=%u, 2 s", L);
    bad += run_case(net, d, true, mo, 2000, tag);
  }
  { SimParams d = hot; d.deferred = true; d.stdp_interval = 50;
    bad += run_case(net, d, true, mo, 1000, "deferred L=50, high-rate stress, 1 s"); }
  std::printf(bad ? "FAIL\n" : "PASS (exact bitwise equality)\n");
  return bad ? 1 : 0;
}
