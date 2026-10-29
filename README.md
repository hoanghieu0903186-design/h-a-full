# Giải mã bản đồ nguyên tố (phiên bản trực tuyến)

Trò chơi Hóa học 10 (Bài 5, bảng tuần hoàn) cho nhiều người chơi cùng lúc. Học sinh giải mã dữ kiện, xác định nguyên tố và định vị đúng ô trên bảng tuần hoàn H–Ca. Khi đủ 10 câu đúng, bảng của đội có 10 nguyên tố tại 10 ô khác nhau.

- Giao diện: HTML + CSS + JavaScript thuần, không build. Trình duyệt chỉ nói chuyện với máy chủ trò chơi cùng địa chỉ, không có URL hay khóa Supabase nào trong mã giao diện.
- Máy chủ trò chơi: Node.js + Express (`server.js`). Phục vụ giao diện, cấp phiên ẩn danh, chuyển tiếp thao tác tới Supabase bằng JWT của từng người chơi, và đẩy sự kiện thời gian thực tới trình duyệt qua Server-Sent Events.
- Cơ sở dữ liệu: Supabase (PostgreSQL, Auth ẩn danh, Realtime). Toàn bộ luật chơi (đồng hồ, giai đoạn, phân công, chấm điểm, quyền hỗ trợ) vẫn chạy bằng hàm SQL, nên máy chủ Node không thể tự cộng điểm hay đổi đồng hồ.
- Hosting: cần dịch vụ chạy Node liên tục (Render, Railway, Fly.io, VPS…). Hosting tĩnh thuần không đủ nữa.

```text
Trình duyệt ──HTTP + SSE──▶ server.js ──JWT người chơi──▶ Supabase (hàm RPC + RLS)
                                 ▲                                │
                                 └──── Realtime (service_role) ◀──┘
```

## Cấu trúc

```text
index.html      giao diện các màn hình
style.css       thiết kế, responsive
app.js          logic giao diện, bảng tuần hoàn, gọi API của server.js
server.js       máy chủ Express (API, SSE, Realtime)
package.json    thư viện cần cài: express, @supabase/supabase-js, dotenv
.env.example    mẫu biến môi trường (sao chép thành .env)
.gitignore      loại .env và node_modules khỏi git
questions.json  ngân hàng 20 câu (10 chính + 10 dự phòng)
Ngan-hang-20-cau-hoi-Giai-ma-ban-do-nguyen-to.docx   tài liệu in cho lớp
supabase/schema.sql   bảng, ràng buộc, RLS, hàm RPC, đáp án chuẩn
```

## Cài đặt từng bước

### 1. Tạo dự án Supabase
Vào https://supabase.com, tạo dự án mới (gói Free đủ dùng). Đợi dự án khởi tạo xong.

### 2. Bật đăng nhập ẩn danh
Authentication → Sign In / Providers → bật **Allow anonymous sign-ins**. Học sinh không cần tài khoản; trình duyệt nhận một định danh ẩn danh ổn định, nên tải lại trang vẫn giữ nguyên người chơi, câu được giao và quyền của chủ phòng.

### 3. Chạy `schema.sql`
SQL Editor → New query → dán toàn bộ `supabase/schema.sql` → Run. Tệp chạy lại nhiều lần được. Tệp tạo bảng, khóa chính/ngoại, ràng buộc duy nhất, chỉ mục, các hàm RPC, dữ liệu bảng tuần hoàn và đáp án chuẩn 20 câu.

### 4. Realtime
Cuối `schema.sql` tự thêm bảng `rooms` vào publication `supabase_realtime`. Kiểm tra: Database → Publications → `supabase_realtime` phải có `rooms`. Nếu chưa có, bật Realtime cho bảng `rooms` trong Table Editor. Trò chơi còn tự hỏi lại máy chủ mỗi 3 giây, nên vẫn chạy được (chậm hơn) nếu Realtime chưa bật.

### 5. RLS
Đã thiết lập trong `schema.sql`. Mọi bảng bật RLS. Trình duyệt không ghi được và không đọc được bảng nào trừ việc đọc `rooms` (để nhận tín hiệu Realtime). Mọi thao tác đi qua hàm RPC kiểm tra quyền chủ phòng, giai đoạn, nộp lặp, quyền hỗ trợ một lần. Không cần cấu hình thêm.

### 6. Điền cấu hình `.env`
Project Settings → API. Sao chép `.env.example` thành `.env` rồi điền:

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=khóa anon / publishable
SUPABASE_SERVICE_ROLE_KEY=khóa service_role / secret
```

`SUPABASE_SERVICE_ROLE_KEY` rất nhạy cảm: chỉ nằm trong `.env` (đã có trong `.gitignore`) hoặc trong biến môi trường của dịch vụ hosting. Không đưa lên GitHub, không dán vào `app.js`. Máy chủ chỉ dùng nó để nghe Supabase Realtime. Thiếu biến nào, máy chủ dừng ngay và báo rõ.

### 7. Cài và chạy
Cần Node.js 18 trở lên.

```bash
npm install
npm start
```

Mở http://localhost:3000. Không mở `index.html` trực tiếp bằng `file://`.

### 8. Triển khai
Đưa mã lên GitHub (không có `.env`), tạo Web Service Node trên Render/Railway/Fly.io với Build command `npm install`, Start command `npm start`, rồi khai báo ba biến môi trường ở trên. Chỉ chạy **một** bản (instance) của máy chủ. Gói miễn phí thường tự ngủ sau một thời gian không dùng, lần mở đầu sẽ chậm; hãy mở trước giờ dạy. Nhớ bật Anonymous sign-ins (bước 2).

### 9. Kiểm tra bằng ít nhất hai thiết bị
Một máy tạo phòng (giáo viên), một điện thoại và một trình duyệt khác vào bằng mã phòng. Thử một vòng đầy đủ trước giờ dạy.

## Cách chơi

1. Giáo viên chọn số người tối đa (1–10), tạo phòng, chia mã 6 ký tự.
2. Học sinh nhập mã và tên, vào phòng chờ. Giáo viên bấm Bắt đầu: 10 câu được chia đều cho những người đã vào (10 người: mỗi người 1 câu; ít người hơn: một người nhận nhiều câu, không bỏ câu nào).
3. Đồng hồ máy chủ: Hướng dẫn 30 giây → Làm bài 180 giây → Kiểm tra và hỗ trợ 90 giây → Xác nhận 60 giây. Hết 180 giây làm bài hiện **PHONG TỎA HỒ SƠ!** và khóa nộp. Hết 360 giây lượt tự kết thúc và lưu kết quả. Giáo viên có thể bấm chuyển giai đoạn sớm.
4. Mỗi câu: chạm ô nguyên tố trên bảng, chọn thẻ chu kỳ/nhóm đúng, nộp. Câu chỉ đúng khi đúng cả ô nguyên tố lẫn chu kỳ và nhóm. Nộp xong bị khóa; nộp lặp không đổi kết quả.
5. Giai đoạn kiểm tra: giáo viên có thể dùng quyền hỗ trợ (1 lần mỗi lượt, hiện gợi ý cho câu chưa đúng, không tự chọn ô) và mở quyền sửa sai (mỗi câu sai được sửa 1 lần).
6. Đội đạt khi số người hoàn thành ≥ `ceil(0.70 × số người tham gia)`. Người hoàn thành là người đúng toàn bộ câu được giao.
7. Chơi lại tạo lượt mới (bộ chính hoặc dự phòng), dữ liệu lượt cũ được giữ.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| "Không kết nối được máy chủ trò chơi" | Máy chủ chưa chạy, `.env` sai, hoặc chưa bật Anonymous sign-ins (bước 2). Xem log của máy chủ. |
| Máy chủ báo "Thiếu biến môi trường" | Điền đủ ba biến trong `.env` hoặc trong cấu hình hosting. |
| Báo lỗi `function ... does not exist` hoặc `permission denied for function` | Chạy lại toàn bộ `schema.sql`; sau đó chờ vài giây để API làm mới lược đồ. |
| Học sinh thấy thay đổi chậm (tới 3 giây) | Luồng SSE bị đứt (proxy/wifi chặn kết nối dài). Trang vẫn tự hỏi lại mỗi 3 giây. Một số proxy cần tắt bộ đệm cho đường `/api/events`. |
| "Dữ liệu questions.json không khớp đáp án trên máy chủ" | Bạn đã sửa `questions.json` hoặc phần dữ liệu cuối `schema.sql` mà không sửa bên còn lại. Sửa cho khớp. |
| Dự án Supabase Free bị tạm dừng sau thời gian dài không dùng | Vào dashboard bấm Restore project. |

## Giới hạn đã biết và cần bạn tự xác nhận

- **`questions.json` là tệp công khai** và (theo đúng đặc tả) chứa các trường đáp án như `atomicNumber`, `period`, `group`. Học sinh biết mở công cụ nhà phát triển có thể đọc. Việc chấm điểm, giải thích, gợi ý hỗ trợ và đáp án trong lúc làm bài đều do Supabase giữ kín và chấm, nhưng tệp này thì không. Nếu cần chống gian lận chặt, tách một bản chỉ có đề cho học sinh; phần chấm điểm không cần sửa.
- **Chưa kiểm thử với Express/Supabase thật.** Môi trường làm việc không cài được gói npm và không có Supabase thật. Đã kiểm thử: lược đồ SQL và luồng chơi trên PostgreSQL 16 thật; `server.js` và giao diện trên Chromium, chạy với một bản giả tối thiểu của `express`/`dotenv`, bản giả của Supabase (Auth và RPC) nối vào PostgreSQL thật. Chưa kiểm thử: `npm install`, Express thật, Supabase Auth/Realtime thật. Hãy chơi thử một vòng trên 2 thiết bị trước giờ dạy.
- Chưa kiểm tra Safari/Firefox hay thiết bị thật; Chromium 390 px thì đã xem. Bảng tuần hoàn có thanh cuộn ngang trên màn hình nhỏ.
- Token truy cập nằm trong địa chỉ của luồng SSE (`EventSource` không gửi được header). Máy chủ đặt `Referrer-Policy: no-referrer`; nếu đặt máy chủ sau proxy, đừng ghi log đầy đủ địa chỉ truy vấn.
- Giới hạn tần suất và danh sách kết nối SSE nằm trong bộ nhớ, nên chỉ chạy một instance. Nhiều instance thì thông báo sau thao tác chỉ tới người cùng instance (Realtime vẫn bù lại).
- Phiên ẩn danh lưu trong localStorage của trình duyệt: xóa dữ liệu trình duyệt, đổi thiết bị hoặc dùng chế độ ẩn danh sẽ mất danh tính (kể cả quyền chủ phòng). Phiên được làm mới tự động; nếu refresh token bị Supabase thu hồi, người chơi bị cấp danh tính mới.
- Người chơi chỉ vào được phòng khi lượt đang ở phòng chờ; người đã vào thì vào lại bằng cùng trình duyệt.
- Người chưa nộp bài bị tính là chưa hoàn thành; không có cơ chế đổi người giữa chừng.
- Các lượt cũ và phòng không tự xóa. Tự dọn bằng SQL nếu cần.
