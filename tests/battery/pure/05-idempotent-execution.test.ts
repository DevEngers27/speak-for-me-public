import { describe, expect, it as vitestIt } from "vitest";

import { planExecutionRecords } from '../../../core/engine/executionPlan';
import { canonicalJson } from '../../../core/engine/canonicalJson';
import { cents } from '../../../core/engine/money';
import { isoDate } from '../../../core/engine/dates';

// W2-2: execution boundary and approval-range mutation guards.
import { readFileSync } from 'node:fs';
import { evaluateApprovalSet } from '../../../core/engine/rules/approvals';
function assertInternalExecution() {
  const source = readFileSync('convex/model/executions.ts','utf8');
  expect(source).not.toMatch(/\bfetch\s*\(|\.runAfter\s*\(|\.runAction\s*\(|\.scheduler\b|["']use node["']/);
  expect(source).not.toMatch(/from\s+["'][^"']*(?:constraints|actions|axios|stripe|nodemailer)[^"']*["']/);
  expect(source).toContain("tx.roomTx.insert('executions'");
  expect(source).not.toMatch(/ctx\.db\.(?:insert|patch|replace|delete)\s*\(/);
}
// End W2-2 boundary guards.

// W2-2: execution snapshot contracts.
const implemented: Record<string, () => void> = {
  'INV-51': () => assertInternalExecution(),
  'CE-104': () => assertInternalExecution(),
  'CE-098': () => {
    const required = [{role:'customer',kind:'terms' as const},{role:'finance',kind:'budget' as const}];
    const members = [{userId:'c',role:'customer'},{userId:'f',role:'finance'}];
    const row = {id:'a',userId:'c',role:'customer',kind:'terms' as const,decision:'approve' as const,seq:1,boundConstraintsVersion:1,boundTermsKey:'terms'};
    const input = {required,members,rows:[row],roomConstraintsVersion:1,termsKey:'terms',approvedRoles:['customer','finance']};
    expect(evaluateApprovalSet(input).complete).toBe(false);
    const actual = {...input,approvedRoles:[],rows:[row,{...row,id:'b',userId:'f',role:'finance',kind:'budget' as const}]};
    expect(evaluateApprovalSet(actual)).toMatchObject({complete:true,approvalIds:['a','b']});
  },
  'INV-49': () => {
    const terms = { itemKeys: ['scope_item'], modifiers: [], deliveryDate: isoDate('2026-10-24'), amountCents: cents(1) };
    const p = { terms, termsKey: canonicalJson(terms), lines: [{ itemKey: 'scope_item', revision: 1, title: 'Scope', priceCents: cents(1), leadDays: 0 }], plannedTasks: [{ itemKey: 'scope_item', templateIndex: 0, title: 'Frozen title', assigneeRole: 'provider', dueDate: terms.deliveryDate }] };
    const chain = { baselineCents: 0, priorApprovedDeltaCents: 0, amountBeforeCents: 0, deltaCents: 1, amountAfterCents: 1, capCents: 1, headroomAfterCents: 0 };
    const plan = planExecutionRecords(p, chain);
    expect(plan).toEqual(planExecutionRecords(structuredClone(p), structuredClone(chain)));
    expect(plan.tasks).toEqual([{ ...p.plannedTasks[0], taskKeySuffix: 'scope_item:0' }]);
    expect(`execution_id:${plan.tasks[0]!.taskKeySuffix}`).toBe('execution_id:scope_item:0');
  },
  'CE-114': () => {
    const terms = { itemKeys: ['scope_item'], modifiers: [], deliveryDate: isoDate('2026-10-24'), amountCents: cents(0) };
    const task = { itemKey: 'scope_item', templateIndex: 0, title: 'Deliver', assigneeRole: 'provider', dueDate: terms.deliveryDate };
    expect(() => planExecutionRecords({ terms, termsKey: canonicalJson(terms), lines: [], plannedTasks: [task, task] }, { baselineCents: 0, priorApprovedDeltaCents: 0, amountBeforeCents: 0, deltaCents: 0, amountAfterCents: 0, capCents: 0, headroomAfterCents: 0 })).toThrow('task_key_duplicate');
  },
};
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body); else vitestIt.todo(title);
} };
// End W2-2 execution snapshot contracts.

describe("P · 05-idempotent-execution", () => {
  it.todo("INV-49 `tasks.taskKey = ${executionId}:${itemKey}:${templateIndex}` 唯一；`tasks` 来自 `proposals.plannedTasks[]` 快照（插入时由当时的 `taskTemplates` 派生），执行时不重算模板；`deriveExecution` 对同输入稳定");
  it.todo("INV-51 mutation 内无外部副作用；执行事务不 `runAfter` 任何 action；通知 / 外部集成只能在提交后经 outbox（17，v1 不建）");
  it.todo("CE-098 变异：完成判定改读 `proposal.approvedRoles` 冗余字段");
  it.todo("CE-104 变异：mutation 内直接发通知 / `fetch`");
  it.todo("CE-114 插件给同一 itemKey 两个相同 `templateIndex`");
});
