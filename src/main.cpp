#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_system.h>
#include <mbedtls/md.h>
#include <time.h>
#include <vector>
#include <ESP_SSLClient.h>
#define ENABLE_SMTP
#define ENABLE_FS
#define ENABLE_READYCLIENT
#define READYCLIENT_SSL_CLIENT ESP_SSLClient
#define READYCLIENT_TYPE_1
#include <ReadyMail.h>
#include "config.h"

namespace {
WebServer server(80);
constexpr uint32_t kSessionLifetimeMs = 12UL * 60UL * 60UL * 1000UL;

struct Session {
  String id;
  String token;
  String userId;
  String name;
  String role;
  String projectAccessMode;
  String startPage;
  bool showOverviewSummary = true;
  bool showOverviewRecent = true;
  bool showOverviewActivity = true;
  bool showOverviewTimeline = true;
  uint8_t overviewRecentCount = 6;
  String ip;
  String userAgent;
  bool admin = false;
  bool mustChangePassword = false;
  uint32_t createdAt = 0;
  uint32_t touchedAt = 0;
};
Session sessions[8];

struct DeviceSettings {
  String wifiSsid = MAKERLOG_WIFI_SSID;
  String wifiPassword = MAKERLOG_WIFI_PASSWORD;
  String hostname = MAKERLOG_HOSTNAME;
  String timezone = "CET-1CEST,M3.5.0,M10.5.0/3";
  String ntpPrimary = "pool.ntp.org";
  String ntpSecondary = "time.nist.gov";
};
DeviceSettings deviceSettings;

struct SmtpSettings {
  String host;
  uint16_t port = 465;
  String security = "tls";
  String username;
  String password;
  String senderName = "Make:Log";
  String senderEmail;
  String testRecipient;
  String rootCa;
};
SmtpSettings smtpSettings;
String smtpLastStatus;

struct BackupSchedule {
  bool enabled = false;
  String recipient;
  String scope = "projects";
  uint16_t intervalDays = 7;
  time_t nextRunAt = 0;
  time_t lastSentAt = 0;
  String lastStatus = "Noch nicht ausgeführt";
};
BackupSchedule backupSchedule;
uint32_t lastBackupScheduleCheck = 0;
File smtpAttachmentFile;

String randomHex(size_t bytes) {
  static const char *hex = "0123456789abcdef";
  String out;
  out.reserve(bytes * 2);
  for (size_t i = 0; i < bytes; ++i) {
    uint8_t value = static_cast<uint8_t>(esp_random());
    out += hex[value >> 4];
    out += hex[value & 0x0f];
  }
  return out;
}

String sha256(const String &value) {
  byte digest[32];
  mbedtls_md_context_t context;
  mbedtls_md_init(&context);
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&context, info, 0);
  mbedtls_md_starts(&context);
  mbedtls_md_update(&context, reinterpret_cast<const byte *>(value.c_str()), value.length());
  mbedtls_md_finish(&context, digest);
  mbedtls_md_free(&context);
  String result;
  result.reserve(64);
  for (byte b : digest) {
    if (b < 16) result += '0';
    result += String(b, HEX);
  }
  return result;
}

String hashPassword(const String &password, const String &salt) {
  String value = salt + ":" + password;
  for (int i = 0; i < 12000; ++i) value = sha256(value + salt);
  return value;
}

String currentIsoTime() {
  time_t now = time(nullptr);
  if (now < 1577836800) return "";
  struct tm value;
  gmtime_r(&now, &value);
  char output[25];
  strftime(output, sizeof(output), "%Y-%m-%dT%H:%M:%SZ", &value);
  return String(output);
}

String jsonBody() { return server.arg("plain"); }

void sendJson(int status, JsonDocument &doc) {
  String payload;
  serializeJson(doc, payload);
  server.sendHeader("Cache-Control", "no-store");
  server.send(status, "application/json; charset=utf-8", payload);
}

void sendError(int status, const String &message) {
  JsonDocument doc;
  doc["error"] = message;
  sendJson(status, doc);
}

String cookieValue(const String &name) {
  String cookie = server.header("Cookie");
  String needle = name + "=";
  int start = cookie.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = cookie.indexOf(';', start);
  return cookie.substring(start, end < 0 ? cookie.length() : end);
}

Session *currentSession() {
  String token = cookieValue("makerlog_session");
  uint32_t now = millis();
  for (auto &session : sessions) {
    if (session.token == token && token.length() > 0 && now - session.touchedAt < kSessionLifetimeMs) {
      session.touchedAt = now;
      return &session;
    }
    if (session.token.length() && now - session.touchedAt >= kSessionLifetimeMs) session = Session{};
  }
  return nullptr;
}

bool requireAuth(bool admin = false) {
  Session *session = currentSession();
  if (!session) {
    sendError(401, "Anmeldung erforderlich");
    return false;
  }
  if (admin && !session->admin) {
    sendError(403, "Admin-Rechte erforderlich");
    return false;
  }
  return true;
}

bool validId(const String &value) {
  if (value.length() < 3 || value.length() > 64) return false;
  for (char c : value) if (!isalnum(c) && c != '-' && c != '_') return false;
  return true;
}

bool validDate(const String &value) {
  if (value.length() != 10 || value[4] != '-' || value[7] != '-') return false;
  for (size_t index = 0; index < value.length(); ++index) if (index != 4 && index != 7 && !isdigit(value[index])) return false;
  int year = value.substring(0, 4).toInt();
  int month = value.substring(5, 7).toInt();
  int day = value.substring(8, 10).toInt();
  return year >= 2000 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

String slugify(String value) {
  value.toLowerCase();
  String result;
  bool dash = false;
  for (char c : value) {
    if (isalnum(c)) { result += c; dash = false; }
    else if (!dash && result.length()) { result += '-'; dash = true; }
  }
  while (result.endsWith("-")) result.remove(result.length() - 1);
  if (result.length() < 3) result = "projekt";
  return result.substring(0, 42);
}

String projectPath(const String &id) { return "/projects/" + id; }
bool writeFile(const String &path, const String &content);
String yamlSafe(String value);

bool canAccess(const String &projectId, Session *session) {
  if (!session || !validId(projectId)) return false;
  if (session->admin) return true;
  if (session->projectAccessMode == "all") return true;
  File file = LittleFS.open(projectPath(projectId) + "/access.json", "r");
  if (!file) return false;
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) return false;
  bool listed = false;
  for (JsonVariant user : doc["users"].as<JsonArray>()) if (user.as<String>() == session->userId) { listed = true; break; }
  return session->projectAccessMode == "exclude" ? !listed : listed;
}

bool canEdit(const String &projectId, Session *session) {
  return session && (session->admin || session->role == "editor") && canAccess(projectId, session);
}

bool loadUsers(JsonDocument &doc) {
  File file = LittleFS.open("/system/users.json", "r");
  if (!file) return false;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  return !error;
}

bool saveUsers(JsonDocument &doc) {
  String json;
  serializeJson(doc, json);
  return writeFile("/system/users.json", json);
}

String userRole(JsonObjectConst user) {
  if (!user["role"].isNull()) return user["role"].as<String>();
  return (user["admin"] | false) ? "admin" : "editor";
}

String userProjectAccessMode(JsonObjectConst user) {
  String mode = user["projectAccessMode"] | "include";
  return mode == "exclude" || mode == "all" ? mode : "include";
}

String userStartPage(JsonObjectConst user) {
  String value = user["startPage"] | "home";
  return value == "projects" || value == "archive" ? value : "home";
}

bool userOverviewFlag(JsonObjectConst user, const char *key) {
  return user[key].isNull() ? true : user[key].as<bool>();
}

uint8_t userOverviewRecentCount(JsonObjectConst user) {
  int value = user["overviewRecentCount"] | 6;
  return value >= 1 && value <= 20 ? static_cast<uint8_t>(value) : 6;
}

void addPreferences(JsonObject target, JsonObjectConst user) {
  target["startPage"] = userStartPage(user);
  target["showOverviewSummary"] = userOverviewFlag(user, "showOverviewSummary");
  target["showOverviewRecent"] = userOverviewFlag(user, "showOverviewRecent");
  target["showOverviewActivity"] = userOverviewFlag(user, "showOverviewActivity");
  target["showOverviewTimeline"] = userOverviewFlag(user, "showOverviewTimeline");
  target["overviewRecentCount"] = userOverviewRecentCount(user);
}

bool userActive(JsonObjectConst user) {
  return user["active"].isNull() ? true : user["active"].as<bool>();
}

void invalidateUserSessions(const String &userId, Session *keep = nullptr) {
  for (auto &session : sessions) if (session.userId == userId && &session != keep) session = Session{};
}

bool projectAssignedToUser(const String &projectId, const String &userId) {
  File file = LittleFS.open(projectPath(projectId) + "/access.json", "r");
  if (!file) return false;
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) return false;
  for (JsonVariant value : doc["users"].as<JsonArray>()) if (value.as<String>() == userId) return true;
  return false;
}

bool projectRequested(JsonArrayConst requested, const String &projectId) {
  for (JsonVariantConst value : requested) if (value.as<String>() == projectId) return true;
  return false;
}

bool updateProjectAssignments(const String &userId, JsonArrayConst requested) {
  File root = LittleFS.open("/projects");
  if (!root) return true;
  File dir = root.openNextFile();
  while (dir) {
    if (dir.isDirectory()) {
      String path = dir.path();
      String projectId = path.substring(path.lastIndexOf('/') + 1);
      JsonDocument access;
      File file = LittleFS.open(path + "/access.json", "r");
      if (file) { deserializeJson(access, file); file.close(); }
      JsonArray users = access["users"].to<JsonArray>();
      JsonDocument updated;
      JsonArray result = updated["users"].to<JsonArray>();
      for (JsonVariant value : users) if (value.as<String>() != userId) result.add(value.as<String>());
      if (projectRequested(requested, projectId)) result.add(userId);
      String json;
      serializeJson(updated, json);
      if (!writeFile(path + "/access.json", json)) { dir.close(); root.close(); return false; }
    }
    dir = root.openNextFile();
  }
  root.close();
  return true;
}

void ensureBootstrapUser() {
  LittleFS.mkdir("/system");
  if (LittleFS.exists("/system/users.json")) return;
  String salt = randomHex(16);
  JsonDocument doc;
  JsonObject user = doc["users"].add<JsonObject>();
  user["id"] = "admin";
  user["name"] = "Administrator";
  user["admin"] = true;
  user["role"] = "admin";
  user["active"] = true;
  user["projectAccessMode"] = "include";
  user["startPage"] = "home";
  user["showOverviewSummary"] = true;
  user["showOverviewRecent"] = true;
  user["showOverviewActivity"] = true;
  user["showOverviewTimeline"] = true;
  user["overviewRecentCount"] = 6;
  user["mustChangePassword"] = true;
  user["createdAt"] = currentIsoTime();
  user["salt"] = salt;
  user["passwordHash"] = hashPassword(MAKERLOG_ADMIN_PASSWORD, salt);
  File file = LittleFS.open("/system/users.json", "w");
  serializeJson(doc, file);
  file.close();
}

void handleLogin() {
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String id = input["user"] | "";
  String password = input["password"] | "";
  File file = LittleFS.open("/system/users.json", "r");
  JsonDocument users;
  if (!file || deserializeJson(users, file)) return sendError(500, "Benutzerdaten nicht lesbar");
  file.close();
  for (JsonObject user : users["users"].as<JsonArray>()) {
    if (user["id"].as<String>() != id) continue;
    if (!userActive(user)) break;
    String expected = user["passwordHash"].as<String>();
    if (hashPassword(password, user["salt"].as<String>()) != expected) break;
    Session *slot = nullptr;
    for (auto &candidate : sessions) if (!candidate.token.length()) { slot = &candidate; break; }
    if (!slot) slot = &sessions[esp_random() % 8];
    slot->token = randomHex(24);
    slot->id = randomHex(6);
    slot->userId = id;
    String storedName = user["name"] | "";
    slot->name = storedName.length() ? storedName : id;
    slot->role = userRole(user);
    slot->projectAccessMode = userProjectAccessMode(user);
    slot->startPage = userStartPage(user);
    slot->showOverviewSummary = userOverviewFlag(user, "showOverviewSummary");
    slot->showOverviewRecent = userOverviewFlag(user, "showOverviewRecent");
    slot->showOverviewActivity = userOverviewFlag(user, "showOverviewActivity");
    slot->showOverviewTimeline = userOverviewFlag(user, "showOverviewTimeline");
    slot->overviewRecentCount = userOverviewRecentCount(user);
    slot->admin = slot->role == "admin";
    slot->mustChangePassword = user["mustChangePassword"] | false;
    slot->createdAt = millis();
    slot->touchedAt = slot->createdAt;
    slot->ip = server.client().remoteIP().toString();
    slot->userAgent = server.header("User-Agent");
    user["lastLoginAt"] = currentIsoTime();
    saveUsers(users);
    server.sendHeader("Set-Cookie", "makerlog_session=" + slot->token + "; Path=/; HttpOnly; SameSite=Strict");
    JsonDocument response;
    response["id"] = id;
    response["name"] = user["name"].as<String>();
    response["role"] = slot->role;
    response["admin"] = slot->admin;
    response["startPage"] = slot->startPage;
    response["showOverviewSummary"] = slot->showOverviewSummary;
    response["showOverviewRecent"] = slot->showOverviewRecent;
    response["showOverviewActivity"] = slot->showOverviewActivity;
    response["showOverviewTimeline"] = slot->showOverviewTimeline;
    response["overviewRecentCount"] = slot->overviewRecentCount;
    response["mustChangePassword"] = slot->mustChangePassword;
    return sendJson(200, response);
  }
  delay(350);
  sendError(401, "Benutzername oder Passwort falsch");
}

void handleMe() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Nicht angemeldet");
  JsonDocument doc;
  doc["id"] = session->userId;
  doc["name"] = session->name;
  doc["role"] = session->role;
  doc["projectAccessMode"] = session->projectAccessMode;
  doc["admin"] = session->admin;
  doc["startPage"] = session->startPage.length() ? session->startPage : "home";
  doc["showOverviewSummary"] = session->showOverviewSummary;
  doc["showOverviewRecent"] = session->showOverviewRecent;
  doc["showOverviewActivity"] = session->showOverviewActivity;
  doc["showOverviewTimeline"] = session->showOverviewTimeline;
  doc["overviewRecentCount"] = session->overviewRecentCount;
  doc["mustChangePassword"] = session->mustChangePassword;
  sendJson(200, doc);
}

void handleLogout() {
  if (Session *session = currentSession()) *session = Session{};
  server.sendHeader("Set-Cookie", "makerlog_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
  server.send(204);
}

void handleUpdatePreferences() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  if (!input["startPage"].isNull()) {
    String startPage = input["startPage"].as<String>();
    if (startPage != "home" && startPage != "projects" && startPage != "archive") return sendError(422, "Ungültige Startseite");
  }
  for (const char *key : {"showOverviewSummary", "showOverviewRecent", "showOverviewActivity", "showOverviewTimeline"}) {
    if (!input[key].isNull() && !input[key].is<bool>()) return sendError(422, "Ungültige Übersichts-Einstellung");
  }
  if (!input["overviewRecentCount"].isNull()) {
    int count = input["overviewRecentCount"].as<int>();
    if (count < 1 || count > 20) return sendError(422, "Es können 1–20 letzte Arbeitsschritte angezeigt werden");
  }
  JsonDocument users;
  if (!loadUsers(users)) return sendError(500, "Benutzerdaten nicht lesbar");
  bool found = false;
  for (JsonObject user : users["users"].as<JsonArray>()) {
    if (user["id"].as<String>() != session->userId) continue;
    if (!input["startPage"].isNull()) user["startPage"] = input["startPage"].as<String>();
    for (const char *key : {"showOverviewSummary", "showOverviewRecent", "showOverviewActivity", "showOverviewTimeline"}) if (!input[key].isNull()) user[key] = input[key].as<bool>();
    if (!input["overviewRecentCount"].isNull()) user["overviewRecentCount"] = input["overviewRecentCount"].as<int>();
    session->startPage = userStartPage(user);
    session->showOverviewSummary = userOverviewFlag(user, "showOverviewSummary");
    session->showOverviewRecent = userOverviewFlag(user, "showOverviewRecent");
    session->showOverviewActivity = userOverviewFlag(user, "showOverviewActivity");
    session->showOverviewTimeline = userOverviewFlag(user, "showOverviewTimeline");
    session->overviewRecentCount = userOverviewRecentCount(user);
    found = true;
    break;
  }
  if (!found) return sendError(404, "Benutzer nicht gefunden");
  if (!saveUsers(users)) return sendError(507, "Startseite konnte nicht gespeichert werden");
  JsonDocument response;
  response["startPage"] = session->startPage;
  response["showOverviewSummary"] = session->showOverviewSummary;
  response["showOverviewRecent"] = session->showOverviewRecent;
  response["showOverviewActivity"] = session->showOverviewActivity;
  response["showOverviewTimeline"] = session->showOverviewTimeline;
  response["overviewRecentCount"] = session->overviewRecentCount;
  sendJson(200, response);
}

String readFile(const String &path) {
  File file = LittleFS.open(path, "r");
  if (!file) return "";
  String value = file.readString();
  file.close();
  return value;
}

bool writeFile(const String &path, const String &content) {
  const String temporary = path + ".tmp";
  const String backup = path + ".bak";
  const size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
  if (freeBytes < content.length() + 4096) return false;
  LittleFS.remove(temporary);
  File file = LittleFS.open(temporary, "w");
  if (!file) return false;
  size_t written = file.print(content);
  file.flush();
  file.close();
  if (written != content.length()) { LittleFS.remove(temporary); return false; }
  File verification = LittleFS.open(temporary, "r");
  const bool complete = verification && verification.size() == content.length();
  if (verification) verification.close();
  if (!complete) { LittleFS.remove(temporary); return false; }
  const bool hadOriginal = LittleFS.exists(path);
  LittleFS.remove(backup);
  if (hadOriginal && !LittleFS.rename(path, backup)) { LittleFS.remove(temporary); return false; }
  if (!LittleFS.rename(temporary, path)) {
    if (hadOriginal) LittleFS.rename(backup, path);
    LittleFS.remove(temporary);
    return false;
  }
  LittleFS.remove(backup);
  return true;
}

void collectRecoveryFiles(const String &path, std::vector<String> &temporary, std::vector<String> &backups) {
  File root = LittleFS.open(path);
  if (!root || !root.isDirectory()) { if (root) root.close(); return; }
  File child = root.openNextFile();
  while (child) {
    const String childPath = child.path();
    const bool directory = child.isDirectory();
    child.close();
    if (directory) collectRecoveryFiles(childPath, temporary, backups);
    else if (childPath.endsWith(".tmp")) temporary.push_back(childPath);
    else if (childPath.endsWith(".bak")) backups.push_back(childPath);
    child = root.openNextFile();
  }
  root.close();
}

void recoverAtomicWrites() {
  std::vector<String> temporary;
  std::vector<String> backups;
  collectRecoveryFiles("/", temporary, backups);
  for (const String &candidate : temporary) {
    const String target = candidate.substring(0, candidate.length() - 4);
    if (LittleFS.exists(target)) LittleFS.remove(candidate);
    else LittleFS.rename(candidate, target);
  }
  for (const String &candidate : backups) {
    const String target = candidate.substring(0, candidate.length() - 4);
    if (LittleFS.exists(target)) LittleFS.remove(candidate);
    else LittleFS.rename(candidate, target);
  }
}

bool validHostname(const String &value) {
  if (!value.length() || value.length() > 32 || value.startsWith("-") || value.endsWith("-")) return false;
  for (char c : value) if (!isalnum(c) && c != '-') return false;
  return true;
}

void loadDeviceSettings() {
  File file = LittleFS.open("/system/device.json", "r");
  JsonDocument stored;
  if (!file || deserializeJson(stored, file)) { if (file) file.close(); return; }
  file.close();
  String value = stored["wifiSsid"] | ""; if (value.length()) deviceSettings.wifiSsid = value;
  value = stored["wifiPassword"] | ""; if (value.length()) deviceSettings.wifiPassword = value;
  value = stored["hostname"] | ""; if (validHostname(value)) deviceSettings.hostname = value;
  value = stored["timezone"] | ""; if (value.length()) deviceSettings.timezone = value;
  value = stored["ntpPrimary"] | ""; if (value.length()) deviceSettings.ntpPrimary = value;
  value = stored["ntpSecondary"] | ""; if (value.length()) deviceSettings.ntpSecondary = value;
}

bool saveDeviceSettings() {
  JsonDocument stored;
  stored["wifiSsid"] = deviceSettings.wifiSsid;
  stored["wifiPassword"] = deviceSettings.wifiPassword;
  stored["hostname"] = deviceSettings.hostname;
  stored["timezone"] = deviceSettings.timezone;
  stored["ntpPrimary"] = deviceSettings.ntpPrimary;
  stored["ntpSecondary"] = deviceSettings.ntpSecondary;
  String json;
  serializeJson(stored, json);
  return writeFile("/system/device.json", json);
}

void loadSmtpSettings() {
  File file = LittleFS.open("/system/smtp.json", "r");
  JsonDocument stored;
  if (!file || deserializeJson(stored, file)) { if (file) file.close(); return; }
  file.close();
  smtpSettings.host = stored["host"] | "";
  smtpSettings.port = stored["port"] | 465;
  smtpSettings.security = stored["security"] | "tls";
  smtpSettings.username = stored["username"] | "";
  smtpSettings.password = stored["password"] | "";
  smtpSettings.senderName = stored["senderName"] | "Make:Log";
  smtpSettings.senderEmail = stored["senderEmail"] | "";
  smtpSettings.testRecipient = stored["testRecipient"] | "";
  smtpSettings.rootCa = stored["rootCa"] | "";
}

bool saveSmtpSettings() {
  JsonDocument stored;
  stored["host"] = smtpSettings.host;
  stored["port"] = smtpSettings.port;
  stored["security"] = smtpSettings.security;
  stored["username"] = smtpSettings.username;
  stored["password"] = smtpSettings.password;
  stored["senderName"] = smtpSettings.senderName;
  stored["senderEmail"] = smtpSettings.senderEmail;
  stored["testRecipient"] = smtpSettings.testRecipient;
  stored["rootCa"] = smtpSettings.rootCa;
  String json;
  serializeJson(stored, json);
  return writeFile("/system/smtp.json", json);
}

String normalizeTagName(String value) {
  value.trim();
  value.toLowerCase();
  String normalized;
  bool space = false;
  for (char c : value) {
    if (isspace(static_cast<unsigned char>(c))) {
      if (normalized.length()) space = true;
    } else {
      if (space) normalized += ' ';
      normalized += c;
      space = false;
    }
  }
  return normalized;
}

bool validTagName(const String &value) {
  String normalized = normalizeTagName(value);
  return normalized.length() >= 2 && normalized.length() <= 40;
}

bool loadTags(JsonDocument &doc) {
  File file = LittleFS.open("/system/tags.json", "r");
  if (!file) { doc["tags"].to<JsonArray>(); return true; }
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error || !doc["tags"].is<JsonArray>()) return false;
  return true;
}

bool saveTags(JsonDocument &doc) {
  String json;
  serializeJson(doc, json);
  return writeFile("/system/tags.json", json);
}

JsonObject findTag(JsonDocument &tags, const String &id) {
  for (JsonObject tag : tags["tags"].as<JsonArray>()) if (tag["id"].as<String>() == id) return tag;
  return JsonObject();
}

JsonObject findTagByName(JsonDocument &tags, const String &name) {
  String normalized = normalizeTagName(name);
  for (JsonObject tag : tags["tags"].as<JsonArray>()) if (tag["normalizedName"].as<String>() == normalized) return tag;
  return JsonObject();
}

bool projectHasTag(JsonDocument &project, const String &tagId) {
  for (JsonVariant value : project["tagIds"].as<JsonArray>()) if (value.as<String>() == tagId) return true;
  return false;
}

bool validateTagIds(JsonVariantConst value, JsonDocument &tags) {
  if (!value.is<JsonArrayConst>()) return false;
  std::vector<String> seen;
  if (value.size() > 20) return false;
  for (JsonVariantConst item : value.as<JsonArrayConst>()) {
    String id = item.as<String>();
    if (!validId(id) || findTag(tags, id).isNull()) return false;
    for (const String &existing : seen) if (existing == id) return false;
    seen.push_back(id);
  }
  return true;
}

String projectMarkdown(JsonDocument &project) {
  String deletedAtLine = project["deletedAt"].is<unsigned long>() ? "\ndeletedAt: " + String(project["deletedAt"].as<unsigned long>()) : "";
  String markdown = "---\nid: " + project["id"].as<String>() + "\ntitle: " + yamlSafe(project["title"].as<String>()) + "\nstatus: " + project["status"].as<String>() + "\ncreatedAt: " + yamlSafe(project["createdAt"].as<String>()) + deletedAtLine + "\ntags:";
  JsonDocument tags;
  if (loadTags(tags)) {
    for (JsonVariant tagId : project["tagIds"].as<JsonArray>()) {
      JsonObject tag = findTag(tags, tagId.as<String>());
      if (!tag.isNull()) markdown += "\n  - " + yamlSafe(tag["name"].as<String>());
    }
  }
  markdown += "\n---\n\n" + project["description"].as<String>() + "\n";
  return markdown;
}

bool validEmail(const String &value) {
  int at = value.indexOf('@');
  int dot = value.lastIndexOf('.');
  return value.length() >= 5 && value.length() <= 254 && at > 0 && dot > at + 1 && dot < static_cast<int>(value.length()) - 1;
}

bool smtpConfigured() {
  return smtpSettings.host.length() && smtpSettings.port > 0 && smtpSettings.username.length() && smtpSettings.password.length() &&
         validEmail(smtpSettings.senderEmail) && validEmail(smtpSettings.testRecipient) && smtpSettings.rootCa.indexOf("BEGIN CERTIFICATE") >= 0;
}

void loadBackupSchedule() {
  File file = LittleFS.open("/system/backup.json", "r");
  JsonDocument stored;
  if (!file || deserializeJson(stored, file)) { if (file) file.close(); return; }
  file.close();
  backupSchedule.enabled = stored["enabled"] | false;
  backupSchedule.recipient = stored["recipient"] | "";
  backupSchedule.scope = stored["scope"] | "projects";
  backupSchedule.intervalDays = stored["intervalDays"] | 7;
  backupSchedule.nextRunAt = stored["nextRunAt"] | 0;
  backupSchedule.lastSentAt = stored["lastSentAt"] | 0;
  backupSchedule.lastStatus = stored["lastStatus"] | "Noch nicht ausgeführt";
}

bool saveBackupSchedule() {
  JsonDocument stored;
  stored["enabled"] = backupSchedule.enabled;
  stored["recipient"] = backupSchedule.recipient;
  stored["scope"] = backupSchedule.scope;
  stored["intervalDays"] = backupSchedule.intervalDays;
  stored["nextRunAt"] = backupSchedule.nextRunAt;
  stored["lastSentAt"] = backupSchedule.lastSentAt;
  stored["lastStatus"] = backupSchedule.lastStatus;
  String json;
  serializeJson(stored, json);
  return writeFile("/system/backup.json", json);
}

bool addTarFile(File &archive, const String &sourcePath, String archiveName) {
  while (archiveName.startsWith("/")) archiveName.remove(0, 1);
  if (!archiveName.length() || archiveName.length() > 99) return false;
  File source = LittleFS.open(sourcePath, "r");
  if (!source || source.isDirectory()) { if (source) source.close(); return false; }
  const size_t size = source.size();
  uint8_t header[512] = {};
  strncpy(reinterpret_cast<char *>(header), archiveName.c_str(), 99);
  snprintf(reinterpret_cast<char *>(header + 100), 8, "%07o", 0644);
  snprintf(reinterpret_cast<char *>(header + 108), 8, "%07o", 0);
  snprintf(reinterpret_cast<char *>(header + 116), 8, "%07o", 0);
  snprintf(reinterpret_cast<char *>(header + 124), 12, "%011o", static_cast<unsigned int>(size));
  snprintf(reinterpret_cast<char *>(header + 136), 12, "%011o", static_cast<unsigned int>(time(nullptr)));
  memset(header + 148, ' ', 8);
  header[156] = '0';
  memcpy(header + 257, "ustar", 5);
  memcpy(header + 263, "00", 2);
  unsigned int checksum = 0;
  for (uint8_t value : header) checksum += value;
  snprintf(reinterpret_cast<char *>(header + 148), 7, "%06o", checksum);
  header[154] = '\0'; header[155] = ' ';
  if (archive.write(header, sizeof(header)) != sizeof(header)) { source.close(); return false; }
  uint8_t buffer[1024];
  size_t written = 0;
  while (source.available()) {
    size_t count = source.read(buffer, sizeof(buffer));
    if (!count || archive.write(buffer, count) != count) { source.close(); return false; }
    written += count;
  }
  source.close();
  size_t padding = (512 - (written % 512)) % 512;
  if (padding) { memset(buffer, 0, padding); if (archive.write(buffer, padding) != padding) return false; }
  return true;
}

bool addTreeToTar(File &archive, const String &path) {
  File root = LittleFS.open(path);
  if (!root) return false;
  if (!root.isDirectory()) { root.close(); return addTarFile(archive, path, path); }
  File child = root.openNextFile();
  while (child) {
    String childPath = child.path();
    bool directory = child.isDirectory();
    child.close();
    if (!childPath.endsWith(".tmp") && !childPath.endsWith(".bak")) {
      bool ok = directory ? addTreeToTar(archive, childPath) : addTarFile(archive, childPath, childPath);
      if (!ok) { root.close(); return false; }
    }
    child = root.openNextFile();
  }
  root.close();
  return true;
}

bool createBackupTar(const String &target, const String &scope) {
  LittleFS.remove(target);
  File archive = LittleFS.open(target, "w");
  if (!archive) return false;
  bool ok = scope == "users" ? addTarFile(archive, "/system/users.json", "users/accounts.json") : addTreeToTar(archive, "/projects");
  if (ok && scope != "users" && LittleFS.exists("/system/tags.json")) ok = addTarFile(archive, "/system/tags.json", "system/tags.json");
  uint8_t end[1024] = {};
  if (ok) ok = archive.write(end, sizeof(end)) == sizeof(end);
  archive.flush();
  archive.close();
  if (!ok) LittleFS.remove(target);
  return ok;
}

void smtpFileCallback(File &file, const char *filename, readymail_file_operating_mode mode) {
  if (mode == readymail_file_mode_open_read) smtpAttachmentFile = LittleFS.open(filename, "r");
  else if (mode == readymail_file_mode_remove) LittleFS.remove(filename);
  file = smtpAttachmentFile;
}

struct MailAttachment {
  String path;
  String filename;
};

void smtpStatusCallback(SMTPStatus status) {
  smtpLastStatus = status.text;
  Serial.printf("SMTP: %s\n", status.text.c_str());
}

bool sendSmtpMail(const String &recipient, const String &subject, const String &body, const std::vector<MailAttachment> &attachments, String &error) {
  if (WiFi.status() != WL_CONNECTED) { error = "Keine WLAN-Verbindung"; return false; }
  if (!smtpConfigured()) { error = "Die SMTP-Konfiguration ist unvollständig"; return false; }
  WiFiClient basicClient;
  ESP_SSLClient sslClient;
  sslClient.setClient(&basicClient);
  sslClient.setCACert(smtpSettings.rootCa.c_str());
  sslClient.setBufferSizes(2048, 1024);
  ReadyClient readyClient(sslClient);
  readyClient.addPort(smtpSettings.port, smtpSettings.security == "starttls" ? readymail_protocol_tls : readymail_protocol_ssl);
  SMTPClient smtp(readyClient);
  smtpLastStatus = "";
  smtp.connect(smtpSettings.host, smtpSettings.port, smtpStatusCallback);
  if (!smtp.isConnected()) { error = smtpLastStatus.length() ? smtpLastStatus : "Verbindung zum SMTP-Server fehlgeschlagen"; return false; }
  smtp.authenticate(smtpSettings.username, smtpSettings.password, readymail_auth_password);
  if (!smtp.isAuthenticated()) { error = smtpLastStatus.length() ? smtpLastStatus : "SMTP-Anmeldung fehlgeschlagen"; smtp.stop(); return false; }
  SMTPMessage message;
  message.headers.add(rfc822_subject, subject);
  message.headers.add(rfc822_from, smtpSettings.senderName + " <" + smtpSettings.senderEmail + ">");
  message.headers.add(rfc822_to, recipient);
  message.text.body(body);
  for (const MailAttachment &item : attachments) {
    Attachment attachment;
    attachment.filename = item.filename;
    attachment.name = item.filename;
    attachment.mime = "application/x-tar";
    attachment.attach_file.callback = smtpFileCallback;
    attachment.attach_file.path = item.path;
    message.attachments.add(attachment, attach_type_attachment);
  }
  message.timestamp = time(nullptr);
  bool sent = smtp.send(message);
  if (!sent) error = smtpLastStatus.length() ? smtpLastStatus : "Testnachricht konnte nicht versendet werden";
  smtp.logout();
  smtp.stop();
  return sent;
}

bool sendSmtpTest(String &error) {
  std::vector<MailAttachment> attachments;
  return sendSmtpMail(smtpSettings.testRecipient, "Make:Log SMTP-Test", "Diese Testnachricht bestätigt, dass Make:Log E-Mails über den eingerichteten SMTP-Server versenden kann.", attachments, error);
}

bool sendBackupNow(String &error) {
  if (!validEmail(backupSchedule.recipient)) { error = "Ungültiger Backup-Empfänger"; return false; }
  std::vector<MailAttachment> attachments;
  if (backupSchedule.scope == "projects" || backupSchedule.scope == "both") {
    if (!createBackupTar("/system/backup-projects.tar", "projects")) { error = "Projektarchiv konnte nicht erstellt werden. Möglicherweise ist der Speicher voll."; return false; }
    attachments.push_back({"/system/backup-projects.tar", "make-log-projekte.tar"});
  }
  if (backupSchedule.scope == "users" || backupSchedule.scope == "both") {
    if (!createBackupTar("/system/backup-users.tar", "users")) {
      LittleFS.remove("/system/backup-projects.tar");
      error = "Benutzerarchiv konnte nicht erstellt werden. Möglicherweise ist der Speicher voll.";
      return false;
    }
    attachments.push_back({"/system/backup-users.tar", "make-log-benutzer.tar"});
  }
  bool sent = sendSmtpMail(backupSchedule.recipient, "Make:Log Backup", "Im Anhang befindet sich das automatisch erstellte Make:Log-Backup.", attachments, error);
  LittleFS.remove("/system/backup-projects.tar");
  LittleFS.remove("/system/backup-users.tar");
  return sent;
}

void auditEvent(const String &actor, const String &action, const String &target, const String &details = "") {
  const String path = "/system/audit.jsonl";
  File existing = LittleFS.open(path, "r");
  size_t size = existing ? existing.size() : 0;
  if (existing) existing.close();
  if (size > 65536) LittleFS.remove(path);
  JsonDocument event;
  event["at"] = currentIsoTime();
  event["uptimeMs"] = millis();
  event["actor"] = actor;
  event["action"] = action;
  event["target"] = target;
  if (details.length()) event["details"] = details;
  String line;
  serializeJson(event, line);
  File file = LittleFS.open(path, "a");
  if (file) { file.println(line); file.close(); }
}

String entryAuditTarget(const String &projectId, const String &entryId, const String &entryTitle) {
  String projectTitle = projectId;
  File file = LittleFS.open(projectPath(projectId) + "/project.json", "r");
  JsonDocument project;
  if (file && !deserializeJson(project, file)) {
    String storedTitle = project["title"] | "";
    if (storedTitle.length()) projectTitle = storedTitle;
  }
  if (file) file.close();
  return projectTitle + " · " + (entryTitle.length() ? entryTitle : entryId);
}

void handleChangePassword() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String currentPassword = input["currentPassword"] | "";
  String newPassword = input["newPassword"] | "";
  if (newPassword.length() < 8 || newPassword.length() > 128) return sendError(422, "Das neue Passwort muss 8–128 Zeichen haben");
  JsonDocument users;
  if (!loadUsers(users)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonObject target;
  for (JsonObject user : users["users"].as<JsonArray>()) if (user["id"].as<String>() == session->userId) { target = user; break; }
  if (target.isNull()) return sendError(404, "Benutzer nicht gefunden");
  if (hashPassword(currentPassword, target["salt"].as<String>()) != target["passwordHash"].as<String>()) return sendError(401, "Aktuelles Passwort ist falsch");
  String salt = randomHex(16);
  target["salt"] = salt;
  target["passwordHash"] = hashPassword(newPassword, salt);
  target["mustChangePassword"] = false;
  if (!saveUsers(users)) return sendError(507, "Passwort konnte nicht gespeichert werden");
  session->mustChangePassword = false;
  invalidateUserSessions(session->userId, session);
  auditEvent(session->userId, "password.changed", session->userId);
  server.send(204);
}

void listSessions() {
  Session *current = currentSession();
  if (!current) return sendError(401, "Anmeldung erforderlich");
  if (!current->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument response;
  JsonArray result = response["sessions"].to<JsonArray>();
  uint32_t now = millis();
  for (auto &session : sessions) {
    if (!session.token.length()) continue;
    if (now - session.touchedAt >= kSessionLifetimeMs) { session = Session{}; continue; }
    JsonObject item = result.add<JsonObject>();
    item["id"] = session.id;
    item["userId"] = session.userId;
    item["name"] = session.name;
    item["ip"] = session.ip;
    item["userAgent"] = session.userAgent;
    item["activeAgoSeconds"] = (now - session.touchedAt) / 1000;
    item["ageSeconds"] = (now - session.createdAt) / 1000;
    item["current"] = &session == current;
  }
  sendJson(200, response);
}

void revokeSession(const String &id) {
  Session *current = currentSession();
  if (!current) return sendError(401, "Anmeldung erforderlich");
  if (!current->admin) return sendError(403, "Admin-Rechte erforderlich");
  for (auto &session : sessions) {
    if (session.id != id || !session.token.length()) continue;
    if (&session == current) return sendError(422, "Die aktuelle Sitzung wird über Abmelden beendet");
    String target = session.userId;
    session = Session{};
    auditEvent(current->userId, "session.revoked", target, id);
    return server.send(204);
  }
  sendError(404, "Sitzung nicht gefunden");
}

void listAudit() {
  if (!requireAuth(true)) return;
  JsonDocument response;
  JsonArray events = response["events"].to<JsonArray>();
  File file = LittleFS.open("/system/audit.jsonl", "r");
  if (file) {
    while (file.available()) {
      String line = file.readStringUntil('\n');
      JsonDocument event;
      if (!deserializeJson(event, line)) {
        if (events.size() >= 50) events.remove(0);
        events.add(event.as<JsonObject>());
      }
    }
    file.close();
  }
  sendJson(200, response);
}

bool validRole(const String &role) { return role == "admin" || role == "editor" || role == "viewer"; }

void addProjectAssignments(JsonArray target, const String &userId) {
  File root = LittleFS.open("/projects");
  if (!root) return;
  File dir = root.openNextFile();
  while (dir) {
    if (dir.isDirectory()) {
      String path = dir.path();
      String projectId = path.substring(path.lastIndexOf('/') + 1);
      if (projectAssignedToUser(projectId, userId)) target.add(projectId);
    }
    dir = root.openNextFile();
  }
  root.close();
}

void addPublicUser(JsonObject target, JsonObjectConst source, bool includeProjects = true) {
  String id = source["id"].as<String>();
  String role = userRole(source);
  String name = source["name"] | "";
  target["id"] = id;
  target["name"] = name.length() ? name : id;
  target["role"] = role;
  target["admin"] = role == "admin";
  target["active"] = userActive(source);
  target["projectAccessMode"] = userProjectAccessMode(source);
  addPreferences(target, source);
  target["mustChangePassword"] = source["mustChangePassword"] | false;
  target["createdAt"] = source["createdAt"] | "";
  target["lastLoginAt"] = source["lastLoginAt"] | "";
  if (includeProjects) addProjectAssignments(target["projectIds"].to<JsonArray>(), id);
}

int activeAdminCount(JsonArrayConst users, const String &excludedId = "") {
  int count = 0;
  for (JsonObjectConst user : users) {
    if (user["id"].as<String>() == excludedId) continue;
    if (userRole(user) == "admin" && userActive(user)) ++count;
  }
  return count;
}

void listUsers() {
  if (!requireAuth(true)) return;
  JsonDocument stored;
  if (!loadUsers(stored)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonDocument response;
  JsonArray result = response["users"].to<JsonArray>();
  for (JsonObjectConst user : stored["users"].as<JsonArrayConst>()) addPublicUser(result.add<JsonObject>(), user);
  sendJson(200, response);
}

void createUser() {
  if (!requireAuth(true)) return;
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String id = input["id"] | "";
  String password = input["password"] | "";
  String role = input["role"] | "editor";
  String accessMode = input["projectAccessMode"] | "include";
  bool mustChangePassword = input["mustChangePassword"].isNull() ? true : input["mustChangePassword"].as<bool>();
  if (!validId(id) || id.length() > 32) return sendError(422, "Benutzername muss 3–32 Zeichen lang sein und darf nur Buchstaben, Zahlen, - und _ enthalten");
  if (password.length() < 8 || password.length() > 128) return sendError(422, "Passwort muss 8–128 Zeichen haben");
  if (!validRole(role)) return sendError(422, "Ungültige Rolle");
  if (accessMode != "include" && accessMode != "exclude" && accessMode != "all") return sendError(422, "Ungültiger Zugriffsmodus");
  JsonDocument users;
  if (!loadUsers(users)) return sendError(500, "Benutzerdaten nicht lesbar");
  for (JsonObjectConst user : users["users"].as<JsonArrayConst>()) if (user["id"].as<String>() == id) return sendError(409, "Benutzername ist bereits vergeben");
  String salt = randomHex(16);
  JsonObject user = users["users"].as<JsonArray>().add<JsonObject>();
  user["id"] = id;
  user["name"] = id;
  user["role"] = role;
  user["admin"] = role == "admin";
  user["active"] = true;
  user["projectAccessMode"] = accessMode;
  user["startPage"] = "home";
  user["showOverviewSummary"] = true;
  user["showOverviewRecent"] = true;
  user["showOverviewActivity"] = true;
  user["showOverviewTimeline"] = true;
  user["overviewRecentCount"] = 6;
  user["mustChangePassword"] = mustChangePassword;
  user["createdAt"] = currentIsoTime();
  user["salt"] = salt;
  user["passwordHash"] = hashPassword(password, salt);
  if (!saveUsers(users)) return sendError(507, "Benutzer konnte nicht gespeichert werden");
  if (!updateProjectAssignments(id, input["projectIds"].as<JsonArrayConst>())) return sendError(507, "Projektfreigaben konnten nicht gespeichert werden");
  if (Session *actor = currentSession()) auditEvent(actor->userId, "user.created", id, "role=" + role + ", access=" + accessMode);
  JsonDocument response;
  addPublicUser(response.to<JsonObject>(), user);
  sendJson(201, response);
}

void updateUser(const String &id) {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  JsonDocument users;
  if (!loadUsers(users)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonObject target;
  for (JsonObject user : users["users"].as<JsonArray>()) if (user["id"].as<String>() == id) { target = user; break; }
  if (target.isNull()) return sendError(404, "Benutzer nicht gefunden");
  String previousRole = userRole(target);
  bool previouslyActive = userActive(target);
  String previousAccessMode = userProjectAccessMode(target);
  bool previouslyMustChangePassword = target["mustChangePassword"] | false;
  String role = input["role"].isNull() ? userRole(target) : input["role"].as<String>();
  bool active = input["active"].isNull() ? userActive(target) : input["active"].as<bool>();
  String accessMode = input["projectAccessMode"].isNull() ? previousAccessMode : input["projectAccessMode"].as<String>();
  bool mustChangePassword = input["mustChangePassword"].isNull() ? (target["mustChangePassword"] | false) : input["mustChangePassword"].as<bool>();
  if (!validRole(role)) return sendError(422, "Ungültige Rolle");
  if (accessMode != "include" && accessMode != "exclude" && accessMode != "all") return sendError(422, "Ungültiger Zugriffsmodus");
  if (id == session->userId && (!active || role != "admin")) return sendError(422, "Der eigene Administratorzugang kann nicht deaktiviert oder herabgestuft werden");
  if (userRole(target) == "admin" && userActive(target) && (role != "admin" || !active) && activeAdminCount(users["users"].as<JsonArrayConst>(), id) == 0) return sendError(422, "Der letzte aktive Administrator muss erhalten bleiben");
  target["role"] = role;
  target["admin"] = role == "admin";
  target["active"] = active;
  target["projectAccessMode"] = accessMode;
  target["mustChangePassword"] = mustChangePassword;
  bool passwordChanged = !input["password"].isNull() && input["password"].as<String>().length();
  if (passwordChanged) {
    String password = input["password"].as<String>();
    if (password.length() < 8 || password.length() > 128) return sendError(422, "Passwort muss 8–128 Zeichen haben");
    String salt = randomHex(16);
    target["salt"] = salt;
    target["passwordHash"] = hashPassword(password, salt);
  }
  if (!saveUsers(users)) return sendError(507, "Benutzer konnte nicht gespeichert werden");
  if (!input["projectIds"].isNull() && !updateProjectAssignments(id, input["projectIds"].as<JsonArrayConst>())) return sendError(507, "Projektfreigaben konnten nicht gespeichert werden");
  auditEvent(session->userId, "user.updated", id, "role=" + role + ", active=" + String(active ? "true" : "false") + ", access=" + accessMode);
  if (active != previouslyActive || role != previousRole || accessMode != previousAccessMode || mustChangePassword != previouslyMustChangePassword || passwordChanged) invalidateUserSessions(id);
  JsonDocument response;
  addPublicUser(response.to<JsonObject>(), target);
  sendJson(200, response);
}

void deleteUser(const String &id) {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  if (id == session->userId) return sendError(422, "Der eigene Benutzer kann nicht gelöscht werden");
  JsonDocument users;
  if (!loadUsers(users)) return sendError(500, "Benutzerdaten nicht lesbar");
  bool found = false;
  JsonDocument updated;
  JsonArray result = updated["users"].to<JsonArray>();
  for (JsonObjectConst user : users["users"].as<JsonArrayConst>()) {
    if (user["id"].as<String>() == id) { found = true; continue; }
    result.add(user);
  }
  if (!found) return sendError(404, "Benutzer nicht gefunden");
  if (activeAdminCount(result) == 0) return sendError(422, "Der letzte aktive Administrator muss erhalten bleiben");
  if (!saveUsers(updated)) return sendError(507, "Benutzer konnte nicht gelöscht werden");
  JsonDocument none;
  if (!updateProjectAssignments(id, none.to<JsonArray>())) return sendError(507, "Projektfreigaben konnten nicht entfernt werden");
  auditEvent(session->userId, "user.deleted", id);
  invalidateUserSessions(id);
  server.send(204);
}

String yamlSafe(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", " ");
  return "\"" + value + "\"";
}

bool deleteTree(const String &path) {
  File root = LittleFS.open(path);
  if (!root) return false;
  if (!root.isDirectory()) {
    root.close();
    return LittleFS.remove(path);
  }
  File child = root.openNextFile();
  while (child) {
    String childPath = child.path();
    bool directory = child.isDirectory();
    child.close();
    if (directory) {
      if (!deleteTree(childPath)) { root.close(); return false; }
    } else if (!LittleFS.remove(childPath)) { root.close(); return false; }
    child = root.openNextFile();
  }
  root.close();
  return LittleFS.rmdir(path);
}

const char *kItemFields[] = {"name", "title", "quantity", "status", "priority", "dueDate", "price", "url", "properties", "role", "company", "email", "phone", "notes", "description"};

bool validCollection(const String &value) {
  return value == "tasks" || value == "materials" || value == "contacts" || value == "links" || value == "ideas";
}

String itemMarkdown(const String &collection, JsonDocument &item) {
  String sortOrderLine = item["sortOrder"].is<int>() ? "\nsortOrder: " + String(item["sortOrder"].as<int>()) : "";
  String markdown = "---\nid: " + item["id"].as<String>() + "\ntype: " + collection + "\ncreatedAt: " + yamlSafe(item["createdAt"].as<String>()) + "\nauthor: " + yamlSafe(item["author"].as<String>()) + sortOrderLine + "\n---\n";
  for (const char *field : kItemFields) {
    String value = item[field] | "";
    if (value.length()) markdown += "\n## " + String(field) + "\n\n" + value + "\n";
  }
  if (collection == "tasks") {
    String completedAt = item["completedAt"] | "";
    String completedEntryId = item["completedEntryId"] | "";
    if (completedAt.length()) markdown += "\n## completedAt\n\n" + completedAt + "\n";
    if (completedEntryId.length()) markdown += "\n## completedEntryId\n\n" + completedEntryId + "\n";
  }
  return markdown;
}

void appendCollection(JsonDocument &project, const String &projectId, const String &collection) {
  JsonArray result = project[collection].to<JsonArray>();
  File dir = LittleFS.open(projectPath(projectId) + "/" + collection);
  if (!dir) return;
  File file = dir.openNextFile();
  while (file) {
    if (!file.isDirectory() && String(file.name()).endsWith(".json")) {
      JsonDocument parsed;
      if (!deserializeJson(parsed, file)) result.add(parsed.as<JsonObject>());
    }
    file = dir.openNextFile();
  }
  dir.close();
}

void tagUsage(const String &tagId, Session *session, uint16_t &activeCount, uint16_t &archivedCount) {
  activeCount = 0; archivedCount = 0;
  File root = LittleFS.open("/projects");
  if (!root) return;
  File dir = root.openNextFile();
  while (dir) {
    if (dir.isDirectory()) {
      String path = dir.path();
      String projectId = path.substring(path.lastIndexOf('/') + 1);
      if (!session || canAccess(projectId, session)) {
        File file = LittleFS.open(path + "/project.json", "r");
        JsonDocument project;
        if (file && !deserializeJson(project, file) && projectHasTag(project, tagId)) {
          String status = project["status"] | "active";
          if (status == "archived") ++archivedCount;
          else if (status == "active") ++activeCount;
        }
        if (file) file.close();
      }
    }
    dir = root.openNextFile();
  }
  root.close();
}

bool rewriteProjectTagAssignments(const String &sourceId, const String &targetId) {
  File root = LittleFS.open("/projects");
  if (!root) return true;
  File dir = root.openNextFile();
  while (dir) {
    if (dir.isDirectory()) {
      String base = dir.path();
      File file = LittleFS.open(base + "/project.json", "r");
      JsonDocument project;
      bool changed = false;
      if (file && !deserializeJson(project, file) && projectHasTag(project, sourceId)) {
        JsonArray ids = project["tagIds"].as<JsonArray>();
        bool hasTarget = targetId.length() && projectHasTag(project, targetId);
        for (int index = static_cast<int>(ids.size()) - 1; index >= 0; --index) {
          if (ids[index].as<String>() == sourceId) { ids.remove(index); changed = true; }
        }
        if (targetId.length() && !hasTarget) ids.add(targetId);
      }
      if (file) file.close();
      if (changed) {
        String json;
        serializeJson(project, json);
        if (!writeFile(base + "/project.json", json) || !writeFile(base + "/README.md", projectMarkdown(project))) { root.close(); return false; }
      }
    }
    dir = root.openNextFile();
  }
  root.close();
  return true;
}

bool rewriteProjectReadmesForTag(const String &tagId) {
  File root = LittleFS.open("/projects");
  if (!root) return true;
  File dir = root.openNextFile();
  while (dir) {
    if (dir.isDirectory()) {
      String base = dir.path();
      File file = LittleFS.open(base + "/project.json", "r");
      JsonDocument project;
      bool affected = file && !deserializeJson(project, file) && projectHasTag(project, tagId);
      if (file) file.close();
      if (affected && !writeFile(base + "/README.md", projectMarkdown(project))) { root.close(); return false; }
    }
    dir = root.openNextFile();
  }
  root.close();
  return true;
}

void listTags() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  JsonDocument stored;
  if (!loadTags(stored)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonDocument response;
  JsonArray result = response["tags"].to<JsonArray>();
  for (JsonObject tag : stored["tags"].as<JsonArray>()) {
    uint16_t activeCount, archivedCount;
    tagUsage(tag["id"].as<String>(), session, activeCount, archivedCount);
    bool isAdmin = session->admin;
    if (!isAdmin && tag["active"].as<bool>() == false && activeCount + archivedCount == 0) continue;
    JsonObject item = result.add<JsonObject>();
    item.set(tag);
    item["activeProjectCount"] = activeCount;
    item["archivedProjectCount"] = archivedCount;
  }
  sendJson(200, response);
}

void createTag() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin && session->role != "editor") return sendError(403, "Bearbeitungsrechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String name = input["name"] | "";
  name.trim();
  if (!validTagName(name)) return sendError(422, "Ein Tag muss 2–40 Zeichen lang sein");
  JsonDocument stored;
  if (!loadTags(stored)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonObject existing = findTagByName(stored, name);
  if (!existing.isNull()) {
    JsonDocument response; response.set(existing); return sendJson(200, response);
  }
  JsonObject tag = stored["tags"].as<JsonArray>().add<JsonObject>();
  String id = "tag-" + slugify(name) + "-" + randomHex(2);
  tag["id"] = id;
  tag["name"] = name;
  tag["normalizedName"] = normalizeTagName(name);
  tag["active"] = true;
  tag["createdAt"] = currentIsoTime();
  if (!saveTags(stored)) return sendError(507, "Tag konnte nicht gespeichert werden");
  auditEvent(session->userId, "tag.created", name);
  JsonDocument response; response.set(tag); response["activeProjectCount"] = 0; response["archivedProjectCount"] = 0;
  sendJson(201, response);
}

void updateTag(const String &id) {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  JsonDocument stored;
  if (!loadTags(stored)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonObject tag = findTag(stored, id);
  if (tag.isNull()) return sendError(404, "Tag nicht gefunden");
  if (!input["name"].isNull()) {
    String name = input["name"] | ""; name.trim();
    if (!validTagName(name)) return sendError(422, "Ein Tag muss 2–40 Zeichen lang sein");
    JsonObject duplicate = findTagByName(stored, name);
    if (!duplicate.isNull() && duplicate["id"].as<String>() != id) return sendError(409, "Ein Tag mit diesem Namen existiert bereits");
    tag["name"] = name;
    tag["normalizedName"] = normalizeTagName(name);
  }
  if (!input["active"].isNull()) tag["active"] = input["active"].as<bool>();
  if (!saveTags(stored)) return sendError(507, "Tag konnte nicht gespeichert werden");
  if (!rewriteProjectReadmesForTag(id)) return sendError(507, "Projektdateien konnten nicht aktualisiert werden");
  auditEvent(session->userId, "tag.updated", tag["name"].as<String>());
  JsonDocument response; response.set(tag); sendJson(200, response);
}

void mergeTag(const String &sourceId) {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String targetId = input["targetId"] | "";
  if (targetId == sourceId) return sendError(422, "Quell- und Ziel-Tag müssen verschieden sein");
  JsonDocument stored;
  if (!loadTags(stored)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonObject source = findTag(stored, sourceId), target = findTag(stored, targetId);
  if (source.isNull() || target.isNull()) return sendError(404, "Tag nicht gefunden");
  String sourceName = source["name"].as<String>();
  if (!rewriteProjectTagAssignments(sourceId, targetId)) return sendError(507, "Tag konnte nicht allen Projekten zugewiesen werden");
  JsonArray tags = stored["tags"].as<JsonArray>();
  for (int index = static_cast<int>(tags.size()) - 1; index >= 0; --index) if (tags[index]["id"].as<String>() == sourceId) tags.remove(index);
  if (!saveTags(stored)) return sendError(507, "Tagliste konnte nicht gespeichert werden");
  auditEvent(session->userId, "tag.merged", sourceName, target["name"].as<String>());
  JsonDocument response; response["merged"] = true; response["targetId"] = targetId; sendJson(200, response);
}

void deleteTag(const String &id) {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (server.hasArg("plain") && server.arg("plain").length() && deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  JsonDocument stored;
  if (!loadTags(stored)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonObject tag = findTag(stored, id);
  if (tag.isNull()) return sendError(404, "Tag nicht gefunden");
  uint16_t activeCount, archivedCount; tagUsage(id, nullptr, activeCount, archivedCount);
  bool removeAssignments = input["removeFromProjects"] | false;
  if (activeCount + archivedCount > 0 && !removeAssignments) return sendError(409, "Der Tag ist noch Projekten zugewiesen");
  if (removeAssignments && !rewriteProjectTagAssignments(id, "")) return sendError(507, "Tag konnte nicht aus allen Projekten entfernt werden");
  String name = tag["name"].as<String>();
  JsonArray tags = stored["tags"].as<JsonArray>();
  for (int index = static_cast<int>(tags.size()) - 1; index >= 0; --index) if (tags[index]["id"].as<String>() == id) tags.remove(index);
  if (!saveTags(stored)) return sendError(507, "Tagliste konnte nicht gespeichert werden");
  auditEvent(session->userId, "tag.deleted", name);
  server.send(204);
}

void listProjects() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  JsonDocument doc;
  JsonArray result = doc["projects"].to<JsonArray>();
  File root = LittleFS.open("/projects");
  if (root) {
    File dir = root.openNextFile();
    while (dir) {
      if (dir.isDirectory()) {
        String path = dir.path();
        String id = path.substring(path.lastIndexOf('/') + 1);
        if (canAccess(id, session)) {
          File meta = LittleFS.open(path + "/project.json", "r");
          JsonObject item = result.add<JsonObject>();
          JsonDocument parsed;
          if (meta && !deserializeJson(parsed, meta)) item.set(parsed.as<JsonObject>());
          item["id"] = id;
          meta.close();
          uint16_t entryCount = 0;
          String latestDate;
          String latestId;
          String latestBody;
          String latestNextStep;
          File entries = LittleFS.open(path + "/entries");
          if (entries) {
            File entry = entries.openNextFile();
            while (entry) {
              if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
                JsonDocument entryDoc;
                if (!deserializeJson(entryDoc, entry)) {
                  ++entryCount;
                  String candidateDate = entryDoc["date"] | "";
                  if (!latestId.length() || candidateDate >= latestDate) {
                    latestDate = candidateDate;
                    latestId = entryDoc["id"] | "";
                    item["latestEntryTitle"] = entryDoc["title"] | "";
                    latestBody = entryDoc["body"] | "";
                    latestNextStep = entryDoc["nextStep"] | "";
                  }
                }
              }
              entry = entries.openNextFile();
            }
            entries.close();
          }
          item["entryCount"] = entryCount;
          if (latestId.length()) {
            item["latestEntryId"] = latestId;
            item["latestEntryDate"] = latestDate;
            item["latestEntryBody"] = latestBody;
            item["latestNextStep"] = latestNextStep;
          }
        }
      }
      dir = root.openNextFile();
    }
    root.close();
  }
  sendJson(200, doc);
}

void createProject() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin && session->role != "editor") return sendError(403, "Bearbeitungsrechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String title = input["title"] | "";
  if (title.length() < 2 || title.length() > 100) return sendError(422, "Titel muss 2–100 Zeichen haben");
  String createdAt = input["createdAt"] | "";
  if (!validDate(createdAt)) return sendError(422, "Ein gültiges Startdatum ist erforderlich");
  JsonDocument tags;
  if (!loadTags(tags)) return sendError(500, "Tags konnten nicht gelesen werden");
  if (!input["tagIds"].isNull() && !validateTagIds(input["tagIds"], tags)) return sendError(422, "Ungültige Tag-Auswahl");
  String id = slugify(title) + "-" + randomHex(3);
  String base = projectPath(id);
  LittleFS.mkdir("/projects");
  LittleFS.mkdir(base);
  LittleFS.mkdir(base + "/entries");
  LittleFS.mkdir(base + "/materials");
  LittleFS.mkdir(base + "/tasks");
  LittleFS.mkdir(base + "/contacts");
  LittleFS.mkdir(base + "/links");
  LittleFS.mkdir(base + "/ideas");
  JsonDocument project;
  project["id"] = id;
  project["title"] = title;
  project["description"] = input["description"] | "";
  project["status"] = "active";
  project["createdAt"] = createdAt;
  JsonArray projectTags = project["tagIds"].to<JsonArray>();
  if (input["tagIds"].is<JsonArray>()) for (JsonVariant value : input["tagIds"].as<JsonArray>()) projectTags.add(value.as<String>());
  String projectJson;
  serializeJson(project, projectJson);
  if (!writeFile(base + "/project.json", projectJson)) return sendError(507, "Speicher voll");
  if (!writeFile(base + "/README.md", projectMarkdown(project))) { deleteTree(base); return sendError(507, "Projektdateien konnten nicht vollständig gespeichert werden"); }
  JsonDocument access;
  access["users"].add(session->userId);
  String accessJson;
  serializeJson(access, accessJson);
  if (!writeFile(base + "/access.json", accessJson)) { deleteTree(base); return sendError(507, "Projektfreigaben konnten nicht gespeichert werden"); }
  project["url"] = "/p/" + id;
  sendJson(201, project);
}

bool adjustProjectStartDate(const String &projectId, const String &entryDate) {
  String path = projectPath(projectId) + "/project.json";
  File file = LittleFS.open(path, "r");
  JsonDocument project;
  if (!file || deserializeJson(project, file)) return false;
  file.close();
  String currentStart = project["createdAt"] | "";
  if (validDate(currentStart) && entryDate >= currentStart) return true;
  project["createdAt"] = entryDate;
  String json;
  serializeJson(project, json);
  if (!writeFile(path, json)) return false;
  return writeFile(projectPath(projectId) + "/README.md", projectMarkdown(project));
}

void updateProject(const String &id) {
  Session *session = currentSession();
  if (!canEdit(id, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String path = projectPath(id) + "/project.json";
  File file = LittleFS.open(path, "r");
  JsonDocument project;
  if (!file || deserializeJson(project, file)) return sendError(404, "Projekt nicht gefunden");
  file.close();
  if (!input["title"].isNull()) {
    String title = input["title"] | "";
    if (title.length() < 2 || title.length() > 100) return sendError(422, "Titel muss 2–100 Zeichen haben");
    project["title"] = title;
  }
  if (!input["description"].isNull()) project["description"] = input["description"].as<String>();
  if (!input["createdAt"].isNull()) {
    String createdAt = input["createdAt"].as<String>();
    if (!validDate(createdAt)) return sendError(422, "Ein gültiges Startdatum ist erforderlich");
    project["createdAt"] = createdAt;
  }
  if (!input["status"].isNull()) {
    String status = input["status"] | "";
    if (status != "active" && status != "archived" && status != "trashed") return sendError(422, "Ungültiger Projektstatus");
    project["status"] = status;
    if (status != "trashed") project.remove("deletedAt");
  }
  if (!input["tagIds"].isNull()) {
    JsonDocument tags;
    if (!loadTags(tags)) return sendError(500, "Tags konnten nicht gelesen werden");
    if (!validateTagIds(input["tagIds"], tags)) return sendError(422, "Ungültige Tag-Auswahl");
    project.remove("tagIds");
    JsonArray projectTags = project["tagIds"].to<JsonArray>();
    for (JsonVariant value : input["tagIds"].as<JsonArray>()) projectTags.add(value.as<String>());
  }
  String json;
  serializeJson(project, json);
  if (!writeFile(path, json)) return sendError(507, "Speicher voll");
  if (!writeFile(projectPath(id) + "/README.md", projectMarkdown(project))) return sendError(507, "Markdown-Datei konnte nicht aktualisiert werden");
  project["url"] = "/p/" + id;
  sendJson(200, project);
}

void deleteProject(const String &id) {
  Session *session = currentSession();
  if (!canEdit(id, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  String path = projectPath(id) + "/project.json";
  File file = LittleFS.open(path, "r");
  JsonDocument project;
  if (!file || deserializeJson(project, file)) { if (file) file.close(); return sendError(404, "Projekt nicht gefunden"); }
  file.close();
  project["status"] = "trashed";
  project["deletedAt"] = static_cast<unsigned long>(time(nullptr));
  String json;
  serializeJson(project, json);
  if (!writeFile(path, json) || !writeFile(projectPath(id) + "/README.md", projectMarkdown(project))) return sendError(507, "Projekt konnte nicht in den Papierkorb verschoben werden");
  auditEvent(session->userId, "project.trashed", id);
  sendJson(200, project);
}

void purgeProject(const String &id) {
  Session *session = currentSession();
  if (!canEdit(id, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  File file = LittleFS.open(projectPath(id) + "/project.json", "r");
  JsonDocument project;
  if (!file || deserializeJson(project, file)) { if (file) file.close(); return sendError(404, "Projekt nicht gefunden"); }
  file.close();
  if (project["status"].as<String>() != "trashed") return sendError(409, "Nur Projekte im Papierkorb können endgültig gelöscht werden");
  if (!deleteTree(projectPath(id))) return sendError(500, "Projekt konnte nicht endgültig gelöscht werden");
  auditEvent(session->userId, "project.deleted", id);
  server.send(204);
}

void emptyTrash() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  std::vector<String> ids;
  File root = LittleFS.open("/projects");
  if (root) {
    File dir = root.openNextFile();
    while (dir) {
      if (dir.isDirectory()) {
        String path = dir.path();
        File file = LittleFS.open(path + "/project.json", "r");
        JsonDocument project;
        if (file && !deserializeJson(project, file) && project["status"].as<String>() == "trashed") ids.push_back(project["id"].as<String>());
        if (file) file.close();
      }
      dir = root.openNextFile();
    }
    root.close();
  }
  uint16_t removed = 0;
  for (const String &id : ids) if (deleteTree(projectPath(id))) ++removed;
  auditEvent(session->userId, "trash.emptied", String(removed));
  JsonDocument response;
  response["removed"] = removed;
  sendJson(200, response);
}

void getProject(const String &id) {
  Session *session = currentSession();
  if (!canAccess(id, session)) return sendError(session ? 403 : 401, "Kein Zugriff auf dieses Projekt");
  JsonDocument doc;
  File file = LittleFS.open(projectPath(id) + "/project.json", "r");
  if (!file || deserializeJson(doc, file)) return sendError(404, "Projekt nicht gefunden");
  file.close();
  JsonArray entries = doc["entries"].to<JsonArray>();
  File dir = LittleFS.open(projectPath(id) + "/entries");
  if (dir) {
    File entry = dir.openNextFile();
    while (entry) {
      if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
        JsonObject item = entries.add<JsonObject>();
        JsonDocument parsed;
        if (!deserializeJson(parsed, entry)) item.set(parsed.as<JsonObject>());
      }
      entry = dir.openNextFile();
    }
  }
  appendCollection(doc, id, "materials");
  appendCollection(doc, id, "tasks");
  appendCollection(doc, id, "contacts");
  appendCollection(doc, id, "links");
  appendCollection(doc, id, "ideas");
  sendJson(200, doc);
}

void createEntry(const String &projectId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String body = input["body"] | "";
  String next = input["nextStep"] | "";
  String title = input["title"] | "";
  String id = "entry-" + randomHex(6);
  String date = input["date"] | "";
  if (!validDate(date)) return sendError(422, "Ein gültiges Datum für den Arbeitsschritt ist erforderlich");
  if (!adjustProjectStartDate(projectId, date)) return sendError(507, "Projekt-Startdatum konnte nicht angepasst werden");
  JsonDocument entry;
  entry["id"] = id;
  entry["date"] = date;
  entry["title"] = title;
  entry["body"] = body;
  entry["nextStep"] = next;
  entry["author"] = session->userId;
  String json;
  serializeJson(entry, json);
  String base = projectPath(projectId) + "/entries/" + id;
  if (!writeFile(base + ".json", json)) return sendError(507, "Speicher voll");
  String md = "---\nid: " + id + "\ndate: " + yamlSafe(date) + "\ntitle: " + yamlSafe(title) + "\nauthor: " + yamlSafe(session->userId) + "\n---\n\n## Gemacht\n\n" + body + "\n";
  if (!writeFile(base + ".md", md)) { LittleFS.remove(base + ".json"); return sendError(507, "Arbeitsschritt konnte nicht vollständig gespeichert werden"); }
  auditEvent(session->userId, "log.created", entryAuditTarget(projectId, id, title), "entryId=" + id + ", date=" + date);
  entry["url"] = "/p/" + projectId + "/e/" + id;
  sendJson(201, entry);
}

void updateEntry(const String &projectId, const String &entryId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validId(entryId)) return sendError(400, "Ungültige ID");
  String base = projectPath(projectId) + "/entries/" + entryId;
  File file = LittleFS.open(base + ".json", "r");
  JsonDocument entry;
  if (!file || deserializeJson(entry, file)) return sendError(404, "Arbeitsschritt nicht gefunden");
  file.close();
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  if (!input["title"].isNull()) entry["title"] = input["title"].as<String>();
  if (!input["body"].isNull()) entry["body"] = input["body"].as<String>();
  if (!input["nextStep"].isNull()) entry["nextStep"] = input["nextStep"].as<String>();
  if (!input["date"].isNull()) {
    String date = input["date"].as<String>();
    if (!validDate(date)) return sendError(422, "Ein gültiges Datum für den Arbeitsschritt ist erforderlich");
    if (!adjustProjectStartDate(projectId, date)) return sendError(507, "Projekt-Startdatum konnte nicht angepasst werden");
    entry["date"] = date;
  }
  String json;
  serializeJson(entry, json);
  if (!writeFile(base + ".json", json)) return sendError(507, "Speicher voll");
  String sourceTaskId = entry["sourceTaskId"] | "";
  String sourceTaskLine = sourceTaskId.length() ? "\nsourceTaskId: " + yamlSafe(sourceTaskId) : "";
  String sortOrderLine = entry["sortOrder"].is<int>() ? "\nsortOrder: " + String(entry["sortOrder"].as<int>()) : "";
  String md = "---\nid: " + entryId + "\ndate: " + yamlSafe(entry["date"].as<String>()) + "\ntitle: " + yamlSafe(entry["title"].as<String>()) + "\nauthor: " + yamlSafe(entry["author"].as<String>()) + sourceTaskLine + sortOrderLine + "\n---\n\n## Gemacht\n\n" + entry["body"].as<String>() + "\n";
  if (!writeFile(base + ".md", md)) return sendError(507, "Markdown-Datei konnte nicht aktualisiert werden");
  auditEvent(session->userId, "log.updated", entryAuditTarget(projectId, entryId, entry["title"].as<String>()), "entryId=" + entryId + ", date=" + entry["date"].as<String>());
  entry["url"] = "/p/" + projectId + "/e/" + entryId;
  sendJson(200, entry);
}

void deleteEntry(const String &projectId, const String &entryId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validId(entryId)) return sendError(400, "Ungültige ID");
  String base = projectPath(projectId) + "/entries/" + entryId;
  bool existed = LittleFS.exists(base + ".json") || LittleFS.exists(base + ".md");
  if (!existed) return sendError(404, "Arbeitsschritt nicht gefunden");
  String title;
  File file = LittleFS.open(base + ".json", "r");
  JsonDocument entry;
  if (file && !deserializeJson(entry, file)) title = entry["title"] | "";
  if (file) file.close();
  bool jsonRemoved = !LittleFS.exists(base + ".json") || LittleFS.remove(base + ".json");
  bool markdownRemoved = !LittleFS.exists(base + ".md") || LittleFS.remove(base + ".md");
  if (!jsonRemoved || !markdownRemoved) return sendError(500, "Arbeitsschritt konnte nicht gelöscht werden");
  auditEvent(session->userId, "log.deleted", entryAuditTarget(projectId, entryId, title), "entryId=" + entryId);
  server.send(204);
}

void reopenEntry(const String &projectId, const String &entryId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validId(entryId)) return sendError(400, "Ungültige ID");
  String entryBase = projectPath(projectId) + "/entries/" + entryId;
  File entryFile = LittleFS.open(entryBase + ".json", "r");
  JsonDocument entry;
  if (!entryFile || deserializeJson(entry, entryFile)) { if (entryFile) entryFile.close(); return sendError(404, "Erledigter Arbeitsschritt nicht gefunden"); }
  entryFile.close();
  String taskId = entry["sourceTaskId"] | "";
  if (!validId(taskId)) taskId = "task-entry-" + sha256(entryId).substring(0, 12);
  String taskBase = projectPath(projectId) + "/tasks/" + taskId;
  JsonDocument task;
  File taskFile = LittleFS.open(taskBase + ".json", "r");
  if (taskFile) {
    if (deserializeJson(task, taskFile)) { taskFile.close(); return sendError(500, "Ursprünglicher Arbeitsschritt konnte nicht gelesen werden"); }
    taskFile.close();
  } else {
    task["id"] = taskId;
    task["createdAt"] = entry["date"] | "";
    task["author"] = session->userId;
    task["title"] = entry["title"] | "Arbeitsschritt fortsetzen";
    task["description"] = entry["body"] | "";
    task["priority"] = "Normal";
  }
  task["status"] = "Offen";
  task.remove("completedAt");
  task.remove("completedEntryId");
  task.remove("sortOrder");
  String taskJson;
  serializeJson(task, taskJson);
  if (!writeFile(taskBase + ".json", taskJson) || !writeFile(taskBase + ".md", itemMarkdown("tasks", task))) return sendError(507, "Arbeitsschritt konnte nicht zurückgestellt werden");
  bool jsonRemoved = LittleFS.remove(entryBase + ".json");
  bool markdownRemoved = !LittleFS.exists(entryBase + ".md") || LittleFS.remove(entryBase + ".md");
  if (!jsonRemoved || !markdownRemoved) return sendError(500, "Erledigter Arbeitsschritt konnte nicht entfernt werden");
  auditEvent(session->userId, "log.reopened", entryAuditTarget(projectId, entryId, entry["title"].as<String>()), "entryId=" + entryId + ", taskId=" + taskId);
  sendJson(200, task);
}

void createItem(const String &projectId, const String &collection) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validCollection(collection)) return sendError(400, "Ungültiger Bereich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String primary = collection == "materials" || collection == "contacts" ? String(input["name"] | "") : String(input["title"] | "");
  if (primary.length() < 1 || primary.length() > 100) return sendError(422, "Eine Bezeichnung ist erforderlich");
  if (collection == "tasks") {
    String status = input["status"] | "Offen";
    String priority = input["priority"] | "Normal";
    String dueDate = input["dueDate"] | "";
    if (status != "Offen" && status != "In Arbeit" && status != "Erledigt") return sendError(422, "Ungültiger Arbeitsschrittstatus");
    if (priority != "Niedrig" && priority != "Normal" && priority != "Hoch") return sendError(422, "Ungültige Priorität");
    if (dueDate.length() && !validDate(dueDate)) return sendError(422, "Ungültiges Fälligkeitsdatum");
  }
  String id = collection.substring(0, collection.length() - 1) + "-" + randomHex(6);
  JsonDocument item;
  item["id"] = id;
  item["createdAt"] = input["createdAt"] | "";
  item["author"] = session->userId;
  for (const char *field : kItemFields) if (!input[field].isNull()) item[field] = input[field].as<String>();
  if (collection == "tasks") {
    if (item["status"].isNull()) item["status"] = "Offen";
    if (item["priority"].isNull()) item["priority"] = "Normal";
  }
  String json;
  serializeJson(item, json);
  String base = projectPath(projectId) + "/" + collection + "/" + id;
  if (!writeFile(base + ".json", json) || !writeFile(base + ".md", itemMarkdown(collection, item))) return sendError(507, "Speicher voll");
  sendJson(201, item);
}

void updateItem(const String &projectId, const String &collection, const String &itemId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validCollection(collection) || !validId(itemId)) return sendError(400, "Ungültige ID");
  String base = projectPath(projectId) + "/" + collection + "/" + itemId;
  File file = LittleFS.open(base + ".json", "r");
  JsonDocument item;
  if (!file || deserializeJson(item, file)) return sendError(404, "Eintrag nicht gefunden");
  file.close();
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  for (const char *field : kItemFields) if (!input[field].isNull()) item[field] = input[field].as<String>();
  String primary = collection == "materials" || collection == "contacts" ? String(item["name"] | "") : String(item["title"] | "");
  if (!primary.length()) return sendError(422, "Eine Bezeichnung ist erforderlich");
  if (collection == "tasks") {
    String status = item["status"] | "Offen";
    String priority = item["priority"] | "Normal";
    String dueDate = item["dueDate"] | "";
    if (status != "Offen" && status != "In Arbeit" && status != "Erledigt") return sendError(422, "Ungültiger Arbeitsschrittstatus");
    if (priority != "Niedrig" && priority != "Normal" && priority != "Hoch") return sendError(422, "Ungültige Priorität");
    if (dueDate.length() && !validDate(dueDate)) return sendError(422, "Ungültiges Fälligkeitsdatum");
  }
  String json;
  serializeJson(item, json);
  if (!writeFile(base + ".json", json) || !writeFile(base + ".md", itemMarkdown(collection, item))) return sendError(507, "Speicher voll");
  sendJson(200, item);
}

void deleteItem(const String &projectId, const String &collection, const String &itemId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validCollection(collection) || !validId(itemId)) return sendError(400, "Ungültige ID");
  String base = projectPath(projectId) + "/" + collection + "/" + itemId;
  bool jsonRemoved = !LittleFS.exists(base + ".json") || LittleFS.remove(base + ".json");
  bool markdownRemoved = !LittleFS.exists(base + ".md") || LittleFS.remove(base + ".md");
  if (!jsonRemoved || !markdownRemoved) return sendError(500, "Eintrag konnte nicht gelöscht werden");
  server.send(204);
}

void reorderItems(const String &projectId, const String &collection) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (collection != "entries" && !validCollection(collection)) return sendError(400, "Dieser Bereich kann nicht sortiert werden");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  if (!input["ids"].is<JsonArray>()) return sendError(422, "Eine Reihenfolge ist erforderlich");
  JsonArray ids = input["ids"].as<JsonArray>();
  if (ids.size() > 500) return sendError(422, "Zu viele Einträge");
  String folder = projectPath(projectId) + "/" + collection + "/";
  for (size_t index = 0; index < ids.size(); index++) {
    String itemId = ids[index].as<String>();
    if (!validId(itemId) || !LittleFS.exists(folder + itemId + ".json")) return sendError(404, "Ein Eintrag der Reihenfolge wurde nicht gefunden");
    for (size_t previous = 0; previous < index; previous++) if (itemId == ids[previous].as<String>()) return sendError(422, "Ein Eintrag ist mehrfach enthalten");
  }
  for (size_t index = 0; index < ids.size(); index++) {
    String itemId = ids[index].as<String>();
    String base = folder + itemId;
    File file = LittleFS.open(base + ".json", "r");
    JsonDocument item;
    if (!file || deserializeJson(item, file)) { if (file) file.close(); return sendError(500, "Reihenfolge konnte nicht gelesen werden"); }
    file.close();
    item["sortOrder"] = index;
    String json;
    serializeJson(item, json);
    String markdown;
    if (collection == "entries") {
      String sourceTaskId = item["sourceTaskId"] | "";
      String sourceTaskLine = sourceTaskId.length() ? "\nsourceTaskId: " + yamlSafe(sourceTaskId) : "";
      markdown = "---\nid: " + itemId + "\ndate: " + yamlSafe(item["date"].as<String>()) + "\ntitle: " + yamlSafe(item["title"].as<String>()) + "\nauthor: " + yamlSafe(item["author"].as<String>()) + sourceTaskLine + "\nsortOrder: " + String(index) + "\n---\n\n## Gemacht\n\n" + String(item["body"] | "") + "\n";
    } else markdown = itemMarkdown(collection, item);
    if (!writeFile(base + ".json", json) || !writeFile(base + ".md", markdown)) return sendError(507, "Reihenfolge konnte nicht gespeichert werden");
  }
  auditEvent(session->userId, collection == "entries" ? "logs.reordered" : collection + ".reordered", projectId, "count=" + String(ids.size()));
  JsonDocument response;
  response["ok"] = true;
  sendJson(200, response);
}

void completeTask(const String &projectId, const String &taskId) {
  Session *session = currentSession();
  if (!canEdit(projectId, session)) return sendError(session ? 403 : 401, "Keine Bearbeitungsrechte für dieses Projekt");
  if (!validId(taskId)) return sendError(400, "Ungültige Arbeitsschritt-ID");
  String taskBase = projectPath(projectId) + "/tasks/" + taskId;
  File file = LittleFS.open(taskBase + ".json", "r");
  JsonDocument task;
  if (!file || deserializeJson(task, file)) return sendError(404, "Arbeitsschritt nicht gefunden");
  file.close();
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String date = input["date"] | "";
  if (!validDate(date)) return sendError(422, "Ein gültiges Abschlussdatum ist erforderlich");
  String entryId = "entry-task-" + sha256(taskId).substring(0, 12);
  String entryBase = projectPath(projectId) + "/entries/" + entryId;
  if (task["status"].as<String>() == "Erledigt" && LittleFS.exists(entryBase + ".json")) {
    JsonDocument existing;
    File existingFile = LittleFS.open(entryBase + ".json", "r");
    if (existingFile && !deserializeJson(existing, existingFile)) { existingFile.close(); return sendJson(200, existing); }
    if (existingFile) existingFile.close();
  }
  if (!adjustProjectStartDate(projectId, date)) return sendError(507, "Projekt-Startdatum konnte nicht angepasst werden");
  String title = task["title"] | "Arbeitsschritt erledigt";
  String description = task["description"] | "";
  JsonDocument entry;
  entry["id"] = entryId;
  entry["date"] = date;
  entry["title"] = title;
  entry["body"] = description;
  entry["nextStep"] = "";
  entry["author"] = session->userId;
  entry["sourceTaskId"] = taskId;
  String entryJson;
  serializeJson(entry, entryJson);
  String entryMarkdown = "---\nid: " + entryId + "\ndate: " + yamlSafe(date) + "\ntitle: " + yamlSafe(title) + "\nauthor: " + yamlSafe(session->userId) + "\nsourceTaskId: " + yamlSafe(taskId) + "\n---\n\n## Gemacht\n\n" + description + "\n";
  if (!writeFile(entryBase + ".json", entryJson) || !writeFile(entryBase + ".md", entryMarkdown)) {
    LittleFS.remove(entryBase + ".json"); LittleFS.remove(entryBase + ".md");
    return sendError(507, "Erledigter Arbeitsschritt konnte nicht gespeichert werden");
  }
  task["status"] = "Erledigt";
  task["completedAt"] = date;
  task["completedEntryId"] = entryId;
  String taskJson;
  serializeJson(task, taskJson);
  if (!writeFile(taskBase + ".json", taskJson) || !writeFile(taskBase + ".md", itemMarkdown("tasks", task))) {
    LittleFS.remove(entryBase + ".json"); LittleFS.remove(entryBase + ".md");
    return sendError(507, "Arbeitsschritt konnte nicht abgeschlossen werden");
  }
  auditEvent(session->userId, "log.created", entryAuditTarget(projectId, entryId, title), "entryId=" + entryId + ", sourceTaskId=" + taskId + ", date=" + date);
  entry["url"] = "/p/" + projectId + "/e/" + entryId;
  sendJson(201, entry);
}

bool validHexString(const String &value, size_t length) {
  if (value.length() != length) return false;
  for (char c : value) if (!isxdigit(c)) return false;
  return true;
}

void exportUserAccounts() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument stored;
  if (!loadUsers(stored)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonDocument response;
  JsonArray accounts = response["accounts"].to<JsonArray>();
  for (JsonObjectConst source : stored["users"].as<JsonArrayConst>()) {
    JsonObject account = accounts.add<JsonObject>();
    account["id"] = source["id"].as<String>();
    String name = source["name"] | "";
    account["name"] = name.length() ? name : source["id"].as<String>();
    account["role"] = userRole(source);
    account["active"] = userActive(source);
    account["projectAccessMode"] = userProjectAccessMode(source);
    account["mustChangePassword"] = source["mustChangePassword"] | false;
    account["createdAt"] = source["createdAt"] | "";
    account["lastLoginAt"] = source["lastLoginAt"] | "";
    account["salt"] = source["salt"].as<String>();
    account["passwordHash"] = source["passwordHash"].as<String>();
    addProjectAssignments(account["projectIds"].to<JsonArray>(), source["id"].as<String>());
  }
  auditEvent(session->userId, "data.users_exported", String(accounts.size()));
  sendJson(200, response);
}

bool validImportedAccount(JsonObjectConst account) {
  String id = account["id"] | "";
  String role = account["role"] | "";
  String mode = account["projectAccessMode"] | "include";
  return validId(id) && id.length() <= 32 && validRole(role) &&
         (mode == "include" || mode == "exclude" || mode == "all") && validHexString(account["salt"].as<String>(), 32) &&
         validHexString(account["passwordHash"].as<String>(), 64) && account["projectIds"].is<JsonArray>();
}

void importUserAccounts() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  if (!input["accounts"].is<JsonArray>()) return sendError(422, "Benutzerkonten fehlen im Backup");
  JsonArrayConst incoming = input["accounts"].as<JsonArrayConst>();
  if (!incoming.size() || incoming.size() > 64) return sendError(422, "Das Backup muss 1–64 Benutzerkonten enthalten");
  for (JsonObjectConst account : incoming) if (!validImportedAccount(account)) return sendError(422, "Ungültiges Benutzerkonto im Backup");
  bool replace = input["replace"] | false;
  JsonDocument stored;
  if (!loadUsers(stored)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonArray users = stored["users"].as<JsonArray>();
  JsonDocument changed;
  JsonArray changedIds = changed.to<JsonArray>();
  uint16_t imported = 0;
  uint16_t skipped = 0;
  for (JsonObjectConst account : incoming) {
    String id = account["id"].as<String>();
    JsonObject target;
    for (JsonObject user : users) if (user["id"].as<String>() == id) { target = user; break; }
    if (!target.isNull() && !replace) { ++skipped; continue; }
    if (id == session->userId && (account["role"].as<String>() != "admin" || !(account["active"] | true))) return sendError(422, "Der angemeldete Administrator muss aktiv bleiben");
    if (target.isNull()) target = users.add<JsonObject>();
    target["id"] = id;
    String name = account["name"] | "";
    target["name"] = name.length() ? name : id;
    target["role"] = account["role"].as<String>();
    target["admin"] = account["role"].as<String>() == "admin";
    target["active"] = account["active"].isNull() ? true : account["active"].as<bool>();
    target["projectAccessMode"] = account["projectAccessMode"].as<String>();
    target["mustChangePassword"] = account["mustChangePassword"] | false;
    target["createdAt"] = account["createdAt"] | "";
    target["lastLoginAt"] = account["lastLoginAt"] | "";
    target["salt"] = account["salt"].as<String>();
    target["passwordHash"] = account["passwordHash"].as<String>();
    changedIds.add(id);
    ++imported;
  }
  if (activeAdminCount(stored["users"].as<JsonArrayConst>()) == 0) return sendError(422, "Mindestens ein aktiver Administrator ist erforderlich");
  if (!saveUsers(stored)) return sendError(507, "Benutzerkonten konnten nicht gespeichert werden");
  for (JsonObjectConst account : incoming) {
    String id = account["id"].as<String>();
    bool changedAccount = false;
    for (JsonVariant changedId : changedIds) if (changedId.as<String>() == id) { changedAccount = true; break; }
    if (!changedAccount) continue;
    if (!updateProjectAssignments(id, account["projectIds"].as<JsonArrayConst>())) return sendError(507, "Projektfreigaben konnten nicht vollständig wiederhergestellt werden");
    if (id == session->userId) {
      String name = account["name"] | "";
      session->name = name.length() ? name : id;
      session->role = account["role"].as<String>();
      session->admin = true;
      session->projectAccessMode = userProjectAccessMode(account);
      session->startPage = userStartPage(account);
      session->showOverviewSummary = userOverviewFlag(account, "showOverviewSummary");
      session->showOverviewRecent = userOverviewFlag(account, "showOverviewRecent");
      session->showOverviewActivity = userOverviewFlag(account, "showOverviewActivity");
      session->showOverviewTimeline = userOverviewFlag(account, "showOverviewTimeline");
      session->overviewRecentCount = userOverviewRecentCount(account);
      session->mustChangePassword = account["mustChangePassword"] | false;
      invalidateUserSessions(id, session);
    } else invalidateUserSessions(id);
  }
  auditEvent(session->userId, "data.users_imported", String(imported), "skipped=" + String(skipped));
  JsonDocument response;
  response["imported"] = imported;
  response["skipped"] = skipped;
  sendJson(200, response);
}

bool validateImportedItems(JsonObject project, const String &collection) {
  if (!project[collection].is<JsonArray>()) return false;
  for (JsonVariant value : project[collection].as<JsonArray>()) {
    JsonObject item = value.as<JsonObject>();
    String id = item["id"] | "";
    if (!validId(id)) return false;
  }
  return true;
}

bool writeImportedProject(JsonObject project, JsonArray accessUsers) {
  String id = project["id"] | "";
  String base = projectPath(id);
  LittleFS.mkdir("/projects");
  if (!LittleFS.mkdir(base) && !LittleFS.exists(base)) return false;
  for (const String &collection : {String("entries"), String("tasks"), String("materials"), String("contacts"), String("links"), String("ideas")}) {
    if (!LittleFS.mkdir(base + "/" + collection) && !LittleFS.exists(base + "/" + collection)) return false;
  }

  JsonDocument projectFile;
  projectFile["id"] = id;
  projectFile["title"] = project["title"].as<String>();
  projectFile["description"] = project["description"] | "";
  projectFile["status"] = project["status"] | "active";
  projectFile["createdAt"] = project["createdAt"] | "";
  JsonArray importedTags = projectFile["tagIds"].to<JsonArray>();
  if (project["tagIds"].is<JsonArray>()) for (JsonVariant value : project["tagIds"].as<JsonArray>()) importedTags.add(value.as<String>());
  String projectJson;
  serializeJson(projectFile, projectJson);
  if (!writeFile(base + "/project.json", projectJson)) return false;
  if (!writeFile(base + "/README.md", projectMarkdown(projectFile))) return false;

  JsonDocument access;
  JsonArray users = access["users"].to<JsonArray>();
  for (JsonVariant value : accessUsers) {
    String userId = value.as<String>();
    if (validId(userId)) users.add(userId);
  }
  String accessJson;
  serializeJson(access, accessJson);
  if (!writeFile(base + "/access.json", accessJson)) return false;

  for (JsonVariant value : project["entries"].as<JsonArray>()) {
    JsonObject source = value.as<JsonObject>();
    JsonDocument entry;
    entry.set(source);
    String entryId = entry["id"].as<String>();
    String json;
    serializeJson(entry, json);
    String entryBase = base + "/entries/" + entryId;
    String sourceTaskId = entry["sourceTaskId"] | "";
    String sourceTaskLine = sourceTaskId.length() ? "\nsourceTaskId: " + yamlSafe(sourceTaskId) : "";
    String sortOrderLine = entry["sortOrder"].is<int>() ? "\nsortOrder: " + String(entry["sortOrder"].as<int>()) : "";
    String md = "---\nid: " + entryId + "\ndate: " + yamlSafe(entry["date"].as<String>()) + "\ntitle: " + yamlSafe(entry["title"].as<String>()) + "\nauthor: " + yamlSafe(entry["author"].as<String>()) + sourceTaskLine + sortOrderLine + "\n---\n\n## Gemacht\n\n" + String(entry["body"] | "") + "\n";
    if (!writeFile(entryBase + ".json", json) || !writeFile(entryBase + ".md", md)) return false;
  }

  for (const String &collection : {String("tasks"), String("materials"), String("contacts"), String("links"), String("ideas")}) {
    for (JsonVariant value : project[collection].as<JsonArray>()) {
      JsonDocument item;
      item.set(value);
      String itemId = item["id"].as<String>();
      String json;
      serializeJson(item, json);
      String itemBase = base + "/" + collection + "/" + itemId;
      if (!writeFile(itemBase + ".json", json) || !writeFile(itemBase + ".md", itemMarkdown(collection, item))) return false;
    }
  }
  return true;
}

void importProject() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  JsonObject project = input["project"].as<JsonObject>();
  String id = project["id"] | "";
  String title = project["title"] | "";
  String status = project["status"] | "active";
  if (!validId(id) || title.length() < 2 || title.length() > 100 || (status != "active" && status != "archived")) return sendError(422, "Ungültige Projektdaten im Backup");
  if (!project["tasks"].is<JsonArray>()) project["tasks"].to<JsonArray>();
  for (const String &collection : {String("entries"), String("tasks"), String("materials"), String("contacts"), String("links"), String("ideas")}) {
    if (!validateImportedItems(project, collection)) return sendError(422, "Ungültige Einträge im Backup");
  }
  JsonDocument storedTags;
  if (!loadTags(storedTags)) return sendError(500, "Tags konnten nicht gelesen werden");
  JsonDocument importedProject;
  importedProject.set(project);
  importedProject.remove("tagIds");
  JsonArray mappedTagIds = importedProject["tagIds"].to<JsonArray>();
  bool tagsChanged = false;
  if (project["tagIds"].is<JsonArray>()) {
    if (project["tagIds"].as<JsonArray>().size() > 20) return sendError(422, "Zu viele Tags im Projekt-Backup");
    for (JsonVariant value : project["tagIds"].as<JsonArray>()) {
      String sourceId = value.as<String>();
      JsonObject target = findTag(storedTags, sourceId);
      if (target.isNull()) {
        JsonObject definition;
        if (input["tags"].is<JsonArray>()) {
          for (JsonObject candidate : input["tags"].as<JsonArray>()) if (candidate["id"].as<String>() == sourceId) { definition = candidate; break; }
        }
        String name = definition.isNull() ? "" : definition["name"].as<String>();
        name.trim();
        if (!validTagName(name)) return sendError(422, "Für einen Projekt-Tag fehlt eine gültige Definition");
        target = findTagByName(storedTags, name);
        if (target.isNull()) {
          target = storedTags["tags"].as<JsonArray>().add<JsonObject>();
          target["id"] = "tag-" + slugify(name) + "-" + randomHex(2);
          target["name"] = name;
          target["normalizedName"] = normalizeTagName(name);
          target["active"] = definition["active"].isNull() ? true : definition["active"].as<bool>();
          target["createdAt"] = currentIsoTime();
          tagsChanged = true;
        }
      }
      String targetId = target["id"].as<String>();
      bool duplicate = false;
      for (JsonVariant existing : mappedTagIds) if (existing.as<String>() == targetId) { duplicate = true; break; }
      if (!duplicate) mappedTagIds.add(targetId);
    }
  }
  if (tagsChanged && !saveTags(storedTags)) return sendError(507, "Tags aus dem Backup konnten nicht gespeichert werden");
  bool exists = LittleFS.exists(projectPath(id));
  bool replace = input["replace"] | false;
  if (exists && !replace) {
    JsonDocument result;
    result["id"] = id;
    result["skipped"] = true;
    return sendJson(200, result);
  }
  if (exists && !deleteTree(projectPath(id))) return sendError(500, "Vorhandenes Projekt konnte nicht ersetzt werden");
  JsonArray accessUsers = input["accessUsers"].is<JsonArray>() ? input["accessUsers"].as<JsonArray>() : JsonArray();
  if (!writeImportedProject(importedProject.as<JsonObject>(), accessUsers)) return sendError(507, "Backup konnte nicht vollständig gespeichert werden");
  auditEvent(session->userId, "data.project_imported", id, replace && exists ? "replaced" : "created");
  JsonDocument result;
  result["id"] = id;
  result["skipped"] = false;
  sendJson(201, result);
}

void clearAllContent() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  int removed = 0;
  File root = LittleFS.open("/projects");
  if (root) {
    File child = root.openNextFile();
    while (child) { if (child.isDirectory()) ++removed; child.close(); child = root.openNextFile(); }
    root.close();
    if (!deleteTree("/projects")) return sendError(500, "Projektinhalte konnten nicht gelöscht werden");
  }
  if (!LittleFS.mkdir("/projects") && !LittleFS.exists("/projects")) return sendError(507, "Projektordner konnte nicht neu angelegt werden");
  LittleFS.remove("/system/tags.json");
  auditEvent(session->userId, "system.content_cleared", String(removed));
  JsonDocument result;
  result["removed"] = removed;
  sendJson(200, result);
}

void clearOtherUsers() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (!session->admin) return sendError(403, "Admin-Rechte erforderlich");
  JsonDocument stored;
  if (!loadUsers(stored)) return sendError(500, "Benutzerdaten nicht lesbar");
  JsonDocument updated;
  JsonArray kept = updated["users"].to<JsonArray>();
  int removed = 0;
  bool currentAdminFound = false;
  for (JsonObjectConst user : stored["users"].as<JsonArrayConst>()) {
    String id = user["id"].as<String>();
    if (id == session->userId) {
      if (userRole(user) != "admin" || !userActive(user)) return sendError(422, "Der aktuelle Administrator ist nicht aktiv");
      kept.add(user);
      currentAdminFound = true;
      continue;
    }
    ++removed;
    invalidateUserSessions(id);
    JsonDocument none;
    if (!updateProjectAssignments(id, none.to<JsonArray>())) return sendError(507, "Projektfreigaben konnten nicht bereinigt werden");
  }
  if (!currentAdminFound) return sendError(500, "Aktueller Administrator wurde nicht gefunden");
  if (!saveUsers(updated)) return sendError(507, "Benutzerkonten konnten nicht zurückgesetzt werden");
  auditEvent(session->userId, "system.users_cleared", String(removed));
  JsonDocument result;
  result["removed"] = removed;
  sendJson(200, result);
}

void handleApiFallback() {
  String path = server.uri();
  Session *apiSession = currentSession();
  if (apiSession && apiSession->mustChangePassword) return sendError(428, "Passwortänderung erforderlich");
  if (path == "/api/sessions" && server.method() == HTTP_GET) return listSessions();
  if (path.startsWith("/api/sessions/") && server.method() == HTTP_DELETE) return revokeSession(path.substring(14));
  if (path == "/api/audit" && server.method() == HTTP_GET) return listAudit();
  if (path == "/api/system/content" && server.method() == HTTP_DELETE) return clearAllContent();
  if (path == "/api/system/users" && server.method() == HTTP_DELETE) return clearOtherUsers();
  if (path == "/api/users" && server.method() == HTTP_GET) return listUsers();
  if (path == "/api/users" && server.method() == HTTP_POST) return createUser();
  if (path == "/api/backup/users" && server.method() == HTTP_GET) return exportUserAccounts();
  if (path == "/api/import/users" && server.method() == HTTP_POST) return importUserAccounts();
  if (path == "/api/import/project" && server.method() == HTTP_POST) return importProject();
  if (path == "/api/tags" && server.method() == HTTP_GET) return listTags();
  if (path == "/api/tags" && server.method() == HTTP_POST) return createTag();
  if (path.startsWith("/api/tags/")) {
    String rest = path.substring(10);
    int slash = rest.indexOf('/');
    String tagId = slash < 0 ? rest : rest.substring(0, slash);
    if (!validId(tagId)) return sendError(400, "Ungültige Tag-ID");
    if (slash < 0 && server.method() == HTTP_PATCH) return updateTag(tagId);
    if (slash < 0 && server.method() == HTTP_DELETE) return deleteTag(tagId);
    if (slash >= 0 && rest.substring(slash + 1) == "merge" && server.method() == HTTP_POST) return mergeTag(tagId);
  }
  if (path.startsWith("/api/users/")) {
    String userId = path.substring(11);
    if (!validId(userId)) return sendError(400, "Ungültige Benutzer-ID");
    if (server.method() == HTTP_PATCH) return updateUser(userId);
    if (server.method() == HTTP_DELETE) return deleteUser(userId);
  }
  if (path == "/api/projects" && server.method() == HTTP_GET) return listProjects();
  if (path == "/api/projects" && server.method() == HTTP_POST) return createProject();
  if (path == "/api/projects/trash" && server.method() == HTTP_DELETE) return emptyTrash();
  if (path.startsWith("/api/projects/")) {
    String rest = path.substring(14);
    int slash = rest.indexOf('/');
    String id = slash < 0 ? rest : rest.substring(0, slash);
    if (!validId(id)) return sendError(400, "Ungültige ID");
    if (slash < 0 && server.method() == HTTP_GET) return getProject(id);
    if (slash < 0 && server.method() == HTTP_PATCH) return updateProject(id);
    if (slash < 0 && server.method() == HTTP_DELETE) return deleteProject(id);
    if (slash >= 0) {
      String child = rest.substring(slash + 1);
      if (child == "permanent" && server.method() == HTTP_DELETE) return purgeProject(id);
      if (child == "entries" && server.method() == HTTP_POST) return createEntry(id);
      if (child == "entries/reorder" && server.method() == HTTP_POST) return reorderItems(id, "entries");
      if (child.startsWith("entries/") && child.endsWith("/reopen") && server.method() == HTTP_POST) {
        String entryId = child.substring(8, child.length() - 7);
        return reopenEntry(id, entryId);
      }
      if (child.startsWith("entries/")) {
        String entryId = child.substring(8);
        if (server.method() == HTTP_PATCH) return updateEntry(id, entryId);
        if (server.method() == HTTP_DELETE) return deleteEntry(id, entryId);
      }
      if (child == "tasks/reorder" && server.method() == HTTP_POST) return reorderItems(id, "tasks");
      if (child.startsWith("tasks/") && child.endsWith("/complete") && server.method() == HTTP_POST) {
        String taskId = child.substring(6, child.length() - 9);
        return completeTask(id, taskId);
      }
      int childSlash = child.indexOf('/');
      String collection = childSlash < 0 ? child : child.substring(0, childSlash);
      if (validCollection(collection)) {
        if (childSlash < 0 && server.method() == HTTP_POST) return createItem(id, collection);
        if (childSlash >= 0) {
          String itemId = child.substring(childSlash + 1);
          if (itemId == "reorder" && server.method() == HTTP_POST) return reorderItems(id, collection);
          if (server.method() == HTTP_PATCH) return updateItem(id, collection, itemId);
          if (server.method() == HTTP_DELETE) return deleteItem(id, collection, itemId);
        }
      }
    }
  }
  sendError(404, "API-Endpunkt nicht gefunden");
}

void serveApp() {
  File file = LittleFS.open("/index.html", "r");
  if (!file) return server.send(500, "text/plain", "Web-App fehlt. Bitte 'pio run -t uploadfs' ausführen.");
  server.streamFile(file, "text/html; charset=utf-8");
  file.close();
}

void handleSystem() {
  Session *session = currentSession();
  if (!session) return sendError(401, "Anmeldung erforderlich");
  if (session->mustChangePassword) return sendError(428, "Passwortänderung erforderlich");
  JsonDocument doc;
  String baseUrl = "http://";
  baseUrl += deviceSettings.hostname;
  baseUrl += ".local";
  doc["hostname"] = deviceSettings.hostname;
  doc["baseUrl"] = baseUrl;
  sendJson(200, doc);
}

void handleGetDeviceSettings() {
  if (!requireAuth(true)) return;
  JsonDocument doc;
  doc["wifiSsid"] = deviceSettings.wifiSsid;
  doc["wifiPasswordSet"] = deviceSettings.wifiPassword.length() > 0;
  doc["hostname"] = deviceSettings.hostname;
  doc["timezone"] = deviceSettings.timezone;
  doc["ntpPrimary"] = deviceSettings.ntpPrimary;
  doc["ntpSecondary"] = deviceSettings.ntpSecondary;
  doc["connected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["currentTime"] = currentIsoTime();
  sendJson(200, doc);
}

void handleUpdateDeviceSettings() {
  if (!requireAuth(true)) return;
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String wifiSsid = input["wifiSsid"] | deviceSettings.wifiSsid;
  String wifiPassword = input["wifiPassword"] | "";
  String hostname = input["hostname"] | deviceSettings.hostname;
  String timezone = input["timezone"] | deviceSettings.timezone;
  String ntpPrimary = input["ntpPrimary"] | deviceSettings.ntpPrimary;
  String ntpSecondary = input["ntpSecondary"] | deviceSettings.ntpSecondary;
  wifiSsid.trim(); hostname.trim(); timezone.trim(); ntpPrimary.trim(); ntpSecondary.trim();
  if (!wifiSsid.length() || wifiSsid.length() > 32) return sendError(422, "Der WLAN-Name muss 1 bis 32 Zeichen lang sein");
  if (!validHostname(hostname)) return sendError(422, "Der Gerätename darf nur Buchstaben, Zahlen und Bindestriche enthalten");
  if (!timezone.length() || timezone.length() > 96) return sendError(422, "Ungültige Zeitzone");
  if (!ntpPrimary.length() || ntpPrimary.length() > 96 || ntpSecondary.length() > 96) return sendError(422, "Ungültiger NTP-Server");
  if (wifiPassword.length() > 63) return sendError(422, "Das WLAN-Passwort ist zu lang");
  bool restartRequired = wifiSsid != deviceSettings.wifiSsid || hostname != deviceSettings.hostname || wifiPassword.length() > 0;
  deviceSettings.wifiSsid = wifiSsid;
  if (wifiPassword.length()) deviceSettings.wifiPassword = wifiPassword;
  deviceSettings.hostname = hostname;
  deviceSettings.timezone = timezone;
  deviceSettings.ntpPrimary = ntpPrimary;
  deviceSettings.ntpSecondary = ntpSecondary;
  if (!saveDeviceSettings()) return sendError(507, "Geräteeinstellungen konnten nicht gespeichert werden");
  configTzTime(deviceSettings.timezone.c_str(), deviceSettings.ntpPrimary.c_str(), deviceSettings.ntpSecondary.c_str());
  Session *session = currentSession();
  auditEvent(session ? session->userId : "system", "device.settings_updated", deviceSettings.hostname);
  JsonDocument result;
  result["saved"] = true;
  result["restartRequired"] = restartRequired;
  sendJson(200, result);
}

void handleGetSmtpSettings() {
  if (!requireAuth(true)) return;
  JsonDocument doc;
  doc["host"] = smtpSettings.host;
  doc["port"] = smtpSettings.port;
  doc["security"] = smtpSettings.security;
  doc["username"] = smtpSettings.username;
  doc["passwordSet"] = smtpSettings.password.length() > 0;
  doc["senderName"] = smtpSettings.senderName;
  doc["senderEmail"] = smtpSettings.senderEmail;
  doc["testRecipient"] = smtpSettings.testRecipient;
  doc["rootCa"] = smtpSettings.rootCa;
  doc["configured"] = smtpConfigured();
  sendJson(200, doc);
}

void handleUpdateSmtpSettings() {
  if (!requireAuth(true)) return;
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  String host = input["host"] | "";
  int port = input["port"] | 0;
  String security = input["security"] | "";
  String username = input["username"] | "";
  String password = input["password"] | "";
  String senderName = input["senderName"] | "";
  String senderEmail = input["senderEmail"] | "";
  String testRecipient = input["testRecipient"] | "";
  String rootCa = input["rootCa"] | "";
  host.trim(); username.trim(); senderName.trim(); senderEmail.trim(); testRecipient.trim(); rootCa.trim();
  if (!host.length() || host.length() > 253 || host.indexOf(' ') >= 0) return sendError(422, "Ungültiger SMTP-Server");
  if (port < 1 || port > 65535) return sendError(422, "Ungültiger SMTP-Port");
  if (security != "tls" && security != "starttls") return sendError(422, "Ungültige Verschlüsselungsart");
  if (!username.length() || username.length() > 254) return sendError(422, "Der SMTP-Benutzername fehlt oder ist zu lang");
  if (password.length() > 256) return sendError(422, "Das SMTP-Passwort ist zu lang");
  if (!senderName.length() || senderName.length() > 80) return sendError(422, "Ungültiger Absendername");
  if (!validEmail(senderEmail) || !validEmail(testRecipient)) return sendError(422, "Ungültige E-Mail-Adresse");
  if (rootCa.length() > 12288 || rootCa.indexOf("-----BEGIN CERTIFICATE-----") < 0 || rootCa.indexOf("-----END CERTIFICATE-----") < 0) return sendError(422, "Bitte ein gültiges CA-Zertifikat im PEM-Format eintragen");
  smtpSettings.host = host;
  smtpSettings.port = static_cast<uint16_t>(port);
  smtpSettings.security = security;
  smtpSettings.username = username;
  if (password.length()) smtpSettings.password = password;
  smtpSettings.senderName = senderName;
  smtpSettings.senderEmail = senderEmail;
  smtpSettings.testRecipient = testRecipient;
  smtpSettings.rootCa = rootCa;
  if (!saveSmtpSettings()) return sendError(507, "SMTP-Konfiguration konnte nicht gespeichert werden");
  Session *session = currentSession();
  auditEvent(session ? session->userId : "system", "smtp.settings_updated", smtpSettings.host);
  JsonDocument result;
  result["saved"] = true;
  result["configured"] = smtpConfigured();
  sendJson(200, result);
}

void handleTestSmtp() {
  if (!requireAuth(true)) return;
  String error;
  if (!sendSmtpTest(error)) return sendError(502, error);
  Session *session = currentSession();
  auditEvent(session ? session->userId : "system", "smtp.test_sent", smtpSettings.testRecipient);
  JsonDocument result;
  result["sent"] = true;
  result["recipient"] = smtpSettings.testRecipient;
  sendJson(200, result);
}

void handleGetBackupSchedule() {
  if (!requireAuth(true)) return;
  JsonDocument doc;
  doc["enabled"] = backupSchedule.enabled;
  doc["recipient"] = backupSchedule.recipient;
  doc["scope"] = backupSchedule.scope;
  doc["intervalDays"] = backupSchedule.intervalDays;
  doc["nextRunAt"] = static_cast<int64_t>(backupSchedule.nextRunAt);
  doc["lastSentAt"] = static_cast<int64_t>(backupSchedule.lastSentAt);
  doc["lastStatus"] = backupSchedule.lastStatus;
  sendJson(200, doc);
}

void handleUpdateBackupSchedule() {
  if (!requireAuth(true)) return;
  JsonDocument input;
  if (deserializeJson(input, jsonBody())) return sendError(400, "Ungültige Anfrage");
  bool enabled = input["enabled"] | false;
  String recipient = input["recipient"] | "";
  String scope = input["scope"] | "projects";
  int intervalDays = input["intervalDays"] | 7;
  recipient.trim();
  if (!validEmail(recipient)) return sendError(422, "Ungültige Backup-Empfängeradresse");
  if (scope != "projects" && scope != "users" && scope != "both") return sendError(422, "Ungültiger Sicherungsumfang");
  if (intervalDays < 1 || intervalDays > 365) return sendError(422, "Das Intervall muss zwischen 1 und 365 Tagen liegen");
  if (enabled && !smtpConfigured()) return sendError(422, "Vor dem Aktivieren muss SMTP vollständig eingerichtet sein");
  time_t now = time(nullptr);
  if (enabled && now < 1577836800) return sendError(503, "Die Systemzeit ist noch nicht synchronisiert");
  bool reschedule = enabled && (!backupSchedule.enabled || recipient != backupSchedule.recipient || scope != backupSchedule.scope || intervalDays != backupSchedule.intervalDays);
  backupSchedule.enabled = enabled;
  backupSchedule.recipient = recipient;
  backupSchedule.scope = scope;
  backupSchedule.intervalDays = static_cast<uint16_t>(intervalDays);
  if (reschedule) backupSchedule.nextRunAt = now + static_cast<time_t>(intervalDays) * 86400;
  if (!enabled) backupSchedule.nextRunAt = 0;
  if (!saveBackupSchedule()) return sendError(507, "Backup-Zeitplan konnte nicht gespeichert werden");
  Session *session = currentSession();
  auditEvent(session ? session->userId : "system", "backup.schedule_updated", enabled ? "aktiv" : "inaktiv");
  JsonDocument result;
  result["saved"] = true;
  result["nextRunAt"] = static_cast<int64_t>(backupSchedule.nextRunAt);
  sendJson(200, result);
}

void handleSendBackupNow() {
  if (!requireAuth(true)) return;
  String error;
  if (!sendBackupNow(error)) {
    backupSchedule.lastStatus = "Fehlgeschlagen: " + error;
    saveBackupSchedule();
    return sendError(502, error);
  }
  time_t now = time(nullptr);
  backupSchedule.lastSentAt = now;
  backupSchedule.lastStatus = "Erfolgreich versendet";
  if (backupSchedule.enabled) backupSchedule.nextRunAt = now + static_cast<time_t>(backupSchedule.intervalDays) * 86400;
  saveBackupSchedule();
  Session *session = currentSession();
  auditEvent(session ? session->userId : "system", "backup.sent", backupSchedule.recipient);
  JsonDocument result;
  result["sent"] = true;
  result["recipient"] = backupSchedule.recipient;
  sendJson(200, result);
}

void processScheduledBackup() {
  if (millis() - lastBackupScheduleCheck < 60000) return;
  lastBackupScheduleCheck = millis();
  time_t now = time(nullptr);
  if (!backupSchedule.enabled || backupSchedule.nextRunAt <= 0 || now < backupSchedule.nextRunAt || WiFi.status() != WL_CONNECTED) return;
  String error;
  if (sendBackupNow(error)) {
    backupSchedule.lastSentAt = now;
    backupSchedule.lastStatus = "Erfolgreich versendet";
    backupSchedule.nextRunAt = now + static_cast<time_t>(backupSchedule.intervalDays) * 86400;
    auditEvent("system", "backup.sent", backupSchedule.recipient);
  } else {
    backupSchedule.lastStatus = "Fehlgeschlagen: " + error;
    backupSchedule.nextRunAt = now + 6 * 3600;
    auditEvent("system", "backup.failed", error);
  }
  saveBackupSchedule();
}
}  // namespace

void setup() {
  Serial.begin(115200);
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS konnte nicht gestartet werden");
    return;
  }
  recoverAtomicWrites();
  loadDeviceSettings();
  loadSmtpSettings();
  loadBackupSchedule();
  ensureBootstrapUser();
  WiFi.setHostname(deviceSettings.hostname.c_str());
  WiFi.begin(deviceSettings.wifiSsid.c_str(), deviceSettings.wifiPassword.c_str());
  Serial.print("Verbinde WLAN");
  for (int i = 0; WiFi.status() != WL_CONNECTED && i < 60; ++i) { delay(500); Serial.print('.'); }
  Serial.printf("\nMake:Log: http://%s/\n", WiFi.localIP().toString().c_str());
  if (WiFi.status() == WL_CONNECTED && MDNS.begin(deviceSettings.hostname.c_str())) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Dauerhafte lokale Adresse: http://%s.local/\n", deviceSettings.hostname.c_str());
  }
  configTzTime(deviceSettings.timezone.c_str(), deviceSettings.ntpPrimary.c_str(), deviceSettings.ntpSecondary.c_str());
  const char *headers[] = {"Cookie", "User-Agent"};
  server.collectHeaders(headers, 2);
  server.on("/api/login", HTTP_POST, handleLogin);
  server.on("/api/logout", HTTP_POST, handleLogout);
  server.on("/api/me", HTTP_GET, handleMe);
  server.on("/api/account/password", HTTP_POST, handleChangePassword);
  server.on("/api/account/preferences", HTTP_PATCH, handleUpdatePreferences);
  server.on("/api/system", HTTP_GET, handleSystem);
  server.on("/api/settings/device", HTTP_GET, handleGetDeviceSettings);
  server.on("/api/settings/device", HTTP_PATCH, handleUpdateDeviceSettings);
  server.on("/api/settings/smtp", HTTP_GET, handleGetSmtpSettings);
  server.on("/api/settings/smtp", HTTP_PATCH, handleUpdateSmtpSettings);
  server.on("/api/settings/smtp/test", HTTP_POST, handleTestSmtp);
  server.on("/api/settings/backup", HTTP_GET, handleGetBackupSchedule);
  server.on("/api/settings/backup", HTTP_PATCH, handleUpdateBackupSchedule);
  server.on("/api/settings/backup/send", HTTP_POST, handleSendBackupNow);
  server.on("/styles.css", HTTP_GET, [] {
    server.sendHeader("Cache-Control", "public, max-age=86400");
    File file = LittleFS.open("/styles.css", "r");
    if (!file) return server.send(404, "text/plain", "Nicht gefunden");
    server.streamFile(file, "text/css; charset=utf-8");
    file.close();
  });
  server.on("/app.js", HTTP_GET, [] {
    server.sendHeader("Cache-Control", "public, max-age=86400");
    File file = LittleFS.open("/app.js", "r");
    if (!file) return server.send(404, "text/plain", "Nicht gefunden");
    server.streamFile(file, "application/javascript; charset=utf-8");
    file.close();
  });
  server.on("/favicon.svg", HTTP_GET, [] {
    server.sendHeader("Cache-Control", "public, max-age=86400");
    File file = LittleFS.open("/favicon.svg", "r");
    if (!file) return server.send(404, "text/plain", "Nicht gefunden");
    server.streamFile(file, "image/svg+xml; charset=utf-8");
    file.close();
  });
  server.on("/demo-data.json", HTTP_GET, [] {
    server.sendHeader("Cache-Control", "public, max-age=86400");
    File file = LittleFS.open("/demo-data.json", "r");
    if (!file) return server.send(404, "text/plain", "Nicht gefunden");
    server.streamFile(file, "application/json; charset=utf-8");
    file.close();
  });
  server.onNotFound([] {
    if (server.uri().startsWith("/api/")) return handleApiFallback();
    serveApp();
  });
  server.begin();
}

void loop() {
  server.handleClient();
  processScheduledBackup();
}
