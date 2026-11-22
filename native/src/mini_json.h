// Tiny JSON helpers: an output builder and a parser for the flat objects the viewer sends.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>

namespace mj {

inline std::string quote(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += char(c);
    }
  }
  return o + "\"";
}

inline std::string num(double v) {
  if (!std::isfinite(v)) return "0";
  char b[40];
  std::snprintf(b, sizeof b, "%.9g", v);
  return b;
}

// Parsed flat JSON object: string / number / bool / null values (nested values are skipped).
struct Value { enum T { Null, Num, Bool, Str, Other } t = Null; double num = 0; bool b = false; std::string s; };
using Object = std::map<std::string, Value>;

struct Parser {
  const std::string& s; size_t i = 0;
  explicit Parser(const std::string& str) : s(str) {}
  void ws() { while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i; }
  bool str(std::string& out) {
    if (i >= s.size() || s[i] != '"') return false;
    ++i; out.clear();
    while (i < s.size() && s[i] != '"') {
      if (s[i] == '\\' && i + 1 < s.size()) {
        ++i;
        switch (s[i]) { case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break;
          case 'u': out += '?'; i += 4; break; default: out += s[i]; }
      } else out += s[i];
      ++i;
    }
    if (i >= s.size()) return false;
    ++i; return true;
  }
  bool skip() {  // skip any value
    ws();
    if (i >= s.size()) return false;
    if (s[i] == '"') { std::string t; return str(t); }
    if (s[i] == '{' || s[i] == '[') {
      int depth = 0;
      while (i < s.size()) {
        if (s[i] == '"') { std::string t; if (!str(t)) return false; continue; }
        if (s[i] == '{' || s[i] == '[') ++depth;
        if (s[i] == '}' || s[i] == ']') { --depth; if (depth == 0) { ++i; return true; } }
        ++i;
      }
      return false;
    }
    while (i < s.size() && s[i] != ',' && s[i] != '}') ++i;
    return true;
  }
  bool parse(Object& o) {
    ws();
    if (i >= s.size() || s[i] != '{') return false;
    ++i; ws();
    if (i < s.size() && s[i] == '}') return true;
    while (true) {
      ws();
      std::string key;
      if (!str(key)) return false;
      ws();
      if (i >= s.size() || s[i] != ':') return false;
      ++i; ws();
      Value v;
      if (i < s.size() && s[i] == '"') { v.t = Value::Str; if (!str(v.s)) return false; }
      else if (s.compare(i, 4, "true") == 0) { v.t = Value::Bool; v.b = true; i += 4; }
      else if (s.compare(i, 5, "false") == 0) { v.t = Value::Bool; v.b = false; i += 5; }
      else if (s.compare(i, 4, "null") == 0) { v.t = Value::Null; i += 4; }
      else if (i < s.size() && (s[i] == '-' || (s[i] >= '0' && s[i] <= '9'))) {
        char* e = nullptr; v.num = std::strtod(s.c_str() + i, &e);
        if (e == s.c_str() + i) return false;
        v.t = Value::Num; i = size_t(e - s.c_str());
      } else { v.t = Value::Other; if (!skip()) return false; }
      o[key] = v;
      ws();
      if (i < s.size() && s[i] == ',') { ++i; continue; }
      if (i < s.size() && s[i] == '}') return true;
      return false;
    }
  }
};

inline bool parse_object(const std::string& s, Object& o) { Parser p(s); return p.parse(o); }

}  // namespace mj
