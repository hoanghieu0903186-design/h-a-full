-- =====================================================================
-- GIẢI MÃ BẢN ĐỒ NGUYÊN TỐ - lược đồ Supabase (PostgreSQL)
-- Chạy toàn bộ tệp này một lần trong Supabase > SQL Editor.
-- Tệp có thể chạy lại nhiều lần (tạo bảng nếu chưa có, cập nhật hàm và dữ liệu mẫu).
--
-- Nguyên tắc bảo mật:
--  * Người chơi đăng nhập ẩn danh (Anonymous sign-in) nên auth.uid() ổn định trong trình duyệt.
--  * Mọi bảng bật RLS. Trình duyệt KHÔNG được ghi hoặc đọc trực tiếp bảng nào,
--    trừ việc đọc bảng rooms (chỉ để nhận tín hiệu Realtime).
--  * Mọi thao tác chính thức đi qua các hàm RPC (SECURITY DEFINER) bên dưới.
--    Các hàm này kiểm tra: ai là chủ phòng, giai đoạn hiện tại do máy chủ tính,
--    câu nào được giao cho ai, nộp lặp, quyền hỗ trợ dùng một lần...
--  * Đáp án chuẩn nằm trong bảng question_bank, trình duyệt không đọc được bảng này.
--
-- Thời gian: giai đoạn được tính trên máy chủ từ started_at + skip_seconds:
--   0-30 giây Hướng dẫn | 30-210 Làm bài | 210-300 Kiểm tra và hỗ trợ | 300-360 Xác nhận | >=360 Kết thúc
-- =====================================================================

create schema if not exists game_private;

-- ---------------------------------------------------------------------
-- 1. Bảng dữ liệu
-- ---------------------------------------------------------------------
create table if not exists public.periodic_elements (
  atomic_number int primary key check (atomic_number between 1 and 20),
  symbol        text not null unique,
  name          text not null,
  period        int  not null check (period between 1 and 4),
  grp           int  not null check (grp between 1 and 18),
  block         text not null check (block in ('s', 'p')),
  unique (period, grp)
);

-- Đáp án chuẩn. Prompt/dữ kiện hiển thị nằm trong questions.json; ở đây chỉ giữ phần chấm điểm.
create table if not exists public.question_bank (
  id            text primary key,
  set_name      text not null check (set_name in ('main', 'reserve')),
  ord           int  not null check (ord between 1 and 10),
  atomic_number int  not null references public.periodic_elements (atomic_number),
  support_hint  text not null,
  explanation   text not null,
  unique (set_name, ord),
  unique (set_name, atomic_number)
);

create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id          uuid not null,
  max_players      int  not null check (max_players between 1 and 10),
  current_round_id uuid,
  version          bigint not null default 1,
  created_at       timestamptz not null default now()
);
create index if not exists rooms_host_idx on public.rooms (host_id);

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  joined_at    timestamptz not null default now(),
  unique (room_id, user_id)
);
create unique index if not exists players_room_name_uq on public.players (room_id, lower(display_name));
create index if not exists players_user_idx on public.players (user_id);

create table if not exists public.rounds (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  round_no        int  not null,
  question_set    text not null check (question_set in ('main', 'reserve')),
  status          text not null default 'lobby' check (status in ('lobby', 'running', 'finished')),
  started_at      timestamptz,
  skip_seconds    numeric not null default 0 check (skip_seconds >= 0),
  correction_open boolean not null default false,
  hint_used       boolean not null default false,
  hint_used_at    timestamptz,
  finished_at     timestamptz,
  result          jsonb,
  created_at      timestamptz not null default now(),
  unique (room_id, round_no)
);

do $$
begin
  alter table public.rooms
    add constraint rooms_current_round_fk
    foreign key (current_round_id) references public.rounds (id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rounds (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  question_id text not null references public.question_bank (id),
  unique (round_id, question_id)
);
create index if not exists assignments_round_player_idx on public.assignments (round_id, player_id);

create table if not exists public.answers (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.rounds (id) on delete cascade,
  question_id      text not null,
  player_id        uuid not null references public.players (id) on delete cascade,
  selected_z       int  not null check (selected_z between 1 and 20),
  claimed_period   int  not null check (claimed_period between 1 and 4),
  claimed_group    int  not null check (claimed_group between 1 and 18),
  is_correct       boolean not null,
  first_selected_z int  not null,
  first_period     int  not null,
  first_group      int  not null,
  first_correct    boolean not null,
  corrected        boolean not null default false,
  submitted_at     timestamptz not null default now(),
  corrected_at     timestamptz,
  unique (round_id, question_id),
  foreign key (round_id, question_id) references public.assignments (round_id, question_id) on delete cascade
);
create index if not exists answers_round_player_idx on public.answers (round_id, player_id);

-- ---------------------------------------------------------------------
-- 2. Hàm nội bộ (schema game_private, không được trình duyệt gọi)
-- ---------------------------------------------------------------------
create or replace function game_private.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return v;
end $$;

create or replace function game_private.is_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.players where room_id = p_room and user_id = auth.uid());
$$;

create or replace function game_private.phase_of(p_elapsed numeric) returns text
language sql immutable as $$
  select case when p_elapsed < 30  then 'intro'
              when p_elapsed < 210 then 'work'
              when p_elapsed < 300 then 'review'
              when p_elapsed < 360 then 'confirm'
              else 'finished' end;
$$;

create or replace function game_private.elapsed(r public.rounds) returns numeric
language sql stable as $$
  select case when r.started_at is null then 0::numeric
              else extract(epoch from (clock_timestamp() - r.started_at))::numeric + r.skip_seconds end;
$$;

create or replace function game_private.phase_now(r public.rounds) returns text
language sql stable as $$
  select case r.status when 'lobby' then 'lobby'
                       when 'finished' then 'finished'
                       else game_private.phase_of(game_private.elapsed(r)) end;
$$;

create or replace function game_private.touch_room(p_room uuid) returns void
language sql as $$
  update public.rooms set version = version + 1 where id = p_room;
$$;

-- Kiểm tra bộ câu hỏi: đúng 10 câu, 10 nguyên tố khác nhau, 10 ô khác nhau.
create or replace function game_private.validate_set(p_set text) returns void
language plpgsql stable as $$
declare n int; d int; s int; pos int;
begin
  select count(*), count(distinct atomic_number), count(distinct ord)
    into n, d, s from public.question_bank where set_name = p_set;
  if n <> 10 then raise exception 'SET_INVALID_COUNT'; end if;
  if d <> 10 then raise exception 'SET_DUPLICATE_ELEMENT'; end if;
  if s <> 10 then raise exception 'SET_INVALID_ORDER'; end if;
  select count(distinct (e.period, e.grp)) into pos
    from public.question_bank q join public.periodic_elements e using (atomic_number)
    where q.set_name = p_set;
  if pos <> 10 then raise exception 'SET_DUPLICATE_POSITION'; end if;
end $$;

-- Chấm một đáp án: đúng khi chọn đúng ô nguyên tố VÀ đúng thẻ vị trí (chu kỳ, nhóm).
create or replace function game_private.grade(p_question text, p_z int, p_period int, p_group int) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.question_bank q
    join public.periodic_elements e on e.atomic_number = q.atomic_number
    where q.id = p_question and q.atomic_number = p_z and e.period = p_period and e.grp = p_group);
$$;

-- Kết quả của một lượt. Ngưỡng đạt = ceil(0.70 x n) = floor((7n + 9) / 10) (dùng số nguyên, không sai số thực).
create or replace function game_private.compute_results(p_round uuid) returns jsonb
language plpgsql stable as $$
declare
  v_players jsonb; v_questions jsonb;
  n int; completed int; thr int; correct_q int; before_q int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', t.player_id, 'name', t.name, 'assigned', t.assigned,
           'submitted', t.submitted, 'correct', t.correct,
           'completed', (t.assigned > 0 and t.correct = t.assigned))
         order by t.joined_at, t.player_id), '[]'::jsonb),
         count(*)::int,
         (count(*) filter (where t.assigned > 0 and t.correct = t.assigned))::int
    into v_players, n, completed
  from (
    select p.id as player_id, p.display_name as name, p.joined_at,
           count(asg.id) as assigned, count(a.id) as submitted,
           count(a.id) filter (where a.is_correct) as correct
    from public.players p
    join public.assignments asg on asg.player_id = p.id and asg.round_id = p_round
    left join public.answers a on a.round_id = asg.round_id and a.question_id = asg.question_id
    group by p.id, p.display_name, p.joined_at
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', q.id, 'ord', q.ord, 'atomic_number', q.atomic_number,
           'player_id', asg.player_id, 'answered', (a.id is not null),
           'correct', coalesce(a.is_correct, false),
           'first_correct', coalesce(a.first_correct, false),
           'corrected', coalesce(a.corrected, false)) order by q.ord), '[]'::jsonb),
         (count(*) filter (where coalesce(a.is_correct, false)))::int,
         (count(*) filter (where coalesce(a.first_correct, false)))::int
    into v_questions, correct_q, before_q
  from public.assignments asg
  join public.question_bank q on q.id = asg.question_id
  left join public.answers a on a.round_id = asg.round_id and a.question_id = asg.question_id
  where asg.round_id = p_round;

  thr := (7 * n + 9) / 10;
  return jsonb_build_object(
    'participants', n, 'completed_players', completed, 'threshold', thr,
    'passed', (n > 0 and completed >= thr),
    'correct_questions', correct_q, 'correct_before_fix', before_q, 'total_questions', 10,
    'hint_used', (select hint_used from public.rounds where id = p_round),
    'players', v_players, 'questions', v_questions);
end $$;

create or replace function game_private.finalize_round(p_round uuid) returns void
language plpgsql as $$
begin
  update public.rounds
     set status = 'finished', finished_at = now(), result = game_private.compute_results(id)
   where id = p_round and status = 'running';
end $$;

-- ---------------------------------------------------------------------
-- 3. Hàm RPC cho trình duyệt (chỉ người đã đăng nhập, kể cả ẩn danh, được gọi)
-- ---------------------------------------------------------------------

-- Giáo viên tạo phòng. Trả về mã phòng 6 ký tự.
create or replace function public.create_room(p_max_players int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text; v_room uuid; v_round uuid; tries int := 0;
begin
  if p_max_players is null or p_max_players < 1 or p_max_players > 10 then
    raise exception 'INVALID_MAX_PLAYERS';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    begin
      insert into rooms (code, host_id, max_players) values (v_code, uid, p_max_players) returning id into v_room;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 20 then raise exception 'CODE_GENERATION_FAILED'; end if;
    end;
  end loop;
  insert into rounds (room_id, round_no, question_set) values (v_room, 1, 'main') returning id into v_round;
  update rooms set current_round_id = v_round where id = v_room;
  return jsonb_build_object('code', v_code);
end $$;

-- Học sinh vào phòng. Gọi lại với cùng trình duyệt là kết nối lại, không tạo người chơi trùng.
create or replace function public.join_room(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user();
  r rooms; rd rounds; pl_id uuid; cnt int;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id = uid then raise exception 'HOST_CANNOT_JOIN'; end if;

  select id into pl_id from players where room_id = r.id and user_id = uid;
  if found then
    return jsonb_build_object('code', r.code, 'player_id', pl_id, 'rejoined', true);
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 30 then raise exception 'INVALID_NAME'; end if;
  select * into rd from rounds where id = r.current_round_id;
  if rd.status <> 'lobby' then raise exception 'GAME_STARTED'; end if;
  select count(*) into cnt from players where room_id = r.id;
  if cnt >= r.max_players then raise exception 'ROOM_FULL'; end if;
  if exists (select 1 from players where room_id = r.id and lower(display_name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;

  insert into players (room_id, user_id, display_name) values (r.id, uid, v_name) returning id into pl_id;
  perform game_private.touch_room(r.id);
  return jsonb_build_object('code', r.code, 'player_id', pl_id, 'rejoined', false);
end $$;

-- Chủ phòng xóa một người khỏi phòng chờ (ví dụ người đã đóng trình duyệt).
create or replace function public.remove_player(p_code text, p_player_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id;
  if rd.status <> 'lobby' then raise exception 'ROUND_NOT_IN_LOBBY'; end if;
  delete from players where id = p_player_id and room_id = r.id;
  perform game_private.touch_room(r.id);
end $$;

-- Chủ phòng so khớp thứ tự nguyên tố của questions.json với đáp án trên máy chủ.
-- Chỉ trả về đúng/sai, không trả về đáp án.
create or replace function public.check_round_set(p_code text, p_z int[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds; server_z int[];
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id;
  if rd.status <> 'lobby' then raise exception 'ROUND_NOT_IN_LOBBY'; end if;
  perform game_private.validate_set(rd.question_set);
  select array_agg(atomic_number order by ord) into server_z from question_bank where set_name = rd.question_set;
  return jsonb_build_object('match', (server_z is not distinct from p_z));
end $$;

-- Chủ phòng bắt đầu lượt: kiểm tra bộ câu hỏi, chia đều 10 câu cho những người đã vào phòng.
create or replace function public.start_round(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds; n int;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'lobby' then raise exception 'ROUND_NOT_IN_LOBBY'; end if;
  select count(*) into n from players where room_id = r.id;
  if n < 1 then raise exception 'NO_PLAYERS'; end if;
  perform game_private.validate_set(rd.question_set);

  -- Câu thứ k (đánh số từ 0) giao cho người thứ (k mod n): mỗi câu đúng một người, chênh lệch tối đa 1 câu.
  insert into assignments (round_id, player_id, question_id)
  select rd.id, p.id, q.id
  from (select id, (row_number() over (order by joined_at, id) - 1)::int as rn from players where room_id = r.id) p
  join (select id, (ord - 1) as rn from question_bank where set_name = rd.question_set) q
    on (q.rn % n) = p.rn;

  update rounds set status = 'running', started_at = clock_timestamp(), skip_seconds = 0 where id = rd.id;
  perform game_private.touch_room(r.id);
end $$;

-- Chủ phòng chuyển sang giai đoạn kế tiếp (nhảy đồng hồ máy chủ tới mốc giai đoạn kế).
create or replace function public.advance_phase(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user(); r rooms; rd rounds;
  el numeric; boundary numeric; real_el numeric;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'running' then raise exception 'ROUND_NOT_RUNNING'; end if;
  el := game_private.elapsed(rd);
  if el >= 360 then
    perform game_private.finalize_round(rd.id);
  else
    boundary := case when el < 30 then 30 when el < 210 then 210 when el < 300 then 300 else 360 end;
    real_el := extract(epoch from (clock_timestamp() - rd.started_at))::numeric;
    update rounds set skip_seconds = (boundary - real_el + 0.001) where id = rd.id;
    if boundary = 360 then perform game_private.finalize_round(rd.id); end if;
  end if;
  perform game_private.touch_room(r.id);
end $$;

-- Chủ phòng kết thúc lượt ngay lập tức và lưu kết quả.
create or replace function public.end_round(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'running' then raise exception 'ROUND_NOT_RUNNING'; end if;
  perform game_private.finalize_round(rd.id);
  perform game_private.touch_room(r.id);
end $$;

-- Mở/đóng quyền sửa sai (chỉ trong giai đoạn Kiểm tra và hỗ trợ).
create or replace function public.set_correction(p_code text, p_open boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'running' or game_private.phase_now(rd) <> 'review' then raise exception 'WRONG_PHASE'; end if;
  update rounds set correction_open = coalesce(p_open, false) where id = rd.id;
  perform game_private.touch_room(r.id);
end $$;

-- Quyền hỗ trợ: mỗi lượt đúng một lần, chỉ sau lần chấm đầu tiên (giai đoạn Kiểm tra và hỗ trợ).
create or replace function public.use_hint(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'running' or game_private.phase_now(rd) <> 'review' then raise exception 'HINT_NOT_AVAILABLE'; end if;
  if rd.hint_used then raise exception 'HINT_ALREADY_USED'; end if;
  update rounds set hint_used = true, hint_used_at = now() where id = rd.id;
  perform game_private.touch_room(r.id);
end $$;

-- Nộp đáp án trong giai đoạn Làm bài. Nộp lặp không làm thay đổi hay tăng điểm.
create or replace function public.submit_answer(p_code text, p_question_id text, p_z int, p_period int, p_group int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user(); r rooms; rd rounds; pl_id uuid; ok boolean; n int;
begin
  if p_z is null or p_z < 1 or p_z > 20 or p_period is null or p_period < 1 or p_period > 4
     or p_group is null or p_group < 1 or p_group > 18 then raise exception 'INVALID_INPUT'; end if;
  select * into r from rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select id into pl_id from players where room_id = r.id and user_id = uid;
  if not found then raise exception 'NOT_A_PLAYER'; end if;
  select * into rd from rounds where id = r.current_round_id;
  if rd.status <> 'running' or game_private.phase_now(rd) <> 'work' then raise exception 'SUBMISSIONS_CLOSED'; end if;
  if not exists (select 1 from assignments where round_id = rd.id and question_id = p_question_id and player_id = pl_id) then
    raise exception 'NOT_ASSIGNED';
  end if;

  ok := game_private.grade(p_question_id, p_z, p_period, p_group);
  insert into answers (round_id, question_id, player_id, selected_z, claimed_period, claimed_group,
                       is_correct, first_selected_z, first_period, first_group, first_correct)
  values (rd.id, p_question_id, pl_id, p_z, p_period, p_group, ok, p_z, p_period, p_group, ok)
  on conflict (round_id, question_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('status', 'already_submitted'); end if;
  perform game_private.touch_room(r.id);
  return jsonb_build_object('status', 'submitted');
end $$;

-- Sửa sai: chỉ khi giáo viên mở quyền, chỉ trong giai đoạn Kiểm tra, chỉ câu đang sai, mỗi câu một lần.
create or replace function public.correct_answer(p_code text, p_question_id text, p_z int, p_period int, p_group int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user(); r rooms; rd rounds; pl_id uuid; a answers;
begin
  if p_z is null or p_z < 1 or p_z > 20 or p_period is null or p_period < 1 or p_period > 4
     or p_group is null or p_group < 1 or p_group > 18 then raise exception 'INVALID_INPUT'; end if;
  select * into r from rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select id into pl_id from players where room_id = r.id and user_id = uid;
  if not found then raise exception 'NOT_A_PLAYER'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'running' or game_private.phase_now(rd) <> 'review' or not rd.correction_open then
    raise exception 'CORRECTION_CLOSED';
  end if;
  select * into a from answers where round_id = rd.id and question_id = p_question_id and player_id = pl_id for update;
  if not found then raise exception 'NO_ANSWER_TO_CORRECT'; end if;
  if a.is_correct then raise exception 'ALREADY_CORRECT'; end if;
  if a.corrected then raise exception 'CORRECTION_ALREADY_USED'; end if;

  update answers
     set selected_z = p_z, claimed_period = p_period, claimed_group = p_group,
         is_correct = game_private.grade(p_question_id, p_z, p_period, p_group),
         corrected = true, corrected_at = now()
   where id = a.id;
  perform game_private.touch_room(r.id);
  return jsonb_build_object('status', 'corrected');
end $$;

-- Tạo lượt mới sau khi lượt hiện tại đã kết thúc. Dữ liệu các lượt cũ được giữ nguyên.
create or replace function public.new_round(p_code text, p_set text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms; rd rounds; v_new uuid; v_no int;
begin
  if p_set not in ('main', 'reserve') then raise exception 'INVALID_SET'; end if;
  select * into r from rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid then raise exception 'NOT_HOST'; end if;
  select * into rd from rounds where id = r.current_round_id for update;
  if rd.status <> 'finished' then raise exception 'ROUND_NOT_FINISHED'; end if;
  select coalesce(max(round_no), 0) + 1 into v_no from rounds where room_id = r.id;
  insert into rounds (room_id, round_no, question_set) values (r.id, v_no, p_set) returning id into v_new;
  update rooms set current_round_id = v_new where id = r.id;
  perform game_private.touch_room(r.id);
end $$;

-- Lịch sử các lượt đã kết thúc của phòng (để xem lại).
create or replace function public.list_rounds(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := game_private.require_user(); r rooms;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id <> uid and not exists (select 1 from players where room_id = r.id and user_id = uid) then
    raise exception 'NOT_A_MEMBER';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'round_no', x.round_no, 'set', x.question_set, 'finished_at', x.finished_at, 'result', x.result)
            order by x.round_no)
          from rounds x where x.room_id = r.id and x.status = 'finished'), '[]'::jsonb);
end $$;

-- Toàn bộ trạng thái mà trình duyệt cần. Dữ liệu được lọc theo vai trò và giai đoạn:
--   trước khi hết giờ làm bài: không có đúng/sai, không có đáp án, không có giải thích;
--   giai đoạn Kiểm tra: đúng/sai, giải thích của câu đã đúng, gợi ý hỗ trợ (nếu đã dùng);
--   giai đoạn Xác nhận và Kết thúc: toàn bộ đáp án, giải thích và kết quả.
create or replace function public.get_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := game_private.require_user();
  r rooms; rd rounds;
  v_role text; v_me_id uuid; v_me_name text;
  v_phase text; v_reveal int;
  v_players jsonb; v_tasks jsonb; v_progress jsonb; v_answers jsonb;
  v_board jsonb := '[]'::jsonb; v_expl jsonb := '{}'::jsonb; v_hints jsonb := '{}'::jsonb; v_result jsonb;
begin
  select * into r from rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id = uid then
    v_role := 'host';
  else
    select id, display_name into v_me_id, v_me_name from players where room_id = r.id and user_id = uid;
    if v_me_id is null then raise exception 'NOT_A_MEMBER'; end if;
    v_role := 'player';
  end if;

  select * into rd from rounds where id = r.current_round_id;
  if rd.status = 'running' and game_private.elapsed(rd) >= 360 then
    perform game_private.finalize_round(rd.id);
    select * into rd from rounds where id = rd.id;
  end if;

  v_phase := game_private.phase_now(rd);
  v_reveal := case when v_phase in ('lobby', 'intro', 'work') then 0
                   when v_phase = 'review' then 1 else 2 end;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.joined_at, p.id), '[]'::jsonb)
    into v_players from players p where p.room_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.id, 'ord', q.ord, 'player_id', asg.player_id) order by q.ord), '[]'::jsonb)
    into v_tasks
    from assignments asg join question_bank q on q.id = asg.question_id
   where asg.round_id = rd.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', p.id, 'name', p.display_name, 'assigned', x.assigned, 'submitted', x.submitted,
           'correct', case when v_reveal >= 1 then x.correct else null end)
         order by p.joined_at, p.id), '[]'::jsonb)
    into v_progress
    from players p
    left join lateral (
      select count(asg.id) as assigned, count(a.id) as submitted, count(a.id) filter (where a.is_correct) as correct
      from assignments asg
      left join answers a on a.round_id = asg.round_id and a.question_id = asg.question_id
      where asg.round_id = rd.id and asg.player_id = p.id) x on true
   where p.room_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', a.question_id, 'player_id', a.player_id, 'selected_z', a.selected_z,
           'period', a.claimed_period, 'group', a.claimed_group, 'corrected', a.corrected,
           'correct', case when v_reveal >= 1 then a.is_correct else null end,
           'first_correct', case when v_reveal >= 1 then a.first_correct else null end)), '[]'::jsonb)
    into v_answers
    from answers a
   where a.round_id = rd.id and (v_role = 'host' or a.player_id = v_me_id);

  if v_reveal >= 1 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'question_id', q.id, 'ord', q.ord, 'atomic_number', q.atomic_number,
             'correct', coalesce(a.is_correct, false), 'player_id', asg.player_id) order by q.ord), '[]'::jsonb)
      into v_board
      from assignments asg
      join question_bank q on q.id = asg.question_id
      left join answers a on a.round_id = asg.round_id and a.question_id = asg.question_id
     where asg.round_id = rd.id and (v_reveal = 2 or coalesce(a.is_correct, false));

    select coalesce(jsonb_object_agg(q.id, q.explanation), '{}'::jsonb)
      into v_expl
      from question_bank q
     where q.id in (select b ->> 'question_id' from jsonb_array_elements(v_board) b);

    if rd.hint_used and v_phase = 'review' then
      select coalesce(jsonb_object_agg(q.id, q.support_hint), '{}'::jsonb)
        into v_hints
        from assignments asg
        join question_bank q on q.id = asg.question_id
        left join answers a on a.round_id = asg.round_id and a.question_id = asg.question_id
       where asg.round_id = rd.id and not coalesce(a.is_correct, false);
    end if;
  end if;

  if v_reveal = 2 then
    v_result := coalesce(rd.result, game_private.compute_results(rd.id));
  end if;

  return jsonb_build_object(
    'server_time', now(),
    'role', v_role,
    'room', jsonb_build_object('code', r.code, 'max_players', r.max_players, 'version', r.version),
    'me', case when v_me_id is null then null else jsonb_build_object('player_id', v_me_id, 'name', v_me_name) end,
    'players', v_players,
    'round', jsonb_build_object(
      'id', rd.id, 'round_no', rd.round_no, 'set', rd.question_set, 'status', rd.status, 'phase', v_phase,
      'elapsed', case when rd.status = 'running' then game_private.elapsed(rd) else null end,
      'correction_open', rd.correction_open, 'hint_used', rd.hint_used),
    'tasks', v_tasks,
    'progress', v_progress,
    'answers', v_answers,
    'board', v_board,
    'explanations', v_expl,
    'hints', v_hints,
    'result', v_result);
end $$;

-- ---------------------------------------------------------------------
-- 4. Dữ liệu mẫu: bảng tuần hoàn H-Ca và đáp án chuẩn của 20 câu hỏi
--    (sinh từ questions.json; nếu sửa questions.json hãy sửa phần này cho khớp)
-- ---------------------------------------------------------------------
insert into public.periodic_elements (atomic_number, symbol, name, period, grp, block) values
  (1, 'H', 'Hydrogen', 1, 1, 's'),
  (2, 'He', 'Helium', 1, 18, 's'),
  (3, 'Li', 'Lithium', 2, 1, 's'),
  (4, 'Be', 'Beryllium', 2, 2, 's'),
  (5, 'B', 'Boron', 2, 13, 'p'),
  (6, 'C', 'Carbon', 2, 14, 'p'),
  (7, 'N', 'Nitrogen', 2, 15, 'p'),
  (8, 'O', 'Oxygen', 2, 16, 'p'),
  (9, 'F', 'Fluorine', 2, 17, 'p'),
  (10, 'Ne', 'Neon', 2, 18, 'p'),
  (11, 'Na', 'Sodium', 3, 1, 's'),
  (12, 'Mg', 'Magnesium', 3, 2, 's'),
  (13, 'Al', 'Aluminium', 3, 13, 'p'),
  (14, 'Si', 'Silicon', 3, 14, 'p'),
  (15, 'P', 'Phosphorus', 3, 15, 'p'),
  (16, 'S', 'Sulfur', 3, 16, 'p'),
  (17, 'Cl', 'Chlorine', 3, 17, 'p'),
  (18, 'Ar', 'Argon', 3, 18, 'p'),
  (19, 'K', 'Potassium', 4, 1, 's'),
  (20, 'Ca', 'Calcium', 4, 2, 's')
on conflict (atomic_number) do update set symbol = excluded.symbol, name = excluded.name,
  period = excluded.period, grp = excluded.grp, block = excluded.block;

insert into public.question_bank (id, set_name, ord, atomic_number, support_hint, explanation) values
  ('Q01', 'main', 1, 3, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 3. Nguyên tử có 2 lớp electron và 1 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 1.'),
  ('Q02', 'main', 2, 4, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 4. Nguyên tử có 2 lớp electron và 2 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 2.'),
  ('Q03', 'main', 3, 5, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 5. Nguyên tử có 2 lớp electron và 3 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 13.'),
  ('Q04', 'main', 4, 8, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 8. Nguyên tử có 2 lớp electron và 6 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 16.'),
  ('Q05', 'main', 5, 11, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Cấu hình electron là 1s² 2s² 2p⁶ 3s¹. Nguyên tử có 3 lớp electron và 1 electron lớp ngoài cùng.'),
  ('Q06', 'main', 6, 12, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Cấu hình electron là 1s² 2s² 2p⁶ 3s². Nguyên tử có 3 lớp electron và 2 electron lớp ngoài cùng.'),
  ('Q07', 'main', 7, 16, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Cấu hình electron là 1s² 2s² 2p⁶ 3s² 3p⁴. Nguyên tử có 3 lớp electron và 6 electron lớp ngoài cùng.'),
  ('Q08', 'main', 8, 17, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Cấu hình electron là 1s² 2s² 2p⁶ 3s² 3p⁵. Nguyên tử có 3 lớp electron và 7 electron lớp ngoài cùng.'),
  ('Q09', 'main', 9, 6, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 6. Nguyên tử có 2 lớp electron và 4 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 14.'),
  ('Q10', 'main', 10, 9, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 9. Nguyên tử có 2 lớp electron và 7 electron lớp ngoài cùng, nên thuộc chu kỳ 2, nhóm 17.'),
  ('Q11', 'reserve', 1, 1, 'Nguyên tố có 1 lớp electron nên thuộc chu kỳ 1. Chu kỳ 1 chỉ có 2 ô, hãy dựa vào số electron để chọn đúng ô.', 'Nguyên tử có 1 electron nên Z = 1, cấu hình electron là 1s¹. Nguyên tử có 1 lớp electron và 1 electron lớp ngoài cùng, nên thuộc chu kỳ 1, nhóm 1 (IA), khối s.'),
  ('Q12', 'reserve', 2, 2, 'Nguyên tố có 1 lớp electron nên thuộc chu kỳ 1. Chu kỳ 1 chỉ có 2 ô, hãy dựa vào số electron để chọn đúng ô.', 'Cấu hình 1s² có 2 electron nên Z = 2. Nguyên tử có 1 lớp electron nên thuộc chu kỳ 1. Lớp ngoài cùng đã bão hòa với 2 electron nên He được xếp ở nhóm 18 (VIIIA, nhóm khí hiếm), dù electron cuối cùng điền vào phân lớp s.'),
  ('Q13', 'reserve', 3, 7, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', '2 lớp electron nên X thuộc chu kỳ 2. Lớp ngoài cùng có 5 electron (2s² 2p³) nên X thuộc nhóm 15 (VA), khối p. Cấu hình là 1s² 2s² 2p³, Z = 7.'),
  ('Q14', 'reserve', 4, 10, 'Nguyên tố có 2 lớp electron nên thuộc chu kỳ 2. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Khí hiếm (trừ He) có 8 electron ở lớp ngoài cùng. X có 2 lớp electron nên cấu hình là 1s² 2s² 2p⁶, Z = 10, thuộc chu kỳ 2, nhóm 18 (VIIIA), khối p.'),
  ('Q15', 'reserve', 5, 13, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Chu kỳ 3 nên có 3 lớp electron. Lớp ngoài cùng có 3 electron (3s² 3p¹) nên X thuộc nhóm 13 (IIIA), khối p. Cấu hình là 1s² 2s² 2p⁶ 3s² 3p¹, Z = 13.'),
  ('Q16', 'reserve', 6, 14, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 14 nên Z = 14. Nguyên tử có 3 lớp electron nên thuộc chu kỳ 3. Lớp ngoài cùng 3s² 3p² có 4 electron nên thuộc nhóm 14 (IVA), khối p.'),
  ('Q17', 'reserve', 7, 15, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', '3 lớp electron nên X thuộc chu kỳ 3. Lớp ngoài cùng có 5 electron (3s² 3p³) nên X thuộc nhóm 15 (VA), khối p. Cấu hình là 1s² 2s² 2p⁶ 3s² 3p³, Z = 15.'),
  ('Q18', 'reserve', 8, 18, 'Nguyên tố có 3 lớp electron nên thuộc chu kỳ 3. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Z = 18, cấu hình electron là 1s² 2s² 2p⁶ 3s² 3p⁶. Nguyên tử có 3 lớp electron và 8 electron lớp ngoài cùng, nên thuộc chu kỳ 3, nhóm 18 (VIIIA), khối p.'),
  ('Q19', 'reserve', 9, 19, 'Nguyên tố có 4 lớp electron nên thuộc chu kỳ 4. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Tổng số electron là 19 nên Z = 19. Nguyên tử có 4 lớp electron nên thuộc chu kỳ 4. Lớp ngoài cùng 4s¹ có 1 electron nên thuộc nhóm 1 (IA), khối s.'),
  ('Q20', 'reserve', 10, 20, 'Nguyên tố có 4 lớp electron nên thuộc chu kỳ 4. Hãy đếm số electron ở lớp ngoài cùng để xác định nhóm.', 'Chu kỳ 4 nên có 4 lớp electron. Lớp ngoài cùng 4s² có 2 electron nên X thuộc nhóm 2 (IIA), khối s. Cấu hình là 1s² 2s² 2p⁶ 3s² 3p⁶ 4s², Z = 20.')
on conflict (id) do update set set_name = excluded.set_name, ord = excluded.ord,
  atomic_number = excluded.atomic_number, support_hint = excluded.support_hint, explanation = excluded.explanation;

-- ---------------------------------------------------------------------
-- 5. Bảo mật: RLS và phân quyền
-- ---------------------------------------------------------------------
alter table public.periodic_elements enable row level security;
alter table public.question_bank     enable row level security;
alter table public.rooms             enable row level security;
alter table public.players           enable row level security;
alter table public.rounds            enable row level security;
alter table public.assignments       enable row level security;
alter table public.answers           enable row level security;

drop policy if exists rooms_select_members on public.rooms;
create policy rooms_select_members on public.rooms
  for select to authenticated
  using (host_id = (select auth.uid()) or game_private.is_member(id));

-- Không có chính sách INSERT/UPDATE/DELETE nào cho trình duyệt: mọi thay đổi đi qua hàm RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.rooms to authenticated;

revoke all on schema game_private from public;
revoke all on all functions in schema game_private from public, anon, authenticated;
grant usage on schema game_private to authenticated;
grant execute on function game_private.is_member(uuid) to authenticated;

revoke execute on function
  public.create_room(int), public.join_room(text, text), public.remove_player(text, uuid),
  public.check_round_set(text, int[]), public.start_round(text), public.advance_phase(text),
  public.end_round(text), public.set_correction(text, boolean), public.use_hint(text),
  public.submit_answer(text, text, int, int, int), public.correct_answer(text, text, int, int, int),
  public.new_round(text, text), public.list_rounds(text), public.get_state(text)
  from public, anon;
grant execute on function
  public.create_room(int), public.join_room(text, text), public.remove_player(text, uuid),
  public.check_round_set(text, int[]), public.start_round(text), public.advance_phase(text),
  public.end_round(text), public.set_correction(text, boolean), public.use_hint(text),
  public.submit_answer(text, text, int, int, int), public.correct_answer(text, text, int, int, int),
  public.new_round(text, text), public.list_rounds(text), public.get_state(text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 6. Realtime: chỉ bảng rooms (mỗi thao tác tăng rooms.version để báo cho các trình duyệt tải lại trạng thái)
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'Chưa có publication supabase_realtime: hãy bật Realtime cho bảng rooms trong Dashboard.';
end $$;
