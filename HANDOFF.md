# Handoff: UI redesign on shadcn (đang làm dở)

Đọc `PLAN.md` trước (thiết kế gốc). File này ghi trạng thái đợt redesign. Ràng buộc trong PLAN.md §10 vẫn áp dụng:
không `git push`/merge/rebase, không ghi credential, trả lời người dùng tiếng Việt, code/comment tiếng Anh.
Chưa commit gì (người dùng muốn để sau).

## Yêu cầu của người dùng cho đợt này

1. Dùng shadcn/ui + một design system riêng (đã cài, xem dưới).
2. Bố cục trang và khung chat trước đó chưa tốt. Chat chuyển sang kiểu **gọn như Slack/Linear** (bỏ bong bóng
   truyện tranh): avatar nhỏ, tên, nhãn act, gom tin liên tiếp, thẻ task đính kèm, màu agent chỉ ở avatar/chip.
3. Tham khảo Munder Difflin (sidebar trái: Home/Tasks/Inbox/Automations/Agents/Settings; board kanban; inbox theo
   kênh; trang Agents dạng thẻ) nhưng **dễ dùng hơn**, nhất là phần thiết lập workflow.
4. Workflow **không chỉ cho dev** (BookLink chỉ là một ví dụ): ví dụ viết bài, nghiên cứu, báo cáo định kỳ.
5. Có trang **Tasks** (board kanban + list), làm luôn đợt này.

## Đã xong

### Backend (typecheck sạch, test qua)
- `src/server/db.ts`: thêm bảng `workflows` (steps JSON, trigger JSON, enabled, lastRunKey) và `tasks`
  (key `T-n`, status `todo|doing|review|blocked|done|archived`, assigneeId = agent id | `user` | null, stepId,
  result, waitingReason). `messages.taskId` thêm qua migration. Hàm CRUD tương ứng.
- `src/server/workflow.ts`: engine. Bước có `agentId` (null = người làm), `instruction`, `approval` (cần duyệt),
  `onReject` (bước quay lại khi bị trả). Hub gửi tin `fromId: 'hub'` cho agent kèm hướng dẫn trả kết quả.
  Agent báo xong bằng outbox `{"to":"user","act":"done","task":"T-3","body":"..."}`; hỏi người bằng
  `needs_human` + `task` → task `blocked`. `decide()` duyệt/trả lại, `answer()` trả lời câu hỏi,
  `runWorkflow()`, `tickSchedules()` (trigger cron).
- `src/server/cron.ts`: cron 5 trường, `cronMatches`, `nextRuns`, `minuteKey`.
- `src/server/bus.ts`: outbox nhận trường `task` (key có sẵn, hoặc `"new"` để tạo task giao cho người nhận);
  reply của agent mang `taskId`; `tick()` gọi `tickSchedules()`.
- `src/server/preamble.ts`: thêm hướng dẫn về task.
- `src/server/api.ts`: thêm
  - `GET/POST /api/workspaces/:ws/tasks`, `PATCH/DELETE /api/tasks/:id`, `POST /api/tasks/:id/start|decision|answer`
  - `GET/POST /api/workspaces/:ws/workflows`, `PATCH/DELETE /api/workflows/:id`, `POST /api/workflows/:id/run`
  - `POST /api/cron/preview` → `{ next: ISO[] }`
  - `POST /api/workspaces/:ws/messages` nhận thêm `taskId`.
- Test: `npm test` (`scripts/test-workflow.ts` + `scripts/fake-agent.mjs`, agent giả, không tốn token) → PASS.

### Frontend setup
- Đã cài: `tailwindcss`, `@tailwindcss/vite`, shadcn (preset radix-nova) kéo theo `radix-ui`, `cn`,
  `class-variance-authority`, `cmdk`, `sonner`, `next-themes`, `tw-animate-css`, `@fontsource-variable/geist`
  (có subset vietnamese). Người dùng đã yêu cầu cài shadcn nên các gói này OK; **gói khác vẫn phải hỏi**.
- tsconfig tách: `tsconfig.app.json` (web, Bundler, alias `@/*` → `src/web/*`), `tsconfig.node.json` (server).
  `npm run typecheck` chạy cả hai. `vite.config.ts` có alias `@` và plugin tailwind.
- `components.json` + `src/web/components/ui/*`: button, input, textarea, label, select, dialog, sheet,
  dropdown-menu, tabs, badge, card, switch, tooltip (cần bọc `TooltipProvider`), scroll-area, separator, avatar,
  sonner, toggle-group, alert-dialog, popover, command, collapsible, input-group.
- `src/web/index.css`: design tokens. Mặc định dark (`<html class="dark">`), nền than ấm (hue ~60), **một màu hành
  động: honey** (`--primary`), token trạng thái `success|warning|info|destructive`, `--subtle`. Có light mode.
  Font Geist, body 14px, control cao 32px, radius 8px.
- `src/web/lib/api.ts`: client đủ endpoint (gồm tasks/workflows/cron).
- `src/web/lib/hub.tsx`: `HubProvider`/`useHub` (workspaces, agents, messages, tasks, workflows, tokens, reload qua
  SSE `/api/events`, `attempt()` báo lỗi bằng `sonner` toast, `agentById`), `agentState()`, `waitingOnUser()`,
  `useHashRoute()` (mặc định `inbox`).

## Còn phải làm (UI hiện **chưa chạy được**: đã xoá UI cũ, chưa có `main.tsx`)

1. `src/web/main.tsx`: `ThemeProvider` (next-themes, `attribute="class"`, `defaultTheme="dark"`), `TooltipProvider`,
   `HubProvider`, `<Toaster />`, import `./index.css`.
2. `src/web/lib/i18n.ts`: dict tiếng Việt + `t(key, vars)` (để sau thêm tiếng Anh). Tất cả chuỗi UI qua đây.
3. Khung app (`App.tsx` + `components/AppSidebar.tsx`): sidebar trái gồm chọn workspace (dropdown + tạo mới),
   nav **Inbox, Tasks, Workflows, Agents, Cài đặt** (badge số việc "Cần bạn"), danh sách agent kèm chấm trạng
   thái, nút đổi theme, credit "Micah avatars — CC BY 4.0" (dùng `@dicebear/core` + `micah`). Màn chào khi chưa có
   workspace (form tạo workspace: tên, repo, thư mục worktree).
4. **Inbox**: cột kênh (Cần bạn / Cả team / từng agent), luồng tin kiểu Slack (gom tin cùng người trong ~5 phút,
   nhãn act dạng badge, trạng thái queued/held/running/failed, thu gọn tin dài, thẻ task nhỏ khi có `taskId`,
   dòng "đang làm…" khi agent working), ô soạn: chọn người nhận, công tắc Gấp, Enter gửi, Shift+Enter xuống dòng.
   "Cần bạn": task `review` (nút Duyệt / Trả lại + ghi chú) và `blocked` (ô trả lời), cùng `needs_human` lẻ.
5. **Tasks**: board 4 cột Chờ làm / Đang làm / Cần bạn (review+blocked) / Xong; list view; lọc theo workflow (khi
   chọn 1 workflow thì cột = các bước + Xong), theo agent, ô tìm. Nút "Task mới" (tiêu đề, mô tả, chọn workflow
   **hoặc** người giao). Bấm thẻ mở `Sheet` chi tiết: tiến độ bước, kết quả, hội thoại liên quan task, các nút
   Bắt đầu / Duyệt / Trả lại / Trả lời / Lưu trữ / Xoá.
6. **Workflows** (trọng tâm "dễ dùng"): danh sách thẻ + editor. Editor: tên, mô tả; các bước dạng danh sách dọc
   (thêm/xoá/lên/xuống), mỗi bước: tên, người làm (agent hoặc "Bạn"), hướng dẫn, công tắc "Cần bạn duyệt", "Nếu
   trả lại thì về bước…"; trigger: Thủ công hoặc Theo lịch (chọn giờ + thứ trên UI sinh cron, hoặc nhập cron tay;
   gọi `/api/cron/preview` để hiện 3 lần chạy tới), tiêu đề task tạo ra (`{date}`), bật/tắt; nút "Chạy ngay".
   Có **mẫu** để bắt đầu nhanh, nhiều lĩnh vực: "Viết bài" (nghiên cứu → viết → biên tập (duyệt) → bạn đăng),
   "Báo cáo định kỳ" (theo lịch), "Ticket dev" (PM → dev → QA → PM review (duyệt)). Mẫu chỉ điền form, chọn agent
   theo tên nếu khớp.
7. **Agents**: lưới thẻ (avatar, tên, orchestrator, trạng thái, engine·model, session, token hôm nay, task đang làm)
   + form trong `Sheet` (các trường cũ: tên, vai, file brief, orchestrator, màu + seed avatar, engine
   claude/codex/antigravity/custom (codex/agy hiện "chưa hỗ trợ"), model, lệnh, flag thêm (Claude mặc định
   `--permission-mode acceptEdits`), isolation worktree/shared/custom + cwd, ngân sách token/ngày, reset context).
   Nút Chạy thử / Tạm dừng / Session mới / Xoá (AlertDialog). Trang chi tiết `#/agents/:id`: bảng lượt chạy (token
   vào/ra/ghi cache/đọc cache, chi phí, thời gian, output mở rộng).
8. **Cài đặt**: workspace (tên, repo, worktree), hàng đợi (agent chạy cùng lúc, lượt/giờ, timeout phút), routing
   star/mesh + cặp nhắn thẳng, xoá workspace.
9. Kiểm tra: `npm run typecheck`, `npm test`, `npm run build`, chạy `npx tsx src/server/index.ts --data data/demo`
   (port 4310, có `.claude/launch.json` tên `hub-demo`) rồi xem từng màn. Cập nhật PLAN.md: §8 đổi từ comic sang
   design system mới; thêm mục Tasks/Workflows; trạng thái.

## Gia cố sau khi đọc issue của Munder Difflin (2026-11-19)

- Outbox (`bus.ts`): file > 256 KiB bị từ chối mà không đọc; file được chuyển vào `processed/` **trước** khi tạo tin (rename lỗi thì để tick sau, không tạo tin trùng); lỗi outbox của một agent không làm dừng tick.
- Đổi engine thì xoá `sessionId` (đang chạy thì 409). Claude luôn chạy kèm `--disallowedTools` chặn `git push/merge/rebase`.
- Hub restart: tin đang chạy chuyển `failed` ("interrupted by hub restart") và task bị block, không tự chạy lại. `POST /api/messages/:id/retry` + nút Thử lại trong Hộp thư.
- `/api/meta` trả về danh sách engine có `label`, `defaultCommand`, `installed` (`where`/`which`), `models`. Ghi đè model bằng `data/models.json`
  (`{"claude":[{"id":"...","label":"..."}]}`). Form agent có combobox chọn model hoặc tự gõ id.
- `.claude/launch.json` có thêm `hub-demo-4311` để chạy demo khi cổng 4310 đang bận.
- **Codex** (`engines/codex.ts`): `codex exec --json ... -`, resume bằng `... resume <thread> -`. Thư mục outbox được
  cho ghi qua `-c sandbox_workspace_write.writable_roots=[...]` (vì `exec resume` không nhận `--add-dir`/`--sandbox`).
  Usage của Codex là tổng cộng dồn của thread, runner trừ đi tổng đã lưu của session (`cumulativeUsage`).
  Đã chạy 2 lượt Codex thật (mới + resume): session nối đúng, usage từng lượt khớp `last_token_usage` trong rollout.
  Mỗi engine có `defaultExtraArgs` trong catalog.
  - **Sandbox Windows**: `~/.codex/config.toml` của người dùng đặt `[windows] sandbox = "elevated"`, chế độ này treo mọi
    lệnh shell khi thiếu bước cài admin. Trên Windows, mặc định của agent Codex có thêm `-c windows.sandbox="unelevated"`
    (không sửa config chung). Đã chạy thật: agent ghi outbox thành công, thư mục ngoài writable roots bị chặn.
    Agent Codex tạo trước thay đổi này phải tự thêm cờ đó vào "Tham số thêm".
  - Khi Codex báo `turn.completed` mà không thoát (chờ lệnh shell bị treo), runner đợi 10 s rồi kill và coi lượt là xong
    (`EngineAdapter.isTurnOver`), thay vì chờ timeout 30 phút.
- **Loop guard**: tin từ outbox mang `parentId` = tin đã kích hoạt lượt đó. Vượt `settings.maxHops` (mặc định 8)
  tin agent→agent liên tiếp không có người/hub chen vào thì tin bị `failed` ("loop guard"), task bị block;
  bấm Thử lại thì chuỗi tính lại từ đầu.
- **Ngân sách token/ngày** của agent giờ được áp dụng: hết thì tin `held` đến hôm sau. Tính bằng `workTokens`
  (input + output + ghi cache, không tính đọc cache); thẻ agent hiển thị cùng con số này.

## Ghi chú kỹ thuật

- API server chặn request ghi có header `Origin` khác host (CSRF); fetch cùng origin thì không sao.
- Kiểu dữ liệu import từ `../../server/db.ts` (type-only) qua `lib/api.ts`.
- `data/demo` có workspace demo (pm, be, fe) và hội thoại cũ; `data/test-workflow` do test tạo.
- Codex/Antigravity runner chưa làm (bước 3 trong PLAN). Kết quả dò CLI ở `docs/cli-probe.md`.
