import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import { describe, it as vitestIt } from "vitest";
import { runtimeCase } from '../../convex-helpers/runtimeCases.w2-4.fixture';
import {batteryChecks} from '../../convex-helpers/workflows.fixture';
const implemented: Record<string, () => Promise<void>> = {
  'CE-080': runtimeCase('CE-080'),
  'CE-077': runtimeCase('CE-077'),
  'CE-079': runtimeCase('CE-079'),
  'CE-085': runtimeCase('CE-085'),
  'CE-087': runtimeCase('CE-087'),
  'CE-092': runtimeCase('CE-092'),
  'INV-41': runtimeCase('INV-41'),
  'CE-084': batteryChecks['CE-084']!,
  'CE-083': w2BatteryCases['CE-083']!
};
const it = {todo(title:string){const run=implemented[title.split(" ")[0]!];if(run)vitestIt(title,run);else vitestIt.todo(title);}};
describe("CT · 04-rules-and-protocol", () => {
  it.todo("INV-41 `turns.complete` 只在 `turn.candidateSnapshot` 内解析 `optionKey`，不重新枚举；`terms` 由服务端从快照物化；同一 run 内重复提出已阻断 candidateKey → `action.repeats_blocked`（provider 快照已剔除，出现即拒）；`counter` 候选等于 base → 解码层已排除，出现即 `action.option_not_in_snapshot`");
  it.todo("INV-44 动作 × 角色矩阵在服务端逐函数执行：`rooms.close` 仅 creator；`budget.setCap` / `ledger.recordBaseline` 仅 finance；`catalog.confirm` / `catalog.retire` 仅 provider；`briefs.confirm` 仅本角色；`humanRequests.answer` 仅 `toRole`；`tasks.markDone` 仅被指派角色的成员（`auth.role_forbidden`）；`runs.requestRenegotiation` / `runs.cancel` 仅 creator（`auth.not_creator`）；`runs.start` 任一成员；`closed` 房间拒绝一切写入；`executed` 房间拒绝协商 / 约束 / 成员 / 审批类写入（`run.invalid_state{ room_status }`，审批见 INV-31），只豁免 `tasks.markDone` 与 `rooms.startFollowUp`（canon D04）");
  it.todo("CE-077 `stop_reason: 'refusal'` + 半截 JSON");
  it.todo("CE-079 可行集只有 1 个候选");
  it.todo("CE-080 第 3 轮仍未收敛且无合格提案");
  it.todo("CE-083 `rooms.create` 指定未注册的 `scenarioKey@scenarioVersion`；已有房间的版本在当前部署未注册时 approve");
  it.todo("CE-084 前端对 `budget.setCap` 传 `role: 'finance'`，调用者是 provider");
  it.todo("CE-085 变异：在 internal query 中返回 Zod schema 给 action");
  it.todo("CE-087 customer 必需项 `audit_log_export` 已被 provider 撤下（不在当前 confirmed 目录中）");
  it.todo("CE-089 改价后新 run 里模型选中与旧提案同 `candidateKey` 的候选（revision 不同）");
  it.todo("CE-092 provider 提案被 `item.required_missing` 阻断");
});
