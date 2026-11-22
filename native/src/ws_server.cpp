#include "ws_server.h"
#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace {

struct Sha1 {
  uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};
  static uint32_t rol(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }
  void block(const uint8_t* p) {
    uint32_t w[80];
    for (int i = 0; i < 16; ++i) w[i] = uint32_t(p[4 * i]) << 24 | uint32_t(p[4 * i + 1]) << 16 | uint32_t(p[4 * i + 2]) << 8 | p[4 * i + 3];
    for (int i = 16; i < 80; ++i) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (int i = 0; i < 80; ++i) {
      uint32_t f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      uint32_t t = rol(a, 5) + f + e + k + w[i];
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
  }
  static void digest(const std::string& in, uint8_t out[20]) {
    Sha1 s;
    std::string m = in;
    uint64_t bits = uint64_t(in.size()) * 8;
    m += char(0x80);
    while (m.size() % 64 != 56) m += char(0);
    for (int i = 7; i >= 0; --i) m += char((bits >> (8 * i)) & 0xff);
    for (size_t i = 0; i < m.size(); i += 64) s.block(reinterpret_cast<const uint8_t*>(m.data()) + i);
    for (int i = 0; i < 5; ++i) for (int j = 0; j < 4; ++j) out[4 * i + j] = uint8_t(s.h[i] >> (24 - 8 * j));
  }
};

std::string base64(const uint8_t* d, size_t n) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string o;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = uint32_t(d[i]) << 16 | (i + 1 < n ? uint32_t(d[i + 1]) << 8 : 0) | (i + 2 < n ? d[i + 2] : 0);
    o += T[(v >> 18) & 63]; o += T[(v >> 12) & 63];
    o += i + 1 < n ? T[(v >> 6) & 63] : '=';
    o += i + 2 < n ? T[v & 63] : '=';
  }
  return o;
}

std::string lower(std::string s) { for (auto& c : s) c = char(std::tolower((unsigned char)c)); return s; }

std::string header(const std::string& req, const std::string& name) {
  const std::string key = lower(name) + ":";
  size_t pos = 0;
  while (pos < req.size()) {
    size_t e = req.find("\r\n", pos);
    if (e == std::string::npos) e = req.size();
    std::string line = req.substr(pos, e - pos);
    if (lower(line).compare(0, key.size(), key) == 0) {
      size_t b = key.size();
      while (b < line.size() && (line[b] == ' ' || line[b] == '\t')) ++b;
      return line.substr(b);
    }
    pos = e + 2;
  }
  return "";
}

// http://localhost or http://127.0.0.1, optionally followed by :port. (Host values have no scheme.)
bool local_origin(const std::string& o, bool with_scheme) {
  std::string s = lower(o);
  if (with_scheme) {
    if (s.compare(0, 7, "http://") != 0) return false;
    s = s.substr(7);
  }
  for (const char* h : {"localhost", "127.0.0.1"}) {
    std::string hs(h);
    if (s.compare(0, hs.size(), hs) == 0) {
      std::string rest = s.substr(hs.size());
      if (rest.empty()) return true;
      if (rest[0] != ':' || rest.size() < 2) return false;
      for (size_t i = 1; i < rest.size(); ++i) if (rest[i] < '0' || rest[i] > '9') return false;
      return true;
    }
  }
  return false;
}

void set_nonblock(int fd) { fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK); }

void append_frame(std::vector<uint8_t>& out, uint8_t op, const uint8_t* p, size_t n) {
  out.push_back(0x80 | op);
  if (n < 126) out.push_back(uint8_t(n));
  else if (n <= 0xffff) { out.push_back(126); out.push_back(uint8_t(n >> 8)); out.push_back(uint8_t(n)); }
  else { out.push_back(127); for (int i = 7; i >= 0; --i) out.push_back(uint8_t(uint64_t(n) >> (8 * i))); }
  out.insert(out.end(), p, p + n);
}

}  // namespace

bool WsServer::start(int port, std::string& err) {
  listen_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
  if (listen_fd_ < 0) { err = "socket failed"; return false; }
  int one = 1;
  setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // 127.0.0.1 only
  a.sin_port = htons(uint16_t(port));
  if (::bind(listen_fd_, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) { err = std::string("bind failed: ") + std::strerror(errno); ::close(listen_fd_); listen_fd_ = -1; return false; }
  if (::listen(listen_fd_, 4) != 0) { err = "listen failed"; ::close(listen_fd_); listen_fd_ = -1; return false; }
  socklen_t l = sizeof a;
  getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&a), &l);
  port_ = ntohs(a.sin_port);
  set_nonblock(listen_fd_);
  if (::pipe(wake_) != 0) { err = "pipe failed"; return false; }
  set_nonblock(wake_[0]); set_nonblock(wake_[1]);
  stop_ = false;
  th_ = std::thread([this] { loop(); });
  return true;
}

void WsServer::stop() {
  if (th_.joinable()) {
    stop_ = true;
    char c = 1; (void)!::write(wake_[1], &c, 1);
    th_.join();
  }
  for (int* fd : {&listen_fd_, &wake_[0], &wake_[1]}) if (*fd >= 0) { ::close(*fd); *fd = -1; }
  ready_ = false;
}

void WsServer::send_text(std::string s) {
  if (!ready_) return;
  {
    std::lock_guard<std::mutex> g(mu_);
    if (text_q_.size() >= 64) return;  // drop: viewer is not keeping up
    text_q_.push_back(std::move(s));
  }
  char c = 1; (void)!::write(wake_[1], &c, 1);
}

void WsServer::send_binary(std::vector<uint8_t> b) {
  if (!ready_) return;
  {
    std::lock_guard<std::mutex> g(mu_);
    if (have_bin_) ++dropped_bin_;  // replaced an unsent frame
    latest_bin_ = std::move(b);
    have_bin_ = true;
  }
  char c = 1; (void)!::write(wake_[1], &c, 1);
}

void WsServer::queue_control(uint8_t op, const std::string& payload) {
  std::string f;
  f += char(0x80 | op); f += char(payload.size()); f += payload;
  control_q_.push_back(f);
}

void WsServer::loop() {
  using clk = std::chrono::steady_clock;
  bool upgraded = false;
  std::string hs_buf;
  clk::time_point hs_start;
  auto drop_client = [&] {
    if (client_ >= 0) { ::close(client_); client_ = -1; }
    bool was = ready_.exchange(false);
    upgraded = false; hs_buf.clear(); inbuf_.clear(); msg_.clear(); out_.clear(); out_off_ = 0; control_q_.clear();
    { std::lock_guard<std::mutex> g(mu_); text_q_.clear(); have_bin_ = false; latest_bin_.clear(); }
    if (was && on_disconnect) on_disconnect();
  };
  int timeout = 100;
  while (!stop_) {
    pollfd fds[3];
    int nf = 0;
    fds[nf++] = {wake_[0], POLLIN, 0};
    fds[nf++] = {listen_fd_, POLLIN, 0};
    const bool polled_client = client_ >= 0;
    const int polled_fd = client_;
    if (client_ >= 0) fds[nf++] = {client_, short(POLLIN | (out_off_ < out_.size() ? POLLOUT : 0)), 0};
    ::poll(fds, nf, timeout);
    timeout = 100;
    if (stop_) break;
    if (fds[0].revents & POLLIN) { char b[64]; while (::read(wake_[0], b, sizeof b) > 0) {} }
    if (fds[1].revents & POLLIN) {
      while (true) {
        int fd = ::accept(listen_fd_, nullptr, nullptr);
        if (fd < 0) break;
        if (client_ >= 0) {  // one viewer at a time
          const char* r = "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
          (void)!::send(fd, r, std::strlen(r), 0);
          ::close(fd);
          continue;
        }
        int one = 1;
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
        set_nonblock(fd);
        client_ = fd; upgraded = false; hs_buf.clear(); hs_start = clk::now();
      }
    }
    if (polled_client && client_ == polled_fd) {
      const short rev = fds[2].revents;
      if (!upgraded && clk::now() - hs_start > std::chrono::seconds(5)) { drop_client(); continue; }
      if (rev & (POLLERR | POLLHUP | POLLNVAL)) { drop_client(); continue; }
      if (rev & POLLIN) {
        char buf[16384];
        ssize_t r = ::recv(client_, buf, sizeof buf, 0);
        if (r == 0 || (r < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) { drop_client(); continue; }
        if (r > 0) {
          if (!upgraded) {
            hs_buf.append(buf, size_t(r));
            size_t e = hs_buf.find("\r\n\r\n");
            if (e == std::string::npos) { if (hs_buf.size() > 8192) { drop_client(); continue; } }
            else {
              std::string req = hs_buf.substr(0, e + 4);
              auto reject = [&](const char* status) {
                std::string resp = std::string("HTTP/1.1 ") + status + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
                (void)!::send(client_, resp.data(), resp.size(), 0);
                drop_client();
              };
              std::string key = header(req, "Sec-WebSocket-Key"), origin = header(req, "Origin"), host = header(req, "Host");
              if (req.compare(0, 4, "GET ") != 0 || lower(header(req, "Upgrade")) != "websocket" || key.empty() ||
                  header(req, "Sec-WebSocket-Version") != "13") { reject("400 Bad Request"); continue; }
              if (!origin.empty() && !local_origin(origin, true)) { reject("403 Forbidden"); continue; }
              if (!host.empty() && !local_origin(host, false)) { reject("403 Forbidden"); continue; }
              uint8_t dg[20];
              Sha1::digest(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", dg);
              std::string resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
                                 base64(dg, 20) + "\r\n\r\n";
              out_.assign(resp.begin(), resp.end()); out_off_ = 0;
              if (on_connect) for (auto& m : on_connect()) append_frame(out_, 1, reinterpret_cast<const uint8_t*>(m.data()), m.size());
              upgraded = true;
              inbuf_ = hs_buf.substr(e + 4);
              ready_ = true;
            }
          } else inbuf_.append(buf, size_t(r));
          // parse frames
          bool bad = false;
          while (upgraded && !bad) {
            if (inbuf_.size() < 2) break;
            const uint8_t b0 = uint8_t(inbuf_[0]), b1 = uint8_t(inbuf_[1]);
            const bool fin = b0 & 0x80; const uint8_t op = b0 & 0x0f; const bool masked = b1 & 0x80;
            uint64_t len = b1 & 0x7f; size_t hdr = 2;
            if (len == 126) { if (inbuf_.size() < 4) break; len = uint64_t(uint8_t(inbuf_[2])) << 8 | uint8_t(inbuf_[3]); hdr = 4; }
            else if (len == 127) {
              if (inbuf_.size() < 10) break;
              len = 0; for (int i = 0; i < 8; ++i) len = len << 8 | uint8_t(inbuf_[2 + i]);
              hdr = 10;
            }
            if (!masked || len > (1u << 20)) { bad = true; break; }
            if (inbuf_.size() < hdr + 4 + len) break;
            uint8_t mk[4]; for (int i = 0; i < 4; ++i) mk[i] = uint8_t(inbuf_[hdr + i]);
            std::string payload(size_t(len), '\0');
            for (size_t i = 0; i < len; ++i) payload[i] = char(uint8_t(inbuf_[hdr + 4 + i]) ^ mk[i & 3]);
            inbuf_.erase(0, hdr + 4 + size_t(len));
            if (op == 8) { queue_control(8, payload.substr(0, std::min<size_t>(payload.size(), 2))); bad = true; }
            else if (op == 9) queue_control(10, payload.substr(0, 125));
            else if (op == 1 || op == 2 || op == 0) {
              if (op != 0) { msg_.clear(); msg_text_ = (op == 1); }
              msg_ += payload;
              if (msg_.size() > (1u << 20)) { bad = true; break; }
              if (fin) { if (msg_text_ && on_text) on_text(msg_); msg_.clear(); }
            }
          }
          if (bad) {  // flush a pending close frame best-effort, then drop
            for (auto& f : control_q_) (void)!::send(client_, f.data(), f.size(), 0);
            drop_client(); continue;
          }
        }
      }
      // writing
      if (client_ >= 0 && upgraded) {
        if (out_off_ >= out_.size()) {
          out_.clear(); out_off_ = 0;
          if (!control_q_.empty()) { auto& f = control_q_.front(); out_.assign(f.begin(), f.end()); control_q_.pop_front(); }
          else {
            std::lock_guard<std::mutex> g(mu_);
            if (!text_q_.empty()) { auto& m = text_q_.front(); append_frame(out_, 1, reinterpret_cast<const uint8_t*>(m.data()), m.size()); text_q_.pop_front(); }
            else if (have_bin_) { append_frame(out_, 2, latest_bin_.data(), latest_bin_.size()); have_bin_ = false; }
          }
        }
      }
      if (client_ >= 0 && out_off_ < out_.size()) {
        ssize_t w = ::send(client_, out_.data() + out_off_, out_.size() - out_off_, 0);
        if (w > 0) out_off_ += size_t(w);
        else if (w < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) { drop_client(); continue; }
        if (out_off_ >= out_.size()) {
          out_.clear(); out_off_ = 0;
          std::lock_guard<std::mutex> g(mu_);
          if (!text_q_.empty() || have_bin_ || !control_q_.empty()) timeout = 0;  // more to send
        }
      }
    }
  }
  if (client_ >= 0) { ::close(client_); client_ = -1; }
  ready_ = false;
}
