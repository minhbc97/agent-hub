# Engine (CLI agent)

Mỗi engine là một adapter trong `src/server/engines/`, cài đặt interface `EngineAdapter`
(`src/server/engines/types.ts`):

| Thành phần | Bắt buộc | Việc |
| --- | --- | --- |
| `command(agent, { resumeId, extraDirs })` | có | Trả về dòng lệnh shell cho một lượt. Prompt **luôn đi qua stdin** để tránh lỗi quoting và giới hạn độ dài lệnh trên Windows. `extraDirs` là các thư mục agent cần ghi (outbox). |
| `parse(stdout, stderr, exitCode)` | có | Trả về `{ text, sessionId, usage, isError }`. |
| `cumulativeUsage` | không | `true` khi CLI báo token cộng dồn cả session khi resume; runner tự trừ phần đã lưu. |
| `cumulativeCost` | không | Như trên nhưng chỉ cho chi phí: `total_cost_usd` của Claude cộng dồn cả session khi resume. |
| `afterTurn(agent)` | không | Xoá file mà `command` tạo cho lượt; chạy dù lượt kết thúc thế nào. |
| `live` | không | CLI nhận thêm tin qua stdin khi đang chạy (chỉ Claude): cách mã hoá tin, sự kiện báo đã đọc và báo xong lượt. |
| `describe(event)` | không | Đổi một sự kiện JSON của stdout thành các dòng dễ đọc cho tab Terminal; không có thì stdout hiện nguyên văn. |
| `isTurnOver(stdout)` | không | `true` khi stdout cho thấy lượt đã xong; CLI không thoát sau 10 giây thì runner kill và coi lượt là thành công. |

Runner chạy lệnh bằng `spawn(cmd, { shell: true, cwd })` với biến môi trường `HUB_OUTBOX`, `HUB_AGENT`, `HUB_URL`.
Hàm `q()` trong `types.ts` quote một tham số cho cả `cmd.exe` và `sh`.

Thông tin hiển thị (tên, lệnh mặc định, tham số mặc định, danh sách model) nằm ở `engines/catalog.ts`.
Kết quả dò output của từng CLI: [cli-probe.md](cli-probe.md).

## Claude Code

```
claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages
       [--model <m>] [--resume <session>] --add-dir <outbox>
       --disallowedTools "Bash(git push:*)" "Bash(git merge:*)" "Bash(git rebase:*)" <tham số thêm>
```

- Output: JSONL; sự kiện `type: "result"` (không chắc là dòng cuối) có `result`, `session_id`, `is_error`, `total_cost_usd`,
  `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` (đã kiểm với 2.1.329).
- Stdin giữ mở tới khi có `result` và mọi tin đã được đọc. Tin gửi giữa lượt được đọc sau bước đang chạy; sự kiện
  `isReplay` cùng `uuid` báo đã đọc. Tin đến đúng lúc xong lượt sinh thêm một `result` (token cộng lại,
  `total_cost_usd` đã là tổng của cả session, kể cả các lượt resume trước).
- Tham số mặc định: `--permission-mode acceptEdits`.
- `acceptEdits` chỉ tự duyệt sửa file và lệnh đọc. Đã thử trên 2.1.329: `git status` chạy được, `npm test` và
  `git add` bị từ chối. Ô **Lệnh được phép** của agent (mặc định trống) thêm `--allowedTools "Bash(<lệnh>:*)"`; engine dự
  phòng Claude cũng dùng. `git` trần bị từ chối vì nó mở đường cho `git -C <dir> push`.
- `--disallowedTools` chặn theo tiền tố lệnh, nên chưa bắt được `git -C <dir> push` hay script tự push.
  Cần chặn chắc hơn thì dùng hook `PreToolUse`.
- Claude Code dùng đăng nhập của chính nó; hub không đọc credential.

**Chế độ gọn** (công tắc trong form agent, chỉ Claude): thêm `--strict-mcp-config --setting-sources project,local
--tools Read,Write,Edit,Bash,Glob,Grep`. Mặc định `claude -p` nạp plugin, skill, hook và MCP cấp user, khoảng 49k token
nền mỗi lần gọi API; chế độ gọn còn khoảng 10k. Agent có chọn MCP thì thêm tool `ToolSearch` để mô tả tool MCP chỉ nạp
khi cần (đo với Atlassian: 42k còn 23k). Đổi lại agent mất MCP cấp user, trừ server được chọn riêng ở dưới.

**MCP theo agent**: form liệt kê server MCP đọc từ `~/.claude.json` và plugin đã cài. Ở chế độ gọn, server được chọn
ghi vào `data/mcp/<agentId>.json` rồi truyền qua `--mcp-config`. Cấu hình có thể chứa token nên file chỉ tồn tại trong
lượt chạy và bị xoá ngay sau đó (còn sót do hub bị kill thì xoá khi khởi động). Tên server giữ dạng `plugin:<plugin>:<server>` giống
Claude nên dùng lại được đăng nhập OAuth đã có. Connector của claude.ai không truyền qua file được.

## Codex

```
codex exec --json --skip-git-repo-check [-m <model>]
           -c "sandbox_workspace_write.writable_roots=['<outbox>']" <tham số thêm> [resume <thread>] -
```

- Output JSONL: `thread.started.thread_id`, `item.completed` (item `agent_message` là câu trả lời),
  `turn.completed.usage`, `turn.failed` / `error` khi lỗi (đã kiểm với 0.164.0).
- `turn.completed.usage` là **tổng của cả thread** khi resume. Adapter đặt `cumulativeUsage: true`; runner trừ tổng
  các lượt đã lưu của cùng session. `input_tokens` của Codex đã gồm phần đọc cache, adapter tách ra
  `cacheReadTokens`. Đã đối chiếu với `last_token_usage` trong rollout của Codex: khớp.
- `codex exec resume` **không nhận `--sandbox` và `--add-dir`**, nên thư mục ghi thêm đi qua `-c`, cờ mà cả lượt mới
  lẫn resume đều nhận. Chuỗi TOML dùng nháy đơn (`'...'`) để giữ nguyên dấu `\` của đường dẫn Windows.
- Tham số mặc định: `-c sandbox_mode="workspace-write"` (mặc định của `codex exec` là chỉ đọc, agent không ghi được
  outbox).

### Sandbox trên Windows

Nếu `~/.codex/config.toml` đặt `[windows] sandbox = "elevated"` mà bước cài đặt cần quyền admin chưa xong,
**mọi lệnh shell trong sandbox đều treo** (kể cả `cmd /c echo`). Khi đó Codex vẫn trả lời nhưng không ghi được outbox,
và tiến trình `codex exec` không thoát sau khi xong lượt.

Hub xử lý như sau:

- Trên Windows, tham số mặc định của agent Codex có thêm `-c windows.sandbox="unelevated"`. Cờ chỉ áp dụng cho lượt
  do hub chạy, không sửa config chung. Đã chạy thật: ghi được cwd và outbox, thư mục khác bị chặn
  (riêng `%TEMP%` mặc định vẫn ghi được, thêm `-c sandbox_workspace_write.exclude_tmpdir_env_var=true` nếu muốn chặn).
- `isTurnOver` nhận `turn.completed` / `turn.failed` nên lượt không bị treo tới timeout.

Agent Codex tạo trước khi có mặc định này cần tự thêm `-c windows.sandbox="unelevated"` vào **Tham số thêm**.
Chế độ unelevated cách ly yếu hơn elevated (token bị hạn chế trên chính tài khoản của bạn, không dùng tài khoản
sandbox riêng). Muốn giữ elevated thì chạy lại bước thiết lập sandbox của Codex, rồi kiểm tra:

```powershell
codex sandbox -c sandbox_mode=workspace-write -- cmd /c echo hi
```

Lệnh in `hi` và thoát ngay là sandbox ổn. Lưu ý: chạy từ git-bash thì `/c` bị đổi thành `C:\`, cần
`MSYS_NO_PATHCONV=1`.

## Custom

Lệnh bất kỳ trong ô **Lệnh** cộng **Tham số thêm**, prompt qua stdin, stdout là câu trả lời. Không có session và
không đếm token. Exit code khác 0 là lỗi. Dùng cho script riêng hoặc agent giả khi test
(`node scripts/fake-agent.mjs`).

## Antigravity

```
agy --input-format stream-json --output-format stream-json [--model <m>] [--conversation <id>] --add-dir <outbox>
    <tham số thêm>
```

- Prompt đi qua stdin dạng stream-json, nên không bị giới hạn độ dài dòng lệnh như `-p=`.
- Tham số mặc định: `--mode accept-edits`. Lần chạy đầu `agy` mở đăng nhập Google; không có lệnh login riêng.
- Hạn mức: hub đọc 5 log mới nhất ở `~/.gemini/antigravity-cli/log/`. CLI chỉ báo khi đã hết quota
  (`RESOURCE_EXHAUSTED ... Resets in ...`), nên hub biết giờ reset nhưng không biết phần trăm đã dùng.
- Chưa đọc được context của lượt, nên session chỉ xoay theo số lượt hoặc khi nghỉ lâu.

Kết quả dò CLI ở [cli-probe.md](cli-probe.md).

## OpenRouter

Không chạy CLI: hub gọi thẳng Chat Completions API của OpenRouter với model id tự nhập. Key lấy từ biến môi trường
`OPENROUTER_API_KEY` của tiến trình hub, không lưu trong DB và bị xoá khỏi môi trường của các CLI con.

Agent OpenRouter chỉ trả lời text: không đọc hay sửa file trong workspace, không ghi outbox nên không nhắn được agent
khác. Mỗi lượt nhận đúng một tin. Kết quả bước workflow vẫn được lưu và chuyển bước như engine khác.

## Engine dự phòng

`quotaPausePercent` của workspace (mặc định 100) coi engine là hết hạn mức từ phần trăm đó; khi có tin chờ, hub tự đọc
lại hạn mức, tối đa mỗi phút một lần. Antigravity không báo phần trăm nên không dừng sớm được.

Mỗi agent chọn được `fallbackEngine` (Claude, Codex hoặc Antigravity) và `fallbackModel`. Khi engine chính hết hạn
mức (đọc từ trang hạn mức hoặc từ lỗi của lượt), hub chạy tin bằng engine dự phòng; cả hai đều bị chặn thì tin chờ ở
trạng thái `held` kèm giờ thử lại và tự chạy khi hết chặn. Lỗi hạn mức không làm tin thất bại.

Khi chuyển engine giữa chừng, engine cũ viết sổ bàn giao cho session mới (xem
[architecture.md](architecture.md#session-và-sổ-bàn-giao)); nếu engine cũ đã hết hạn mức thì hub tự ghép sổ từ 8 tin gần
nhất. Lượt dự phòng dùng lệnh và tham số mặc định của engine đó, với Claude thì luôn ở chế độ gọn.

## Thêm engine mới

1. Thêm id vào `ENGINE` trong `src/shared/contracts.ts`.
2. Viết `src/server/engines/<id>.ts` cài đặt `EngineAdapter`; đăng ký trong `engines/index.ts`. Engine có adapter
   tự được coi là "đã hỗ trợ" (`SUPPORTED_ENGINES` lấy từ danh sách adapter).
3. Thêm mục vào `BUILT_IN` trong `engines/catalog.ts`: `label`, `defaultCommand`, `defaultExtraArgs`, `models`.
4. Thêm test với một CLI giả trong `scripts/` (xem `fake-codex.mjs`) vào `scripts/test-workflow.ts`.
5. Chạy thử một lượt thật: lượt mới, resume, ghi outbox; đối chiếu token với log của CLI.

## Danh sách model

Danh sách có sẵn trong `catalog.ts` chỉ là gợi ý; ô model luôn cho gõ id bất kỳ. Để thay danh sách mà không sửa code,
tạo `data/models.json` (thay toàn bộ danh sách của engine được khai báo):

```json
{
  "claude": [{ "id": "claude-opus-5-5", "label": "Opus 5.5" }],
  "codex": [{ "id": "gpt-6.2-sol", "label": "GPT-6.2 Sol" }]
}
```

File hỏng hoặc sai dạng thì bị bỏ qua (có log), dùng lại danh sách có sẵn. Dòng thiếu `label` thì dùng `id`.
