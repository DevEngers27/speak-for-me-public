import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inv23ModelReferencesOnlySnapshotAndEnums, ce038ForbiddenAgentActionsRejected, ce040OutOfSnapshotOptionAndStaleVersionRejected } from '../../engine/w2-5-battery-helpers';
import type { ActionCtx } from '../../../core/engine';
import { describe, expect, it as vitestIt } from "vitest";
import {
  actionAllowed,
  allowedActions,
  enumerateCandidates,
  MODEL_ACTIONS,
} from "../../../core/engine";
import {
  scopeChangeCandidates,
  viewForRoleFromFixture,
} from "../../../core/scenarios/scope-change/candidates";
import { main } from "../../../core/scenarios/scope-change/fixtures/main";

function actionCtx(snapshotSize: number): ActionCtx {
  return { snapshotSize, clarifyUsedInRun: false, escalateUsedInRun: false, proposeCountInRun: 0, counterCountInRun: 0, providerRejectLocked: false, topicKeys: [] };
}

const inv22AllowedActionsAndCounterPool = () => {
  expect(MODEL_ACTIONS).toEqual([
    "propose",
    "counter",
    "clarify",
    "recommend_accept",
    "reject",
    "escalate",
  ]);
  expect(actionAllowed("finance", "evaluate", "counter")).toBe(false);
  expect(actionAllowed("provider", "propose", "recommend_accept")).toBe(false);
  expect(actionAllowed("provider", "propose", "counter")).toBe(false);

  expect(allowedActions("finance", "evaluate", actionCtx(0))).not.toContain("counter");
  expect(allowedActions("provider", "propose", actionCtx(0))).not.toContain("recommend_accept");
  expect(allowedActions("provider", "propose", actionCtx(0))).not.toContain("counter");
  expect(allowedActions("customer", "evaluate", actionCtx(0))).not.toContain("counter");

  const customerView = viewForRoleFromFixture(main, "customer");
  const allSnap = enumerateCandidates(scopeChangeCandidates, customerView, {
    roundNo: 1,
    turnKind: "propose",
  });
  expect(allSnap.items).toHaveLength(2);

  // When both candidates are excluded (base + run exclusions), base-excluded snapshot is empty -> 'counter' removed
  const emptyEvalSnap = enumerateCandidates(scopeChangeCandidates, customerView, {
    roundNo: 1,
    turnKind: "evaluate",
    baseCandidateKey: "audit_log_export+sso_login+usage_dashboard",
    excludedCandidateKeys: ["audit_log_export+sso_login"],
  });
  expect(emptyEvalSnap.items).toEqual([]);
  expect(allowedActions("customer", "evaluate", actionCtx(emptyEvalSnap.items.length))).not.toContain("counter");

  // Evaluator snapshot enumeration excludes the base proposal's candidateKey, leaving n = 1 >= 1 -> 'counter' kept
  const evalSnap = enumerateCandidates(scopeChangeCandidates, customerView, {
    roundNo: 1,
    turnKind: "evaluate",
    baseCandidateKey: "audit_log_export+sso_login+usage_dashboard",
  });
  expect(evalSnap.items.map((s) => s.candidateKey)).toEqual(["audit_log_export+sso_login"]);
  expect(evalSnap.items.map((s) => s.candidateKey)).not.toContain(
    "audit_log_export+sso_login+usage_dashboard",
  );
  expect(allowedActions("customer", "evaluate", actionCtx(evalSnap.items.length))).toContain("counter");
};

function executionSources(dir = 'convex'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['test', '_generated'].includes(entry.name) ? [] : executionSources(file);
    return file.endsWith('.ts') && !file.endsWith('.test.ts') ? [file] : [];
  });
}

const implemented: Record<string, () => void | Promise<void>> = {
  'INV-23': inv23ModelReferencesOnlySnapshotAndEnums,
  'CE-038': ce038ForbiddenAgentActionsRejected,
  'CE-040': ce040OutOfSnapshotOptionAndStaleVersionRejected,
  'INV-21': () => {
    const callers = executionSources().filter(file => file !== 'convex/model/executions.ts' && /\bexecuteIfComplete\s*\(/.test(readFileSync(file,'utf8')));
    expect(callers).toEqual(['convex/approvals.ts']);
    expect(readFileSync('convex/model/executions.ts','utf8')).not.toMatch(/(?:internalMutation|internalAction|memberMutation|action)\s*\(/);
  },
  'CE-037': () => {
    const writers = executionSources().filter(file => /\.insert\(['"]executions['"]/.test(readFileSync(file,'utf8')));
    expect(writers).toEqual(['convex/model/executions.ts']);
    expect(readFileSync('convex/executions.ts','utf8')).not.toMatch(/executeIfComplete|internalMutation|memberMutation/);
  }
};

const it = Object.assign(
  (title: string, fn: () => void | Promise<void>) => vitestIt(title, fn),
  { todo(title: string) {
    const body = implemented[title.split(' ')[0]!];
    if (body) vitestIt(title, body);
    else vitestIt.todo(title);
  } },
);

describe("P · 02-agent-advisory", () => {
  it.todo("INV-21 执行的唯一路径是 `approvals.record` 同事务内调用的 helper `executions.executeIfComplete`；没有公开 / internal 执行入口，没有 action 或 cron 能执行");
  it("INV-22 `AgentModelOutput.action ∈ {propose, counter, clarify, recommend_accept, reject, escalate}`；白名单 `allowedActions(role, turnKind, snapshot)`：finance 不能 `counter`，provider 无 `recommend_accept`，propose 回合无 `counter`；传入的 evaluate 快照已排除 base（05 §5.7.2），快照 `n ≥ 1` 才保留 `counter`（`n = 0` 时去掉，等价于 canon 按含 base 计数的\"n < 2 去 counter\"），counter 的 optionKey 枚举因此天然不含 base", inv22AllowedActionsAndCounterPool);
  it.todo("INV-23 模型只能引用它见过的 `optionKey`（本回合 `candidateSnapshot`）、提案 `version`、`topicKey`、`reasonKey`、`toRole`；模型声明的任何数值 / 身份 / 版本不进入任何判定；`terms` 由服务端从快照物化");
  it.todo("CE-037 结构测试：枚举 `convex/` 导出的全部函数，查找能写 `executions` 的公开 / internal 入口");
  it.todo("CE-038 脚本化模型输出 `action: 'approve'` / `'execute'` / `'request_tradeoff'`");
  // W1-1F: static matrix remains the outer boundary of dynamic action filtering.
  it("CE-039 finance evaluate 回合输出 `counter`；provider propose 回合输出 `recommend_accept`", () => {
    expect(actionAllowed('finance', 'evaluate', 'counter')).toBe(false);
    expect(actionAllowed('provider', 'propose', 'recommend_accept')).toBe(false);
    expect(allowedActions('finance', 'evaluate', actionCtx(0))).not.toContain('counter');
    expect(allowedActions('provider', 'propose', actionCtx(0))).not.toContain('recommend_accept');
  });
  it.todo("CE-040 模型 `propose { optionKey: 'O9' }` 而快照只有 O1…O5；`counter { baseProposalVersion: 1 }` 而当前是 v3");
});
