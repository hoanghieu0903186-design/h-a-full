/* GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - logic trình duyệt (JavaScript thuần).
 * Máy chủ (Supabase) quyết định: đồng hồ, giai đoạn, phân công, chấm điểm, quyền hỗ trợ.
 * Trình duyệt chỉ hiển thị trạng thái nhận từ hàm get_state và gửi thao tác qua các hàm RPC. */
"use strict";

/* ===== 1. KẾT NỐI: trình duyệt chỉ nói chuyện với máy chủ trò chơi (server.js) cùng địa chỉ trang web.
 * Không có URL hay khóa Supabase nào trong tệp này; chúng nằm trong .env của máy chủ. ===== */
const API = "/api";

/* ===== 2. DỮ LIỆU BẢNG TUẦN HOÀN (H đến Ca). Tọa độ hiển thị suy ra từ chu kỳ và nhóm ===== */
const ELEMENTS = [
  { atomicNumber: 1, symbol: "H", name: "Hydrogen", period: 1, group: 1, block: "s" },
  { atomicNumber: 2, symbol: "He", name: "Helium", period: 1, group: 18, block: "s" },
  { atomicNumber: 3, symbol: "Li", name: "Lithium", period: 2, group: 1, block: "s" },
  { atomicNumber: 4, symbol: "Be", name: "Beryllium", period: 2, group: 2, block: "s" },
  { atomicNumber: 5, symbol: "B", name: "Boron", period: 2, group: 13, block: "p" },
  { atomicNumber: 6, symbol: "C", name: "Carbon", period: 2, group: 14, block: "p" },
  { atomicNumber: 7, symbol: "N", name: "Nitrogen", period: 2, group: 15, block: "p" },
  { atomicNumber: 8, symbol: "O", name: "Oxygen", period: 2, group: 16, block: "p" },
  { atomicNumber: 9, symbol: "F", name: "Fluorine", period: 2, group: 17, block: "p" },
  { atomicNumber: 10, symbol: "Ne", name: "Neon", period: 2, group: 18, block: "p" },
  { atomicNumber: 11, symbol: "Na", name: "Sodium", period: 3, group: 1, block: "s" },
  { atomicNumber: 12, symbol: "Mg", name: "Magnesium", period: 3, group: 2, block: "s" },
  { atomicNumber: 13, symbol: "Al", name: "Aluminium", period: 3, group: 13, block: "p" },
  { atomicNumber: 14, symbol: "Si", name: "Silicon", period: 3, group: 14, block: "p" },
  { atomicNumber: 15, symbol: "P", name: "Phosphorus", period: 3, group: 15, block: "p" },
  { atomicNumber: 16, symbol: "S", name: "Sulfur", period: 3, group: 16, block: "p" },
  { atomicNumber: 17, symbol: "Cl", name: "Chlorine", period: 3, group: 17, block: "p" },
  { atomicNumber: 18, symbol: "Ar", name: "Argon", period: 3, group: 18, block: "p" },
  { atomicNumber: 19, symbol: "K", name: "Potassium", period: 4, group: 1, block: "s" },
  { atomicNumber: 20, symbol: "Ca", name: "Calcium", period: 4, group: 2, block: "s" }
];
const EL_BY_Z = Object.fromEntries(ELEMENTS.map(e => [e.atomicNumber, e]));
const GROUP_A = { 1: "IA", 2: "IIA", 13: "IIIA", 14: "IVA", 15: "VA", 16: "VIA", 17: "VIIA", 18: "VIIIA" };
const PHASE_NAME = { lobby: "Phòng chờ", intro: "Hướng dẫn", work: "Làm bài", review: "Kiểm tra và hỗ trợ", confirm: "Xác nhận", finished: "Đã kết thúc" };
const PHASE_END = { intro: 30, work: 210, review: 300, confirm: 360 };   // mốc giây tính từ lúc bắt đầu
const ERRORS = {
  NOT_AUTHENTICATED: "Chưa đăng nhập ẩn danh. Hãy tải lại trang.", ROOM_NOT_FOUND: "Không tìm thấy phòng với mã này.",
  INVALID_NAME: "Tên hiển thị phải từ 1 đến 30 ký tự.", HOST_CANNOT_JOIN: "Thiết bị này là chủ phòng, không thể vào với vai học sinh.",
  GAME_STARTED: "Phòng đã bắt đầu chơi, không thể vào thêm.", ROOM_FULL: "Phòng đã đủ số người.", NAME_TAKEN: "Tên này đã có người dùng trong phòng.",
  NOT_HOST: "Chỉ giáo viên (chủ phòng) được thực hiện thao tác này.", ROUND_NOT_IN_LOBBY: "Lượt chơi không còn ở phòng chờ.",
  NO_PLAYERS: "Chưa có học sinh nào trong phòng.", SUBMISSIONS_CLOSED: "Đã hết thời gian nộp bài.", NOT_ASSIGNED: "Câu này không được giao cho bạn.",
  NOT_A_PLAYER: "Bạn chưa tham gia phòng này.", NOT_A_MEMBER: "Bạn không thuộc phòng này.", WRONG_PHASE: "Thao tác không khả dụng ở giai đoạn này.",
  HINT_NOT_AVAILABLE: "Quyền hỗ trợ chỉ dùng được ở giai đoạn Kiểm tra và hỗ trợ.", HINT_ALREADY_USED: "Quyền hỗ trợ đã được dùng trong lượt này.",
  CORRECTION_CLOSED: "Chưa mở quyền sửa sai hoặc đã hết giai đoạn sửa.", ALREADY_CORRECT: "Câu này đã đúng.", NO_ANSWER_TO_CORRECT: "Câu này chưa có bài nộp để sửa.",
  CORRECTION_ALREADY_USED: "Câu này đã được sửa một lần.", ROUND_NOT_RUNNING: "Lượt chơi không đang diễn ra.", ROUND_NOT_FINISHED: "Lượt hiện tại chưa kết thúc.",
  INVALID_INPUT: "Dữ liệu gửi lên không hợp lệ.", INVALID_MAX_PLAYERS: "Số người phải từ 1 đến 10.", INVALID_SET: "Bộ câu hỏi không hợp lệ.",
  SET_INVALID_COUNT: "Lỗi dữ liệu máy chủ: bộ câu hỏi không đủ 10 câu.", SET_DUPLICATE_ELEMENT: "Lỗi dữ liệu máy chủ: có nguyên tố trùng trong bộ câu hỏi.",
  SET_DUPLICATE_POSITION: "Lỗi dữ liệu máy chủ: có hai câu cùng một ô.", SET_INVALID_ORDER: "Lỗi dữ liệu máy chủ: thứ tự câu hỏi sai."
};

/* ===== 3. TRẠNG THÁI ===== */
let bank = null, bankErrors = [];
const S = {
  code: null, st: null, seq: 0, applied: 0, syncAt: 0, elapsed0: null,
  draft: {}, activeQ: null, detailQ: null, busy: false, connOk: true, events: null, eventsTimer: null, fetchTimer: null,
  lastRenderKey: "", lastFetch: 0, history: null, historyFor: null, homeError: ""
};

/* ===== 4. TIỆN ÍCH GIAO DIỆN ===== */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
function errText(e) {
  const m = (e && e.message) || String(e);
  for (const code of Object.keys(ERRORS)) if (m.includes(code)) return ERRORS[code];
  return "Có lỗi: " + m;
}
function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }
function qById(id) { return bank.find(q => q.id === id); }
function save(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } }
function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function drop(k) { try { localStorage.removeItem(k); } catch (_) { /* bỏ qua */ } }

/* Kiểm tra quyền Host cố định */
function isHostUser() {
  if (!S.st) return false;
  const isHostByServer = S.st.role === "host";
  const savedHostRoom = load("gm_host_room");
  const isHostByStorage = savedHostRoom && savedHostRoom === S.code;
  return Boolean(isHostByServer || isHostByStorage);
}

/* ===== 5. KIỂM TRA DỮ LIỆU CÂU HỎI ===== */
function parseConfig(cfg) {
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹", parts = [];
  for (const m of cfg.matchAll(/(\d)([spdf])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g))
    parts.push({ n: +m[1], sub: m[2], e: +[...m[3]].map(c => sup.indexOf(c)).join("") });
  return parts;
}
function validateBank(list) {
  const errs = [];
  if (!Array.isArray(list) || list.length !== 20) errs.push("Ngân hàng phải có đúng 20 câu hỏi.");
  if (new Set(list.map(q => q.id)).size !== list.length) errs.push("Có mã câu hỏi bị trùng.");
  for (const set of ["main", "reserve"]) {
    const qs = list.filter(q => q.set === set);
    if (qs.length !== 10) errs.push(`Bộ "${set}" phải có đúng 10 câu (hiện có ${qs.length}).`);
    if (new Set(qs.map(q => q.atomicNumber)).size !== qs.length) errs.push(`Bộ "${set}" có nguyên tố trùng (atomicNumber).`);
    if (new Set(qs.map(q => q.period + "-" + q.group)).size !== qs.length) errs.push(`Bộ "${set}" có hai câu cùng một ô.`);
  }
  for (const q of list) {
    const e = EL_BY_Z[q.atomicNumber];
    if (!e) { errs.push(`${q.id}: nguyên tố ngoài phạm vi H–Ca.`); continue; }
    if (e.symbol !== q.elementSymbol || e.period !== q.period || e.group !== q.group || e.block !== q.block || GROUP_A[e.group] !== q.groupA)
      errs.push(`${q.id}: ký hiệu/chu kỳ/nhóm/khối không khớp bảng tuần hoàn.`);
    const parts = parseConfig(q.configuration || "");
    const z = parts.reduce((s, p) => s + p.e, 0), per = Math.max(...parts.map(p => p.n));
    if (z !== q.atomicNumber || per !== q.period) errs.push(`${q.id}: cấu hình electron không khớp Z/chu kỳ.`);
    const opts = q.positionOptions || [];
    if (opts.length < 4 || opts.filter(o => o.period === q.period && o.group === q.group).length !== 1) errs.push(`${q.id}: thẻ vị trí không hợp lệ.`);
  }
  return errs;
}

/* ===== 6. KHỞI ĐỘNG ===== */
async function init() {
  const app = $("app");
  if (location.protocol === "file:") {
    app.replaceChildren(h("div", { class: "card" }, h("h2", null, "Cần chạy qua máy chủ trò chơi"),
      h("p", null, "Trang này không chạy được khi mở trực tiếp bằng file://. Hãy chạy máy chủ (npm install, tạo .env, npm start) rồi mở http://localhost:3000."),
      h("p", { class: "muted" }, "Xem README.md để biết hướng dẫn từng bước.")));
    return;
  }
  try {
    const res = await fetch("questions.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    bank = (await res.json()).questions;
  } catch (e) {
    app.replaceChildren(h("div", { class: "error" }, "Không đọc được questions.json (" + e.message + "). Hãy mở trang qua máy chủ web (không mở trực tiếp bằng file://)."));
    return;
  }
  bankErrors = validateBank(bank);
  try { await ensureSession(); }
  catch (e) {
    app.replaceChildren(h("div", { class: "error" }, "Không kết nối được máy chủ trò chơi: " + (e.message || e) +
      ". Kiểm tra máy chủ đang chạy, .env đã điền đúng và Anonymous sign-ins đã được bật trên Supabase."));
    return;
  }
  setInterval(tick, 250);
  setInterval(() => { if (S.code) fetchState(); }, 3000);   // dự phòng khi luồng sự kiện bị đứt
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.code) { subscribe(); fetchState(); } });
  window.addEventListener("online", () => { if (S.code) { subscribe(); fetchState(); } });
  const saved = load("gm_room");
  if (saved) { S.code = saved; subscribe(); await fetchState(); } else render();
}

/* Phiên đăng nhập ẩn danh */
let sessionPromise = null;
function readTokens() { try { return JSON.parse(load("gm_tokens") || "null"); } catch (_) { return null; } }
async function postJson(url, body, token) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body || {}) });
  let j = null;
  try { j = await res.json(); } catch (_) { /* phản hồi không phải JSON */ }
  if (!res.ok) { const e = new Error((j && j.error && j.error.message) || "HTTP " + res.status); e.status = res.status; throw e; }
  return j.data;
}
function ensureSession(force) {
  const t = readTokens();
  if (!force && t && t.expires_at - Date.now() / 1000 > 60) return Promise.resolve(t);
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      let data;
      if (t && t.refresh_token) {
        try { data = await postJson(API + "/session", { refresh_token: t.refresh_token }); }
        catch (e) { if (e.status !== 401) throw e; data = await postJson(API + "/session", {}); }
      } else data = await postJson(API + "/session", {});
      save("gm_tokens", JSON.stringify(data));
      return data;
    } finally { sessionPromise = null; }
  })();
  return sessionPromise;
}
async function rpc(fn, args) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await ensureSession(attempt > 0);
    try { return await postJson(API + "/rpc/" + fn, args || {}, t.access_token); }
    catch (e) { if (e.status === 401 && attempt === 0) continue; throw e; }
  }
}

/* ===== 7. ĐỒNG BỘ TRẠNG THÁI ===== */
function closeEvents() {
  clearTimeout(S.eventsTimer); S.eventsTimer = null;
  if (S.events) { S.events.close(); S.events = null; }
}
async function subscribe() {
  closeEvents();
  if (!S.code) return;
  const code = S.code;
  let t;
  try { t = await ensureSession(); } catch (_) { S.eventsTimer = setTimeout(subscribe, 3000); return; }
  if (code !== S.code) return;
  const es = new EventSource(API + "/events?code=" + encodeURIComponent(code) + "&token=" + encodeURIComponent(t.access_token));
  S.events = es;
  es.addEventListener("change", scheduleFetch);
  es.addEventListener("hello", () => { S.connOk = true; scheduleFetch(); });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED && S.events === es) {
      S.events = null; S.eventsTimer = setTimeout(async () => { try { await ensureSession(true); } catch (_) { /* thử lại */ } subscribe(); }, 3000);
    }
  };
}
function scheduleFetch() {
  if (S.fetchTimer) return;
  S.fetchTimer = setTimeout(() => { S.fetchTimer = null; fetchState(); }, 80);
}
async function fetchState() {
  if (!S.code) return;
  const mySeq = ++S.seq, code = S.code;
  try {
    const data = await rpc("get_state", { p_code: code });
    if (code !== S.code || mySeq < S.applied) return;
    S.applied = mySeq; S.connOk = true; S.lastFetch = Date.now();
    applyState(data);
  } catch (e) {
    const m = (e && e.message) || "";
    if (/ROOM_NOT_FOUND|NOT_A_MEMBER/.test(m)) { leaveRoom(); S.homeError = errText(e); render(); return; }
    S.connOk = false; updateTop();
  }
}
function applyState(st) {
  const prevPhase = S.st ? S.st.round.phase : null, prevRound = S.st ? S.st.round.id : null;
  S.st = st; S.syncAt = performance.now(); S.elapsed0 = st.round.elapsed;
  if (prevRound === st.round.id && prevPhase === "work" && st.round.phase !== "work") showLock();
  if (prevRound !== st.round.id) { S.draft = loadDraft(st.round.id); S.activeQ = null; S.detailQ = null; }
  if (st.round.phase === "finished" && S.historyFor !== st.round.id) loadHistory(st.round.id);
  render();
}
function elapsedNow() { return S.st && S.st.round.status === "running" ? S.elapsed0 + (performance.now() - S.syncAt) / 1000 : null; }
function localPhase() {
  const st = S.st; if (!st) return null;
  if (st.round.status !== "running") return st.round.phase;
  const e = elapsedNow();
  return e < 30 ? "intro" : e < 210 ? "work" : e < 300 ? "review" : e < 360 ? "confirm" : "finished";
}
function tick() {
  updateTop();
  if (!S.st) return;
  const lp = localPhase();
  if (lp !== S.st.round.phase && Date.now() - S.lastFetch > 800) { S.lastFetch = Date.now(); fetchState(); }
  const big = $("big-timer"); if (big) big.textContent = timerText();
  if (S.st.round.phase === "work" && lp !== "work") { const b = $("submit-btn"); if (b) b.disabled = true; }
}
function timerText() {
  const e = elapsedNow(), p = localPhase();
  if (e == null || !PHASE_END[p]) return "";
  return PHASE_NAME[p] + ": " + fmt(PHASE_END[p] - e) + " · Tổng còn " + fmt(360 - e);
}
function updateTop() {
  const info = $("topinfo");
  info.hidden = !S.code;
  if (!S.code) return;
  $("top-room").textContent = "Phòng " + S.code;
  const c = $("top-conn"); c.className = "conn" + (S.connOk ? "" : " off"); c.textContent = S.connOk ? "● trực tuyến" : "● mất kết nối";
  const e = elapsedNow(), p = localPhase();
  $("top-timer").textContent = e != null && PHASE_END[p] ? fmt(PHASE_END[p] - e) : "";
}
function showLock() {
  const o = $("lock-overlay"); o.hidden = false;
  clearTimeout(showLock.t); showLock.t = setTimeout(() => { o.hidden = true; }, 3000);
}
async function loadHistory(roundId) {
  S.historyFor = roundId;
  try { S.history = await rpc("list_rounds", { p_code: S.code }); render(true); } catch (_) { S.history = null; }
}
function leaveRoom() {
  closeEvents();
  S.code = null; S.st = null; S.applied = S.seq; 
  drop("gm_room"); 
  drop("gm_host_room");
  updateTop();
}

/* ===== 8. BẢN NHÁP CÂU TRẢ LỜI ===== */
function loadDraft(roundId) { try { return JSON.parse(load("gm_draft_" + roundId) || "{}"); } catch (_) { return {}; } }
function saveDraft() { if (S.st) save("gm_draft_" + S.st.round.id, JSON.stringify(S.draft)); }

/* ===== 9. BẢNG TUẦN HOÀN ===== */
function periodicTable(opts) {
  const grid = h("div", { class: "pt" + (opts.onPick ? " interactive" : "") });
  grid.append(h("div", { class: "pt-head", style: "grid-row:1;grid-column:1" }, ""));
  for (let g = 1; g <= 18; g++) grid.append(h("div", { class: "pt-head", style: `grid-row:1;grid-column:${g + 1}` }, g));
  for (let p = 1; p <= 4; p++) grid.append(h("div", { class: "pt-side", style: `grid-row:${p + 1};grid-column:1` }, p));
  for (const e of ELEMENTS) {
    const mark = (opts.marks || {})[e.atomicNumber];
    const cls = ["cell", e.block, e.atomicNumber === opts.selectedZ ? "selected" : "", mark || "", opts.dimOthers && !mark ? "dim" : ""].join(" ");
    const attrs = { class: cls, style: `grid-row:${e.period + 1};grid-column:${e.group + 1}`, title: `${e.name} (Z = ${e.atomicNumber}, chu kỳ ${e.period}, nhóm ${e.group})` };
    if (opts.onPick) { attrs.role = "button"; attrs.tabindex = "0"; attrs.onclick = () => opts.onPick(e.atomicNumber); attrs.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); opts.onPick(e.atomicNumber); } }; }
    if (opts.onCell && mark) attrs.onclick = () => opts.onCell(e.atomicNumber);
    grid.append(h("div", attrs, h("span", { class: "z" }, e.atomicNumber), h("span", { class: "sym" }, e.symbol), h("span", { class: "nm" }, e.name)));
  }
  return h("div", null,
    h("div", { class: "pt-wrap" }, grid),
    h("div", { class: "legend" },
      h("span", null, h("i", { style: "background:var(--s)" }), "Khối s"), h("span", null, h("i", { style: "background:var(--p)" }), "Khối p"),
      h("span", null, h("i", { style: "border-color:var(--gold)" }), "Đang chọn"), h("span", null, h("i", { style: "border-color:var(--cyan)" }), "Đã nộp"),
      h("span", null, h("i", { style: "border-color:var(--ok)" }), "Đúng (đã định vị)"), h("span", null, h("i", { style: "border-color:var(--bad)" }), "Sai"),
      h("span", null, "Chưa thực hiện: ô không viền")));
}

/* ===== 10. VẼ GIAO DIỆN ===== */
function render(force) {
  const st = S.st;
  const key = JSON.stringify([S.code, st && { ...st, server_time: 0, round: { ...st.round, elapsed: 0 } }, S.draft, S.activeQ, S.detailQ, S.homeError, !!S.history, bankErrors.length, isHostUser()]);
  if (!force && key === S.lastRenderKey) return;
  S.lastRenderKey = key;
  const app = $("app"), view = !S.code || !st ? viewHome() : st.round.status === "lobby" ? viewLobby() : viewGame();
  app.replaceChildren(view);
  updateTop();
}

/* --- Màn hình mở đầu --- */
function viewHome() {
  const nameIn = h("input", { id: "in-name", maxlength: "30", placeholder: "Tên hiển thị", autocomplete: "nickname" });
  const codeIn = h("input", { id: "in-code", maxlength: "6", placeholder: "VD: K7M2QA", autocapitalize: "characters", autocomplete: "off" });
  const maxIn = h("select", { id: "in-max" }, ...Array.from({ length: 10 }, (_, i) => h("option", { value: i + 1, selected: i + 1 === 10 }, `${i + 1} người`)));
  return h("div", null,
    h("div", { class: "card" }, h("span", { class: "stamp" }, "HỒ SƠ MẬT"),
      h("h1", null, "Giải mã bản đồ nguyên tố"),
      h("p", { class: "muted" }, "Giải mã dữ kiện hóa học, xác định nguyên tố và định vị đúng ô trên bảng tuần hoàn. Hoàn thành 10 nhiệm vụ để lấp đầy bản đồ.")),
    S.homeError ? h("div", { class: "error" }, S.homeError) : null,
    bankErrors.length ? h("div", { class: "error" }, h("b", null, "Lỗi dữ liệu câu hỏi, không thể tạo phòng:"), h("ul", null, bankErrors.map(e => h("li", null, e)))) : null,
    h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h2", null, "Giáo viên / Trưởng phòng"),
        h("label", { for: "in-max" }, "Số điều tra viên tối đa"), maxIn,
        h("p", null, h("button", { disabled: bankErrors.length > 0, onclick: async ev => {
          ev.target.disabled = true; S.homeError = "";
          try { 
            const r = await rpc("create_room", { p_max_players: +maxIn.value }); 
            save("gm_host_room", r.code); // Lưu cờ quyền Host
            await enterRoom(r.code); 
          }
          catch (e) { S.homeError = errText(e); render(true); }
        } }, "Tạo phòng"))),
      h("div", { class: "card" }, h("h2", null, "Điều tra viên / Học sinh"),
        h("label", { for: "in-code" }, "Mã phòng"), codeIn,
        h("label", { for: "in-name" }, "Tên hiển thị"), nameIn,
        h("p", null, h("button", { onclick: async ev => {
          ev.target.disabled = true; S.homeError = "";
          try { 
            drop("gm_host_room"); // Người chơi thường không có cờ Host
            const r = await rpc("join_room", { p_code: codeIn.value.trim().toUpperCase(), p_name: nameIn.value.trim() }); 
            await enterRoom(r.code); 
          }
          catch (e) { S.homeError = errText(e); render(true); }
        } }, "Tham gia"))))
  );
}
async function enterRoom(code) {
  S.code = code; S.homeError = ""; save("gm_room", code); S.st = null;
  subscribe(); await fetchState();
}

/* --- Phòng chờ --- */
function viewLobby() {
  const st = S.st, host = isHostUser();
  const list = h("ul", { class: "players" }, st.players.map(p => h("li", null, h("span", null, p.name),
    host ? h("button", { class: "secondary", onclick: () => act(() => rpc("remove_player", { p_code: S.code, p_player_id: p.id })) }, "Xóa") : null)));
  return h("div", null,
    h("div", { class: "card" }, h("h2", null, "Phòng chờ · Lượt " + st.round.round_no + (st.round.set === "main" ? " (bộ câu chính)" : " (bộ câu dự phòng)")),
      h("p", { class: "muted" }, "Mã phòng"), h("div", { class: "code" }, S.code),
      h("p", null, `Đã vào: ${st.players.length} / ${st.room.max_players} điều tra viên`),
      host ? h("p", { class: "muted" }, "Chia mã phòng cho học sinh. Khi bắt đầu, 10 câu hỏi được chia đều cho những người đã vào phòng.") :
        h("p", null, "Bạn là: ", h("b", null, (st.me && st.me.name) || "Học sinh"), ". Đang chờ giáo viên bắt đầu…")),
    h("div", { class: "card" }, h("h3", null, "Danh sách điều tra viên"), st.players.length ? list : h("p", { class: "muted" }, "Chưa có ai.")),
    host ? h("div", { class: "card" },
      bankErrors.length ? h("div", { class: "error" }, "Dữ liệu câu hỏi lỗi: " + bankErrors.join(" ")) : null,
      h("button", { disabled: !st.players.length || bankErrors.length > 0, onclick: startGame }, "Bắt đầu trò chơi")) : null,
    host ? null : h("div", { class: "card" }, h("button", { class: "secondary", onclick: () => { leaveRoom(); render(true); } }, "Rời màn hình phòng (có thể vào lại bằng mã)")));
}
async function startGame() {
  try {
    const zs = bank.filter(q => q.set === S.st.round.set).sort((a, b) => a.order - b.order).map(q => q.atomicNumber);
    const chk = await rpc("check_round_set", { p_code: S.code, p_z: zs });
    if (!chk.match) { toast("Dữ liệu questions.json không khớp đáp án trên máy chủ. Không thể bắt đầu."); return; }
    await rpc("start_round", { p_code: S.code }); await fetchState();
  } catch (e) { toast(errText(e)); }
}
async function act(fn) { try { await fn(); await fetchState(); } catch (e) { toast(errText(e)); await fetchState(); } }

/* --- Màn hình trò chơi --- */
function viewGame() {
  const st = S.st, host = isHostUser(), phase = st.round.phase;
  const myTasks = host ? [] : st.tasks.filter(t => st.me && t.player_id === st.me.player_id);
  const nameOf = id => (st.players.find(p => p.id === id) || {}).name || "?";
  const parts = [];
  parts.push(h("div", { class: "card row" }, h("span", { class: "stamp" }, PHASE_NAME[phase].toUpperCase()),
    h("span", { id: "big-timer", class: "timer" }, timerText()),
    h("span", { class: "muted" }, `Lượt ${st.round.round_no} · ${host ? "Giáo viên" : "Điều tra viên " + ((st.me && st.me.name) || "")}`)));
  if (host) parts.push(hostControls());

  if (phase === "intro") parts.push(viewIntro(myTasks, nameOf));
  else if (phase === "work") parts.push(host ? viewMonitor(nameOf) : viewWork(myTasks));
  else if (phase === "review") parts.push(host ? viewMonitor(nameOf) : viewReview(myTasks), boardCard("Bảng tuần hoàn của đội: các nguyên tố đã định vị đúng"));
  else parts.push(viewFinal(nameOf), boardCard("Bảng tuần hoàn của đội"), detailCard(), historyCard());
  return h("div", null, parts);
}

function hostControls() {
  const st = S.st, ph = st.round.phase, r = st.round;
  const nextLabel = { intro: "Vào giai đoạn Làm bài", work: "Khóa bài, sang Kiểm tra", review: "Sang Xác nhận", confirm: "Kết thúc lượt" }[ph];
  const btns = [];
  if (r.status === "running") {
    if (nextLabel) btns.push(h("button", { class: "warn", onclick: () => { if (ph !== "work" || confirm("Khóa nộp bài ngay bây giờ?")) act(() => rpc("advance_phase", { p_code: S.code })); } }, nextLabel));
    if (ph === "review") {
      btns.push(h("button", { disabled: r.hint_used, onclick: () => act(() => rpc("use_hint", { p_code: S.code })) }, r.hint_used ? "Quyền hỗ trợ đã dùng" : "Dùng quyền hỗ trợ (1 lần)"));
      btns.push(h("button", { class: "secondary", onclick: () => act(() => rpc("set_correction", { p_code: S.code, p_open: !r.correction_open })) }, r.correction_open ? "Đóng quyền sửa sai" : "Mở quyền sửa sai"));
    }
    btns.push(h("button", { class: "danger", onclick: () => { if (confirm("Kết thúc lượt ngay và lưu kết quả?")) act(() => rpc("end_round", { p_code: S.code })); } }, "Kết thúc lượt ngay"));
  }
  if (r.status === "finished") {
    btns.push(h("button", { onclick: () => act(() => rpc("new_round", { p_code: S.code, p_set: "main" })) }, "Chơi lại: bộ câu chính"));
    btns.push(h("button", { class: "secondary", onclick: () => act(() => rpc("new_round", { p_code: S.code, p_set: "reserve" })) }, "Chơi lại: bộ dự phòng"));
  }
  return h("div", { class: "card" }, h("b", null, "Điều khiển của giáo viên"), h("div", { class: "row", style: "margin-top:8px" }, btns),
    ph === "review" ? h("p", { class: "muted" }, `Quyền hỗ trợ: ${r.hint_used ? "đã dùng" : "chưa dùng"} · Sửa sai: ${r.correction_open ? "đang mở" : "đang đóng"}`) : null);
}

function viewIntro(myTasks, nameOf) {
  const st = S.st, host = isHostUser();
  return h("div", { class: "card" }, h("h2", null, "Luật chơi"),
    h("ol", null,
      h("li", null, "Mỗi điều tra viên nhận câu hỏi riêng; tất cả làm bài cùng lúc."),
      h("li", null, "Đọc dữ kiện, xác định nguyên tố rồi chạm vào ô của nó trên bảng tuần hoàn, sau đó chọn thẻ chu kỳ/nhóm đúng."),
      h("li", null, "Nhấn Nộp bài. Sau khi nộp, câu trả lời bị khóa. Hết 3 phút làm bài, hồ sơ bị phong tỏa."),
      h("li", null, "Sau đó là giai đoạn kiểm tra (có thể có quyền hỗ trợ và sửa sai) và xác nhận kết quả."),
      h("li", null, "Đội đạt khi số người hoàn thành đạt ít nhất 70% số người tham gia (làm tròn lên).")),
    host ? h("div", null, h("h3", null, "Phân công"), h("ul", { class: "players" }, groupTasks(nameOf).map(g => h("li", null, h("b", null, g.name), h("span", null, g.ids.join(", "))))))
      : h("div", null, h("h3", null, "Nhiệm vụ của bạn"), h("p", null, myTasks.map(t => qById(t.question_id).title).join(" · "))));
}
function groupTasks(nameOf) {
  const m = new Map();
  for (const t of S.st.tasks) { if (!m.has(t.player_id)) m.set(t.player_id, { name: nameOf(t.player_id), ids: [] }); m.get(t.player_id).ids.push(t.question_id); }
  return [...m.values()];
}

/* --- Giáo viên theo dõi tiến độ --- */
function viewMonitor(nameOf) {
  const st = S.st, ph = st.round.phase;
  return h("div", { class: "card" }, h("h3", null, "Trạng thái từng điều tra viên"),
    h("table", { class: "t" }, h("thead", null, h("tr", null, h("th", null, "Tên"), h("th", null, "Câu được giao"), h("th", null, "Đã nộp"), ph === "work" ? null : h("th", null, "Đúng"))),
      h("tbody", null, st.progress.map(p => h("tr", null, h("td", null, p.name), h("td", null, st.tasks.filter(t => t.player_id === p.player_id).map(t => t.question_id).join(", ") || "—"),
        h("td", null, `${p.submitted}/${p.assigned}`, p.assigned && p.submitted === p.assigned ? h("span", { class: "tag ok", style: "margin-left:6px" }, "đã nộp đủ") : null),
        ph === "work" ? null : h("td", null, `${p.correct}/${p.assigned}`))))),
    ph === "work" ? h("p", { class: "muted" }, "Đúng/sai chỉ hiển thị sau khi hồ sơ bị phong tỏa.") : null);
}

/* --- Điều tra viên: làm bài --- */
function answerEditor(qid, mode) {
  const q = qById(qid), d = S.draft[qid] || {};
  const done = d.z && d.period && d.group;
  const setDraft = patch => { S.draft[qid] = { ...S.draft[qid], ...patch }; saveDraft(); render(true); };
  const sel = EL_BY_Z[d.z];
  return h("div", null,
    h("div", { class: "card" }, h("h3", null, qid + " · " + q.title), h("pre", { class: "cfg" }, q.data), h("p", null, q.task)),
    h("p", null, "Bước 1 · Chạm vào ô nguyên tố trên bảng: ", sel ? h("b", null, `${sel.symbol} (Z = ${sel.atomicNumber})`) : h("span", { class: "muted" }, "chưa chọn")),
    periodicTable({ onPick: z => setDraft({ z }), selectedZ: d.z }),
    h("p", null, "Bước 2 · Chọn thẻ vị trí đúng:"),
    h("div", { class: "cards" }, q.positionOptions.map(o => h("button", { class: d.period === o.period && d.group === o.group ? "on" : "", onclick: () => setDraft({ period: o.period, group: o.group }) },
      `Chu kỳ ${o.period} · Nhóm ${o.group}`))),
    h("p", null, h("button", { id: "submit-btn", disabled: !done || localPhase() !== (mode === "fix" ? "review" : "work"), onclick: () => submitAnswer(qid, mode) },
      mode === "fix" ? "Gửi sửa sai (1 lần)" : "Nộp bài (khóa câu trả lời)")));
}
async function submitAnswer(qid, mode) {
  const d = S.draft[qid];
  if (!d || !d.z || !d.period || !d.group || S.busy) return;
  S.busy = true;
  try {
    const r = await rpc(mode === "fix" ? "correct_answer" : "submit_answer", { p_code: S.code, p_question_id: qid, p_z: d.z, p_period: d.period, p_group: d.group });
    if (r && r.status === "already_submitted") toast("Câu này đã được nộp trước đó, kết quả không thay đổi.");
    else toast(mode === "fix" ? "Đã gửi sửa sai." : "Đã nộp bài.");
  } catch (e) { toast(errText(e)); }
  S.busy = false; await fetchState();
}
function viewWork(myTasks) {
  const st = S.st, ans = qid => st.answers.find(a => a.question_id === qid);
  if (!myTasks.length) return h("div", { class: "card" }, "Bạn chưa được giao nhiệm vụ nào trong lượt này.");
  if (!myTasks.some(t => t.question_id === S.activeQ)) S.activeQ = (myTasks.find(t => !ans(t.question_id)) || myTasks[0]).question_id;
  const submitted = myTasks.filter(t => ans(t.question_id)).length;
  const a = ans(S.activeQ);
  return h("div", null,
    h("div", { class: "card" }, h("b", null, `Đã nộp ${submitted}/${myTasks.length} câu được giao`), h("div", { class: "bar" }, h("div", { style: `width:${100 * submitted / myTasks.length}%` })),
      h("div", { class: "tabs", style: "margin-top:10px" }, myTasks.map(t => h("button", { class: (t.question_id === S.activeQ ? "active " : "") + (ans(t.question_id) ? "done" : ""), onclick: () => { S.activeQ = t.question_id; render(true); } }, t.question_id)))),
    a ? lockedAnswer(a) : answerEditor(S.activeQ, "work"));
}
function lockedAnswer(a) {
  const q = qById(a.question_id), e = EL_BY_Z[a.selected_z];
  return h("div", null, h("div", { class: "card" }, h("h3", null, a.question_id + " · " + q.title), h("pre", { class: "cfg" }, q.data),
    h("p", null, h("span", { class: "tag ok" }, "ĐÃ NỘP · ĐÃ KHÓA"), ` Bạn chọn ${e.symbol} (Z = ${e.atomicNumber}), chu kỳ ${a.period}, nhóm ${a.group}. Kết quả sẽ có sau khi hồ sơ bị phong tỏa.`)),
    periodicTable({ marks: { [a.selected_z]: "pending" }, dimOthers: false }));
}

/* --- Điều tra viên: kiểm tra, hỗ trợ, sửa sai --- */
function viewReview(myTasks) {
  const st = S.st, r = st.round;
  const ans = qid => st.answers.find(a => a.question_id === qid);
  const mine = myTasks.map(t => {
    const a = ans(t.question_id), q = qById(t.question_id);
    const canFix = r.correction_open && a && a.correct === false && !a.corrected;
    return h("div", { class: "card" }, h("h3", null, t.question_id + " · " + q.title),
      !a ? h("span", { class: "tag bad" }, "Chưa nộp (đã hết hạn)") :
        h("span", { class: "tag " + (a.correct ? "ok" : "bad") }, a.correct ? "ĐÚNG" : "SAI" + (a.corrected ? " (đã sửa 1 lần)" : "")),
      a && a.correct ? h("p", null, st.explanations[t.question_id] || "") : null,
      a && !a.correct ? h("p", { class: "muted" }, "Gợi ý: " + q.hint) : null,
      st.hints[t.question_id] ? h("div", { class: "notice" }, "Quyền hỗ trợ: " + st.hints[t.question_id]) : null,
      canFix ? h("div", null, h("p", { class: "notice" }, "Giáo viên đã mở quyền sửa sai. Bạn chỉ được sửa một lần."), answerEditor(t.question_id, "fix")) : null);
  });
  return h("div", null, h("div", { class: "card" }, h("b", null, "Kiểm tra kết quả của bạn"), h("p", { class: "muted" },
    "Giai đoạn này không nộp thêm câu mới. Lời giải thích đầy đủ sẽ được công bố ở giai đoạn Xác nhận.")), mine);
}

/* --- Bảng của đội, chi tiết và tổng kết --- */
function boardMarks() {
  const marks = {};
  for (const b of S.st.board) marks[b.atomic_number] = b.correct ? "placed" : "wrong";
  return marks;
}
function boardCard(title) {
  const st = S.st, correct = st.board.filter(b => b.correct).length;
  const final = st.round.phase === "confirm" || st.round.phase === "finished";
  return h("div", { class: "card" }, h("h3", null, title), h("p", null, h("b", null, `${correct}/10`), " nguyên tố đã định vị đúng"),
    h("div", { class: "bar" }, h("div", { style: `width:${correct * 10}%` })),
    periodicTable({ marks: boardMarks(), onCell: final ? z => { const b = st.board.find(x => x.atomic_number === z); S.detailQ = b.question_id; render(true); } : null }),
    final ? h("p", { class: "muted" }, "Chạm vào ô có viền để xem lại dữ kiện và lời giải.") : null);
}
function detailCard() {
  const st = S.st; if (!S.detailQ) return null;
  const q = qById(S.detailQ), b = st.board.find(x => x.question_id === S.detailQ);
  return h("div", { class: "card" }, h("h3", null, q.id + " · " + q.title), h("pre", { class: "cfg" }, q.data), h("p", null, q.task),
    h("p", null, h("b", null, `Đáp án: ${q.elementSymbol} (${q.elementName}), Z = ${q.atomicNumber}, chu kỳ ${q.period}, nhóm ${q.group} (${q.groupA}), khối ${q.block}.`)),
    h("p", null, st.explanations[q.id] || ""), b ? h("span", { class: "tag " + (b.correct ? "ok" : "bad") }, b.correct ? "Đội đã trả lời đúng" : "Chưa đúng") : null);
}
function viewFinal(nameOf) {
  const st = S.st, res = st.result; if (!res) return h("div", { class: "card" }, "Đang tải kết quả…");
  const pass = res.passed;
  return h("div", { class: "card" }, h("div", { class: "result-title " + (pass ? "pass" : "wait") }, pass ? "HOÀN THÀNH NHIỆM VỤ" : "CHỜ XÁC MINH BỔ SUNG"),
    st.round.phase === "confirm" ? h("p", { class: "muted" }, "Kết quả đang được xác nhận. Lượt sẽ tự kết thúc và lưu khi hết 360 giây.") : null,
    h("ul", null,
      h("li", null, `Số câu đúng: ${res.correct_questions}/${res.total_questions} (trước khi sửa sai: ${res.correct_before_fix})`),
      h("li", null, `Số nguyên tử đã định vị chính xác: ${res.correct_questions}/10`),
      h("li", null, `Số người hoàn thành: ${res.completed_players}/${res.participants}`),
      h("li", null, `Ngưỡng tối thiểu: ${res.threshold} người (làm tròn lên của 70% × ${res.participants})`),
      h("li", null, `Quyền hỗ trợ: ${res.hint_used ? "đã dùng" : "không dùng"}`)),
    h("table", { class: "t" }, h("thead", null, h("tr", null, h("th", null, "Điều tra viên"), h("th", null, "Câu đúng"), h("th", null, "Kết quả"))),
      h("tbody", null, res.players.map(p => h("tr", null, h("td", null, p.name), h("td", null, `${p.correct}/${p.assigned}`),
        h("td", null, h("span", { class: "tag " + (p.completed ? "ok" : "bad") }, p.completed ? "Hoàn thành" : "Chưa hoàn thành")))))),
    h("table", { class: "t", style: "margin-top:12px" }, h("thead", null, h("tr", null, h("th", null, "Câu"), h("th", null, "Nguyên tố"), h("th", null, "Người làm"), h("th", null, "Kết quả"))),
      h("tbody", null, res.questions.map(x => h("tr", null, h("td", null, x.question_id), h("td", null, EL_BY_Z[x.atomic_number].symbol + " (Z = " + x.atomic_number + ")"),
        h("td", null, nameOf(x.player_id)), h("td", null, h("span", { class: "tag " + (x.correct ? "ok" : "bad") }, !x.answered ? "Chưa nộp" : x.correct ? "Đúng" : "Sai")))))),
    st.round.phase === "finished" && !isHostUser() ? h("p", { class: "muted" }, "Đang chờ giáo viên tạo lượt mới (nếu có).") : null);
}
function historyCard() {
  const hs = S.history; if (!hs || hs.length < 2) return null;
  return h("div", { class: "card" }, h("h3", null, "Các lượt đã chơi"), h("ul", null, hs.map(x => h("li", null,
    `Lượt ${x.round_no} (${x.set === "main" ? "bộ chính" : "bộ dự phòng"}): ${x.result.correct_questions}/10 câu đúng, ${x.result.completed_players}/${x.result.participants} người hoàn thành, ${x.result.passed ? "HOÀN THÀNH NHIỆM VỤ" : "CHỜ XÁC MINH BỔ SUNG"}`))));
}

init();