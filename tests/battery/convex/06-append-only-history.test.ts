import { makeFunctionReference } from 'convex/server';
import { harness } from '../../convex-helpers/w2Execution.fixture';
import type { Id } from '../../../convex/_generated/dataModel';
import { describe, it as vitestIt, expect } from "vitest";
import {batteryChecks} from '../../convex-helpers/workflows.fixture';
import { cases } from '../w2-3.cases';
// W2-1 / W2-3: union of converted registry IDs.
const implemented: Record<string, () => Promise<void>> = {
  'INV-54': batteryChecks['INV-54']!,
  'INV-56': batteryChecks['INV-56']!,
  'INV-57': cases.replay,
  'INV-58': async () => {
    const h = await harness();
    const result = await h.execute();
    const before = await h.t.run(async ctx => ({ execution: await ctx.db.get(result.executionId!), orders: await ctx.db.query('changeOrders').collect(), approvals: await ctx.db.query('approvals').collect() }));
    const ref = makeFunctionReference<'mutation', { executionId: Id<'executions'> }, { roomId: Id<'rooms'>; created: boolean }>('rooms:startFollowUp');
    const followUp = await h.as('finance').mutation(ref, { executionId: result.executionId! });
    await expect(h.approve('customer', { expectedConstraintsVersion: 999, expectedTermsKey: 'outdated' })).resolves.toMatchObject({ alreadyExecuted: true });
    const after = await h.t.run(async ctx => ({ execution: await ctx.db.get(result.executionId!), orders: await ctx.db.query('changeOrders').collect(), approvals: await ctx.db.query('approvals').collect() }));
    expect(after).toEqual(before);
    await h.t.run(async ctx => {
      const room = await ctx.db.get(followUp.roomId);
      expect(room).toMatchObject({ status: 'setup', constraintsVersion: 0, followsExecutionId: result.executionId });
      expect(await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', followUp.roomId)).collect()).toEqual([]);
    });
  }
};
const it={todo(title:string){const body=implemented[title.split(' ')[0]!];if(body)vitestIt(title,body);else vitestIt.todo(title);}};
describe("CT · 06-append-only-history", () => {
  it.todo("INV-54 只追加表：`proposals`（只有 `status` 经 04 迁移表变化）、`approvals`、`events`、`ledgerEntries`、`briefs`、`catalogItems`（纯只追加：确认、下架、只改标题都插新行，`draft` 行也从不修改）、`sharedFacts`、`constraintRevisions`、`executions`、`changeOrders`、`attempts`（终态后不改 `status`，只可补记 usage）；代码库对这些表无 `patch` / `replace` / `delete`，例外只有 `status` 迁移与 `privacy.redact` 把 `REDACTABLE_FIELDS`（与 `termsKey` 覆盖字段不相交）覆盖为 `\"[redacted]\"`；删除入口只有 `seed.reset` 与 `ops.purgeRawOutputs`（内部表 `rawOutputs`）；`seed.reset` 为 dev / preview / test-only internal mutation，`assertTier` 读 `DEPLOYMENT_TIER` 与 `ctx.meta.getDeploymentMetadata().name`，只删 `provenance !== 'live'` 的房间；prod 无 reset，`rooms.close` 是 `setup` / `open` 房间唯一的\"清理\"（`executed` 房间保持只读，canon D18、04 M6）");
  it.todo("INV-56 `events.append` 是唯一写事件入口，为同事务多条事件分配递增 `seq`，`(roomId, commitTs, seq)` 唯一；每个状态迁移（room / run / turn（G0 情形除外）/ proposal / approval / execution / bump / humanRequest / task）至少一条事件；`commitTs` 不进任何 DTO，游标为字符串；不做哈希链（外部锚点 → 17）");
  it.todo("INV-57 约束历史可复现：每个 cv 一行 `constraintRevisions { version, previousVersion, cause, actorUserId?, sourceRefs, localDate }`（`cause ∈ room_opened / brief_confirmed / catalog_changed / human_answer / clock / scenario_migrated`；`room_opened` 行的 `sourceRefs` 含全部生效来源，其余只含本次变化的来源；只有 `clock` 缺 `actorUserId`）；`briefs` 与 `catalogItems` 版本不可变 ⇒ 任一提案在任一历史 cv 下的检查可由 `sourceRefs` 重算（`replayRuleInput`，internal query，按查看者投影后显示）；行内不存任何约束值，不回填源表（无 `producedConstraintsVersion`）");
  it.todo("INV-58 执行后历史不再变化：`executed` 房间拒绝 bump（INV-52），`executions` / `changeOrders` / `approvalIds` 永不被重新评估；`startFollowUp` 的新房间 cv 从 0 起、账本独立、只以 `followsExecutionId` 引用旧执行");
});
