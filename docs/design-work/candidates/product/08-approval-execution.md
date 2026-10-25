# 08 审批与执行（part1）：绑定、必需签核、签核类型、撤回与过期、完成判定

> 本章分 2 片：part1（本文件）8.1–8.6；part2 8.7 执行事务分步时序、8.8 失败分支、8.9 记录派生、8.10 幂等与并发分析、8.11 执行边界与执行之后。

## 8.1 审批绑定什么

| 绑定项 | 存在哪里 | 作用 |
| --- | --- | --- |
| `proposalId` | `decisions.proposalId` | 提案条款不可变（I-11），绑定 ID 即绑定内容 |
| `constraintsVersion` | `decisions.constraintsVersion` | 约束一变，旧签核自动变为 stale（核心 3） |
| `termsKey` | `decisions.termsKey`（副本） | 可读的规范化证据；`decisions.record` 要求客户端回传它（`expectedTermsKey`），确保"人看到的就是被签的" |
| 签核类型 | `decisions.signoffKind`（取自提案快照） | 区分 terms 与 budget 两种责任 |

**不复制提案**（ADR-09）：约束变化后若提案仍可执行，同一个 `proposalId` 在新约束版本下重新签核；界面提示 "Terms unchanged · constraints v6 → v7 · re-approval needed"。被否决的备选是 Role A 的 revalidated 复制版本：它重复绑定约束版本、制造两行相同条款的版本噪音，并把 finance 的动作记成 provider 的提案（RA-R11）。

## 8.2 谁必须签核

- 由插件 `RoleSpec.signoff` 声明（scope_change：customer `terms`、provider `terms`、finance `budget`），在 `insertProposal` 时快照进 `proposal.requiredSignoffs: [{seatId, roleKey, kind}]`；执行以快照为准（RA-R05、F08.2）。
- 席位上没有可改的 `approvalRequired` 开关；v1 不能中途增减必需签核人。将来若支持（例如成员变化），必须走 `bumpConstraints`，使旧签核失效（17）。
- 完成判定**按集合不按计数**：每个快照中的席位都要有当前约束版本下最新为 approve 的决定；禁止 `approvals.length >= N`（重复点击会让计数提前达标）。
- 不同席位必为不同用户（I-2）；执行时再断言一次。

## 8.3 两种签核类型（F08.3、Q5 的决定）

| 类型 | 谁 | 界面文案 | 含义 |
| --- | --- | --- | --- |
| `terms` | customer、provider | "Accept terms of v2 (constraints v7)" | 同意范围、价格、交付日与延后项 |
| `budget` | finance | "Approve budget commitment of +$750 (v2, constraints v7)" | 同意把这笔金额记入预算台账 |

两类签核都绑定同一个"提案 × 约束版本"，执行要求全部齐全；不做成两套独立流程。provider 的视图只显示条款与自己的任务；finance 的视图额外显示预算影响。

## 8.4 撤回、拒绝与过期

| 情况 | 规则 |
| --- | --- |
| 撤回 | 执行前可撤回自己在当前约束版本下的 approve：追加一条 `withdraw`，状态回到 pending；不要求理由（理由可写在备注，仅本人可见）。执行后不可撤回（RA-R16） |
| 拒绝后改主意 | 再追加一条 approve 即可（前提：提案仍为当前且可执行）；历史保留全部三条（RA-B06 回归） |
| 约束变化 | 旧签核读时判定为 `stale_approve` / `stale_reject`，记录不删不改 |
| 新提案出现 | 旧提案 `superseded`，其上的签核随之无意义（界面在历史中显示 "Superseded by v3"） |
| 报价过期 | 不让签核本身过期，而是让提案经 `source_unexpired` 检查被阻断（时间型变化不经 `bumpConstraints`，执行时用实时日期重算兜底）。签核本身是否设有效期列为开放问题（18） |

## 8.5 完成判定（纯函数）

```ts
// engine/signoff.ts
export type SignoffState = "pending" | "approved" | "rejected" | "stale_approve" | "stale_reject";
export function signoffStates(
  required: { seatId: string; roleKey: string; kind: string }[],
  decisions: { seatId: string; userId: string; kind: "approve" | "reject" | "withdraw";
               constraintsVersion: number; _creationTime: number; _id: string }[],
  currentConstraintsVersion: number,
): { perSeat: Record<string, { state: SignoffState; decisionId?: string; userId?: string }>;
     complete: boolean; approvingDecisionIds: string[] } {
  const perSeat: Record<string, { state: SignoffState; decisionId?: string; userId?: string }> = {};
  for (const r of required) {
    const mine = decisions.filter(d => d.seatId === r.seatId)
                          .sort((a, b) => a._creationTime - b._creationTime);
    const latest = mine.at(-1);
    if (!latest) { perSeat[r.seatId] = { state: "pending" }; continue; }
    const current = latest.constraintsVersion === currentConstraintsVersion;
    const state: SignoffState =
      latest.kind === "withdraw" ? "pending" :
      latest.kind === "approve" ? (current ? "approved" : "stale_approve") :
                                  (current ? "rejected" : "stale_reject");
    perSeat[r.seatId] = { state, decisionId: latest._id, userId: latest.userId };
  }
  const approving = required.map(r => perSeat[r.seatId]).filter(s => s.state === "approved");
  const distinctUsers = new Set(approving.map(s => s.userId)).size === approving.length;
  const complete = approving.length === required.length && distinctUsers;
  return { perSeat, complete, approvingDecisionIds: approving.map(s => s.decisionId!) };
}
```

注意：withdraw 若发生在旧约束版本，最新一条是旧版本的 withdraw，状态仍为 pending——这是正确的（人没有在当前版本表达任何态度）。

## 8.6 审批前展示"将创建的记录"

`rooms.workspace` 的 `current.recordsPreview` 用与执行完全相同的插件函数计算（`records.commitmentCents`、`records.tasks`），展示：

- 变更单编号预测 "CO-{executionSeq + 1}"（标注 "number assigned on execution"）；
- 预算承诺金额（公开，= 提案金额）；买方另见执行后已承诺与余量；
- 任务清单（标题、指派角色、截止日）；
- 声明 "Internal record only — no payment, transfer, or signature."

若查看者是最后一个待签核的人，按钮下方显示 "Approving will execute these records now"（F6）。这解决"审批人看不到批准后会生成哪些任务"（RA-B19、Q10：任务由带版本的确定性模板派生，模板版本记入执行记录，不纳入 termsKey）。
