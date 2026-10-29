/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - máy chủ Node.js/Express
 *
 * Vai trò:
 *  1. Phục vụ đúng 4 tệp giao diện (index.html, style.css, app.js, questions.json).
 *  2. Cấp phiên đăng nhập ẩn danh Supabase cho trình duyệt (POST /api/session).
 *  3. Chuyển tiếp các thao tác game tới hàm RPC trên Supabase (POST /api/rpc/:fn) bằng chính JWT của người chơi.
 *  4. Đẩy sự kiện thời gian thực tới trình duyệt qua Server-Sent Events (GET /api/events).
 */
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== Cấu hình ===== */
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const missing = [];
if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");

if (missing.length) {
  console.error("Thiếu biến môi trường: " + missing.join(", "));
  process.exit(1);
}

/* Khởi tạo Supabase Client dùng cho Auth */
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

/* Hàm RPC được phép gọi từ trình duyệt. true = thao tác làm thay đổi phòng (cần báo cho mọi người). */
const RPC = new Map([
  ["create_room", false], ["join_room", true], ["remove_player", true], ["check_round_set", false],
  ["start_round", true], ["advance_phase", true], ["end_round", true], ["set_correction", true],
  ["use_hint", true], ["submit_answer", true], ["correct_answer", true], ["new_round", true],
  ["list_rounds", false], ["get_state", false]
]);
const MAX_SSE_PER_ROOM = 60;

/* ===== Giới hạn tần suất đơn giản trong bộ nhớ ===== */
const buckets = new Map();
function allow(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n += 1;
  return b.n <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > 120000) buckets.delete(k); }, 60000).unref();

/* ===== Ứng dụng Express ===== */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: "4kb" }));

/* Phục vụ file tĩnh trực tiếp bằng fs.readFileSync chuẩn hóa MIME Types cho Vercel */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function serveStaticFile(filename, res) {
  try {
    const filePath = path.join(__dirname, filename);
    const ext = path.extname(filename);
    const content = fs.readFileSync(filePath);
    res.setHeader("Content-Type", MIME_TYPES[ext] || "text/plain");
    res.setHeader("Cache-Control", "no-cache");
    return res.send(content);
  } catch (e) {
    return res.status(404).json({ error: { message: "File not found: " + filename } });
  }
}

app.get("/", (req, res) => serveStaticFile("index.html", res));
app.get("/index.html", (req, res) => serveStaticFile("index.html", res));
app.get("/style.css", (req, res) => serveStaticFile("style.css", res));
app.get("/app.js", (req, res) => serveStaticFile("app.js", res));
app.get("/questions.json", (req, res) => serveStaticFile("questions.json", res));

app.get("/api/health", (req, res) => res.json({ ok: true }));

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  return m ? m[1] : null;
}
function fail(res, status, message, code) { return res.status(status).json({ error: { message, code: code || null } }); }
async function readJson(r) {
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return { message: text.slice(0, 200) }; }
}
function sessionPayload(j) {
  return { 
    access_token: j.access_token, 
    refresh_token: j.refresh_token, 
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) 
  };
}

/* Cấp phiên: Tạo người dùng ẩn danh chuẩn bằng Supabase Service Role Key */
app.post("/api/session", async (req, res) => {
  if (!allow("session:" + req.ip, 300, 60000)) return fail(res, 429, "Quá nhiều yêu cầu, thử lại sau ít giây.");
  const refresh = req.body && typeof req.body.refresh_token === "string" ? req.body.refresh_token : null;
  
  try {
    if (refresh) {
      const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh })
      });
      const data = await readJson(r);
      if (!r.ok || !data.access_token) {
        return fail(res, 401, (data && (data.error_description || data.msg)) || "Không thể làm mới phiên");
      }
      return res.json({ data: sessionPayload(data) });
    } else {
      const r = await fetch(SUPABASE_URL + "/auth/v1/signup", {
        method: "POST",
        headers: { 
          apikey: SUPABASE_SERVICE_ROLE_KEY, 
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "content-type": "application/json" 
        },
        body: JSON.stringify({ data: {} })
      });
      const data = await readJson(r);
      if (!r.ok || !data.access_token) {
        return fail(res, 401, (data && (data.msg || data.error_description)) || "Không thể tạo phiên ẩn danh. Hãy kiểm tra lại cấu hình Allow Anonymous sign-ins trên Supabase Dashboard.");
      }
      return res.json({ data: sessionPayload(data) });
    }
  } catch (e) {
    fail(res, 502, "Không kết nối được Supabase: " + e.message);
  }
});

/* Chuyển tiếp RPC. */
app.post("/api/rpc/:fn", async (req, res) => {
  const fn = req.params.fn;
  if (!RPC.has(fn)) return fail(res, 404, "Hàm không tồn tại");
  const token = bearer(req);
  if (!token) return fail(res, 401, "Thiếu token", "NO_TOKEN");
  if (!allow("rpc:" + crypto.createHash("sha256").update(token).digest("hex"), 240, 60000)) return fail(res, 429, "Thao tác quá nhanh, thử lại sau ít giây.");
  const args = {};
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body))
    for (const [k, v] of Object.entries(req.body)) if (/^p_[a-z_]+$/.test(k)) args[k] = v;
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { 
        apikey: SUPABASE_SERVICE_ROLE_KEY, 
        Authorization: "Bearer " + token, 
        "content-type": "application/json" 
      },
      body: JSON.stringify(args)
    });
    const body = await readJson(r);
    if (!r.ok) {
      const msg = (body && body.message) || "Lỗi máy chủ";
      return fail(res, r.status === 401 ? 401 : 400, msg, body && body.code);
    }
    res.json({ data: body });
    if (RPC.get(fn) && typeof args.p_code === "string") broadcast(args.p_code.trim().toUpperCase());
  } catch (e) { fail(res, 502, "Không kết nối được Supabase: " + e.message); }
});

/* ===== Server-Sent Events ===== */
const rooms = new Map();   // mã phòng -> Set(res)
function broadcast(code) {
  const set = rooms.get(code);
  if (!set) return;
  const msg = "event: change\ndata: " + JSON.stringify({ t: Date.now() }) + "\n\n";
  for (const r of set) { try { r.write(msg); } catch (_) { /* kết nối sẽ được dọn ở sự kiện close */ } }
}
setInterval(() => { for (const set of rooms.values()) for (const r of set) { try { r.write(": ping\n\n"); } catch (_) { /* bỏ qua */ } } }, 25000).unref();

app.get("/api/events", async (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  const token = String(req.query.token || "");
  if (!/^[A-Z0-9]{6}$/.test(code) || !token) return fail(res, 400, "Thiếu mã phòng hoặc token");
  if (!allow("sse:" + req.ip, 600, 60000)) return fail(res, 429, "Quá nhiều kết nối");
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_state", {
      method: "POST", 
      headers: { 
        apikey: SUPABASE_SERVICE_ROLE_KEY, 
        Authorization: "Bearer " + token, 
        "content-type": "application/json" 
      }, 
      body: JSON.stringify({ p_code: code })
    });
    if (r.status === 401) return fail(res, 401, "Token hết hạn", "JWT_EXPIRED");
    if (!r.ok) return fail(res, 403, "Bạn không thuộc phòng này");
  } catch (e) { return fail(res, 502, "Không kết nối được Supabase"); }
  let set = rooms.get(code);
  if (!set) { set = new Set(); rooms.set(code, set); }
  if (set.size >= MAX_SSE_PER_ROOM) return fail(res, 429, "Phòng có quá nhiều kết nối");
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\nevent: hello\ndata: {}\n\n");
  set.add(res);
  req.on("close", () => { set.delete(res); if (!set.size && rooms.get(code) === set) rooms.delete(code); });
});

/* ===== Supabase Realtime ===== */
function startRealtime() {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  admin.channel("rooms-feed")
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, payload => {
      const code = payload && payload.new && payload.new.code;
      if (code) broadcast(code);
    })
    .subscribe(status => console.log("Supabase Realtime (rooms):", status));
}

/* Fallback chuyển tiếp HTML cho Vercel */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return fail(res, 404, "Không tìm thấy API");
  }
  serveStaticFile("index.html", res);
});

app.use((err, req, res, next) => { fail(res, 400, "Yêu cầu không hợp lệ"); });

export default app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log("Giải mã bản đồ nguyên tố đang chạy tại http://localhost:" + PORT);
    try { startRealtime(); } catch (e) { console.warn("Không bật được Realtime:", e.message); }
  });
}