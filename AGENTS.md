# Quy tắc code cho agent (Codex, Claude, ...)

Đọc `PLAN.md` (thiết kế, ràng buộc §10) và `HANDOFF.md` (trạng thái hiện tại) trước khi làm.
Trả lời người dùng bằng tiếng Việt; code, comment, commit bằng tiếng Anh.

## 1. Nguyên tắc chung

- **KISS / YAGNI**: viết ít code nhất mà vẫn giải quyết trọn vấn đề. Không thêm option, config, abstraction "để sau".
- **DRY theo rule of three**: lặp lần 2 thì chấp nhận, lần 3 mới gom thành hàm/component chung.
  Abstraction sai tệ hơn lặp code.
- **Tái sử dụng trước khi viết mới**, theo thứ tự: code có sẵn trong repo → thư viện chuẩn / tính năng nền tảng →
  dependency đã cài → mới viết. **Không thêm dependency mới khi chưa hỏi người dùng.**
- **Một trách nhiệm (SRP)**: mỗi hàm/module làm một việc, đặt tên nói rõ việc đó. Hàm dài cũng được nếu nó là
  một việc liền mạch (deep module); đừng băm nhỏ chỉ để hàm ngắn.
- **Phụ thuộc một chiều**: `features` → `components` → `lib`; không import ngược. Server: `api` → logic
  (`workflow`, `bus`, ...) → `db`. Logic nghiệp vụ không phụ thuộc chi tiết HTTP/UI.
- Giữ cấu trúc, đặt tên và pattern sẵn có của codebase. Sửa bug thì sửa gốc ở chỗ dùng chung, sau khi grep mọi nơi gọi.

## 2. Đặt tên và comment

- Tên có nghĩa, đúng domain (`task`, `workflow`, `agent`, `step`). Không viết tắt khó hiểu, không `data2`, `tmp`.
- Boolean: `is/has/can/should...`. Hàm: động từ (`runWorkflow`, `formatIncoming`).
- Comment chỉ để giải thích **tại sao**, không giải thích code làm gì. Xóa code chết, không comment-out code.
- Shortcut có giới hạn đã biết thì ghi: `// shortcut: <giới hạn>, <khi nào cần nâng cấp>`.

## 3. Không hard-code

- **Chuỗi hiển thị**: luôn qua i18n (`t('...')` hoặc `useTranslation`), thêm key vào cả
  `src/web/locales/vi.json` và `en.json`. Không viết text tiếng Việt/Anh trực tiếp trong JSX.
- **Màu, khoảng cách, font, radius**: dùng design token trong `src/web/index.css` qua class Tailwind
  (`bg-primary`, `text-muted-foreground`, `text-success`, ...). Không dùng mã màu hex/rgb, không `style={{ color: ... }}`.
  Ngoại lệ duy nhất: giá trị thật sự động từ dữ liệu (vd. `agent.tint`, kích thước avatar theo prop).
- **URL, port, đường dẫn, timeout, giới hạn**: lấy từ hằng số/config đã có (`HUB_URL`, `DATA_DIR`, ...) hoặc biến
  môi trường; đặt hằng số có tên ở một chỗ, không rải magic number/magic string.
- **Trạng thái, enum, key lặp lại** (`'todo' | 'doing' | ...`): định nghĩa một lần (type/const) rồi import.
- Không hard-code credential, token, email, đường dẫn máy cá nhân.

## 4. Frontend: Tailwind + shadcn/ui

Thứ tự ưu tiên khi cần UI:

1. **Component chung của dự án**: `src/web/components/shared.tsx` (`Avatar`, `PageHeading`, `Field`, `Empty`, ...).
2. **shadcn/ui** trong `src/web/components/ui/*` (`Button`, `Input`, `Textarea`, `Select`, `Dialog`, `Sheet`,
   `DropdownMenu`, `Tabs`, `Badge`, `Card`, `Switch`, `Tooltip`, `ScrollArea`, `Separator`, `Popover`,
   `Command`, `AlertDialog`, `Collapsible`, `ToggleGroup`, `InputGroup`, `Label`, toast qua `sonner`).
   Thiếu component shadcn thì thêm bằng CLI: `npx shadcn@latest add <name>`, không tự viết lại.
3. **Icon**: `lucide-react`.
4. Chỉ khi 1–3 không có: viết component mới, dựng từ primitive shadcn/Radix + Tailwind. Nếu dùng ở ≥2 chỗ thì đưa vào
   `components/` thay vì để trong feature.

Quy tắc:

- **Không dùng thẻ HTML tương tác tự chế** khi đã có component: không `<button>`, `<input>`, `<select>`,
  `<textarea>`, `<dialog>` thô, không tự làm dropdown/modal/tab/toggle bằng `div` + state.
  Thẻ bố cục/ngữ nghĩa (`div`, `section`, `header`, `main`, `nav`, `ul/li`, `p`, `h1-h6`, `span`, `img`, `form`) thì dùng
  bình thường.
- **Style chỉ bằng Tailwind class**, gộp class có điều kiện bằng `cn()` từ `@/lib/utils`. Không file CSS riêng cho
  component, không inline `style` (trừ giá trị động nói ở §3), không CSS-in-JS.
- Biến thể component: dùng `variant`/`size` có sẵn của shadcn (`<Button variant="ghost" size="sm">`) hoặc thêm vào
  `cva` của component đó, không override bằng một đống class.
- Không sửa logic trong `components/ui/*` trừ khi cần thiết; chỉnh token/variant thay vì hack từng chỗ.
- Hỗ trợ cả dark và light mode (dùng token, không màu cố định). Giữ accessibility: `Label` cho input, `aria-label` cho
  nút chỉ có icon, điều hướng được bằng bàn phím.
- Gọi API qua `src/web/lib/api.ts` / `useHub`, không `fetch` trực tiếp trong component.
- Mỗi tính năng nằm trong `src/web/features/<tên>/`.

## 5. Backend

- Validate input ở biên (request HTTP, outbox của agent, file đọc từ đĩa). Lỗi trả về qua `HttpError`, không nuốt lỗi.
- Không log credential, `.env`, token, nội dung nhạy cảm.
- Không đổi schema DB mà không có migration.

## 6. TypeScript

- `strict`; không `any` (dùng `unknown` rồi thu hẹp), không `@ts-ignore`, hạn chế `as` ép kiểu.
- Kiểu dùng chung khai báo một chỗ rồi import, không khai báo lại.
- Ưu tiên `const`, hàm thuần, early return thay vì `if` lồng sâu.

## 7. Trước khi báo xong

- **Bắt buộc chạy `npm run check`** (= `format` → `lint` → `typecheck`) và phải sạch: 0 error, 0 warning.
  - `npm run format`: `eslint --fix` (tự sửa class Tailwind: canonical, deprecated, trùng lặp) rồi `prettier --write`
    (format + sắp xếp class Tailwind).
  - Warning Tailwind không tự sửa được (`no-unknown-classes`, `no-conflicting-classes`) thì sửa tay. Không tắt rule,
    không thêm `eslint-disable` để né.
  - Ưu tiên class chuẩn thay vì giá trị tuỳ ý: `w-60` thay `w-[210px]`, `text-sm/6` thay `text-sm leading-6`,
    `rounded-sm` thay `rounded`. Lưu ý `html` có `font-size: 14px`, nên 1 đơn vị spacing = 3.5px, không phải 4px
    (`w-60` = 15rem = 210px). Đừng tự quy đổi px theo cỡ 16px.
- `npm test` nếu đụng server/workflow.
- Logic mới không tầm thường (rẽ nhánh, parser, bảo mật) có test hoặc self-check nhỏ.
- Thay đổi UI thì mở app kiểm tra thật (cả dark/light) thay vì chỉ đọc code.
- Không `git push`/merge/rebase thay người dùng; chỉ commit khi được yêu cầu.
