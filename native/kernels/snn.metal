// Spiking network kernels. Semantics are defined by src/cpu_backend.cpp; keep in sync.
// All state is integer so results are order-independent and bit-identical to the CPU.
#include <metal_stdlib>
using namespace metal;

struct Fixed {            // mirror of snn::FixedParams
  uint n, seed;
  int dI_q, dv_q, Kq;
  int vth, vreset, vmin;
  int ref_steps;
  uint pext_q;
  int wext_q;
  int dx_q, dy_q;
  int one;
  int Ap_q, Am_q;
  int wmax_q;
  uint learning;   // 0 off, 1 per-spike, 2 deferred
  uint interval;
};

constant float kWScale = 1048576.0f;
constant float kWUnit = 1.0f / 1048576.0f;

inline uint fmix32(uint h) {
  h ^= h >> 16; h *= 0x85ebca6bu; h ^= h >> 13; h *= 0xc2b2ae35u; h ^= h >> 16; return h;
}
inline uint hash3(uint seed, uint n, uint t) {
  uint h = fmix32(seed + n * 0x9E3779B1u);
  return fmix32(h ^ (t * 0x85EBCA77u + 0x27D4EB2Fu));
}

// Buffer slots are bound once per encoder and shared by all kernels:
//  0 P  1 I  2 v  3 ref  4 x  5 y  6 inbuf  7 spike_count  8 list(2N)  9 counters(2)
//  10 args  11 row_ptr  12 col  13 w  14 is_exc  15 in_ptr  16 in_pos  17 in_src  18 step
//  deferred STDP only: 19 decay tables  20 spike masks  21 x0  22 y0  23 sxf  24 ry  25 sxmax

kernel void neuron_update(constant Fixed& P [[buffer(0)]],
                          device int* Is [[buffer(1)]],
                          device int* vs [[buffer(2)]],
                          device int* refs [[buffer(3)]],
                          device int* xs [[buffer(4)]],
                          device int* ys [[buffer(5)]],
                          device atomic_int* inbuf [[buffer(6)]],
                          device uint* spike_count [[buffer(7)]],
                          device uint* list [[buffer(8)]],
                          device atomic_uint* counters [[buffer(9)]],
                          constant uint& step [[buffer(18)]],
                          device uint* masks [[buffer(20)]],
                          uint n [[thread_position_in_grid]]) {
  if (n >= P.n) return;
  int I = int((long(Is[n]) * long(P.dI_q)) >> 16);
  I += atomic_exchange_explicit(&inbuf[n], 0, memory_order_relaxed);
  if (hash3(P.seed, n, step) < P.pext_q) I += P.wext_q;
  int v = vs[n], r = refs[n];
  bool spike = false;
  if (r > 0) {
    --r;
  } else {
    v = int((long(v) * long(P.dv_q)) >> 16) + int((long(I) * long(P.Kq)) >> 20);
    v = max(v, P.vmin);
    if (v >= P.vth) { spike = true; v = P.vreset; r = P.ref_steps; }
  }
  int x = int((long(xs[n]) * long(P.dx_q)) >> 16);
  int y = int((long(ys[n]) * long(P.dy_q)) >> 16);
  if (spike) {
    x += P.one; y += P.one;
    spike_count[n] += 1;
    uint idx = atomic_fetch_add_explicit(&counters[step & 1], 1u, memory_order_relaxed);
    list[(step & 1) * P.n + idx] = n;
    if (P.learning == 2) {
      uint off = step % P.interval;
      masks[((n * ((P.interval + 31) / 32)) + off / 32)] |= 1u << (off % 32);
    }
  }
  Is[n] = I; vs[n] = v; refs[n] = r; xs[n] = x; ys[n] = y;
}

// Single thread: turn the spike count into indirect dispatch arguments, clear the other counter.
kernel void prep(device atomic_uint* counters [[buffer(9)]],
                 device uint* args [[buffer(10)]],
                 constant uint& step [[buffer(18)]]) {
  args[0] = atomic_load_explicit(&counters[step & 1], memory_order_relaxed);
  args[1] = 1; args[2] = 1;
  atomic_store_explicit(&counters[(step + 1) & 1], 0u, memory_order_relaxed);
}

// One threadgroup per spiking neuron; lanes stride over its CSR row.
kernel void deliver(constant Fixed& P [[buffer(0)]],
                    device const int* ys [[buffer(5)]],
                    device atomic_int* inbuf [[buffer(6)]],
                    device const uint* list [[buffer(8)]],
                    device const uint* row_ptr [[buffer(11)]],
                    device const uint* col [[buffer(12)]],
                    device float* w [[buffer(13)]],
                    device const uchar* is_exc [[buffer(14)]],
                    constant uint& step [[buffer(18)]],
                    uint gid [[threadgroup_position_in_grid]],
                    uint lane [[thread_index_in_threadgroup]],
                    uint tg_size [[threads_per_threadgroup]]) {
  uint i = list[(step & 1) * P.n + gid];
  uint s0 = row_ptr[i], s1 = row_ptr[i + 1];
  bool dep = (P.learning == 1) && (is_exc[i] != 0);
  for (uint s = s0 + lane; s < s1; s += tg_size) {
    uint j = col[s];
    int wi = int(w[s] * kWScale);
    atomic_fetch_add_explicit(&inbuf[j], wi, memory_order_relaxed);
    if (dep) {
      int dw = int((long(P.Am_q) * long(ys[j])) >> 16);
      wi = max(wi - dw, 0);
      w[s] = float(wi) * kWUnit;
    }
  }
}

// One threadgroup per spiking neuron; lanes stride over its incoming excitatory synapses.
// Measured: this pass is bound by random cache-line traffic into the weight array (group size
// 32..512 makes no difference), so it only touches weights that can actually change:
//  - dw == 0 (pre trace has decayed to ~0): min(w, wmax) == w because w <= wmax always holds
//    (initial excitatory weights are below wmax, depression only lowers, potentiation clips),
//    so the read and write are skipped with bit-identical results;
//  - the write is skipped when the clipped value equals the old one.
kernel void potentiate(constant Fixed& P [[buffer(0)]],
                       device const int* xs [[buffer(4)]],
                       device const uint* list [[buffer(8)]],
                       device float* w [[buffer(13)]],
                       device const uint* in_ptr [[buffer(15)]],
                       device const uint* in_pos [[buffer(16)]],
                       device const uint* in_src [[buffer(17)]],
                       constant uint& step [[buffer(18)]],
                       uint gid [[threadgroup_position_in_grid]],
                       uint lane [[thread_index_in_threadgroup]],
                       uint tg_size [[threads_per_threadgroup]]) {
  uint j = list[(step & 1) * P.n + gid];
  uint k0 = in_ptr[j], k1 = in_ptr[j + 1];
  for (uint k = k0 + lane; k < k1; k += tg_size) {
    int dw = int((long(P.Ap_q) * long(xs[in_src[k]])) >> 16);
    if (dw == 0) continue;
    uint p = in_pos[k];
    int w0 = int(w[p] * kWScale);
    int wi = min(w0 + dw, P.wmax_q);
    if (wi != w0) w[p] = float(wi) * kWUnit;
  }
}

// ---------------------------------------------------------------------------------------------
// Deferred STDP (learning == 2). Semantics defined by CpuBackend::sweep(); see README.
// Per step the only learning work is setting one bit in the spiking neuron's mask (neuron_update).
// At the end of every `interval` steps: stdp_prep (per neuron) -> stdp_sweep (all synapses, CSR order)
// -> stdp_finish (per neuron: x0/y0 <- x/y, clear masks).

kernel void stdp_prep(constant Fixed& P [[buffer(0)]],
                      device const uint* masks [[buffer(20)]],
                      device const int* tab [[buffer(19)]],
                      device uint* sxf [[buffer(23)]],
                      device uint* ry [[buffer(24)]],
                      device atomic_uint* sxmax [[buffer(25)]],
                      uint j [[thread_position_in_grid]]) {
  if (j >= P.n) return;
  uint L = P.interval, W = (L + 31) / 32;
  uint sx = 0, r = 0, any = 0;
  for (uint k = 0; k < W; ++k) {
    uint mm = masks[j * W + k]; any |= mm;
    while (mm) { uint b = k * 32 + ctz(mm); mm &= mm - 1; sx += uint(tab[b + 1]); r += uint(tab[L + 1 + b + 1]); }
  }
  sxf[j] = (sx << 1) | (any ? 1u : 0u);
  ry[j] = r;
  if (sx) atomic_fetch_max_explicit(sxmax, sx, memory_order_relaxed);
}

constant uint kChunk = 1024;   // synapses per threadgroup in the sweep

kernel void stdp_sweep(constant Fixed& P [[buffer(0)]],
                       device const uint* row_ptr [[buffer(11)]],
                       device const uint* col [[buffer(12)]],
                       device float* w [[buffer(13)]],
                       device const uchar* is_exc [[buffer(14)]],
                       device const int* tab [[buffer(19)]],
                       device const uint* masks [[buffer(20)]],
                       device const int* x0 [[buffer(21)]],
                       device const int* y0 [[buffer(22)]],
                       device const uint* sxf [[buffer(23)]],
                       device const uint* ry [[buffer(24)]],
                       device const uint* sxmax_p [[buffer(25)]],
                       uint gid [[threadgroup_position_in_grid]],
                       uint lane [[thread_index_in_threadgroup]],
                       uint tg_size [[threads_per_threadgroup]]) {
  const uint n = P.n, L = P.interval, W = (L + 31) / 32;
  const uint total = row_ptr[n];
  const uint s_lo = gid * kChunk, s_hi = min(s_lo + kChunk, total);
  const device int* Dx = tab;
  const device int* Dy = tab + L + 1;
  const uint sxmax = sxmax_p[0];
  // last row i with row_ptr[i] <= s_lo
  uint lo = 0, hi = n - 1;
  while (lo < hi) { uint mid = (lo + hi + 1) >> 1; if (row_ptr[mid] <= s_lo) lo = mid; else hi = mid - 1; }
  for (uint i = lo; i < n && row_ptr[i] < s_hi; ++i) {
    if (is_exc[i] == 0) continue;
    const bool spiked = (sxf[i] & 1u) != 0;
    const long xi = x0[i];
    if (!spiked && !((long(P.Ap_q) * ((xi * long(sxmax)) >> 16)) >= 65536)) continue;
    const uint a0 = max(row_ptr[i], s_lo), a1 = min(row_ptr[i + 1], s_hi);
    const long ryi = ry[i];
    for (uint s = a0 + lane; s < a1; s += tg_size) {
      const uint j = col[s];
      const uint sj = sxf[j];
      long X = (xi * long(sj >> 1)) >> 16, Y = 0;
      if (spiked) {
        Y = (long(y0[j]) * ryi) >> 16;
        if (sj & 1u) {
          for (uint ka = 0; ka < W; ++ka) {
            uint ma = masks[i * W + ka];
            while (ma) {
              uint a = ka * 32 + ctz(ma); ma &= ma - 1;
              for (uint kb = 0; kb < W; ++kb) {
                uint mb = masks[j * W + kb];
                while (mb) {
                  uint b = kb * 32 + ctz(mb); mb &= mb - 1;
                  if (b >= a) X += Dx[b - a];
                  if (a >= b) Y += Dy[a - b];
                }
              }
            }
          }
        }
      }
      const long dpot = (long(P.Ap_q) * X) >> 16, ddep = (long(P.Am_q) * Y) >> 16;
      if (dpot == 0 && ddep == 0) continue;
      long wi = long(int(w[s] * kWScale)) + dpot - ddep;
      wi = min(max(wi, 0L), long(P.wmax_q));
      w[s] = float(int(wi)) * kWUnit;
    }
  }
}

kernel void stdp_finish(constant Fixed& P [[buffer(0)]],
                        device const int* xs [[buffer(4)]],
                        device const int* ys [[buffer(5)]],
                        device uint* masks [[buffer(20)]],
                        device int* x0 [[buffer(21)]],
                        device int* y0 [[buffer(22)]],
                        device uint* sxmax [[buffer(25)]],
                        uint j [[thread_position_in_grid]]) {
  if (j >= P.n) return;
  uint W = (P.interval + 31) / 32;
  for (uint k = 0; k < W; ++k) masks[j * W + k] = 0;
  x0[j] = xs[j]; y0[j] = ys[j];
  if (j == 0) sxmax[0] = 0;
}
