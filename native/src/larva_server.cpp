// larva_server: live larva-brain simulation served to a viewer over WebSocket (see protocol.h / protocol.ts).
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include "larva_brain.h"
#include "mini_json.h"
#include "protocol.h"
#include "ws_server.h"

using namespace larva;
using clk = std::chrono::steady_clock;

static std::atomic<bool> g_stop{false};
static void on_signal(int) { g_stop = true; }

static const char* kOdourLabel[2] = {"Odour A", "Odour B"};

static std::vector<std::string> caveats(const Brain& b) {
  const Params& P = b.params();
  char buf[600];
  std::vector<std::string> c;
  c.push_back("The wiring is real: the 3,016-neuron larval brain from the public L1 connectome (Winding, Pedigo et al., Science 2023). "
              "Only links between these neurons are included: 337,264 synapses, fewer than the paper's ~548,000.");
  c.push_back("Excitatory or inhibitory sign is assumed, not measured. Acetylcholine neurons are excitatory, GABA neurons inhibitory, "
              "glutamate neurons ASSUMED inhibitory. 85% of neurons have no known transmitter and are ASSUMED excitatory; "
              "the viewer marks which signs come from data.");
  std::snprintf(buf, sizeof buf,
                "Synapse strength = number of synapses x a gain per connection class that I chose (excitatory %.2f, inhibitory %.2f, "
                "smell sensors to relay x%.1f, relay to memory cells x%.1f, memory cells to output neurons x%.1f, memory-cell recurrence x%.1f, "
                "APL inhibition of memory cells x%.1f). These strengths are not measured.",
                P.g_exc, P.g_inh, P.g_orn_pn, P.g_pn_kc, P.g_kc_mbon, P.g_kc_kc, P.g_apl_kc);
  c.push_back(buf);
  c.push_back("Dopamine and octopamine neurons are given no fast synapses: they only act as the teaching signal for learning.");
  std::snprintf(buf, sizeof buf,
                "Stabilisers (not from data): every neuron gets random background input whose rate is tuned during a %.0f s simulated start-up "
                "so it rests near %.0f Hz (memory cells near %.0f Hz); neurons still too active with no background input have their incoming "
                "synapses scaled down (to as little as x%.2f); total incoming synapse count per neuron is capped at %.0f for weighting; and a global "
                "feedback inhibition proportional to the mean population rate bounds responses. Resting rates are therefore set by design, not measured.",
                P.calib_seconds, P.target_hz, P.target_kc_hz, P.scale_min, P.in_cap);
  c.push_back(buf);
  c.push_back("Odours are invented: Odour A and Odour B each drive a different half of the 21 smell-receptor types (11 and 10, same types on both sides, "
              "no overlap) with random input spikes. Neither has a built-in meaning.");
  c.push_back("Which dopamine neurons stand for reward and which for punishment is an ASSUMPTION. I could not map the connectome's lineage names to "
              "the published reward/punishment neurons reliably, so I assigned them from the valence labels of the output neurons they connect to "
              "(fly rule: reward dopamine weakens the memory-cell input to avoidance output neurons, punishment dopamine to approach output neurons). "
              "4 neurons stand for reward, 4 for punishment.");
  c.push_back("Learning: only memory-cell to output-neuron synapses change. A synapse weakens when its memory cell was recently active AND the dopamine "
              "neurons connected to that output neuron fire above their resting rate (dopamine-gated depression, as reported in the fly mushroom body); "
              "weights recover slowly. Applied in sweeps every 100 ms.");
  c.push_back("The approach/avoid value is the engine's summary of output-neuron activity (punishment-taught minus reward-taught output neurons, relative to resting "
              "activity), not a measured behaviour.");
  c.push_back("Neurons are simple leaky integrate-and-fire cells with 1 ms steps. Positions are raw CATMAID nanometres centred on the origin; sensory neurons are placed "
              "where their axon enters the brain, and axis directions were not checked.");
  return c;
}

static std::string build_hello(const Brain& b) {
  const Layout& L = b.layout();
  std::string s = "{\"type\":\"hello\",\"protocol\":" + std::to_string(protocol::kProtocolVersion) + ",\"network\":{";
  s += "\"name\":" + mj::quote("Drosophila larva brain (L1 connectome)");
  s += ",\"neurons\":" + std::to_string(b.connectome().neurons.size());
  s += ",\"synapses\":" + std::to_string(b.connectome().total_synapses);
  s += ",\"source\":" + mj::quote("Winding, Pedigo et al., Science 2023 (public L1 CATMAID connectome)");
  s += ",\"caveats\":[";
  auto cv = caveats(b);
  for (size_t i = 0; i < cv.size(); ++i) s += (i ? "," : "") + mj::quote(cv[i]);
  s += "]},\"dtMs\":" + mj::num(b.params().dt_ms) + ",\"groups\":[";
  for (int g = 0; g < G_COUNT; ++g) {
    s += std::string(g ? "," : "") + "{\"id\":" + std::to_string(g) + ",\"label\":" + mj::quote(group_label(g)) +
         ",\"scientific\":" + mj::quote(group_scientific(g)) + ",\"description\":" + mj::quote(group_description(g)) +
         ",\"kind\":" + mj::quote(group_kind(g)) + ",\"count\":" + std::to_string(L.members[g].size()) + ",\"stimulable\":true}";
  }
  s += "],\"pathways\":[";
  const auto& P = b.pathways();
  for (size_t i = 0; i < P.size(); ++i)
    s += std::string(i ? "," : "") + "{\"id\":" + std::to_string(i) + ",\"label\":" + mj::quote(P[i].label) +
         ",\"fromGroup\":" + std::to_string(P[i].from_group) + ",\"toGroup\":" + std::to_string(P[i].to_group) +
         ",\"synapses\":" + std::to_string(P[i].synapses) + ",\"plastic\":" + (P[i].plastic ? "true" : "false") + "}";
  s += "],\"odours\":[";
  for (int o = 0; o < 2; ++o)
    s += std::string(o ? "," : "") + "{\"id\":" + std::to_string(o) + ",\"label\":" + mj::quote(kOdourLabel[o]) +
         ",\"sensors\":" + std::to_string(L.odour_sensors[o].size()) + "}";
  s += "]}";
  return s;
}

static std::string build_neurons(const Brain& b) {
  const Connectome& c = b.connectome();
  const Layout& L = b.layout();
  const size_t n = c.neurons.size();
  double mx = 0, my = 0, mz = 0;
  for (auto& r : c.neurons) { mx += r.x; my += r.y; mz += r.z; }
  mx /= n; my /= n; mz /= n;
  std::string g = "[", sd = "[", x = "[", y = "[", z = "[", hp = "[", sg = "[", sk = "[", nm = "[";
  for (size_t i = 0; i < n; ++i) {
    const char* sep = i ? "," : "";
    const auto& r = c.neurons[i];
    g += sep + std::to_string(L.group[i]);
    sd += sep + std::to_string(r.hemisphere == "left" ? -1 : r.hemisphere == "right" ? 1 : 0);
    x += sep + mj::num(r.x - mx); y += sep + mj::num(r.y - my); z += sep + mj::num(r.z - mz);
    hp += sep + std::string("1");
    sg += sep + std::to_string(L.sign[i]);
    sk += sep + std::to_string(L.sign_known[i]);
    nm += sep + mj::quote(r.name);
  }
  return "{\"type\":\"neurons\",\"group\":" + g + "],\"side\":" + sd + "],\"x\":" + x + "],\"y\":" + y + "],\"z\":" + z +
         "],\"hasPosition\":" + hp + "],\"sign\":" + sg + "],\"signKnown\":" + sk + "],\"name\":" + nm + "]}";
}

static std::string build_stats(const Brain& b, bool paused, double rtf, double speed) {
  Stats s = b.stats();
  std::string o = "{\"type\":\"stats\",\"simTime\":" + mj::num(s.sim_time) + ",\"realtimeFactor\":" + mj::num(rtf) +
                  ",\"paused\":" + (paused ? "true" : "false") + ",\"learning\":" + (b.learning() ? "true" : "false") +
                  ",\"speed\":" + mj::num(speed) + ",\"groupRateHz\":[";
  for (size_t i = 0; i < s.group_rate_hz.size(); ++i) o += (i ? "," : "") + mj::num(s.group_rate_hz[i]);
  o += "],\"pathwayStrength\":[";
  for (size_t i = 0; i < s.pathway_strength.size(); ++i) o += (i ? "," : "") + mj::num(s.pathway_strength[i]);
  o += "],\"reward\":" + mj::num(s.reward) + ",\"approach\":" + mj::num(s.approach) + ",\"odour\":" +
       (s.odour >= 0 ? std::to_string(s.odour) : "null") + ",\"odourSecondsLeft\":" + mj::num(s.odour_seconds_left) + ",\"stimuli\":[";
  for (size_t i = 0; i < s.stimuli.size(); ++i)
    o += std::string(i ? "," : "") + "{\"group\":" + std::to_string(s.stimuli[i].group) + ",\"rateHz\":" + mj::num(s.stimuli[i].rate_hz) +
         ",\"secondsLeft\":" + mj::num(s.stimuli[i].seconds_left) + "}";
  return o + "]}";
}

static std::string build_detail(const Brain& b, uint32_t nrn) {
  NeuronDetail d = b.detail(nrn);
  auto list = [](const std::vector<LinkPartnerInfo>& v) {
    std::string s = "[";
    for (size_t i = 0; i < v.size(); ++i)
      s += std::string(i ? "," : "") + "{\"neuron\":" + std::to_string(v[i].neuron) + ",\"synapses\":" + std::to_string(v[i].synapses) +
           ",\"strength\":" + mj::num(v[i].strength) + "}";
    return s + "]";
  };
  return "{\"type\":\"neuronDetail\",\"neuron\":" + std::to_string(nrn) + ",\"rateHz\":" + mj::num(d.rate_hz) + ",\"inputs\":" + list(d.inputs) +
         ",\"outputs\":" + list(d.outputs) + ",\"inDegree\":" + std::to_string(d.in_degree) + ",\"outDegree\":" + std::to_string(d.out_degree) + "}";
}

static std::string err_msg(const std::string& m) { return "{\"type\":\"error\",\"message\":" + mj::quote(m) + "}"; }

static int bench(const Brain& const_b, Brain& b) {
  (void)const_b;
  for (int learning = 1; learning >= 0; --learning) {
    b.reset(7); b.set_learning(learning); b.present_odour(0, 1e6);
    b.step(2000);
    const double secs = 60;
    auto t0 = clk::now();
    b.step(uint32_t(secs * 1000));
    double w = std::chrono::duration<double>(clk::now() - t0).count();
    std::printf("learning %s: %.0f simulated s in %.2f s wall -> max real-time factor %.1f\n", learning ? "on " : "off", secs, w, secs / w);
  }
  return 0;
}

int main(int argc, char** argv) {
  int port = protocol::kDefaultPort;
  std::string dir = LARVA_DATA_DIR;
  bool do_bench = false;
  Params params;
  for (int i = 1; i < argc; ++i) {
    if (!std::strcmp(argv[i], "--port") && i + 1 < argc) port = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--data") && i + 1 < argc) dir = argv[++i];
    else if (!std::strcmp(argv[i], "--bench")) do_bench = true;
    else if (!std::strcmp(argv[i], "--calib-seconds") && i + 1 < argc) params.calib_seconds = std::atof(argv[++i]);
    else { std::fprintf(stderr, "usage: larva_server [--port N] [--data DIR] [--bench] [--calib-seconds S]\n"); return 2; }
  }
  std::signal(SIGPIPE, SIG_IGN);
  std::signal(SIGINT, on_signal);
  std::signal(SIGTERM, on_signal);
  Connectome conn; std::string err;
  if (!load_connectome(dir, conn, err)) { std::fprintf(stderr, "load failed: %s\n", err.c_str()); return 1; }
  std::fprintf(stderr, "loaded %zu neurons, %llu synapses; calibrating (%.0f simulated s)...\n", conn.neurons.size(),
               (unsigned long long)conn.total_synapses, params.calib_seconds);
  Brain brain(conn, params);
  std::fprintf(stderr, "%s\n", brain.calibration_log().c_str());
  if (do_bench) return bench(brain, brain);

  const std::string hello = build_hello(brain), neurons = build_neurons(brain);
  std::mutex qmu;
  std::deque<std::string> cmds;
  WsServer ws;
  ws.on_connect = [&] { return std::vector<std::string>{hello, neurons}; };
  ws.on_text = [&](const std::string& m) { std::lock_guard<std::mutex> g(qmu); if (cmds.size() < 256) cmds.push_back(m); };
  ws.on_disconnect = [&] { std::lock_guard<std::mutex> g(qmu); cmds.push_back("\x01"); };
  if (!ws.start(port, err)) { std::fprintf(stderr, "cannot listen on 127.0.0.1:%d: %s\n", port, err.c_str()); return 1; }
  std::fprintf(stderr, "larva_server listening on ws://127.0.0.1:%d (Ctrl-C to stop)\n", ws.port());
  std::fflush(stderr);

  bool paused = false;
  double speed = 1.0;
  int64_t inspected = -1;
  uint64_t reset_count = 1;
  uint32_t seq = 0;
  const double dt_s = params.dt_ms * 1e-3;
  auto last = clk::now(), last_frame = last, last_stats = last, last_detail = last, rtf_mark = last;
  double budget = 0, rtf_sim0 = brain.sim_time(), rtf = 0;
  bool frame_after_pause = false;
  std::vector<uint8_t> frame;

  while (!g_stop) {
    // ---- commands
    std::deque<std::string> local;
    { std::lock_guard<std::mutex> g(qmu); local.swap(cmds); }
    for (auto& m : local) {
      if (m == "\x01") { inspected = -1; continue; }
      mj::Object o;
      if (!mj::parse_object(m, o) || o["type"].t != mj::Value::Str) { ws.send_text(err_msg("malformed message")); continue; }
      const std::string t = o["type"].s;
      auto num = [&](const char* k, double& out) { auto it = o.find(k); if (it == o.end() || it->second.t != mj::Value::Num) return false; out = it->second.num; return std::isfinite(out); };
      double a = 0, b2 = 0, c2 = 0;
      if (t == "setPaused") {
        auto it = o.find("paused");
        if (it == o.end() || it->second.t != mj::Value::Bool) { ws.send_text(err_msg("setPaused needs paused: boolean")); continue; }
        paused = it->second.b; if (paused) frame_after_pause = true;
      } else if (t == "setSpeed") {
        if (!num("speed", a) || a <= 0) { ws.send_text(err_msg("setSpeed needs speed > 0")); continue; }
        speed = std::min(64.0, std::max(0.05, a));
      } else if (t == "setLearning") {
        auto it = o.find("on");
        if (it == o.end() || it->second.t != mj::Value::Bool) { ws.send_text(err_msg("setLearning needs on: boolean")); continue; }
        brain.set_learning(it->second.b);
      } else if (t == "stimulate") {
        if (!num("group", a) || !num("rateHz", b2) || !num("seconds", c2) || a < 0 || a >= double(G_COUNT) || a != std::floor(a) || b2 <= 0 || c2 <= 0) {
          ws.send_text(err_msg("stimulate needs group (id), rateHz > 0, seconds > 0")); continue; }
        brain.stimulate(int(a), std::min(b2, 1000.0), std::min(c2, 3600.0));
      } else if (t == "odour") {
        if (!num("odour", a) || !num("seconds", c2) || a < 0 || a > 1 || a != std::floor(a) || c2 <= 0) { ws.send_text(err_msg("odour needs a valid odour id and seconds > 0")); continue; }
        brain.present_odour(int(a), std::min(c2, 3600.0));
      } else if (t == "reward") {
        if (!num("value", a) || !num("seconds", c2) || c2 <= 0) { ws.send_text(err_msg("reward needs value (-1..1) and seconds > 0")); continue; }
        brain.give_reward(a, std::min(c2, 3600.0));
      } else if (t == "clearStimuli") {
        brain.clear_stimuli();
      } else if (t == "inspect") {
        auto it = o.find("neuron");
        if (it == o.end()) { ws.send_text(err_msg("inspect needs neuron: number or null")); continue; }
        if (it->second.t == mj::Value::Null) inspected = -1;
        else if (it->second.t == mj::Value::Num && it->second.num >= 0 && it->second.num < double(conn.neurons.size()) &&
                 it->second.num == std::floor(it->second.num)) {
          inspected = int64_t(it->second.num);
          ws.send_text(build_detail(brain, uint32_t(inspected)));
          last_detail = clk::now();
        } else { ws.send_text(err_msg("inspect: neuron index out of range")); }
      } else if (t == "forget") {
        brain.forget();
      } else if (t == "reset") {
        brain.reset(++reset_count);
        rtf_sim0 = 0; rtf_mark = clk::now();
      } else {
        ws.send_text(err_msg("unknown message type: " + t));
      }
    }
    // ---- advance the simulation at the requested speed (simulated time per wall time)
    const auto now = clk::now();
    const double wall_dt = std::chrono::duration<double>(now - last).count();
    last = now;
    if (!paused) {
      budget += wall_dt * speed;
      budget = std::min(budget, 0.25 * std::max(speed, 1.0));  // do not try to catch up unboundedly
      uint32_t steps = uint32_t(budget / dt_s);
      steps = std::min<uint32_t>(steps, uint32_t(0.05 / dt_s));  // keep the loop responsive
      if (steps) { brain.step(steps); budget -= steps * dt_s; }
    } else budget = 0;
    // ---- realtime factor, once a second
    const double since = std::chrono::duration<double>(now - rtf_mark).count();
    if (since >= 1.0) {
      rtf = paused ? 0.0 : std::max(0.0, (brain.sim_time() - rtf_sim0) / since);
      rtf_mark = now; rtf_sim0 = brain.sim_time();
    }
    // ---- outputs
    if (ws.connected()) {
      if ((!paused || frame_after_pause) && std::chrono::duration<double>(now - last_frame).count() >= 1.0 / 30.0) {
        const uint32_t n = uint32_t(conn.neurons.size());
        frame.assign(protocol::kActivityHeaderBytes + n, 0);
        const uint32_t magic = protocol::kActivityMagic, count = n;
        const double st = brain.sim_time();
        for (int i = 0; i < 4; ++i) frame[i] = uint8_t(magic >> (8 * i));
        for (int i = 0; i < 4; ++i) frame[4 + i] = uint8_t(seq >> (8 * i));
        uint64_t bits; std::memcpy(&bits, &st, 8);
        for (int i = 0; i < 8; ++i) frame[8 + i] = uint8_t(bits >> (8 * i));
        for (int i = 0; i < 4; ++i) frame[16 + i] = uint8_t(count >> (8 * i));
        brain.activity_bytes(frame.data() + protocol::kActivityHeaderBytes);
        ws.send_binary(frame);
        ++seq;
        last_frame = now; frame_after_pause = false;
      }
      if (std::chrono::duration<double>(now - last_stats).count() >= 0.2) {
        ws.send_text(build_stats(brain, paused, rtf, speed));
        last_stats = now;
      }
      if (inspected >= 0 && std::chrono::duration<double>(now - last_detail).count() >= 1.0) {
        ws.send_text(build_detail(brain, uint32_t(inspected)));
        last_detail = now;
      }
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  ws.stop();
  std::fprintf(stderr, "larva_server stopped\n");
  return 0;
}
