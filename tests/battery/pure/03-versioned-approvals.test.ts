import { describe, expect, it as vitestIt } from "vitest";
import {
  cents,
  evaluateApprovalSet,
  hardProjection,
  isExecutable,
  viewFor,
  type ApprovalRow,
} from "../../../core/engine";
import {
  GOLDEN_ANCHOR,
  main,
  materializeFixture,
  scopeChangePlugin,
  toRuleInput,
} from "../../../core/scenarios/scope-change";

// W1-1F: preserve the independent approval-set and executable assertions.
import * as w1Rules from '../../../core/engine/rules';
import * as w1Fixture from '../../engine/rules/fixture';
const w1Checks = (() => {
const { evaluateApprovalSet, isExecutable, canExecuteNow } = w1Rules;
const { input, plugin, proposal } = w1Fixture;
const approval = { id: 'a', userId: 'u', role: 'customer', kind: 'terms' as const, decision: 'approve' as const, seq: 1, boundConstraintsVersion: 3, boundTermsKey: 't' };
const setInput = { required: [{ role: 'customer', kind: 'terms' as const }], members: [{ role: 'customer', userId: 'u' }], rows: [approval], roomConstraintsVersion: 3, termsKey: 't' };
const executableInput = () => ({ room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'p' }, proposal: { ...proposal(), _id: 'p', status: 'active', createdAtConstraintsVersion: 1 }, input });
const checks = {
  'INV-26': () => {
    expect(evaluateApprovalSet(setInput).complete).toBe(true);
    expect(evaluateApprovalSet({ ...setInput, rows: [approval, { ...approval, id: 'b', seq: 2, decision: 'withdraw' }] }).complete).toBe(false);
    expect(evaluateApprovalSet({ ...setInput, roomConstraintsVersion: 4 }).slots[0]?.slot.state).toBe('stale_approve');
    expect(evaluateApprovalSet({ ...setInput, members: [{ role: 'customer', userId: 'replacement' }] }).complete).toBe(false);
  },
  'INV-27': () => {
    const result = evaluateApprovalSet({ ...setInput, required: [...setInput.required, { role: 'finance', kind: 'budget' }], members: [...setInput.members, { role: 'finance', userId: 'u' }] });
    expect(result.complete).toBe(false);
    expect(result.reasons).toContainEqual({ code: 'approval.self_conflict', role: 'finance' });
  },
  'INV-35': () => {
    const x = executableInput();
    expect(isExecutable(plugin, x)).toEqual({ ok: true });
    expect(canExecuteNow(plugin, { ...x, approvalSet: evaluateApprovalSet({ ...setInput, rows: [] }) }).ok).toBe(false);
    expect(isExecutable(plugin, { ...x, run: { ...x.run, status: 'superseded' } })).toEqual({ ok: false, reasons: [{ code: 'approval.not_current' }] });
  },
  'CE-053': () => {
    const x = executableInput();
    const approvalSet = evaluateApprovalSet({ ...setInput, termsKey: x.proposal.termsKey, rows: [{ ...approval, boundTermsKey: x.proposal.termsKey }] });
    expect(canExecuteNow(plugin, { ...x, approvalSet })).toEqual({ ok: true });
  },
};
return checks;
})();

const materialized = materializeFixture(main, GOLDEN_ANCHOR);
const inputCv1 = toRuleInput(materialized as unknown as Record<string, unknown>);
const v2 = scopeChangePlugin.materialize(
  { itemKeys: ["audit_log_export", "sso_login"], modifiers: [] },
  inputCv1.catalog,
  inputCv1.localDate,
)!;
const required = scopeChangePlugin.roles.map((r) => ({ role: r.role, kind: r.approvalKind }));
const members = scopeChangePlugin.roles.map((r) => ({ role: r.role, userId: `user_${r.role}` }));

function inv26() {
  const rows: ApprovalRow[] = [
    {
      id: "a1",
      userId: "user_customer",
      role: "customer",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 1,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "a2",
      userId: "user_provider",
      role: "provider",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 2,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "a3",
      userId: "user_provider",
      role: "provider",
      kind: "terms",
      decision: "withdraw",
      seq: 2,
      boundConstraintsVersion: 2,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "a4",
      userId: "user_finance",
      role: "finance",
      kind: "budget",
      decision: "reject",
      seq: 1,
      boundConstraintsVersion: 1,
      boundTermsKey: v2.termsKey,
    },
  ];
  const res = evaluateApprovalSet({
    required,
    members,
    rows,
    roomConstraintsVersion: 2,
    termsKey: v2.termsKey,
  });
  expect(res.complete).toBe(false);
  expect(res.slots.find((s) => s.role === "customer")?.slot.state).toBe("stale_approve");
  expect(res.slots.find((s) => s.role === "provider")?.slot.state).toBe("withdrawn");
  expect(res.slots.find((s) => s.role === "finance")?.slot.state).toBe("stale_reject");

  // Non-member userId or boundTermsKey mismatch is never effective
  const badRows: ApprovalRow[] = [
    {
      id: "b1",
      userId: "user_stranger",
      role: "customer",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 2,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "b2",
      userId: "user_provider",
      role: "provider",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 2,
      boundTermsKey: "wrong_terms_key",
    },
  ];
  const badRes = evaluateApprovalSet({
    required,
    members,
    rows: badRows,
    roomConstraintsVersion: 2,
    termsKey: v2.termsKey,
  });
  expect(badRes.complete).toBe(false);
  expect(badRes.missingRoles).toEqual(["customer", "provider", "finance"]);
}

function inv27() {
  const sameUserMembers = [
    { role: "customer", userId: "user_shared" },
    { role: "provider", userId: "user_provider" },
    { role: "finance", userId: "user_shared" },
  ];
  const rows: ApprovalRow[] = [
    {
      id: "a1",
      userId: "user_shared",
      role: "customer",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 1,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "a2",
      userId: "user_provider",
      role: "provider",
      kind: "terms",
      decision: "approve",
      seq: 1,
      boundConstraintsVersion: 1,
      boundTermsKey: v2.termsKey,
    },
    {
      id: "a3",
      userId: "user_shared",
      role: "finance",
      kind: "budget",
      decision: "approve",
      seq: 2,
      boundConstraintsVersion: 1,
      boundTermsKey: v2.termsKey,
    },
  ];
  const res = evaluateApprovalSet({
    required,
    members: sameUserMembers,
    rows,
    roomConstraintsVersion: 1,
    termsKey: v2.termsKey,
  });
  expect(res.complete).toBe(false);
  expect(res.reasons).toContainEqual({ role: "finance", code: "approval.self_conflict" });
}

function inv35() {
  // Valid input (including createdAtConstraintsVersion mismatch not blocking isExecutable)
  const validExec = isExecutable(scopeChangePlugin, {
    room: { status: "open", currentRunId: "run_1" },
    run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
    proposal: {
      ...v2,
      _id: "p_1",
      status: "active",
      createdAtConstraintsVersion: 1,
    } as typeof v2 & { _id: string; status: string; createdAtConstraintsVersion: number },
    input: inputCv1,
  });
  expect(validExec.ok).toBe(true);
  expect(validExec).toEqual({ ok: true });

  // Invalid proposal.status: 'stale', 'executed', 'superseded'
  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "open", currentRunId: "run_1" },
      run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
      proposal: { ...v2, _id: "p_1", status: "stale" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "version.stale_constraints" }] });

  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "open", currentRunId: "run_1" },
      run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
      proposal: { ...v2, _id: "p_1", status: "executed" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "approval.already_executed" }] });

  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "open", currentRunId: "run_1" },
      run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
      proposal: { ...v2, _id: "p_1", status: "superseded" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "approval.not_current" }] });

  // Invalid run.currentProposalId !== proposal._id
  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "open", currentRunId: "run_1" },
      run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_other" },
      proposal: { ...v2, _id: "p_1", status: "active" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "approval.not_current" }] });

  // Invalid run.status !== 'pending_approval' and room.status !== 'open'
  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "open", currentRunId: "run_1" },
      run: { _id: "run_1", status: "running", currentProposalId: "p_1" },
      proposal: { ...v2, _id: "p_1", status: "active" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "approval.not_current" }] });

  expect(
    isExecutable(scopeChangePlugin, {
      room: { status: "executed", currentRunId: "run_1" },
      run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
      proposal: { ...v2, _id: "p_1", status: "active" },
      input: inputCv1,
    }),
  ).toMatchObject({ ok: false, reasons: [{ code: "approval.not_current" }] });

  // Invalid checkProposal blocking !== empty
  const overBudgetExec = isExecutable(scopeChangePlugin, {
    room: { status: "open", currentRunId: "run_1" },
    run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
    proposal: { ...v2, _id: "p_1", status: "active" },
    input: { ...inputCv1, capCents: cents(470_000), headroomCents: 70_000 },
  });
  expect(overBudgetExec.ok).toBe(false);
  expect(overBudgetExec).toEqual({ ok: false, reasons: [{ code: "budget.over" }] });
}

function ce045() {
  const before = hardProjection(scopeChangePlugin, inputCv1);
  const afterSoftAndDisclosureChange = hardProjection(scopeChangePlugin, {
    ...inputCv1,
    preferredItemKeys: ["custom_theme"],
    notes: "updated private note",
  });
  expect(afterSoftAndDisclosureChange).toBe(before);
  // Changing disclosure switches changes viewFor, but never changes hardProjection
  const openView = viewFor(
    scopeChangePlugin,
    inputCv1,
    { requiredItemKeys: ["provider"], deadline: ["provider"] },
    "provider",
  );
  expect(openView.deadline).toBeDefined();
  expect(hardProjection(scopeChangePlugin, inputCv1)).toBe(before);
}

function ce053() {
  const execAtCv3 = isExecutable(scopeChangePlugin, {
    room: { status: "open", currentRunId: "run_1" },
    run: { _id: "run_1", status: "pending_approval", currentProposalId: "p_1" },
    proposal: {
      ...v2,
      _id: "p_1",
      status: "active",
      createdAtConstraintsVersion: 1,
    } as typeof v2 & { _id: string; status: string; createdAtConstraintsVersion: number },
    input: inputCv1,
  });
  expect(execAtCv3.ok).toBe(true);
  const approvalsAtCv3: ApprovalRow[] = scopeChangePlugin.roles.map((r, i) => ({
    id: `a_${i + 1}`,
    userId: `user_${r.role}`,
    role: r.role,
    kind: r.approvalKind,
    decision: "approve" as const,
    seq: 1,
    boundConstraintsVersion: 3,
    boundTermsKey: v2.termsKey,
  }));
  const setAtCv3 = evaluateApprovalSet({
    required,
    members,
    rows: approvalsAtCv3,
    roomConstraintsVersion: 3,
    termsKey: v2.termsKey,
  });
  expect(setAtCv3.complete).toBe(true);
}

// W2-3: excluded private soft/disclosure fields preserve projection and checks.
import { readFileSync } from 'node:fs';
import { findConstraintWriteViolations } from '../../../scripts/lib/constraint-writes.mjs';
import { hardProjection as w2HardProjection, checkProposal as w2CheckProposal } from '../../../core/engine/rules';
import { input as w2Input, plugin as w2Plugin, proposal as w2Proposal } from '../../engine/rules/fixture';
const w2Checks: Record<string, () => void> = {
  'CE-057': () => {
    for (const source of [
      'ctx.db.patch(roomId, { constraintsVersion: 2 });',
      'ctx.tx.patch("rooms", roomId, { constraintsVersion });',
      'ctx.db.patch(briefId, { hardFields: secret });',
      'ctx.db["patch"](briefId, { ["hardFields"]: secret });',
      'async function unsafe() { await bump(tx, args); }',
      'import { bump as mutate } from "./constraints"; async function unsafe() { await mutate(tx, args); }',
    ]) expect(findConstraintWriteViolations('convex/model/probe.ts', source)).not.toEqual([]);
    expect(findConstraintWriteViolations('convex/model/constraints/protocol.ts', 'async function bump(){await ctx.tx.patch(\"rooms\",roomId,{constraintsVersion:2});}')).toEqual([]);
    const adapter = '// Removed legacy adapter\nfunction makeConstraintTx(){ return { patchVersion: version => ctx.db.patch(roomId, {constraintsVersion:version}) }; }';
    expect(findConstraintWriteViolations('convex/model/_parallelStubs.w2-3.ts', adapter)).not.toEqual([]);
    expect(findConstraintWriteViolations('convex/model/probe.ts', adapter)).not.toEqual([]);
    expect(findConstraintWriteViolations('convex/model/_parallelStubs.w2-3.ts', adapter.replace('// Removed legacy adapter', ''))).not.toEqual([]);
    expect(findConstraintWriteViolations('convex/model/probe.ts', 'ctx.db.patch(runId,{status:"superseded"});')).toEqual([]);
    for (const file of ['convex/model/constraints.ts', 'convex/model/constraints/protocol.ts', 'convex/model/runs.ts', 'convex/model/clock.ts']) expect(findConstraintWriteViolations(file, readFileSync(file, 'utf8'))).toEqual([]);
  },
  'CE-045': () => {
    const changed = { ...w2Input, preferredDate: '2026-11-01', preferredItemKeys: ['usage_dashboard'], notes: 'private notes', disclosures: { deadline: ['finance'] } };
    expect(w2HardProjection(w2Plugin, changed)).toBe(w2HardProjection(w2Plugin, w2Input));
    expect(w2CheckProposal(w2Plugin, changed, w2Proposal())).toEqual(w2CheckProposal(w2Plugin, w2Input, w2Proposal()));
  },
};

import { scenarioOf, latestScenarioVersion } from '../../../convex/scenarios/registry';
// W2-3 / W1-1F: register each registry title once while retaining both bodies.
const implemented: Record<string, () => void> = {
'CE-072': () => {
    const pinned = {scenarioKey: 'scope_change', scenarioVersion: 1};
    expect(scenarioOf(pinned)).toBe(scopeChangePlugin);
    expect(latestScenarioVersion('scope_change')).toBe(1);
    expect(() => scenarioOf({...pinned, scenarioVersion: 2})).toThrow(/scenario_version/);
    expect(() => scenarioOf({...pinned, scenarioKey: 'unregistered'})).toThrow(/scenario_version/);
    expect(scenarioOf(pinned)).toBe(scopeChangePlugin);
  },

  'INV-26': () => { inv26(); w1Checks['INV-26'](); },
  'INV-27': () => { inv27(); w1Checks['INV-27'](); },
  'INV-35': () => { inv35(); w1Checks['INV-35'](); },
  'CE-045': () => { ce045(); w2Checks['CE-045']!(); },
  'CE-053': () => { ce053(); w1Checks['CE-053'](); },
  'CE-057': w2Checks['CE-057']!,
};
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body);
  else vitestIt.todo(title);
} };

describe("P · 03-versioned-approvals",()=>{
  it.todo("INV-26 审批有效性不存字段：`effective(a) ⇔ a 是 (proposalId, userId) 上 seq 最大行 ∧ a.decision === 'approve' ∧ a.boundConstraintsVersion === cv ∧ a.boundTermsKey === proposal.termsKey ∧ userId 是当前 members 中 a.role 的成员`；其余派生为 `stale_approve / stale_reject / withdrawn`；执行后一律以 `executions.approvalIds` 快照显示，不再实时派生");
  it.todo("INV-27 完成判定按集合：对 `proposal.requiredApprovals` 的每个 `{ role, kind }`，取**当前** members 中该角色成员，其有效决定为 approve，被选 userId 两两不同（`approval.self_conflict`）；禁止计数式判定；输入必须是同一事务读到的**整个** `approvals.by_proposal` 区间 + 当前 `members` + `rooms`");
  it.todo("INV-35 `passesChecks(p) ⇔ checkProposal(p, RuleInput@cv, room.localDate).blocking = ∅`；`isExecutable(p) ⇔ room.status === 'open' ∧ run 是 room.currentRunId ∧ run.status === 'pending_approval' ∧ run.currentProposalId === p._id ∧ p.status === 'active' ∧ passesChecks(p)`（**不含**审批集合）；`canExecuteNow(p) ⇔ isExecutable(p) ∧ allApproved(p)`（`evaluateApprovalSet` 已齐），是唯一的执行条件；三者实时计算、不存字段；**不**比较 `createdAtConstraintsVersion`");
  it.todo("CE-045 customer 只改软字段 `preferredItemKeys` / 披露开关 / 备注");
  it.todo("CE-053 提案在 cv1 创建；当前 cv3 下全部检查通过且三方在 cv3 批准");
  it.todo("CE-057 变异：某 mutation 直接 `patch(rooms, { constraintsVersion })` 或直接 patch `briefs.hardFields`");
  it.todo("CE-072 部署新版场景规则（插件代码变化）而房间 `scenarioVersion` 不变；或新部署不再注册旧版本");
});
