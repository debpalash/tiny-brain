// Minimal RFC 6455 WebSocket server: 127.0.0.1 only, one client at a time, Origin/Host checked.
// IO runs on its own thread; sending never blocks the caller (text is queued with a bound, binary keeps only the newest frame).
#pragma once
#include <atomic>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

class WsServer {
 public:
  ~WsServer() { stop(); }
  // Messages to send right after the handshake (in order). Called on the IO thread.
  std::function<std::vector<std::string>()> on_connect;
  std::function<void(const std::string&)> on_text;  // IO thread
  std::function<void()> on_disconnect;              // IO thread

  bool start(int port, std::string& err);  // port 0 = pick a free one
  void stop();
  int port() const { return port_; }
  bool connected() const { return ready_.load(); }
  // Thread-safe, non-blocking. Dropped when no client; text queue bounded; binary keeps only the latest.
  void send_text(std::string s);
  void send_binary(std::vector<uint8_t> b);
  uint64_t dropped_binary() const { return dropped_bin_.load(); }

 private:
  void loop();
  bool handshake(int fd, std::string& req_buf, bool& done);
  bool read_frames(int fd);
  void queue_control(uint8_t op, const std::string& payload);
  int listen_fd_ = -1, port_ = 0, wake_[2] = {-1, -1};
  std::thread th_;
  std::atomic<bool> stop_{false}, ready_{false};
  std::atomic<uint64_t> dropped_bin_{0};
  std::mutex mu_;
  std::deque<std::string> text_q_;
  std::vector<uint8_t> latest_bin_;
  bool have_bin_ = false;
  // IO-thread state
  int client_ = -1;
  std::string inbuf_, msg_;
  std::vector<uint8_t> out_;
  size_t out_off_ = 0;
  std::deque<std::string> control_q_;
  bool msg_text_ = false;
};
