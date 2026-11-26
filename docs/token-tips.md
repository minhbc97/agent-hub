# Mẹo tiết kiệm token

Rút ra từ hai ngày chạy một team bốn agent (PM, BE, QA trên Claude; FE trên Codex) sửa bug và review code trên một
monorepo thật. Số liệu là chi phí quy đổi hub ghi lại cho từng lượt (gói thuê bao không trừ tiền theo số này, nhưng
nó tỉ lệ với phần trăm hạn mức bị dùng).

## Ý chính

Token tốn nhất không nằm ở lượt làm việc thật, mà ở lượt **không ra kết quả**: hỏi lại, chờ môi trường, làm việc đã
bỏ, đọc lại context dài. Mỗi lượt đều phải đọc lại toàn bộ session, nên một lượt "chỉ hỏi một câu" trên session
100 nghìn token vẫn tốn như đọc 100 nghìn token.

## 1. Chuẩn bị môi trường trước khi giao việc

| Hiện tượng | Đã tốn | Cách tránh |
| --- | --- | --- |
| Worktree của agent chưa có `node_modules` | QA không chạy được tsc và test nên "PASS có điều kiện", phải kiểm lại cả lượt | Cài dependency (offline nếu được), `prisma generate`, build package dùng chung cho mọi worktree trước lượt đầu |
| Codex treo ở lần đầu vì sandbox phải gắn quyền lên cả worktree | 4 lượt FE không làm được gì | Cho Codex chạy một lệnh trong worktree **trước** khi cài `node_modules`, hoặc chạy `codex sandbox ... -- cmd /c echo ok` một lần |
| Agent bị chặn quyền chạy lệnh (`npm test`, `tsc`) | Agent đọc code, đoán, rồi báo "chưa chạy được" | Thêm lệnh cần thiết vào **Lệnh được phép** (ví dụ `pnpm`, `node`) trước khi giao task cần test |
| Codex ghi vào `.git` | Bị sandbox chặn có chủ đích, mở thêm `writable_roots` cũng không ăn | Agent Codex chỉ sửa file; để hub commit code của task. Sửa tiếp task đã xong thì tạo task mới |

## 2. Không để agent hỏi những gì đã biết

| Hiện tượng | Đã tốn | Cách tránh |
| --- | --- | --- |
| Rule của repo bắt agent hỏi chọn chế độ (ví dụ antislop DURING/AFTER) | 6 task, mỗi task một lượt chỉ để hỏi | Lưu lựa chọn mặc định cho cả máy, hoặc ghi sẵn vào vai trò agent trước khi giao việc |
| Câu trả lời của người dùng nằm cuối hàng đợi | Agent đọc tới task nào hỏi task đó | Gửi câu trả lời dạng **gấp** để chen lên đầu hàng |
| Câu hỏi gắn với task đã xong không đóng khi trả lời | Mỗi lần bấm là một lượt mới của PM (5 lần cho một câu) | Đã sửa trong hub (`db2d0b4`); nếu thấy câu hỏi không mất, đừng bấm lại |
| Agent hỏi lại brief sau khi đổi session | Một vòng hỏi qua PM, PM cũng không có brief | Hub giữ brief của task qua session; khi gửi tin cho task cũ, kèm brief đầy đủ |

## 3. Không để agent làm việc đã bỏ

| Hiện tượng | Đã tốn | Cách tránh |
| --- | --- | --- |
| Tin cũ của task đã lưu trữ vẫn nằm trong hàng đợi | BE làm lại cả task cũ: 15 nghìn output, khoảng 0,55 USD | Trước khi bỏ tạm dừng agent, dọn tin của task đã xong hoặc đã lưu trữ |
| Bỏ tạm dừng agent để chạy một task, các tin khác chạy theo | Một lượt review ngoài kế hoạch | Gửi tin **gấp** cho task cần chạy, bỏ tạm dừng, rồi tạm dừng lại ngay khi lượt đó bắt đầu (lượt đang chạy vẫn làm hết) |
| Workflow định kỳ gọi dịch vụ đang hỏng (Jira bị khoá) | Khoảng 0,17–0,19 USD mỗi lần, không ra kết quả | Tắt các workflow phụ thuộc dịch vụ đó cho tới khi nó chạy lại |
| Lead agent tự sinh task mới | Thêm audit, review ngoài yêu cầu | Dặn lead agent không tạo task khi người dùng chưa duyệt danh sách |

## 4. Giữ context nhỏ

| Hiện tượng | Đã tốn | Cách tránh |
| --- | --- | --- |
| Gửi tin "sửa tiếp" vào session đang dài | Một lượt FE: 14 phút, 12 triệu token cache, context 220 nghìn, không ra commit | Mỗi việc sửa là một task mới; session mới bắt đầu ở 35–60 nghìn |
| Lượt dài làm session vượt ngưỡng | Hai lượt BE 1,1–1,2 USD, context 120–165 nghìn | Hạ ngưỡng xoay session của agent Claude xuống khoảng 60 nghìn token |
| Session nghỉ quá 60 phút, cache đã hết hạn, hub vẫn hỏi agent viết sổ bàn giao | 0,43 USD cho một lượt 10 giây, nhiều hơn cả lượt làm việc thật | Đã sửa trong hub (`3649aca`): hub tự viết sổ khi session nghỉ lâu |
| Xoay session khi cache còn nóng | Khoảng 0,03 USD mỗi lần | Chấp nhận được; đây là cái giá của session nhỏ |
| Phiên chat điều phối (với Claude) kéo quá dài | Chiếm phần lớn hạn mức của cả buổi | Mở phiên mới khi đổi chủ đề, dán một đoạn tóm tắt trạng thái thay vì giữ cả lịch sử |

## 5. Brief tốt thì ít lượt

- Ghi sẵn nguyên nhân nếu đã biết, kèm `file:line`. Agent không phải dò lại.
- Ghi rõ "Done when" đo được và lệnh kiểm tra cần chạy.
- Ghi điều **không** làm: không đụng phần nào, không chạy lệnh DB, không dev server, không build toàn bộ.
- Bắt agent tự `git diff --stat` và bỏ thay đổi ngoài phạm vi trước khi báo xong. Một dòng sửa lố (khung trích dẫn)
  đã làm hai task phải quay lại.
- Yêu cầu kết quả theo khuôn cố định (Nguyên nhân, Cách fix, Phạm vi ảnh hưởng). Bước sau và comment Jira dùng lại được,
  không phải hỏi.
- Gộp bước khi được: PM merge và comment Jira trong cùng một lượt tiết kiệm một lượt mỗi task.

## 6. Chia hạn mức theo engine

- Việc đọc nhiều, sửa giao diện: engine có hạn mức dư (ở đây là Codex). Việc cần quyền chạy lệnh rộng, kiểm tra: Claude.
- Đừng dồn PM, BE, QA cùng lúc lên một engine khi hạn mức đã quá nửa; giữ phần cho QA, vì code chưa kiểm thì chưa merge được.
- Xem hạn mức theo từng agent ở trang Usage, và lượt tốn nhiều nhất ở tab lượt của agent. Lượt ngắn mà tốn nhiều
  thường là lượt đọc lại context lớn.

## Kiểm tra nhanh trước khi cho team chạy

1. Worktree mọi agent đã có dependency, và sandbox Codex đã chạy thử một lệnh.
2. Lệnh test, build mà agent cần đã nằm trong **Lệnh được phép**.
3. Các lựa chọn rule bắt hỏi (chế độ, quy ước) đã ghi sẵn.
4. Hàng đợi không còn tin của task đã xong hoặc đã lưu trữ.
5. Workflow định kỳ phụ thuộc dịch vụ ngoài: dịch vụ đó đang chạy.
6. Ngưỡng xoay session phù hợp (Claude khoảng 60 nghìn).
