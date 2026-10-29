/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - Backend Express & Static Server cho Vercel */
import dotenv from "dotenv";
dotenv.config();

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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

const RPC = new Set([
  "create_room", "join_room", "remove_player", "check_round_set",
  "start_round", "advance_phase", "end_round", "set_correction",
  "use_hint", "submit_answer", "correct_answer", "new_round",
  "list_rounds", "get_state"
]);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4kb" }));

/* Serve các file tĩnh */
app.use(express.static(__dirname));

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

/* API Endpoints */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/session", async (req, res) => {
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
    return res.json({ data: { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + 3600 } });
  } catch (e) {
    fail(res, 502, e.message);
  }
});

app.post("/api/rpc/:fn", async (req, res) => {
  const fn = req.params.fn;
  if (!RPC.has(fn)) return fail(res, 404, "Hàm không tồn tại");
  const token = bearer(req);
  if (!token) return fail(res, 401, "Thiếu token");
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(req.body || {})
    });
    const body = await readJson(r);
    if (!r.ok) return fail(res, r.status, (body && body.message) || "Lỗi RPC");
    res.json({ data: body });
  } catch (e) { fail(res, 502, e.message); }
});

/* Trả về index.html cho tất cả các request trang web */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return fail(res, 404, "Không tìm thấy API");
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

export default app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log("Chạy tại http://localhost:" + PORT));
}