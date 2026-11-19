# agent-hub — Thiết kế

Tool tự host để điều phối nhiều agent CLI (Claude Code, Codex, Antigravity, lệnh tùy chỉnh) làm việc
như một team, thay cho Munder Difflin. Lý do: gói free của Munder Difflin tính token context
(192.2M / 200M mỗi tháng, gồm cả token đọc lại từ cache), nên nhanh chạm giới hạn.

Trạng thái (2026-11-19): **đã hoàn thành khung frontend shadcn, Inbox, Tasks, Workflows, Agents và Cài đặt; backend workflow/task API sẵn sàng. `npm run typecheck`, `npm test`, `npm run build` đều PASS.**
- Bước 1: khung repo, runner Claude, bus + outbox, demo pm → be → pm (`npm run demo:pm-be`). Kết quả dò CLI ở `docs/cli-probe.md`.
- Bước 2: dashboard comic (Floor, Agents + lịch sử lượt, Cài đặt workspace/hàng đợi/routing), API cấu hình.
  Chạy `npm run dev` (dữ liệu thật ở `data/`) hoặc `npx tsx src/server/index.ts --data data/demo`.

## 1. Quyết định đã chốt

| Mục | Chọn |
| --- | --- |
| Vị trí | Repo riêng `D:\GMS\agent-hub`, ngoài `booklink` |
| Giao diện | Web dashboard chạy local, shadcn/ui + design system riêng, bố cục gọn kiểu Slack/Linear (mục 8) |
| Cách chạy agent | Headless theo lượt: mỗi tin nhắn chạy CLI một lần, nối session bằng id |
| Cấu hình | **Mọi thứ người dùng tự setup trên UI** (agent, lịch, giờ làm, ngưỡng, routing…), không gắn cứng cho BookLink. BookLink chỉ là một template nhập vào |
| Ngôn ngữ UI | Tiếng Việt (gom chuỗi vào một file dict để sau thêm tiếng Anh) |

## 2. Stack

- Node 24 (máy đang có v24.5.0) + TypeScript, chạy server bằng `tsx`.
- **SQLite qua `node:sqlite` có sẵn trong Node** (không cần `better-sqlite3`, tránh build native trên Windows).
- Server: `node:http` + router nhỏ; dev dùng Vite middleware mode trong cùng server; prod phục vụ `dist/`.
- Realtime: Server-Sent Events `/api/events`, UI nhận sự kiện rồi tải lại dữ liệu.
- Web: React + Vite, `lucide-react` (icon), `@dicebear/core` + `@dicebear/collection` (avatar Micah, CC BY 4.0).
- Lịch: tự viết bộ đọc cron 5 trường (`*`, list, range, step), khỏi thêm dependency.
- Port mặc định `4310` (env `HUB_PORT`). Dữ liệu ở `data/` (gitignore): `hub.db`, `outbox/<agentId>/`.
- Dependency dự kiến: react, react-dom, lucide-react, @dicebear/core, @dicebear/collection; dev: vite,
  @vitejs/plugin-react, typescript, tsx, @types/react, @types/react-dom, @types/node.

## 3. Mô hình dữ liệu (SQLite)

- `workspaces`: id, name, repoPath, worktreesDir, settings (JSON, mục 6).
- `agents`: id, workspaceId, name, role (prompt vai), goal (mục tiêu), briefFiles, engine (`claude|codex|antigravity|custom`),
  model, command, extraArgs, isolation (`worktree|shared|custom`), cwd, isOrchestrator, tint, avatarSeed,
  resetPolicy (`never|turns|context`) + resetValue, sessionId, turnsInSession, paused, status.
- `missions`: id, workspaceId, name, cron, agentId, prompt, enabled, respectHours, lastRunKey.
- `messages`: id, workspaceId, fromId, toId (`user` hoặc agentId), act, subject, body, status
  (`queued|held|running|delivered|failed`), urgent, decision (cho approval), parentId, runId, createdAt.
- `runs`: id, agentId, messageId, startedAt, endedAt, status, exitCode, output, inputTokens, outputTokens,
  cacheWriteTokens, cacheReadTokens, costUsd, sessionId.
- `limits_snapshots`: engine, window (`5h|week`), usedPercent, resetsAt, source (`real|estimate`), takenAt.

## 4. Chạy agent (runner)

Prompt đưa qua **stdin** để tránh lỗi quoting và giới hạn độ dài lệnh trên Windows. Lệnh chạy bằng
`spawn(..., { shell: true, cwd })`. Env truyền vào: `HUB_OUTBOX`, `HUB_AGENT`, `HUB_URL`.

| Engine | Lượt mới | Nối session | Đọc kết quả |
| --- | --- | --- | --- |
| Claude Code | `claude -p --output-format json [--model m] <extra>` | thêm `--resume <id>` | JSON: `result`, `session_id`, `usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, `total_cost_usd`, `is_error` |
| Codex | `codex exec --json --skip-git-repo-check [-c model=…] <extra> -` | `codex exec --json <extra> resume <id> -` | JSONL: `thread.started.thread_id`, `item.completed` (item `agent_message` → text cuối), `turn.completed.usage.{input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens}`, **cộng dồn cả thread khi resume**, phải trừ lượt trước |
| Antigravity | `agy -p='<prompt>' --output-format json` (**phải gắn prompt vào cờ** `-p='…'`, nếu không agy hiểu cờ kế tiếp là prompt) | `--conversation <id>` | JSON: `conversation_id`, `status` (SUCCESS/ERROR), `response`, `error`, `usage.{input_tokens,output_tokens,thinking_tokens,cache_read_tokens}` |
| Custom | lệnh người dùng nhập, prompt qua stdin | — | stdout dạng text |

- Isolation `worktree`: nếu `worktreesDir/<agent>` chưa có thì chạy `git -C <repo> worktree add --detach <path>`;
  agent tự tạo nhánh. `shared` dùng repoPath; `custom` dùng cwd tự nhập.
- Timeout mỗi lượt (mặc định 30 phút, chỉnh được), quá thì kill và đánh `failed`.
- Lượt đầu của session: ghép **preamble** (tiếng Anh cho ít token) trước tin nhắn: tên, vai, danh sách
  team, cách gửi tin qua outbox, quy tắc routing, "câu trả lời thường chỉ người dùng thấy".
- Reset context theo resetPolicy: sau N lượt, khi context (input + cache read của lượt cuối) vượt N
  token, khi agent gửi `act: done`, hoặc bấm nút "Session mới".

## 5. Hộp thư và điều phối (bus)

- Agent gửi tin bằng cách ghi **mỗi tin một file JSON** vào `HUB_OUTBOX`:
  `{"to":"<tên agent|user>","act":"request|query|inform|done|needs_human","subject":"…","body":"…"}`.
  Server quét outbox sau mỗi lượt và định kỳ, kiểm tra hợp lệ rồi xếp hàng, file đã xử lý thì chuyển đi.
- Câu trả lời thường của agent chỉ lưu và hiện cho người dùng, **không tự gửi sang agent khác** (tránh
  vòng lặp ping-pong). Agent với agent chỉ nói chuyện qua outbox.
- `to: "user"` + `act: "needs_human"` → vào hàng **Approvals** (Duyệt/Từ chối + ghi chú); quyết định
  được gửi lại cho agent như một tin nhắn.
- Routing: `star` (mọi tin qua orchestrator, mặc định) hoặc `mesh` (bật thêm đường trực tiếp giữa các cặp agent).
- Hàng đợi: mỗi agent chạy một lượt một lúc; giới hạn số agent chạy đồng thời và số lượt mỗi giờ của
  workspace (chống chạy loạn). Tin bị giữ thì có lý do: ngoài giờ, chạm hạn mức, agent tạm dừng.

## 6. Cấu hình người dùng tự setup (UI)

1. **Workspace**: tên, repo, thư mục worktree; nhiều workspace, chuyển qua lại ở header.
2. **Agent** (nút Add agent, form giống ô Configuration của Munder Difflin): tên, vai/prompt, file brief,
   engine, model, lệnh + flag, isolation, orchestrator, màu đĩa avatar, chính sách
   reset context. Nút: Chạy thử, Tạm dừng, Session mới, Xoá.
3. **Routing**: star/mesh và danh sách cặp được nhắn trực tiếp.
4. **Lịch (Missions)**: tên, agent nhận, prompt, giờ + thứ (chọn trên UI, sinh cron) hoặc nhập cron
   tay, bật/tắt, tuân theo giờ làm hay không. Nút "Chạy ngay".
5. **Giờ làm**: bật/tắt, giờ bắt đầu, giờ dừng, giờ ngừng giao việc mới, các ngày, múi giờ
   (mặc định Asia/Ho_Chi_Minh), từ khoá cho chạy ngoài giờ ("gấp", "urgent").
6. **Ngưỡng hạn mức** theo engine: % hạn mức 5 giờ, % hạn mức tuần để tạm dừng (mặc định 80 / 70).
7. **Approvals**: chọn loại hành động bắt buộc chờ duyệt (ghi vào preamble của agent).
8. **Tích hợp**: thông báo Windows toast; sau này Slack/Telegram. MCP vẫn cấu hình trong từng CLI.
9. **Xuất/nhập** toàn bộ cấu hình ra JSON. Kèm template **"BookLink Scrum"**: 4 agent pm/be/fe/qa
   (role trỏ tới `.agents/team/<role>.md` trong booklink), lịch quét Jira 05:00/07:30/10:00/12:00,
   chốt 13:30, báo cáo 15:00 (T2–T6), giờ làm 05:00–14:00, ngừng giao 12:30.

## 7. Token, hạn mức còn lại và giờ reset

Hạn mức tính **theo tài khoản của từng engine, không theo agent**: các agent cùng engine dùng chung.

**Token theo agent** (chính xác, lấy từ output mỗi lượt): input, output, ghi cache, **đọc cache tách
riêng**, chi phí (Claude). Hiển thị theo lượt, ngày, tuần; context hiện tại của session.

**% hạn mức còn lại + giờ reset theo engine:**

| Engine | Nguồn | Ghi chú |
| --- | --- | --- |
| Codex | Log phiên `~/.codex/sessions/**/rollout-*.jsonl`, sự kiện `token_count` có `rate_limits` (used_percent, cửa sổ, reset) cho 5 giờ và tuần | Đã xác nhận 0.164.0: `rate_limits.primary` (300 phút) / `secondary` (10080 phút), `resets_at` epoch giây |
| Claude Code | Control request `get_usage` qua `claude -p --input-format stream-json --output-format stream-json --verbose` → `rate_limits.five_hour/seven_day.{utilization,resets_at}` (đã xác nhận 2.1.328, không gọi model) | Claude Code tự dùng đăng nhập của nó, **agent-hub không đọc credential**. Bỏ cách statusline và endpoint riêng |
| Antigravity | Chưa có nguồn | Người dùng nhập ngân sách tuần + ngày reset; tool đếm token đã dùng → % còn lại (**ước tính**). Khi chạm quota agy báo lỗi 429 kèm "Resets in 163h31m7s" → giờ reset **thật** |
| Tạm thời | `md-limits --json` của Munder Difflin (`D:/GMS/booklink-hive/hive/bin/hive-node D:/GMS/booklink-hive/hive/bin/md-limits.cjs --json`) | Chỉ đúng khi app Munder Difflin còn cập nhật |

UI ghi rõ nhãn **thật** hay **ước tính** cho từng con số. Khi engine chạm ngưỡng, hàng đợi giữ việc
của mọi agent trên engine đó đến giờ reset rồi tự chạy tiếp.

## 8. Giao diện shadcn

Frontend dùng shadcn/ui Radix Nova, Tailwind 4, Geist Variable và design tokens riêng: nền charcoal ấm, màu hành động honey, màu trạng thái semantic, control 8px và card bo góc. Dark là mặc định, có light mode. App shell có sidebar trái; hội thoại gọn kiểu Slack/Linear, màu agent chỉ nằm ở avatar/chip. Avatar Micah ghi credit CC BY 4.0.

**Các màn đã dựng:**
- **Inbox**: Cần bạn, Cả team, kênh từng agent; tin nhắn compact có act/status, task link, composer chọn người nhận và Gấp. Task review có Duyệt/Trả lại và ghi chú; task blocked nhận trả lời.
- **Tasks**: board và list, lọc tìm kiếm/workflow/agent, tạo task và sheet chi tiết có tiến độ, kết quả, hội thoại, Bắt đầu/Duyệt/Trả lại/Trả lời/Lưu trữ/Xoá.
- **Workflows**: editor dọc, chọn agent hoặc Bạn, chỉ dẫn, phê duyệt và bước quay lại; trigger thủ công/lịch, cron preview, bật/tắt, chạy ngay; mẫu Viết bài, Báo cáo định kỳ, Ticket dev.
- **Agents**: thẻ, form tạo/sửa, trạng thái, session/token; trang chi tiết hiển thị lượt chạy, token, chi phí và output. Codex/Antigravity hiện ghi rõ chưa hỗ trợ.
- **Cài đặt**: workspace/repo/worktree, concurrency, lượt/giờ, timeout, star/mesh và cặp agent nhắn thẳng, xoá workspace.
- **Welcome**: tạo workspace đầu tiên.

UI đang hiển thị tiếng Việt. `src/web/lib/i18n.ts` là dict khởi đầu; cần chuyển hết nhãn inline vào dict trước khi bổ sung locale thứ hai. Agent form còn thiếu chọn brief files, seed/màu avatar, thiết lập reset context và xác nhận riêng khi xoá agent.

## 9. Thứ tự làm

1. Khung repo; kiểm tra output JSON của CLI và nguồn hạn mức; runner Claude, bus/outbox, demo pm → be → pm — hoàn tất theo trạng thái backend hiện tại.
2. Dashboard comic + form cấu hình — được thay bằng redesign shadcn ở đợt hiện tại.
3. Codex, Antigravity, custom; đếm token; trang Usage với hạn mức + giờ reset.
4. Missions, giờ làm, ngưỡng hạn mức, approvals, thông báo. Workflow scheduling và approvals theo task đã có API/UI riêng.
5. Xuất/nhập + template BookLink Scrum; chạy song song với Munder Difflin trên một ticket rồi mới chuyển hẳn.
6. Hoàn tất i18n extraction và các trường cấu hình agent còn thiếu; xem trực quan app khi port khả dụng.

## 10. Ràng buộc

- Không bao giờ chạy `git push`, merge, rebase thay người dùng; agent cũng bị dặn như vậy trong preamble.
- Không ghi credential, `.env`, token đăng nhập ra log, DB hay tin nhắn.
- Thêm dependency ngoài danh sách mục 2 phải hỏi người dùng.
- Trả lời người dùng bằng tiếng Việt; code, comment, commit bằng tiếng Anh.

## Mở chat mới

Mở session với thư mục làm việc `D:\GMS\agent-hub` và nhắn:

```text
Đọc PLAN.md và làm bước 1. Hỏi tôi trước khi đọc credential của Claude hoặc thêm dependency ngoài danh sách.
```
