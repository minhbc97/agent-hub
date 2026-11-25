# HTTP API

REST JSON tại `http://127.0.0.1:4310/api/...`. Kiểu dữ liệu chi tiết nằm ở `src/shared/contracts.ts`.

## Quy ước

- Server chỉ trả lời request có `Host` là `127.0.0.1:<port>` hoặc `localhost:<port>` (chống DNS rebinding).
- Request ghi (khác `GET`) có header `Origin` thì origin phải trùng host (chống CSRF). Script / curl không gửi
  `Origin` vẫn dùng được.
- Body là JSON. Lỗi trả về `{ "error": "...", "errorKey": "errors.xxx", "errorParams": {...} }` với mã 400 / 403 /
  404 / 409 / 500 / 501. `errorKey` là key i18n trong `src/web/locales/*.json`.
- Agent có thể chỉ định bằng id hoặc tên (ở các trường `to`, `assigneeId`).

## Meta

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| POST | `/api/folders/pick` | Mở hộp chọn thư mục của hệ điều hành trên máy chạy hub. Trả `{ path }` (`null` nếu huỷ); 501 nếu máy không có hộp chọn (Linux thiếu `zenity`/`kdialog`). |
| GET | `/api/meta` | Danh sách engine (`id`, `label`, `supported`, `defaultCommand`, `defaultExtraArgs`, `installed`, `models`), isolation, reset policy, settings mặc định. |
| GET | `/api/usage` | Hạn mức từng engine đọc từ CLI (cửa sổ hạn mức, % đã dùng, giờ reset, trạng thái đăng nhập). Kết quả được cache 1 phút; thêm `?refresh` để đọc lại ngay. |

`installed` là `true` / `false` khi kiểm tra được lệnh trên PATH (`where` / `which`), `null` khi không biết.
`models` lấy từ danh sách có sẵn, hoặc từ `data/models.json` nếu có.

## Workspace

| Method | Đường dẫn | Body / ghi chú |
| --- | --- | --- |
| GET | `/api/workspaces` | |
| POST | `/api/workspaces` | `name` (bắt buộc, không trùng), `repoPath` (phải là thư mục có thật), `worktreesDir` |
| PATCH | `/api/workspaces/:ws` | Các trường trên và `settings` (một phần): `routing` (`star`/`mesh`), `directPairs` (`[["a","b"]]`), `maxConcurrent` (1–20), `maxTurnsPerHour` (1–1000), `turnTimeoutMin` (1–240), `maxHops` (1–100), `quotaPausePercent` (1–100). Đổi `repoPath` / `worktreesDir`: 409 khi có agent đang chạy; lưu xong thì xoá session của các agent không dùng isolation `custom` |
| DELETE | `/api/workspaces/:ws` | 409 nếu có agent đang chạy |

## Agent

| Method | Đường dẫn | Body / ghi chú |
| --- | --- | --- |
| GET | `/api/workspaces/:ws/agents` | |
| POST | `/api/workspaces/:ws/agents` | `name` (bắt buộc), `role`, `goal`, `engine`, `model`, `command`, `extraArgs`, `isolation` (mặc định `worktree`), `cwd`, `isOrchestrator`, `resetPolicy`, `resetValue`, `briefFiles`, `allowedCommands`, `tint`, `avatarSeed` |
| PATCH | `/api/agents/:id` | Các trường trên và `paused`. Đổi `engine` thì session bị xoá; 409 nếu agent đang chạy |
| DELETE | `/api/agents/:id` | 409 nếu agent đang chạy hoặc là Lead Agent |
| POST | `/api/agents/:id/new-session` | Bỏ session hiện tại |
| POST | `/api/agents/:id/stop` | Dừng lượt đang chạy; 409 nếu agent không chạy |
| POST | `/api/agents/:id/test` | Gửi tin kiểm tra; trả về tin vừa tạo |
| GET | `/api/agents/:id/runs` | 50 lượt gần nhất, mới trước |
| GET | `/api/agents/:id/terminal` | Output của lượt đang chạy, hoặc lượt gần nhất: `{ runId, status, cwd, startedAt, endedAt, droppedEntries, entries: [{ seq, at, kind, text }] }`. `kind`: `start`, `input` (tin giao cho agent), `text`, `thinking`, `shell` (lệnh), `tool`, `output`, `error`. Thêm `?run=<runId>&after=<seq>` để chỉ lấy phần chưa có. Giữ trong bộ nhớ tối đa 500 mục, mỗi mục 4000 ký tự; hub khởi động lại thì chỉ còn câu trả lời đã lưu. Token và mật khẩu nhận ra được thì thay bằng `[redacted]` |

## Tin nhắn

| Method | Đường dẫn | Body / ghi chú |
| --- | --- | --- |
| GET | `/api/workspaces/:ws/messages` | 200 tin gần nhất, cũ trước |
| POST | `/api/workspaces/:ws/messages` | `to` (id hoặc tên agent), `body` (bắt buộc), `subject`, `urgent`, `taskId` |
| POST | `/api/messages/:id/retry` | Chạy lại tin `failed` gửi cho agent; task bị block vì lỗi đó trở lại `doing`; loop guard đếm lại |
| GET | `/api/workspaces/:ws/tokens` | Tổng token và chi phí từng agent từ 0 giờ hôm nay |

## Task

| Method | Đường dẫn | Body / ghi chú |
| --- | --- | --- |
| GET | `/api/workspaces/:ws/tasks` | |
| POST | `/api/workspaces/:ws/tasks` | `title` (bắt buộc), `body`, `workflowId` **hoặc** `assigneeId` (id/tên agent, `"user"`), `start` (mặc định bắt đầu ngay; `false` để giữ ở `todo`) |
| PATCH | `/api/tasks/:id` | `title`, `body`, `status`, `assigneeId` |
| GET | `/api/tasks/:id/changes` | `{ branch, files: [{ path, added, deleted, patch }] }` so với lúc task bắt đầu; `null` nếu task không có code riêng |
| DELETE | `/api/tasks/:id` | |
| POST | `/api/tasks/:id/start` | `note`. Chỉ khi task ở `todo` và đã có người làm hoặc workflow |
| POST | `/api/tasks/:id/decision` | `approve` (bool), `note`. Chỉ khi task ở `review` |
| POST | `/api/tasks/:id/answer` | `body` (bắt buộc). Chỉ khi task ở `blocked`; gửi câu trả lời cho agent |

## Workflow

| Method | Đường dẫn | Body / ghi chú |
| --- | --- | --- |
| GET | `/api/workspaces/:ws/workflows` | |
| POST | `/api/workspaces/:ws/workflows` | `name`, `description`, `steps`, `trigger`, `enabled` |
| PATCH | `/api/workflows/:id` | Một phần các trường trên |
| DELETE | `/api/workflows/:id` | Task đã tạo vẫn giữ |
| POST | `/api/workflows/:id/run` | `title` (mặc định `<tên> <ngày>`), `body`. Tạo task và bắt đầu bước 1 |
| POST | `/api/cron/preview` | `cron` → `{ "next": [ISO, ISO, ISO] }`, 400 nếu cron sai |

Dạng `steps` và `trigger`:

```json
{
  "steps": [
    { "id": "s1", "name": "Viết", "agentId": "<id agent>", "instruction": "...", "approval": false, "onReject": null },
    { "id": "s2", "name": "Duyệt", "agentId": null, "instruction": "...", "approval": true, "onReject": "s1" }
  ],
  "trigger": { "kind": "schedule", "cron": "0 9 * * 1-5", "title": "Báo cáo {date}", "body": "" }
}
```

`agentId: null` là bước do người làm. `trigger.kind` là `manual` hoặc `schedule`.

## Sự kiện realtime

`GET /api/events` (Server-Sent Events). Mỗi sự kiện: `data: {"type":"message|agent|run|task|workflow|terminal","workspaceId":"...","id":"..."}`.
Sự kiện chỉ báo "có thay đổi"; client tự gọi lại endpoint tương ứng để lấy dữ liệu mới.
`terminal` báo agent `id` vừa in thêm output (tối đa mỗi 300 ms một lần); client gọi `/api/agents/:id/terminal`.

## Ví dụ

```bash
# Gửi tin cho agent "be" trong workspace <ws>
curl -X POST http://127.0.0.1:4310/api/workspaces/<ws>/messages \
  -H "content-type: application/json" \
  -d '{"to":"be","body":"Kiểm tra lại endpoint đăng nhập"}'

# Chạy workflow ngay
curl -X POST http://127.0.0.1:4310/api/workflows/<id>/run -H "content-type: application/json" -d '{}'
```
