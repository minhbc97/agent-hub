# Hướng dẫn sử dụng

Tài liệu này dành cho người dùng app. Cách cài và chạy xem [README](../README.md#chạy-từ-source).

## 1. Khái niệm

| Khái niệm | Nghĩa |
| --- | --- |
| **Workspace** | Một team agent làm việc trên một repo. Mỗi workspace có agent, task, workflow và cài đặt riêng. |
| **Agent** | Một CLI (Claude Code, Codex hoặc lệnh tùy chỉnh) cùng vai trò, model, thư mục làm việc. |
| **Lượt (turn / run)** | Hub chạy CLI một lần cho một tin nhắn đến, ở chế độ headless. Lượt sau nối tiếp session cũ. |
| **Orchestrator** | Agent điều phối. Ở chế độ routing *star*, mọi tin giữa các agent đi qua agent này. |
| **Outbox** | Thư mục riêng của mỗi agent. Agent nhắn cho người hoặc agent khác bằng cách ghi file JSON vào đây. |
| **Task** | Một việc trên board, có key dạng `T-12`, giao cho một agent, cho bạn, hoặc đi theo một workflow. |
| **Workflow** | Chuỗi bước có thứ tự, mỗi bước do một agent hoặc bạn làm, có thể yêu cầu bạn duyệt. |

Câu trả lời thường của agent (phần text nó in ra) **chỉ bạn thấy**, không tự chuyển cho agent khác. Agent muốn nhắn
ai thì phải ghi vào outbox. Cách này tránh hai agent trả lời qua lại vô tận.

## 2. Bắt đầu

1. Chạy `npm run dev`, mở <http://127.0.0.1:4310>.
2. Màn chào: nhập **tên workspace**, **đường dẫn repo** và (tùy chọn) **thư mục worktree**.
3. Vào **Agents → Thêm agent**, tạo ít nhất một agent (xem mục 3).
4. Bấm **Chạy thử** trên agent: hub gửi một tin kiểm tra, agent trả lời tên và vai trò trong **Hộp thư**.

## 3. Agent

Form **Thêm agent / Cấu hình agent**:

| Trường | Ý nghĩa |
| --- | --- |
| Tên | Viết thường, tối đa 32 ký tự, chỉ chữ, số, `-`, `_`. Agent khác dùng tên này để nhắn. |
| Vai trò / prompt | Mô tả việc của agent; được đưa vào lượt đầu của mỗi session. |
| Engine | Claude Code, Codex hoặc Custom. Engine chưa hỗ trợ có nhãn "chưa hỗ trợ". |
| Model | Chọn trong danh sách, gõ id bất kỳ CLI chấp nhận, hoặc "Mặc định của CLI". |
| Lệnh | File chạy của CLI (`claude`, `codex`) hoặc lệnh đầy đủ với Custom. |
| Tham số thêm | Cờ truyền thêm cho CLI. Đổi engine thì ô này được điền giá trị mặc định của engine đó. |
| Isolation | `worktree`: mỗi agent một git worktree riêng (tự tạo). `shared`: dùng chung repo. `custom`: tự nhập thư mục. |
| Ngân sách token/ngày | `0` là không giới hạn. Hết ngân sách thì tin mới bị giữ đến hôm sau. |
| Orchestrator | Mỗi workspace chỉ có một orchestrator. |

Tham số mặc định theo engine:

- **Claude Code**: `--permission-mode acceptEdits` (lượt headless không trả lời được hộp thoại xin quyền).
  Hub luôn thêm `--disallowedTools` chặn `git push`, `git merge`, `git rebase`.
- **Codex**: `-c sandbox_mode="workspace-write"`, trên Windows thêm `-c windows.sandbox="unelevated"`
  (xem [engines.md](engines.md#codex)).

Nếu không tìm thấy lệnh của engine trên PATH, form hiện cảnh báo. Đây chỉ là gợi ý, không chặn lưu.

Các nút trên agent:

- **Chạy thử**: gửi tin kiểm tra kết nối.
- **Session mới**: bỏ session hiện tại, lượt sau bắt đầu lại từ đầu (gồm cả preamble).
- **Tạm dừng / Tiếp tục**: agent tạm dừng thì tin gửi đến bị giữ, không mất.
- **Xoá**: không xoá được khi agent đang chạy. Tin đang chờ của agent bị đánh dấu thất bại; lịch sử hội thoại giữ lại.

Trang chi tiết agent (**Lịch sử lượt**) liệt kê từng lượt: trạng thái, token vào / ra / ghi cache / đọc cache,
chi phí (Claude), thời gian và output.

## 4. Hộp thư

- **Cần bạn**: task đang chờ bạn duyệt hoặc trả lời, và câu hỏi `needs_human` của agent.
- **Cả team**: mọi tin trong workspace.
- **Kênh từng agent**: hội thoại giữa bạn và agent đó.

Ô soạn tin: chọn người nhận, bật **Gấp** nếu cần (tin gấp được xếp lên đầu hàng đợi của agent), Enter để gửi,
Shift+Enter để xuống dòng.

Trạng thái tin:

| Trạng thái | Nghĩa |
| --- | --- |
| đang chờ gửi | Trong hàng đợi, chờ agent rảnh. |
| đang giữ | Bị giữ có lý do: agent tạm dừng, hết lượt trong giờ, hết ngân sách token. Tự chạy khi hết lý do. |
| đang chạy | Agent đang chạy lượt cho tin này. |
| gửi thất bại | Lượt lỗi, quá giờ, hub khởi động lại giữa chừng, hoặc bị loop guard chặn. Có lý do và nút **Thử lại**. |

## 5. Công việc (task)

- Xem dạng **Board** (Chờ làm, Đang làm, Cần bạn, Xong) hoặc **Danh sách**; lọc theo workflow, người làm, ô tìm.
  Khi lọc một workflow, các cột là các bước của workflow đó.
- **Task mới**: tiêu đề, mô tả, và chọn **một workflow** hoặc **một người làm** (agent hoặc bạn).
  Task giao cho agent được bắt đầu ngay: hub gửi tin hướng dẫn cho agent, kèm cách báo xong.
- Bấm vào thẻ để mở chi tiết: tiến độ bước, kết quả gần nhất, hội thoại liên quan và các nút
  **Bắt đầu / Duyệt / Trả lại / Trả lời / Lưu trữ / Xoá**.

Vòng đời task:

```
todo ──Bắt đầu──▶ doing ──agent báo done──▶ (bước cần duyệt?) ──▶ review ──Duyệt──▶ bước sau / done
                    │                                                  └─Trả lại──▶ về bước "onReject"
                    └──agent hỏi needs_human / lượt lỗi──▶ blocked ──Trả lời / Thử lại──▶ doing
```

Agent cũng có thể tự tạo task khi giao việc cho agent khác (`"task":"new"` trong outbox); task đó hiện trên board.

## 6. Quy trình (workflow)

Editor theo chiều dọc:

- **Tên, mô tả**.
- **Các bước** (thêm, xoá, đưa lên/xuống). Mỗi bước có: tên, **người làm** (agent hoặc *Bạn*), **hướng dẫn**,
  công tắc **cần bạn duyệt**, và **trả lại thì về bước…** (mặc định về chính bước đó).
- **Trigger**: *Thủ công* hoặc *Theo lịch*. Theo lịch: chọn giờ và ngày trên UI hoặc nhập cron 5 trường
  (ví dụ `0 9 * * 1-5` là 09:00 thứ Hai đến thứ Sáu). Bấm **Xem 3 lần chạy tới** để kiểm tra.
  Tiêu đề task tạo theo lịch có thể dùng `{date}`.
- **Bật / tắt**, **Chạy ngay**.

Mẫu có sẵn để bắt đầu nhanh: *Viết bài* (nghiên cứu → viết → biên tập có duyệt → bạn đăng), *Báo cáo định kỳ*
(theo lịch), *Ticket dev* (PM → dev → QA → PM duyệt). Mẫu chỉ điền sẵn form và chọn agent theo tên nếu trùng.

Mỗi bước, agent nhận tin từ `hub` gồm: task, hướng dẫn bước, kết quả bước trước, ghi chú của bạn, và cách báo xong.
Kết quả của bước được truyền sang bước sau.

## 7. Cài đặt

| Mục | Ý nghĩa |
| --- | --- |
| Workspace | Tên, đường dẫn repo, thư mục worktree. |
| Agent chạy cùng lúc | Số agent được chạy lượt song song (mặc định 2). |
| Lượt mỗi giờ | Giới hạn số lượt của cả workspace trong 1 giờ (mặc định 30). Vượt thì tin bị giữ. |
| Timeout (phút) | Quá thời gian thì lượt bị dừng và đánh dấu thất bại (mặc định 30). |
| Tin agent liên tiếp tối đa | **Loop guard** (mặc định 8), xem dưới. |
| Routing | *Star*: mọi tin giữa agent đi qua orchestrator. *Mesh*: bật thêm các cặp agent được nhắn thẳng. |
| Vùng nguy hiểm | Xoá workspace cùng toàn bộ dữ liệu. Không làm được khi có agent đang chạy. |

**Loop guard**: hub đếm số tin agent → agent nối tiếp nhau kể từ lần cuối bạn (hoặc hub) gửi tin. Vượt ngưỡng thì
tin tiếp theo bị chặn (*gửi thất bại*, lý do "loop guard"), task liên quan chuyển sang *Cần bạn*. Bạn đọc rồi bấm
**Thử lại** nếu muốn cho chạy tiếp; chuỗi được đếm lại từ đầu.

## 8. Token và chi phí

- Token được đọc từ output của từng lượt: input, output, ghi cache, đọc cache; chi phí USD với Claude.
- Số "token hôm nay" trên thẻ agent và ngân sách token/ngày dùng cùng cách tính: **input + output + ghi cache**,
  không tính đọc cache (đọc cache lặp lại cả context mỗi lượt nên sẽ lấn át mọi thứ khác).
- Ngày tính theo giờ địa phương của máy chạy hub.

## 9. Khi có sự cố

| Hiện tượng | Xem gì |
| --- | --- |
| Tin "đang giữ" mãi | Lý do hiện cạnh tin: agent tạm dừng, hết lượt/giờ, hết ngân sách. |
| Tin "gửi thất bại" | Đọc lý do và câu trả lời lỗi của agent trong kênh của nó; sửa rồi bấm **Thử lại**. |
| Agent nhắn mà không ai nhận | File lỗi nằm ở `data/outbox/<agentId>/rejected/` kèm file `.error.txt` giải thích. |
| Codex treo trên Windows | Xem [engines.md](engines.md#codex). |
| Hub tắt giữa chừng | Lượt dở thành *gửi thất bại* ("interrupted by hub restart"); bấm Thử lại sau khi kiểm tra thay đổi dở dang. |
