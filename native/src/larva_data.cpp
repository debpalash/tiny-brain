#include "larva_data.h"
#include <cstdlib>
#include <fstream>

namespace larva {
namespace {

// RFC 4180-style line splitter (quoted fields may contain commas and doubled quotes).
std::vector<std::string> split_csv(const std::string& line) {
  std::vector<std::string> f;
  std::string cur;
  bool q = false;
  for (size_t i = 0; i < line.size(); ++i) {
    char c = line[i];
    if (q) {
      if (c == '"') {
        if (i + 1 < line.size() && line[i + 1] == '"') { cur += '"'; ++i; } else q = false;
      } else cur += c;
    } else if (c == '"') q = true;
    else if (c == ',') { f.push_back(cur); cur.clear(); }
    else if (c != '\r') cur += c;
  }
  f.push_back(cur);
  return f;
}

}  // namespace

bool load_connectome(const std::string& dir, Connectome& out, std::string& err) {
  out = Connectome{};
  std::ifstream nf(dir + "/neurons.csv");
  if (!nf) { err = "cannot open " + dir + "/neurons.csv"; return false; }
  std::string line;
  std::getline(nf, line);
  auto hdr = split_csv(line);
  auto col = [&](const char* n) -> int {
    for (size_t i = 0; i < hdr.size(); ++i) if (hdr[i] == n) return int(i);
    return -1;
  };
  const int ci = col("index"), cn = col("name"), ch = col("hemisphere"), cb = col("broad_class"),
            ca = col("all_classes"), ct = col("cell_type"), cm = col("sensory_modality"),
            cx = col("transmitter"), px = col("x"), py = col("y"), pz = col("z");
  if (ci < 0 || cn < 0 || ch < 0 || cb < 0 || ca < 0 || ct < 0 || cm < 0 || cx < 0 || px < 0 || py < 0 || pz < 0) {
    err = "neurons.csv: missing column";
    return false;
  }
  while (std::getline(nf, line)) {
    if (line.empty()) continue;
    auto f = split_csv(line);
    if (f.size() < hdr.size()) { err = "neurons.csv: short row"; return false; }
    if (size_t(std::atol(f[ci].c_str())) != out.neurons.size()) { err = "neurons.csv: index not dense"; return false; }
    NeuronRec r;
    r.name = f[cn]; r.hemisphere = f[ch]; r.broad_class = f[cb]; r.all_classes = f[ca];
    r.cell_type = f[ct]; r.modality = f[cm]; r.transmitter = f[cx];
    r.x = std::atof(f[px].c_str()); r.y = std::atof(f[py].c_str()); r.z = std::atof(f[pz].c_str());
    out.neurons.push_back(std::move(r));
  }
  std::ifstream sf(dir + "/synapses.csv");
  if (!sf) { err = "cannot open " + dir + "/synapses.csv"; return false; }
  std::getline(sf, line);
  const uint32_t n = uint32_t(out.neurons.size());
  while (std::getline(sf, line)) {
    if (line.empty()) continue;
    auto f = split_csv(line);
    if (f.size() < 3) { err = "synapses.csv: short row"; return false; }
    long a = std::atol(f[0].c_str()), b = std::atol(f[1].c_str()), c = std::atol(f[2].c_str());
    if (a < 0 || b < 0 || a >= long(n) || b >= long(n) || c <= 0) { err = "synapses.csv: bad row"; return false; }
    out.pre.push_back(uint32_t(a)); out.post.push_back(uint32_t(b)); out.count.push_back(uint32_t(c));
    out.total_synapses += uint64_t(c);
  }
  return true;
}

}  // namespace larva
