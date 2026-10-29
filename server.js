/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - Backend Express API cho Vercel */
import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";

/* ===== Cấu hình ===== */
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

const RPC = new Map([
  ["create_room", false], ["join_room", true], ["remove_player", true], ["check_round_set", false],
  ["start_round", true], ["advance_phase", true], ["end_round", true], ["set_correction", true],
  ["use_hint", true], ["submit_answer", true], ["correct_answer", true], ["new_round", true],
  ["list_rounds", false], ["get_state", false]
]);
const MAX_SSE_PER_ROOM = 60;

const buckets = new Map();
function allow(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n += 1;
  return b.n <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > 120000) buckets.delete(k); }, 60000).unref();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4kb" }));

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  return m ? m[1] : null;
}
function fail(res, status, message, code) { 
  return res.status(status).json({ error: { message, code: code || null } }); 
}
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

/* API Endpoints */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/session", async (req, res) => {
  if (!allow("session:" + req.ip, 300, 60000)) return fail(res, 429, "Quá nhiều yêu cầu, thử lại sau.");
  const refresh = req.body && typeof req.body.refresh_token === "string" ? req.body.refresh_token : null;
  
  try {
    const url = refresh ? SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token" : SUPABASE_URL + "/auth/v1/signup";
    const body = refresh ? { refresh_token: refresh } : { data: {} };
    const r = await fetch(url, {
      method: "POST",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await readJson(r);
    if (!r.ok || !data.access_token) return fail(res, 401, "Không thể xác thực phiên");
    return res.json({ data: sessionPayload(data) });
  } catch (e) { fail(res, 502, "Không kết nối được Supabase: " + e.message); }
});

app.post("/api/rpc/:fn", async (req, res) => {
  const fn = req.params.fn;
  if (!RPC.has(fn)) return fail(res, 404, "Hàm không tồn tại");
  const token = bearer(req);
  if (!token) return fail(res, 401, "Thiếu token", "NO_TOKEN");
  if (!allow("rpc:" + crypto.createHash("sha256").update(token).digest("hex"), 240, 60000)) return fail(res, 429, "Thao tác quá nhanh.");
  
  const args = {};
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body))
    for (const [k, v] of Object.entries(req.body)) if (/^p_[a-z_]+$/.test(k)) args[k] = v;
    
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(args)
    });
    const body = await readJson(r);
    if (!r.ok) return fail(res, r.status === 401 ? 401 : 400, (body && body.message) || "Lỗi máy chủ", body && body.code);
    res.json({ data: body });
    if (RPC.get(fn) && typeof args.p_code === "string") broadcast(args.p_code.trim().toUpperCase());
  } catch (e) { fail(res, 502, "Không kết nối được Supabase: " + e.message); }
});

/* ===== Server-Sent Events (SSE) ===== */
const rooms = new Map();
function broadcast(code) {
  const set = rooms.get(code);
  if (!set) return;
  const msg = "event: change\ndata: " + JSON.stringify({ t: Date.now() }) + "\n\n";
  for (const r of set) { try { r.write(msg); } catch (_) {} }
}
setInterval(() => { for (const set of rooms.values()) for (const r of set) { try { r.write(": ping\n\n"); } catch (_) {} } }, 25000).unref();

app.get("/api/events", async (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  const token = String(req.query.token || "");
  if (!/^[A-Z0-9]{6}$/.test(code) || !token) return fail(res, 400, "Thiếu mã phòng hoặc token");
  if (!allow("sse:" + req.ip, 600, 60000)) return fail(res, 429, "Quá nhiều kết nối");
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_state", {
      method: "POST", 
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token, "content-type": "application/json" }, 
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
    .subscribe(status => console.log("Supabase Realtime:", status));
}

app.use("/api/*", (req, res) => fail(res, 404, "Không tìm thấy API"));

export default app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log("Chạy tại http://localhost:" + PORT);
    try { startRealtime(); } catch (e) { console.warn("Lỗi Realtime:", e.message); }
  });
}