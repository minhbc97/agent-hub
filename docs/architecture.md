# Kiến trúc

Một tiến trình Node duy nhất: HTTP server + bus điều phối + SQLite. Web UI là React (Vite), ở chế độ dev chạy qua
Vite middleware trong cùng server, ở production phục vụ từ `dist/`.

```
 Trình duyệt (React)  ──REST /api/*──▶  routes/  ──▶  bus.ts / workflow.ts  ──▶  db.ts (SQLite)
        ▲                                                  │
        └──────── SSE /api/events (hub báo "có thay đổi") ◀┘
                                                           │ runTurn()
                                                           ▼
                                   runner.ts ── spawn CLI (prompt qua stdin) ── engines/<engine>.ts
                                                           │
                                         agent ghi file JSON vào data/outbox/<agentId>/
                                                           │
                                   bus.ts quét outbox ──▶ tạo tin mới / cập nhật task
```

Phụ thuộc một chiều: `routes` → logic (`bus`, `workflow`, `runner`) → `db`. Web: `features` → `components` → `lib`.

## Thư mục mã nguồn

| File | Trách nhiệm |
| --- | --- |
| `src/server/index.ts` | Tạo HTTP server (chỉ `127.0.0.1`), mở DB, khởi động bus, phục vụ UI. |
| `src/server/http/router.ts` | Router nhỏ, chặn Host lạ (DNS rebinding) và request ghi khác origin (CSRF), map lỗi sang JSON. |
| `src/server/routes/*.ts` | Từng nhóm endpoint, xem [api.md](api.md). |
| `src/server/routes/folders.ts` | Mở hộp chọn thư mục của hệ điều hành (Windows qua `scripts/pick-folder.ps1`, macOS `osascript`, Linux `zenity`/`kdialog`). |
| `src/server/api/validation.ts` | Kiểm tra input ở biên (tên agent, settings, workflow...). |
| `src/server/bus.ts` | Hàng đợi, quét outbox, routing, loop guard, lý do giữ tin, khôi phục sau restart, thử lại. |
| `src/server/runner.ts` | Chạy một lượt: dựng lệnh, tạo worktree nếu cần, timeout, kill cây tiến trình, lưu `runs`, chính sách reset session. |
| `src/server/engines/` | Adapter theo CLI (`claude`, `codex`, `custom`) và `catalog.ts` (tên, lệnh mặc định, model, kiểm tra PATH). |
| `src/server/workflow.ts` | Engine task / workflow: bắt đầu bước, agent báo xong, duyệt / trả lại, trả lời, lịch cron. |
| `src/server/preamble.ts` | Lời dặn lượt đầu của session: vai trò, mục tiêu, team, cách dùng outbox, quy tắc. |
| `src/server/cron.ts` | Bộ đọc cron 5 trường (`*`, danh sách, khoảng, bước). |
| `src/server/db.ts` | Schema, migration cộng cột, mọi truy vấn SQL. |
| `src/shared/contracts.ts` | Kiểu và hằng số dùng chung server và web. |
| `src/web/lib/hub.tsx` | `HubProvider` / `useHub`: tải dữ liệu, nghe SSE, `attempt()` báo lỗi bằng toast. |

## Vòng đời một tin nhắn

1. Tin được tạo (người gửi qua UI, hub gửi bước workflow, hoặc agent ghi outbox) với trạng thái `queued`.
2. `tick()` chạy mỗi 3 giây và ngay sau mỗi thay đổi:
   1. Chạy workflow theo lịch đến hạn (`tickSchedules`).
   2. Quét outbox của các agent không chạy.
   3. Với mỗi agent rảnh có tin chờ: tính **lý do giữ** (tạm dừng → hết lượt/giờ).
      Có lý do thì tin thành `held` kèm lý do; lý do hết thì tin tự chạy ở tick sau.
   4. Còn chỗ (`maxConcurrent`) thì bắt đầu lượt cho tin đầu hàng (tin gấp trước, rồi theo thời gian).
3. `runTurn()` chạy CLI. Lượt đầu session thì ghép preamble trước tin. Kết quả:
   - Tin gốc thành `delivered` hoặc `failed`.
   - Câu trả lời của agent lưu thành tin `reply` gửi **người dùng** (không chuyển cho agent khác).
   - Lượt lỗi thì task đang làm của agent chuyển `blocked` để người dùng thấy.
4. Hết lượt, bus quét outbox của agent đó, gắn các tin mới với tin vừa xử lý (`parentId`) rồi gọi `tick()`.

Mỗi agent chỉ chạy một lượt một lúc (`running` trong bộ nhớ).

## Giao thức outbox

Agent nhận đường dẫn outbox qua preamble và biến môi trường `HUB_OUTBOX` (kèm `HUB_AGENT`, `HUB_URL`).
Mỗi tin là một file `.json` (một object hoặc một mảng object):

```json
{ "to": "be", "act": "request", "subject": "API đăng nhập", "body": "...", "task": "T-12", "urgent": false }
```

| Trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `to` | có | Tên agent hoặc `"user"`. |
| `act` | không (mặc định `inform`) | `request` (giao việc), `query` (hỏi), `inform` (báo), `done` (xong việc), `needs_human` (chỉ gửi `"user"`, cần người quyết). |
| `subject`, `body` | ít nhất một | Nội dung. `subject` tối đa 200 ký tự. |
| `task` | không | Key task có sẵn (`T-12`), hoặc `"new"` để hub tạo task giao cho người nhận. |
| `urgent` | không | Xếp lên đầu hàng đợi của người nhận. |

Xử lý của hub:

- Chỉ đọc file `.json` thường, cũ trước mới sau. File lớn hơn 256 KiB bị từ chối mà không đọc.
- File parse lỗi được chờ 30 giây (có thể agent đang ghi dở), sau đó bị từ chối.
- File hợp lệ được **chuyển vào `processed/` trước** rồi mới tạo tin. Nếu chuyển không được (ví dụ antivirus khóa
  file) thì tick sau thử lại, không tạo tin trùng.
- Mục không hợp lệ: file chuyển vào `rejected/` kèm `<file>.error.txt` ghi lý do. Mục hợp lệ trong cùng file vẫn được nhận.
- Routing *star*: tin giữa hai agent thường bị chuyển qua orchestrator, tiêu đề thêm `[for <tên>]`.
  *Mesh*: các cặp trong `directPairs` được nhắn thẳng.
- `done` + `task`: báo xong bước hiện tại (`agentDone`); `done` cũng reset session của agent.
- `needs_human` + `task`: task chuyển `blocked` kèm câu hỏi.

## Loop guard

Mỗi tin từ outbox có `parentId` là tin đã kích hoạt lượt ghi ra nó. `agentHops(id)` đi ngược chuỗi `parentId`
(CTE đệ quy) và đếm các tin do agent gửi; tin của người dùng hoặc hub là gốc chuỗi. Nếu tin mới gửi cho agent
làm chuỗi dài hơn `settings.maxHops` thì tin được tạo ở trạng thái `failed` với lý do "loop guard" và task liên quan
bị block. **Thử lại** xoá `parentId` của tin đó nên chuỗi được đếm lại.

## Session và reset context

- Agent lưu `sessionId` từ output của CLI; lượt sau truyền lại để nối session.
- Reset (xoá `sessionId`) khi: đạt số lượt hoặc ngưỡng context theo `resetPolicy`, agent gửi `done`,
  người dùng bấm **Session mới**, hoặc **đổi engine** (id session của CLI này không dùng được cho CLI khác).

## Khôi phục và độ bền

- Hub khởi động lại: agent đang `working` về `idle`; tin đang chạy thành `failed` ("interrupted by hub restart")
  và task liên quan bị block. Không tự chạy lại vì lượt dở có thể đã sửa file một nửa.
- Timeout mỗi lượt (`turnTimeoutMin`): kill cả cây tiến trình (`taskkill /T /F` trên Windows).
- CLI đã báo xong lượt (adapter có `isTurnOver`) mà 10 giây sau chưa thoát thì hub kill và coi là thành công.
- Lỗi khi quét outbox của một agent chỉ được log, không làm dừng tick của agent khác.

Giới hạn đã biết: hub bị kill đột ngột thì tiến trình CLI con có thể còn chạy mồ côi (pid chưa được lưu).

## Dữ liệu (SQLite, `data/hub.db`)

| Bảng | Nội dung chính |
| --- | --- |
| `workspaces` | `name`, `repoPath`, `worktreesDir`, `settings` (JSON, merge với giá trị mặc định), `taskSeq`. |
| `agents` | Cấu hình agent, `sessionId`, `turnsInSession`, `paused`, `status`. Tên duy nhất trong workspace. |
| `messages` | `fromId`, `toId` (`user`, `hub` hoặc id agent), `act`, `status`, `holdReason`, `urgent`, `decision`, `parentId`, `runId`, `taskId`. |
| `runs` | Mỗi lượt: thời gian, `status`, `exitCode`, `output`, token từng loại, `costUsd`, `sessionId`. |
| `tasks` | `key` (`T-n`, không tái dùng), `status`, `assigneeId`, `workflowId`, `stepId`, `result`, `waitingReason`. |
| `workflows` | `steps` (JSON), `trigger` (JSON), `enabled`, `lastRunKey` (chống chạy trùng trong cùng phút). |
| `missions`, `limits_snapshots` | Có trong schema nhưng chưa dùng (lịch đã chuyển sang workflow; trang Usage chưa làm). |

Đổi schema: thêm cột qua mảng `MIGRATIONS` trong `db.ts` (chạy `ALTER TABLE` nếu cột chưa có).
`settings` của workspace là JSON nên thêm trường mới chỉ cần thêm vào `DEFAULT_SETTINGS`.

## Realtime

`GET /api/events` là Server-Sent Events. Server phát `{type, workspaceId, id?}` (`message`, `task`, `agent`, `run`,
`workflow`) mỗi khi dữ liệu đổi; UI nhận rồi tải lại phần liên quan. Ping mỗi 25 giây để giữ kết nối.

## Test

`npm test` chạy `scripts/test-workflow.ts` trên thư mục dữ liệu riêng `data/test-workflow`, với agent giả:

- `scripts/fake-agent.mjs`: đọc prompt, báo `done` khi thấy key task, chế độ `ping-pong with <tên>` để thử loop guard.
- `scripts/fake-codex.mjs`: in JSONL giống Codex với usage cộng dồn; prompt chứa `linger` thì không thoát sau lượt.

Test bao phủ: workflow có duyệt / trả lại, routing, đổi tên / xoá agent, lượt lỗi chặn task, thử lại, khôi phục
sau restart, outbox quá lớn, loop guard, usage Codex, CLI không thoát, lớp HTTP (đường dẫn lỗi,
Host lạ).
