# agent-hub

Hub tự host để điều phối nhiều agent CLI (Claude Code, Codex, lệnh tùy chỉnh) làm việc như một team, có giao diện
web chạy local. Mỗi tin nhắn chạy CLI một lượt ở chế độ headless và nối session bằng id. Agent nhắn cho nhau bằng cách
ghi file JSON vào thư mục outbox riêng của mình.

Tài liệu chi tiết ở [docs/](docs/README.md): [hướng dẫn sử dụng](docs/user-guide.md),
[kiến trúc](docs/architecture.md), [API](docs/api.md), [engine](docs/engines.md).
Thiết kế ban đầu ở [PLAN.md](PLAN.md), trạng thái làm việc gần nhất ở [HANDOFF.md](HANDOFF.md), quy tắc code
ở [AGENTS.md](AGENTS.md).

## Yêu cầu

- **Node.js 24 trở lên** (dùng `node:sqlite` có sẵn, không cần build native module).
- Ít nhất một CLI agent đã cài và đăng nhập:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`), đăng nhập sẵn. Hub không đọc credential.
  - Tùy chọn: Codex CLI (`codex`, đã thử với 0.164.0), đăng nhập sẵn.
- Đã chạy thử trên Windows 11. macOS/Linux chưa thử.

## Chạy từ source

```bash
npm install
npm run dev
```

Mở <http://127.0.0.1:4310>. Lần đầu sẽ có màn tạo workspace (tên, đường dẫn repo, thư mục worktree), sau đó vào
**Agents → Thêm agent** để tạo agent.

| Lệnh | Việc |
| --- | --- |
| `npm run dev` | Server + Vite middleware (hot reload), dữ liệu ở `data/` |
| `npm run build` rồi `npm start` | Bản production, phục vụ `dist/` |
| `npm test` | Test workflow, outbox, loop guard, Codex usage... bằng agent giả (không tốn token) |
| `npm run check` | `format` → `lint` → `typecheck`, phải sạch trước khi commit |
| `npm run demo:pm-be` | Demo thật pm → be → pm bằng Claude (model `haiku`, tốn token), dữ liệu ở `data/demo` |

Tùy chọn:

- `HUB_PORT=4311` đổi port (mặc định `4310`).
- `HUB_DATA=đường/dẫn` hoặc `--data đường/dẫn` đổi thư mục dữ liệu (mặc định `data/`). Ví dụ chạy lại dữ liệu demo:
  `npx tsx src/server/index.ts --data data/demo`.
- `data/models.json` (tự tạo) để thêm hoặc thay danh sách model cho ô chọn model, không cần sửa code:
  `{"claude":[{"id":"claude-opus-5-5","label":"Opus 5.5"}],"codex":[{"id":"gpt-6.2-sol","label":"GPT-6.2 Sol"}]}`

Thư mục `data/` (DB SQLite, outbox của agent) nằm trong `.gitignore`.

### An toàn

- Server chỉ nghe `127.0.0.1`, chặn request ghi khác origin và chặn DNS rebinding, vì hub chạy lệnh trên máy bạn.
- Agent Claude mặc định chạy với `--permission-mode acceptEdits` và bị chặn cứng `git push/merge/rebase`
  (`--disallowedTools`).
- Agent Codex mặc định chạy `-c sandbox_mode="workspace-write"`. Trên Windows có thêm
  `-c windows.sandbox="unelevated"` vì chế độ `elevated` treo mọi lệnh shell khi thiếu bước cài đặt admin. Hub chỉ
  truyền cờ cho từng lượt, không sửa `~/.codex/config.toml`.

## Cấu trúc

```
src/server/          Node server (node:http), không framework
  routes/            REST API /api/...
  bus.ts             hàng đợi, outbox, routing star/mesh, loop guard
  runner.ts          chạy một lượt CLI (prompt qua stdin, timeout, kill cây tiến trình)
  engines/           adapter từng CLI (claude, codex, custom) + catalog model
  workflow.ts        engine workflow / task, lịch cron
  db.ts              SQLite (node:sqlite) + migration
src/web/             React + Vite + Tailwind 4 + shadcn/ui
  features/          inbox, tasks, workflows, agents, settings
  locales/           vi.json, en.json
src/shared/          kiểu và hằng số dùng chung server/web
scripts/             test (agent giả) và demo
docs/cli-probe.md    kết quả dò output JSON và nguồn hạn mức của từng CLI
```

## Đã làm được

**Chạy agent**
- Adapter **Claude Code** và **Codex** (lượt mới + resume session, đọc token từng lượt; Codex báo tổng cộng dồn nên
  hub tự trừ), **Custom** (lệnh bất kỳ, prompt qua stdin).
- Đã chạy thật Claude và Codex qua hub, kể cả Codex ghi tin vào outbox.
- Isolation theo agent: `worktree` (tự tạo git worktree), `shared`, `custom` (cwd tự nhập).
- Timeout mỗi lượt, kill cả cây tiến trình. CLI đã báo xong lượt mà không thoát thì sau 10 giây hub tự kết thúc.
- Chính sách reset session theo số lượt hoặc độ lớn context (phía server).

**Nhắn tin và điều phối**
- Outbox: mỗi tin một file JSON, có kiểm tra hợp lệ, giới hạn 256 KiB, không tạo tin trùng khi rename lỗi.
- Routing star (qua orchestrator) hoặc mesh (cặp agent được nhắn thẳng).
- `needs_human` vào hàng "Cần bạn"; câu trả lời thường của agent chỉ người dùng thấy (tránh ping-pong).
- **Loop guard**: quá `maxHops` tin agent→agent liên tiếp không có người chen vào thì dừng, chờ người bấm Thử lại.
- Hàng đợi: số agent chạy cùng lúc và số lượt mỗi giờ.
- Hub khởi động lại: lượt đang chạy dở chuyển `failed` (không tự chạy lại), có nút **Thử lại**.

**Giao diện** (tiếng Việt / English, dark / light)
- **Trang chủ**: văn phòng kiểu truyện tranh, mỗi agent một bàn với bong bóng thoại trạng thái; giao việc cho agent điều phối.
- **Hộp thư**: cột kênh (Cần bạn, agent điều phối, mọi tin, từng agent), tìm tin; luồng tin kiểu Slack; duyệt / trả lại / trả lời task.
- **Công việc**: board 5 cột TODO / DOING / REVIEW / BLOCKED / DONE mỗi cột một màu, list, lọc, tạo task, sheet chi tiết.
- **Quy trình (workflow)**: các bước giao cho agent hoặc người, bước cần duyệt, bước quay lại khi bị trả,
  chạy tay hoặc theo lịch cron (xem trước 3 lần chạy), mẫu Viết bài / Báo cáo định kỳ / Ticket dev.
- **Agents**: popup bắt buộc tạo agent điều phối khi workspace chưa có, thẻ agent, form cấu hình (avatar và màu nền, vai trò, mục tiêu,
  engine, ô chọn model hoặc tự gõ, lệnh, tham số, isolation mặc định `worktree`),
  cảnh báo khi CLI chưa có trên PATH, lịch sử lượt chạy với token và chi phí.
- **Cài đặt**: workspace (đổi thư mục an toàn), giới hạn hàng đợi, loop guard, routing, kiểm tra CLI trên máy.

## Chưa làm

- **Antigravity (`agy`)**: mới dò CLI (`docs/cli-probe.md`), chưa có adapter.
- **Trang Usage**: % hạn mức 5 giờ / tuần và giờ reset theo engine, tự giữ việc khi chạm ngưỡng
  (bảng `limits_snapshots` có sẵn nhưng chưa dùng).
- **Giờ làm việc**: giờ bắt đầu / dừng / ngừng giao việc, từ khóa "gấp" cho chạy ngoài giờ.
- **Thông báo**: Windows toast, Slack / Telegram.
- **Xuất / nhập cấu hình** ra JSON và template "BookLink Scrum".
- Form agent còn thiếu: file brief, màu / seed avatar, chính sách reset context (server đã hỗ trợ).
- Cấu hình loại hành động bắt buộc chờ duyệt.
- Chặn `git push` mới theo tiền tố lệnh, chưa bắt được dạng `git -C dir push`.
- Hub bị crash thì tiến trình CLI con có thể còn chạy mồ côi (chưa lưu pid để dọn).
- Chưa có CI.

## Skill cho agent lập trình

Các skill bên thứ ba dùng khi phát triển repo (thư mục `.agents/`, `.claude/skills/`) không commit;
nguồn của chúng ghi trong `skills-lock.json`.

## Credit

Avatar [Micah](https://www.dicebear.com/styles/micah/) qua DiceBear, giấy phép CC BY 4.0.
