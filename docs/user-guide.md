# Hướng dẫn sử dụng

Tài liệu này dành cho người dùng app. Cách cài và chạy xem [README](../README.vi.md#bắt-đầu-nhanh).

## 1. Khái niệm

| Khái niệm | Nghĩa |
| --- | --- |
| **Workspace** | Một team agent làm việc trên một repo. Mỗi workspace có agent, task, workflow và cài đặt riêng. |
| **Agent** | Một CLI (Claude Code, Codex hoặc lệnh tùy chỉnh) cùng vai trò, model, thư mục làm việc. |
| **Lượt (turn / run)** | Hub chạy CLI một lần cho một tin nhắn đến, ở chế độ headless. Lượt sau nối tiếp session cũ. |
| **Lead Agent** (orchestrator) | Bắt buộc, mỗi workspace đúng một. Nhận và chia việc; ở routing *star*, mọi tin giữa các agent đi qua agent này. |
| **Outbox** | Thư mục riêng của mỗi agent. Agent nhắn cho người hoặc agent khác bằng cách ghi file JSON vào đây. |
| **Task** | Một việc trên board, có key dạng `T-12`, giao cho một agent, cho bạn, hoặc đi theo một workflow. |
| **Workflow** | Chuỗi bước có thứ tự, mỗi bước do một agent hoặc bạn làm, có thể yêu cầu bạn duyệt. |

Câu trả lời thường của agent (phần text nó in ra) **chỉ bạn thấy**, không tự chuyển cho agent khác. Agent muốn nhắn
ai thì phải ghi vào outbox. Cách này tránh hai agent trả lời qua lại vô tận.

## 2. Bắt đầu

1. Chạy `npx @minhbc/agent-hub` (hoặc `npm run dev` nếu chạy từ source), mở <http://127.0.0.1:4310>.
2. Màn chào: nhập **tên workspace**, **đường dẫn repo** và (tùy chọn) **thư mục worktree**. Nút **Chọn thư mục**
   mở hộp chọn thư mục của hệ điều hành (Windows, macOS; Linux cần `zenity` hoặc `kdialog`), hoặc gõ tay đường dẫn.
3. Ngay sau khi tạo workspace, popup **Tạo Lead Agent** mở ra và không đóng được cho tới khi tạo xong (xem mục 3).
   Workspace cũ chưa có Lead Agent cũng hiện popup này. Các agent khác thêm ở **Agents → Thêm agent**.
   Khi có nhiều workspace, popup này có menu để chuyển sang workspace khác.
4. Bấm **Chạy thử** trên agent: hub gửi một tin kiểm tra, agent trả lời tên và vai trò trong **Hộp thư**.

Bấm **tên workspace** ở đầu trang để chuyển workspace hoặc chọn **Workspace mới**. Mỗi workspace có agent, tin nhắn, task,
workflow, giới hạn lượt và worktree riêng; agent của workspace không mở vẫn chạy nền. Tên và thư mục bản sao git không được
trùng giữa các workspace. Hạn mức engine là của tài khoản nên dùng chung; hai workspace cùng trỏ một thư mục và dùng
isolation `shared` thì vẫn sửa chung file.

**Trang chủ** là màn mở đầu: một "văn phòng" kiểu truyện tranh, mỗi agent một bàn làm việc với bong bóng thoại cho biết
nó đang làm gì (task đang làm, đang chờ bạn trả lời, có tin bị giữ, tạm nghỉ hoặc rảnh). Bấm vào bàn để mở kênh nhắn
với agent đó. Bên phải là giấy note **Cần bạn** và số task theo trạng thái; dưới cùng là ô giao việc thẳng cho Lead Agent.

## 3. Agent

Form **Thêm agent / Cấu hình agent**:

| Trường | Ý nghĩa |
| --- | --- |
| Tên | Viết thường, tối đa 32 ký tự, chỉ chữ, số, `-`, `_`. Agent khác dùng tên này để nhắn. |
| Avatar | Chọn một khuôn mặt trong hàng gợi ý (nút xáo để xem bộ khác) và màu nền. Avatar hiện ở sidebar, thẻ agent, hộp thư. |
| Vai trò / prompt | Mô tả việc của agent; được đưa vào lượt đầu của mỗi session. |
| Mục tiêu | Kết quả agent cần đạt (tùy chọn). Đưa vào lượt đầu của session, ngay sau vai trò. |
| Engine | Claude Code, Codex hoặc Custom. Engine chưa hỗ trợ có nhãn "chưa hỗ trợ". |
| Model | Chọn trong danh sách, gõ id bất kỳ CLI chấp nhận, hoặc "Mặc định của CLI". |
| Lệnh | File chạy của CLI (`claude`, `codex`) hoặc lệnh đầy đủ với Custom. |
| Tham số thêm | Cờ truyền thêm cho CLI. Đổi engine thì ô này được điền giá trị mặc định của engine đó. |
| Lệnh được phép | Chỉ Claude (chính hoặc dự phòng). Mỗi dòng một lệnh agent được chạy với tham số bất kỳ, ví dụ `npm test`, `git commit`. Mặc định trống: lệnh có thay đổi dữ liệu bị từ chối. Script được phép có thể làm mọi thứ. |
| Isolation | `worktree` (mặc định, khuyến nghị): mỗi agent một git worktree riêng (tự tạo), agent không giẫm file của nhau. Cần workspace có đường dẫn repo là git repo. `shared`: dùng chung repo. `custom`: tự nhập hoặc chọn thư mục. |
| Lead Agent | Không có công tắc trong form: agent đầu tiên (tạo qua popup) là Lead Agent. |

Tham số mặc định theo engine:

- **Claude Code**: `--permission-mode acceptEdits` (lượt headless không trả lời được hộp thoại xin quyền).
  Hub luôn thêm `--disallowedTools` chặn `git push`, `git merge`, `git rebase`.
- **Codex**: `-c sandbox_mode="workspace-write"`, trên Windows thêm `-c windows.sandbox="unelevated"`
  (xem [engines.md](engines.md#codex)).

Nếu không tìm thấy lệnh của engine trên PATH, form hiện cảnh báo. Đây chỉ là gợi ý, không chặn lưu.

Các nút trên agent:

- **Chạy thử**: gửi tin kiểm tra kết nối.
- **Session mới**: bỏ session hiện tại, lượt sau bắt đầu lại từ đầu (gồm cả preamble).
- **Dừng lượt** (trang agent, khi đang làm): kết thúc CLI và mọi tiến trình nó mở. Tin chuyển `failed`, task vào
  **BLOCKED**; bấm **Thử lại** để chạy lại. Tin khác đang chờ vẫn chạy tiếp, muốn giữ lại thì **Tạm dừng** trước.
- **Tạm dừng / Tiếp tục**: agent tạm dừng thì tin gửi đến bị giữ, không mất.
- **Xoá**: không xoá được khi agent đang chạy, và không xoá được Lead Agent. Tin đang chờ của agent bị đánh dấu thất bại; lịch sử hội thoại giữ lại.

Trang chi tiết agent (nút **Xem agent** trong kênh riêng, hoặc **Lịch sử lượt** trên thẻ) có: trạng thái, engine / model /
isolation, vai trò và mục tiêu, session, token hôm nay, chi phí các lượt gần đây, các nút **Chạy thử**, **Session mới**,
**Cấu hình**, và bảng từng lượt: trạng thái, token vào / ra / ghi cache / đọc cache,
chi phí (Claude), thời gian và output.

## 4. Hộp thư

Hộp thư có cột kênh riêng (nền khác sidebar) và ô **Tìm tin nhắn** (lọc tin trong kênh đang mở):

- *Cho bạn*: **Cần bạn** (kèm số việc đang chờ) và Lead Agent.
- *Tất cả*: **Mọi tin nhắn** trong workspace.
- *Agents*: mỗi agent còn lại một dòng, kèm avatar, chấm trạng thái, tin gần nhất và giờ.

Mục **Agents** ở sidebar chính cũng mở thẳng kênh của agent. Bấm **Hộp thư** ở sidebar khi có việc chờ thì mở ngay
mục Cần bạn. Đầu kênh của agent có nút **Xem agent** để mở trang chi tiết.

- **Cần bạn**: chia hai nhóm. *Chờ bạn duyệt* (task ở bước cần duyệt, kèm kết quả, nút **Duyệt** / **Trả lại** và
  ghi chú) và *Câu hỏi* (task bị chặn chờ bạn trả lời, câu hỏi `needs_human` lẻ của agent).
- **Mọi tin nhắn**: mọi tin trong workspace. Mỗi tin ghi rõ ai gửi cho ai.
- **Kênh của agent**: hội thoại giữa bạn và agent đó; ô soạn tin gửi thẳng cho agent.
- Bấm chip task (`T-12 · tiêu đề`) dưới tin để mở luồng chỉ gồm tin của task đó; nút mũi tên trái ở đầu luồng để quay lại.

Trong luồng tin: có mốc ngày (Hôm nay, Hôm qua, ...), tin liên tiếp của cùng người trong 5 phút được gom lại. Chỉ các
loại tin cần chú ý mới có nhãn: *Cần người dùng*, *Hoàn tất*, *Truy vấn*. Câu hỏi đang chờ bạn có nút **Trả lời** dẫn
sang mục Cần bạn.

Ô soạn tin: ở kênh riêng của agent thì gửi thẳng cho agent đó; ở Mọi tin nhắn chọn người nhận (mặc định Lead Agent);
trong luồng task thì mặc định người được giao task và tin gắn vào task. Bật **Gấp** nếu cần (tin gấp được xếp lên đầu
hàng đợi của agent). Enter để gửi, Shift+Enter để xuống dòng.

Trạng thái tin:

| Trạng thái | Nghĩa |
| --- | --- |
| đang chờ gửi | Trong hàng đợi, chờ agent rảnh. |
| đang giữ | Bị giữ có lý do: agent tạm dừng hoặc hết lượt trong giờ. Tự chạy khi hết lý do. |
| đang chạy | Agent đang chạy lượt cho tin này. |
| gửi thất bại | Lượt lỗi, quá giờ, hub khởi động lại giữa chừng, hoặc bị loop guard chặn. Có lý do và nút **Thử lại**. |

## 5. Công việc (task)

- Xem dạng **Board** hoặc **Danh sách**; lọc theo workflow, người làm, ô tìm. Board có 5 cột trải đầy màn hình, mỗi cột
  một màu: **TODO** (chờ làm), **DOING** (đang làm), **REVIEW** (chờ bạn duyệt), **BLOCKED** (chờ bạn trả lời),
  **DONE** (xong). Màu trạng thái dùng chung ở Danh sách và trang chủ. Khi lọc một workflow, các cột là các bước của
  workflow đó (tên viết hoa) cộng cột DONE.
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
Task xong thì agent đã giao việc tự nhận được kết quả.

Với agent dùng worktree, mục **Thay đổi code** trong task và thẻ duyệt hiện diff từng file kèm lệnh `git merge` để bạn tự
đưa vào nhánh của mình. Hub tự lưu thay đổi sau mỗi lượt, gồm mọi file không nằm trong `.gitignore`.

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
| Workspace | Tên, đường dẫn repo, thư mục worktree. Đổi đường dẫn repo hoặc thư mục worktree: không lưu được khi có agent đang chạy; lưu xong thì mọi agent (trừ agent dùng thư mục tuỳ chỉnh) bắt đầu session mới ở chỗ mới vì session của CLI gắn với thư mục cũ. Worktree cũ vẫn nằm ở thư mục cũ, tự xoá nếu không cần. |
| Agent chạy cùng lúc | Số agent được chạy lượt song song (mặc định 2). |
| Lượt mỗi giờ | Giới hạn số lượt của cả workspace trong 1 giờ (mặc định 30). Vượt thì tin bị giữ. |
| Timeout (phút) | Quá thời gian thì lượt bị dừng và đánh dấu thất bại (mặc định 30). |
| Tin agent liên tiếp tối đa | **Loop guard** (mặc định 8), xem dưới. |
| Routing | *Star*: mọi tin giữa agent đi qua orchestrator. *Mesh*: bật thêm các cặp agent được nhắn thẳng. |
| Agent CLI trên máy | Danh sách engine và việc lệnh của nó có trên PATH hay không. |
| Vùng nguy hiểm | Xoá workspace cùng toàn bộ dữ liệu. Không làm được khi có agent đang chạy. |

**Loop guard**: hub đếm số tin agent → agent nối tiếp nhau kể từ lần cuối bạn (hoặc hub) gửi tin. Vượt ngưỡng thì
tin tiếp theo bị chặn (*gửi thất bại*, lý do "loop guard"), task liên quan chuyển sang *Cần bạn*. Bạn đọc rồi bấm
**Thử lại** nếu muốn cho chạy tiếp; chuỗi được đếm lại từ đầu.

## 8. Token và chi phí

- Token được đọc từ output của từng lượt: input, output, ghi cache, đọc cache; chi phí USD với Claude.
- Số "token hôm nay" trên thẻ agent tính **input + output + ghi cache**, không tính đọc cache
  (đọc cache lặp lại cả context mỗi lượt nên sẽ lấn át mọi thứ khác).
- Ngày tính theo giờ địa phương của máy chạy hub.

## 9. Khi có sự cố

| Hiện tượng | Xem gì |
| --- | --- |
| Tin "đang giữ" mãi | Lý do hiện cạnh tin: agent tạm dừng hoặc hết lượt/giờ. |
| Tin "gửi thất bại" | Đọc lý do và câu trả lời lỗi của agent trong kênh của nó; sửa rồi bấm **Thử lại**. |
| Agent nhắn mà không ai nhận | File lỗi nằm ở `data/outbox/<agentId>/rejected/` kèm file `.error.txt` giải thích. |
| Codex treo trên Windows | Xem [engines.md](engines.md#codex). |
| Hub tắt giữa chừng | Lượt dở thành *gửi thất bại* ("interrupted by hub restart"); bấm Thử lại sau khi kiểm tra thay đổi dở dang. |
