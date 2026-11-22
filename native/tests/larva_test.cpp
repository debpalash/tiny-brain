// larva_test <loader|stability|learning> : automated evidence for the larva brain (no viewer needed).
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include "larva_experiment.h"

using namespace larva;
static int g_fail = 0;
#define CHECK(c, ...) do { bool ok_ = (c); std::printf("%s ", ok_ ? "ok  " : "FAIL"); std::printf(__VA_ARGS__); std::printf("\n"); if (!ok_) ++g_fail; } while (0)

static bool load(Connectome& c) {
  std::string err;
  if (!load_connectome(LARVA_DATA_DIR, c, err)) { std::printf("FAIL load: %s\n", err.c_str()); return false; }
  return true;
}

static int test_loader() {
  Connectome c;
  if (!load(c)) return 1;
  CHECK(c.neurons.size() == 3016, "neurons = %zu (expect 3016)", c.neurons.size());
  CHECK(c.pre.size() == 107388, "connected pairs = %zu (expect 107388)", c.pre.size());
  CHECK(c.total_synapses == 337264, "synapses = %llu (expect 337264)", (unsigned long long)c.total_synapses);
  // independent recount straight from the CSV text
  std::ifstream f(std::string(LARVA_DATA_DIR) + "/synapses.csv");
  std::string line; std::getline(f, line);
  size_t rows = 0; unsigned long long sum = 0;
  while (std::getline(f, line)) { if (line.empty()) continue; ++rows; size_t a = line.find(','), b = line.find(',', a + 1), e = line.find(',', b + 1); sum += std::stoull(line.substr(b + 1, e - b - 1)); }
  CHECK(rows == 107388 && sum == 337264, "independent CSV recount rows=%zu sum=%llu", rows, sum);
  int dop = 0; for (auto& n : c.neurons) dop += n.transmitter == "dopamine";
  CHECK(dop == 14, "dopamine neurons = %d (expect 14)", dop);
  Params p; p.calib_seconds = 1;  // wiring/layout only, skip real calibration
  Brain b(c, p);
  const Layout& L = b.layout();
  CHECK(L.members[G_SMELL].size() == 42 && L.members[G_RELAY].size() == 80 && L.members[G_KENYON].size() == 222 && L.members[G_OUTPUT].size() == 48 &&
            L.members[G_REWARD].size() == 26, "group sizes ORN 42, PN 80, KC 222, MBON 48, MBIN 26");
  size_t tot = 0; for (auto& m : L.members) tot += m.size();
  CHECK(tot == 3016, "every neuron in exactly one group");
  CHECK(L.orn_types.size() == 21, "olfactory receptor types = %zu (expect 21)", L.orn_types.size());
  CHECK(L.odour_sensors[0].size() + L.odour_sensors[1].size() == 42, "odours A %zu + B %zu sensors, disjoint types cover all 42", L.odour_sensors[0].size(), L.odour_sensors[1].size());
  const auto& P = b.pathways();
  CHECK(P.size() == 4 && P[0].synapses == 17778 && P[1].synapses == 5656 && P[2].synapses == 3680 && P[3].synapses == 4697,
        "pathway synapses KC>MBON %llu (17778), ORN>PN %llu (5656), PN>KC %llu (3680), MBIN>KC %llu (4697)", (unsigned long long)P[0].synapses,
        (unsigned long long)P[1].synapses, (unsigned long long)P[2].synapses, (unsigned long long)P[3].synapses);
  CHECK(P[0].syn_idx.size() == 3053 && P[1].syn_idx.size() == 354 && P[2].syn_idx.size() == 648 && P[3].syn_idx.size() == 1640,
        "pathway connected pairs %zu (3053), %zu (354), %zu (648), %zu (1640)", P[0].syn_idx.size(), P[1].syn_idx.size(), P[2].syn_idx.size(), P[3].syn_idx.size());
  int plastic = 0; for (auto& q : P) plastic += q.plastic;
  CHECK(plastic == 1 && P[0].plastic, "exactly one plastic pathway (KC -> MBON)");
  CHECK(L.reward_dans.size() == 4 && L.punish_dans.size() == 4, "reward neurons %zu, punishment neurons %zu", L.reward_dans.size(), L.punish_dans.size());
  std::printf("reward MBONs %zu, punishment MBONs %zu\n", L.reward_mbons.size(), L.punish_mbons.size());
  CHECK(!L.reward_mbons.empty() && !L.punish_mbons.empty(), "both readout sets non-empty");
  return g_fail;
}

static int test_stability() {
  Connectome c;
  if (!load(c)) return 1;
  Params p;
  Brain b(c, p);
  std::printf("%s\n", b.calibration_log().c_str());
  b.reset(21);
  b.step(3000);  // settle
  const auto before = b.spike_totals();
  const double secs = 20;
  b.step(uint32_t(secs * 1000));
  const auto after = b.spike_totals();
  const Layout& L = b.layout();
  double all = 0; size_t silent = 0;
  std::printf("rest, %.0f simulated s, learning %s\n", secs, b.learning() ? "on" : "off");
  bool groups_ok = true;
  for (int g = 0; g < G_COUNT; ++g) {
    double r = 0; size_t s0 = 0;
    for (uint32_t i : L.members[g]) { double x = double(after[i] - before[i]) / secs; r += x; s0 += (x == 0); }
    all += r; silent += s0;
    r /= L.members[g].size();
    std::printf("  %-20s n=%4zu mean rate %6.2f Hz, silent neurons %zu\n", group_label(g), L.members[g].size(), r, s0);
    if (r < 0.2 || r > 20.0) groups_ok = false;
  }
  all /= c.neurons.size();
  std::printf("  whole brain mean %.2f Hz, silent neurons %zu / %zu\n", all, silent, c.neurons.size());
  CHECK(all >= 1.0 && all <= 5.0, "mean rate %.2f Hz within the stated band 1-5 Hz", all);
  CHECK(groups_ok, "no group silent (<0.2 Hz) or saturated (>20 Hz) at rest");
  CHECK(double(silent) / c.neurons.size() < 0.25, "fewer than 25%% of neurons silent for 20 s (%.1f%%)", 100.0 * silent / c.neurons.size());
  const double strength = b.stats().pathway_strength[0];
  CHECK(strength > 0.995, "learning on at rest leaves KC->MBON weights essentially unchanged (%.5f)", strength);
  // evoked response is clear and bounded
  for (int o = 0; o < 2; ++o) {
    b.present_odour(o, 100);
    b.step(1500);
    const auto b0 = b.spike_totals();
    b.step(5000);
    const auto b1 = b.spike_totals();
    b.clear_stimuli(); b.step(3000);
    double allr = 0, smell = 0, kc = 0, mx = 0;
    for (int g = 0; g < G_COUNT; ++g) {
      double r = 0;
      for (uint32_t i : L.members[g]) r += double(b1[i] - b0[i]) / 5.0;
      allr += r; r /= L.members[g].size();
      if (g == G_SMELL) smell = r;
      if (g == G_KENYON) kc = r;
      mx = std::max(mx, r);
    }
    allr /= c.neurons.size();
    std::printf("  odour %c: whole brain %.2f Hz, smell sensors %.1f Hz, memory cells %.2f Hz, highest group %.1f Hz\n", 'A' + o, allr, smell, kc, mx);
    CHECK(smell > 10 && kc > 1.3 && allr < 10 && mx < 80, "odour %c evokes a clear (smell %.1f Hz, KC %.2f Hz) and bounded (brain %.2f Hz, max group %.1f Hz) response", 'A' + o, smell, kc, allr, mx);
  }
  return g_fail;
}

static int test_learning(int seeds) {
  Connectome c;
  if (!load(c)) return 1;
  Params p;
  Brain b(c, p);
  ExperimentConfig cfg;
  const Condition conds[4] = {Condition::PairedReward, Condition::PairedPunish, Condition::ControlReward, Condition::ControlPunish};
  std::vector<std::vector<RunResult>> all(4);
  for (int ci = 0; ci < 4; ++ci) for (int s = 0; s < seeds; ++s) all[ci].push_back(run_one(b, conds[ci], 100 + s, cfg));
  auto col = [&](int ci, int o) { std::vector<double> v; for (auto& r : all[ci]) v.push_back(r.delta(o)); return v; };
  for (int ci = 0; ci < 4; ++ci) {
    Summary a = summarise(col(ci, 0)), bb = summarise(col(ci, 1));
    std::printf("  %-40s dA %+.3f +- %.3f   dB %+.3f +- %.3f\n", condition_name(conds[ci]), a.mean, a.sd, bb.mean, bb.sd);
  }
  const double rA = summarise(col(0, 0)).mean, rB = summarise(col(0, 1)).mean, cA = summarise(col(2, 0)).mean;
  const double pA = summarise(col(1, 0)).mean, pB = summarise(col(1, 1)).mean, pcA = summarise(col(3, 0)).mean;
  // Assertions fixed in advance: trained odour moves in the right direction, and more than the untrained odour and the unpaired control.
  CHECK(rA > 0 && rA > rB && rA > cA, "reward: trained dA %+.3f > 0, > untrained dB %+.3f, > unpaired control dA %+.3f", rA, rB, cA);
  CHECK(pA < 0 && pA < pB && pA < pcA, "punishment: trained dA %+.3f < 0, < untrained dB %+.3f, < unpaired control dA %+.3f", pA, pB, pcA);
  return g_fail;
}

int main(int argc, char** argv) {
  if (argc < 2) { std::fprintf(stderr, "usage: larva_test loader|stability|learning\n"); return 2; }
  int r = 2;
  if (!std::strcmp(argv[1], "loader")) r = test_loader();
  else if (!std::strcmp(argv[1], "stability")) r = test_stability();
  else if (!std::strcmp(argv[1], "learning")) r = test_learning(8);
  std::printf(r ? "FAILED\n" : "PASSED\n");
  return r ? 1 : 0;
}
