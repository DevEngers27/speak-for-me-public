// Browser rows stay todo until every clause of each title is verified.
import { describe, it } from "vitest";

describe("E2E · 12-e2e-walkthrough", () => {
  it.todo("CE-165 D27 主 fixture：就绪 → `openIfReady`（cv 1、run 1，cause `room_opened`）→ v1 $900 `pending_approval` → customer、provider 批准 → finance 降到 $4,800（cv 2）→ run 1 `superseded`、v1 `stale`、2 条 `stale_approve` + finance pending → run 2 预检不保留 v1、`negotiating` → stub provider 第 1 轮选 $900 被 `budget.over` 阻断（不插提案、不消耗版本号、不花评估调用）→ 第 2 轮选 $800 → v2（恰等于上限通过）→ customer、finance `recommend_accept` → 三方对 v2 批准 → 执行（`exec:<v2>`，已承诺 480000 = 上限）；全程三身份金丝雀（含派生值）扫描 WebSocket 帧、HTML、日志");
  it.todo("CE-166 同上，provider 账号抓包全部订阅帧与错误响应");
  it.todo("CE-167 变体 $4,700：预检无解 → run 2 直接 `needs_input(infeasible)` → customer 视图（看不到已承诺额）候选集非空、被跳过 → finance 收到 `raise_cap` 480000 / 490000 + `end_run` → finance 选 480000 → bump（cv 3，cause `human_answer`）→ run 3 `negotiating` → v2 $800 → 执行；全程 `attempts` 为 0 直到 run 3");
  it.todo("CE-168 执行后 `startFollowUp`：新房间预填席位与 draft 目录（不含已交付条目）；finance 确认基线；customer 重确认简报（去掉已完成项）；新执行");
  it.todo("CE-169 最后一票按钮 `dblclick()` + 快速再点");
  it.todo("CE-170 回合进行中刷新三个页面；断线重连");
});
