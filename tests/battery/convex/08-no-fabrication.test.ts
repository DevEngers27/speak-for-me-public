import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import { describe, it as vitestIt } from "vitest";
import { runtimeCase } from '../../convex-helpers/runtimeCases.w2-4.fixture';
import {batteryChecks} from '../../convex-helpers/workflows.fixture';
const implemented: Record<string, () => Promise<void>> = {
  'INV-63': async () => implemented['CE-156']!(),
  'CE-156': async () => {
    for (const file of ['seed.ts', 'lib/seedChain.ts']) {
      const source = readFileSync(new URL('../../../convex/' + file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\bt\.run\s*\(/);
      expect(source).not.toMatch(/ctx\.db\.(insert|patch)\s*\(/);
    }
  },
  'CE-157': runtimeCase('CE-157'),
  'INV-64': runtimeCase('INV-64'),
  'INV-65': runtimeCase('INV-65'),
  'INV-66': runtimeCase('INV-66'),
  'CE-154': batteryChecks['CE-154']!,
  'INV-62': w2BatteryCases['INV-62']!
};
const it = {todo(title:string){const run=implemented[title.split(" ")[0]!];if(run)vitestIt(title,run);else vitestIt.todo(title);}};
describe("CT · 08-no-fabrication", () => {
  it.todo("INV-62 `provenance: 'live' | 'seeded' | 'stub'` 必填于 `rooms` / `proposals` / `executions` / `ledgerEntries` / `changeOrders` / `tasks` / `attempts`；派生继承：提案 = `max(room.provenance, 驱动 provenance)`（stub 驱动产物为 `stub`；`human_choice` 提案的驱动是它所在的 run，人的选择不清除模拟来源），execution / changeOrder / task / commit 行继承提案；`startFollowUp` 的新房间 = `max(旧房间, 所跟随的 execution)`（03 §3.3.3）；UI 对非 `live` 必显示 `SimulatedBadge`；不存在 `simulated` / `isSimulated` 别名");
  it.todo("INV-63 `seed.fromFixture`（internal mutation，一个事务）以 fixture 角色身份显式作为 actor，复用与公开 mutation 相同的入口逻辑与事务 helper，依次 `rooms.create → invites.create + invites.accept → ledger.recordBaseline → catalog.confirm → briefs.confirm ×3`；就绪后按生产路径 `openIfReady` 打开房间并自动开首个 run，`stopBeforeRole` 可留一方不确认、停在 `setup`；不预置提案 / 审批 / 执行；真实部署探针用 `npx convex run --identity` 调公开函数；禁止 `t.run` / 直接 insert 绕过唯一写入口；fixture 自检：`below_committed` 不可达、canary 数值 ≠ 任何目录价 / 子集和 / 上限差 / 公开日期，并过 `lintCanaries`");
  it.todo("INV-64 当前约束下没有满足条件的方案时，系统只创建人工请求，不创建声称一致的提案或执行；`run.status === 'needs_input'` ⇔ 恰有一个 `status: 'open'` 的 `humanRequests` 行属于该 run（kind ∈ `infeasible / rounds_exhausted / agent_escalated / clarify / agent_failed`）；无解时按场景 `relaxationOrder`（customer `drop_items` / `extend_deadline` → finance `raise_cap`）选第一个\"其自身视图下候选集为空、且单独放松自身一个硬字段即可非空\"的角色（视图下候选集非空者被跳过）；都没有 → customer 收到回退请求（尚未向放松角色披露的硬字段各一个 `disclose` + `end_run`）；`infeasible` 请求的收件人若不在 `relaxationOrder` 末位，另有 `pass_to_next { toRole }`（按位置提供，回答后同事务给下一角色开它自己视图的请求，仍恰一个 open）；选项直接是约束效果（`raise_cap { amountCents }` 等），不是\"编辑意向\"");
  it.todo("INV-65 open 请求 `expiresAt = openedAt + HUMAN_REQUEST_TTL_DAYS(7)`；到期由 cron 置 `expired`，run → `ended_no_agreement`，creator 收到站内待办；审批轮不设过期（U7）；`keep_as_is` 按 kind：`clarify` = 拒绝披露、发问方同轮新开回合；`rounds_exhausted` = `maxRounds += 1`（`roundsExtended`，每 run 一次，run 的调用 / 美元上限触发时不提供）；customer 的 `agent_escalated` = 下一轮（轮次已尽等价 `end_run`）；provider 的 `agent_escalated` = provider 同轮新开回合；`infeasible` / `agent_failed` 不提供；没有任何选项映射到 `rooms.close`");
  it.todo("INV-66 stub 驱动与 live 共用 `AgentDriver.decide(input)` 接口与全部下游（`turns.complete` 同一路径）；`replay` / `scripted` 驱动只在测试；stub 产物 `provenance: 'stub'`；stub 不受 `opsFlags.draining` 与 `AGENTS_ENABLED` 影响；`AGENT_MODE` 在 run 开始时快照");
  it.todo("CE-152 seed 房间走完主线执行；检查 `executions` / `changeOrders` / `tasks` / `ledgerEntries(commit)` 的 `provenance`");
  it.todo("CE-154 缺 provider 目录 / 缺 baseline 时第三份简报确认；随后 finance 录入 baseline 成为最后一个就绪条件");
  it.todo("CE-156 变异：seed 用 `t.run` 直接 insert 已批准的 v1");
  it.todo("CE-157 stub run 进行中把 `AGENT_MODE` 改为 `live`");
});
