/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - Backend Express API & Phục vụ file tĩnh cho Vercel */
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== Cấu hình Biến Môi Trường ===== */
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY;

/* Khởi tạo Supabase Admin Client */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const RPC = new Set([
  "create_room", "join_room", "remove_player", "check_round_set",
  "start_round", "advance_phase", "end_round", "set_correction",
  "use_hint", "submit_answer", "correct_answer", "new_round",
  "list_rounds", "get_state"
]);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  return m ? m[1] : null;
}
function fail(res, status, message, code) { 
  return res.status(status).json({ error: { message, code: code || null } }); 
}

/* Hàm phục vụ file tĩnh an toàn */
function serveFile(res, filePath, contentType) {
  try {
    const fullPath = path.join(__dirname, filePath);
    if (fs.existsSync(fullPath)) {
      res.setHeader("Content-Type", contentType);
      return res.send(fs.readFileSync(fullPath));
    }
  } catch (e) {}
  return fail(res, 404, "File not found: " + filePath);
}

/* API Endpoints */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/session", async (req, res) => {
  const refresh = req.body && typeof req.body.refresh_token === "string" ? req.body.refresh_token : null;
  try {
    if (refresh) {
      const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refresh });
      if (error || !data.session) return fail(res, 401, (error && error.message) || "Không thể làm mới phiên");
      return res.json({
        data: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at || Math.floor(Date.now() / 1000) + 3600
        }
      });
    } else {
      const { data, error } = await supabaseAdmin.auth.signInAnonymously();
      if (error || !data.session) {
        return fail(res, 401, (error && error.message) || "Lỗi tạo phiên.");
      }
      return res.json({
        data: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at || Math.floor(Date.now() / 1000) + 3600
        }
      });
    }
  } catch (e) {
    fail(res, 502, "Lỗi kết nối Supabase: " + e.message);
  }
});

app.post("/api/rpc/:fn", async (req, res) => {
  const fn = req.params.fn;
  if (!RPC.has(fn)) return fail(res, 404, "Hàm không tồn tại");
  const token = bearer(req);
  if (!token) return fail(res, 401, "Thiếu token");

  try {
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false }
    });

    const { data, error } = await userSupabase.rpc(fn, req.body || {});
    if (error) return fail(res, 400, error.message, error.code);
    
    res.json({ data });
  } catch (e) { 
    fail(res, 502, "Lỗi xử lý RPC: " + e.message); 
  }
});

/* Phục vụ các file tĩnh */
app.get("/", (req, res) => serveFile(res, "index.html", "text/html; charset=utf-8"));
app.get("/index.html", (req, res) => serveFile(res, "index.html", "text/html; charset=utf-8"));
app.get("/style.css", (req, res) => serveFile(res, "style.css", "text/css; charset=utf-8"));
app.get("/app.js", (req, res) => serveFile(res, "app.js", "application/javascript; charset=utf-8"));
app.get("/questions.json", (req, res) => serveFile(res, "questions.json", "application/json; charset=utf-8"));

app.use("/api/*", (req, res) => fail(res, 404, "Không tìm thấy API"));

app.get("*", (req, res) => serveFile(res, "index.html", "text/html; charset=utf-8"));

export default app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log("Chạy tại http://localhost:" + PORT));
}