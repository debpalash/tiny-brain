#define NS_PRIVATE_IMPLEMENTATION
#define MTL_PRIVATE_IMPLEMENTATION
#define CA_PRIVATE_IMPLEMENTATION
#include <Foundation/Foundation.hpp>
#include <Metal/Metal.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include "metal_backend.h"

namespace snn {
namespace {

std::string read_file(const std::string& path) {
  std::ifstream f(path);
  if (!f) throw std::runtime_error("cannot open kernel source: " + path);
  std::stringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

class MetalBackend final : public Backend {
 public:
  explicit MetalBackend(const MetalOptions& opt) : opt_(opt) {
    pool_ = NS::AutoreleasePool::alloc()->init();
    dev_ = MTL::CreateSystemDefaultDevice();
    if (!dev_) throw std::runtime_error("no Metal device");
    queue_ = dev_->newCommandQueue();
    const char* env = std::getenv("SNN_KERNEL_DIR");
    std::string src = read_file(std::string(env ? env : SNN_KERNEL_DIR) + "/snn.metal");
    NS::Error* err = nullptr;
    MTL::CompileOptions* co = MTL::CompileOptions::alloc()->init();
    co->setFastMathEnabled(false);
    lib_ = dev_->newLibrary(NS::String::string(src.c_str(), NS::UTF8StringEncoding), co, &err);
    co->release();
    if (!lib_) {
      throw std::runtime_error(std::string("Metal compile failed: ") +
                               (err ? err->localizedDescription()->utf8String() : "?"));
    }
    k_neuron_ = pso("neuron_update");
    k_prep_ = pso("prep");
    k_deliver_ = pso("deliver");
    k_pot_ = pso("potentiate");
    k_sprep_ = pso("stdp_prep");
    k_ssweep_ = pso("stdp_sweep");
    k_sfin_ = pso("stdp_finish");
  }
  ~MetalBackend() override {
    free_buffers();
    for (auto* p : {k_neuron_, k_prep_, k_deliver_, k_pot_, k_sprep_, k_ssweep_, k_sfin_}) if (p) p->release();
    if (lib_) lib_->release();
    if (queue_) queue_->release();
    if (dev_) dev_->release();
    pool_->release();
  }

  const char* name() const override { return "metal"; }

  void upload(const Network& net, const SimParams& p) override {
    NS::AutoreleasePool* pool = NS::AutoreleasePool::alloc()->init();
    sync();
    free_buffers();
    n_ = net.n;
    learning_ = p.learning && !p.deferred;
    deferred_ = p.learning && p.deferred;
    interval_ = p.stdp_interval;
    m_ = net.m;
    FixedParams F = make_fixed(p, net.n);
    b_P_ = copy_buf(&F, sizeof F);
    const size_t n = net.n;
    b_I_ = zero_buf(n * 4); b_v_ = zero_buf(n * 4); b_ref_ = zero_buf(n * 4);
    b_x_ = zero_buf(n * 4); b_y_ = zero_buf(n * 4); b_in_ = zero_buf(n * 4);
    b_cnt_ = zero_buf(n * 4);
    b_list_ = zero_buf(2 * n * 4);
    b_counters_ = zero_buf(8);
    b_args_ = zero_buf(16);
    b_rowptr_ = copy_buf(net.row_ptr.data(), net.row_ptr.size() * 4);
    b_col_ = copy_buf(net.col.data(), net.col.size() * 4);
    b_w_ = copy_buf(net.w.data(), net.w.size() * 4);
    b_exc_ = copy_buf(net.is_exc.data(), net.is_exc.size());
    b_inptr_ = copy_buf(net.in_ptr.data(), net.in_ptr.size() * 4);
    b_inpos_ = copy_buf(net.in_pos.data(), net.in_pos.size() * 4);
    b_insrc_ = copy_buf(net.in_src.data(), net.in_src.size() * 4);
    if (deferred_) {
      if (interval_ < 1 || interval_ > 256) throw std::runtime_error("stdp interval must be 1..256");
      std::vector<int32_t> tab = make_stdp_tables(p);
      b_tab_ = copy_buf(tab.data(), tab.size() * 4);
      b_masks_ = zero_buf(n * ((interval_ + 31) / 32) * 4);
      b_x0_ = zero_buf(n * 4); b_y0_ = zero_buf(n * 4); b_sxf_ = zero_buf(n * 4); b_ry_ = zero_buf(n * 4);
      b_sxmax_ = zero_buf(4);
    } else {  // unused slots still need something bound
      b_tab_ = zero_buf(4); b_masks_ = zero_buf(4); b_x0_ = zero_buf(4); b_y0_ = zero_buf(4);
      b_sxf_ = zero_buf(4); b_ry_ = zero_buf(4); b_sxmax_ = zero_buf(4);
    }
    step_ = 0;
    gpu_seconds_ = 0;
    pool->release();
  }

  void run(uint32_t steps) override {
    NS::AutoreleasePool* pool = NS::AutoreleasePool::alloc()->init();
    uint32_t done = 0;
    const MTL::Size tg_n(256, 1, 1), grid_n(n_, 1, 1), tg_e(opt_.group_size, 1, 1);
    while (done < steps) {
      uint32_t k = std::min(opt_.steps_per_cmdbuf, steps - done);
      MTL::CommandBuffer* cb = queue_->commandBuffer();
      MTL::ComputeCommandEncoder* enc = cb->computeCommandEncoder();
      MTL::Buffer* bufs[] = {b_P_, b_I_, b_v_, b_ref_, b_x_, b_y_, b_in_, b_cnt_, b_list_,
                             b_counters_, b_args_, b_rowptr_, b_col_, b_w_, b_exc_,
                             b_inptr_, b_inpos_, b_insrc_};
      for (uint32_t i = 0; i < 18; ++i) enc->setBuffer(bufs[i], 0, i);
      MTL::Buffer* dbufs[] = {b_tab_, b_masks_, b_x0_, b_y0_, b_sxf_, b_ry_, b_sxmax_};
      for (uint32_t i = 0; i < 7; ++i) enc->setBuffer(dbufs[i], 0, 19 + i);
      for (uint32_t s = 0; s < k; ++s) {
        uint32_t t = step_++;
        enc->setComputePipelineState(k_neuron_);
        enc->setBytes(&t, 4, 18);
        enc->dispatchThreads(grid_n, tg_n);
        enc->setComputePipelineState(k_prep_);
        enc->dispatchThreads(MTL::Size(1, 1, 1), MTL::Size(1, 1, 1));
        enc->setComputePipelineState(k_deliver_);
        enc->dispatchThreadgroups(b_args_, 0, tg_e);
        if (learning_) {
          enc->setComputePipelineState(k_pot_);
          enc->dispatchThreadgroups(b_args_, 0, tg_e);
        }
        if (deferred_ && (t + 1) % interval_ == 0) {
          enc->setComputePipelineState(k_sprep_);
          enc->dispatchThreads(grid_n, tg_n);
          enc->setComputePipelineState(k_ssweep_);
          enc->dispatchThreadgroups(MTL::Size((m_ + 1023) / 1024, 1, 1), MTL::Size(128, 1, 1));
          enc->setComputePipelineState(k_sfin_);
          enc->dispatchThreads(grid_n, tg_n);
        }
      }
      enc->endEncoding();
      cb->retain();
      cb->commit();
      pending_.push_back(cb);
      if (!opt_.pipeline) sync_locked();
      done += k;
    }
    pool->release();
  }

  void sync() override {
    NS::AutoreleasePool* pool = NS::AutoreleasePool::alloc()->init();
    sync_locked();
    pool->release();
  }

  Snapshot snapshot(bool with_weights) override {
    sync();
    Snapshot s;
    auto grab = [&](MTL::Buffer* b, auto& vec, size_t count) {
      using T = typename std::remove_reference_t<decltype(vec)>::value_type;
      vec.resize(count);
      std::memcpy(vec.data(), b->contents(), count * sizeof(T));
    };
    grab(b_cnt_, s.spike_count, n_);
    grab(b_v_, s.v, n_); grab(b_I_, s.I, n_); grab(b_x_, s.x, n_); grab(b_y_, s.y, n_);
    if (with_weights) grab(b_w_, s.w, m_);
    return s;
  }

  size_t device_bytes() const override { return bytes_; }
  double gpu_seconds() const { return gpu_seconds_; }

 private:
  MTL::ComputePipelineState* pso(const char* name) {
    NS::Error* err = nullptr;
    MTL::Function* f = lib_->newFunction(NS::String::string(name, NS::UTF8StringEncoding));
    if (!f) throw std::runtime_error(std::string("missing kernel ") + name);
    MTL::ComputePipelineState* p = dev_->newComputePipelineState(f, &err);
    f->release();
    if (!p) throw std::runtime_error(std::string("pipeline failed: ") + name);
    return p;
  }
  MTL::Buffer* copy_buf(const void* data, size_t len) {
    if (len == 0) len = 4;
    MTL::Buffer* b = dev_->newBuffer(len, MTL::ResourceStorageModeShared);
    if (!b) throw std::runtime_error("buffer allocation failed");
    std::memcpy(b->contents(), data, len);
    bufs_.push_back(b);
    bytes_ += len;
    return b;
  }
  MTL::Buffer* zero_buf(size_t len) {
    MTL::Buffer* b = dev_->newBuffer(len, MTL::ResourceStorageModeShared);
    if (!b) throw std::runtime_error("buffer allocation failed");
    std::memset(b->contents(), 0, len);
    bufs_.push_back(b);
    bytes_ += len;
    return b;
  }
  void free_buffers() {
    for (auto* b : bufs_) b->release();
    bufs_.clear();
    bytes_ = 0;
  }
  void sync_locked() {
    for (auto* cb : pending_) {
      cb->waitUntilCompleted();
      if (cb->status() != MTL::CommandBufferStatusCompleted)
        throw std::runtime_error("command buffer failed");
      gpu_seconds_ += cb->GPUEndTime() - cb->GPUStartTime();
      cb->release();
    }
    pending_.clear();
  }

  MetalOptions opt_;
  NS::AutoreleasePool* pool_ = nullptr;
  MTL::Device* dev_ = nullptr;
  MTL::CommandQueue* queue_ = nullptr;
  MTL::Library* lib_ = nullptr;
  MTL::ComputePipelineState *k_neuron_ = nullptr, *k_prep_ = nullptr, *k_deliver_ = nullptr,
                            *k_pot_ = nullptr, *k_sprep_ = nullptr, *k_ssweep_ = nullptr, *k_sfin_ = nullptr;
  std::vector<MTL::Buffer*> bufs_;
  std::vector<MTL::CommandBuffer*> pending_;
  MTL::Buffer *b_P_ = nullptr, *b_I_ = nullptr, *b_v_ = nullptr, *b_ref_ = nullptr, *b_x_ = nullptr,
              *b_y_ = nullptr, *b_in_ = nullptr, *b_cnt_ = nullptr, *b_list_ = nullptr,
              *b_counters_ = nullptr, *b_args_ = nullptr, *b_rowptr_ = nullptr, *b_col_ = nullptr,
              *b_w_ = nullptr, *b_exc_ = nullptr, *b_inptr_ = nullptr, *b_inpos_ = nullptr,
              *b_insrc_ = nullptr, *b_tab_ = nullptr, *b_masks_ = nullptr, *b_x0_ = nullptr,
              *b_y0_ = nullptr, *b_sxf_ = nullptr, *b_ry_ = nullptr, *b_sxmax_ = nullptr;
  size_t bytes_ = 0;
  uint32_t n_ = 0, step_ = 0;
  uint64_t m_ = 0;
  bool learning_ = false, deferred_ = false;
  uint32_t interval_ = 50;
  double gpu_seconds_ = 0;
};

}  // namespace

std::unique_ptr<Backend> make_metal_backend(const MetalOptions& opt) {
  return std::make_unique<MetalBackend>(opt);
}
double metal_gpu_seconds(Backend& b) { return static_cast<MetalBackend&>(b).gpu_seconds(); }

}  // namespace snn
