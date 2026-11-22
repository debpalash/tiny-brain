// CLI report of the learning experiment: larva_experiment [--seeds N] [--data DIR] [--csv]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "larva_experiment.h"
using namespace larva;

int main(int argc, char** argv) {
  int seeds = 8;
  std::string dir = LARVA_DATA_DIR;
  ExperimentConfig cfg;
  Params p;
  for (int i = 1; i < argc; ++i) {
    if (!std::strcmp(argv[i], "--seeds") && i + 1 < argc) seeds = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--data") && i + 1 < argc) dir = argv[++i];
    else if (!std::strcmp(argv[i], "--eta") && i + 1 < argc) p.eta = std::atof(argv[++i]);
    else if (!std::strcmp(argv[i], "--kcthr") && i + 1 < argc) p.kc_threshold = std::atof(argv[++i]);
    else if (!std::strcmp(argv[i], "--pairings") && i + 1 < argc) cfg.pairings = std::atoi(argv[++i]);
  }
  Connectome c; std::string err;
  if (!load_connectome(dir, c, err)) { std::fprintf(stderr, "%s\n", err.c_str()); return 1; }
  Brain b(c, p);
  std::printf("%s\n", b.calibration_log().c_str());
  const Condition conds[] = {Condition::PairedReward, Condition::PairedPunish, Condition::ControlReward, Condition::ControlPunish};
  auto t0 = std::chrono::steady_clock::now();
  std::vector<std::vector<RunResult>> all(4);
  for (int ci = 0; ci < 4; ++ci)
    for (int s = 0; s < seeds; ++s) all[ci].push_back(run_one(b, conds[ci], 100 + s, cfg));
  double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::printf("change in approach (post - pre), %d seeds, mean +- sd (sem); approach in -1..1\n", seeds);
  std::printf("%-40s %-22s %-22s %-10s\n", "condition", "odour A (paired/first)", "odour B (untrained)", "KC>MBON");
  for (int ci = 0; ci < 4; ++ci) {
    std::vector<double> a, bb, st;
    for (auto& r : all[ci]) { a.push_back(r.delta(0)); bb.push_back(r.delta(1)); st.push_back(r.kc_mbon_strength); }
    Summary sa = summarise(a), sb = summarise(bb), ss = summarise(st);
    std::printf("%-40s %+.3f +- %.3f (%.3f)  %+.3f +- %.3f (%.3f)  %.3f\n", condition_name(conds[ci]), sa.mean, sa.sd, sa.sem,
                sb.mean, sb.sd, sb.sem, ss.mean);
  }
  for (int ci = 0; ci < 4; ++ci) {
    std::printf("%s\n", condition_name(conds[ci]));
    for (auto& r : all[ci])
      std::printf("  seed %llu pre A %+.3f B %+.3f  post A %+.3f B %+.3f  dA %+.3f dB %+.3f\n", (unsigned long long)r.seed, r.pre[0],
                  r.pre[1], r.post[0], r.post[1], r.delta(0), r.delta(1));
  }
  std::printf("total wall time %.1f s (%d seeds x 4 conditions)\n", wall, seeds);
  return 0;
}
