/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - Backend Express API & Phục vụ file tĩnh cho Vercel */
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

/* ===== Cấu hình Biến Môi Trường Tương Thích Linh Hoạt ===== */
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Thiếu cấu hình Supabase URL hoặc API Key");
}

/* Khởi tạo Admin Client ưu tiên Service Role Key (sb_secret_...) để gọi auth.signInAnonymously() thành công */
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
app.set("trust proxy", 1);
app.use(express.json({ limit: "4kb"