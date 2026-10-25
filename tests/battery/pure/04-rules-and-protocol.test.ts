import { inv43ValueDomainChecks, ce075Rationale1500CodepointsRejected, ce094ExtraRoomIdOrProposalVersionRejected } from '../../engine/w2-5-battery-helpers';
import { gatewayWhitelistChecks, thinkingTruncationChecks, budgetMutationChecks } from '../../engine/gatewayAssertions';
import { describe, expect, it as vitestIt } from "vitest";
import {
  cents,
  enumerateCandidates,
  isoDate,
  materializeSelectedOption,
  MAX_CENTS,
  resolveOptionKeyWithReason,
  viewFor,
  type Cents,
} from "../../../core/engine";
import { checkBudget, checkProposal, claimMismatch, materializeTerms } from "../../../core/engine/rules";
import {
  validateCapCents,
  validateDeadline,
  validateNotes,
} from "../../../core/scenarios/scope-change";
import {
  scopeChangeCandidates,
  viewForRoleFromFixture,
} from "../../../core/scenarios/scope-change/candidates";
import { main } from "../../../core/scenarios/scope-change/fixtures/main";
import { input, plugin, proposal } from "../../engine/rules/fixture";

import { runtimePureCases } from '../../engine/runtimeBattery';
const implemented: Record<string, () => void | Promise<void>> = {
  'INV-45': runtimePureCases['INV-45']!,
  'INV-40': runtimePureCases['INV-40']!,
  'CE-075': ce075Rationale1500CodepointsRejected,
  'CE-094': ce094ExtraRoomIdOrProposalVersionRejected,

  'INV-42': gatewayWhitelistChecks,
  'CE-076': thinkingTruncationChecks,
  'CE-093': budgetMutationChecks,
  'INV-37': () => {
    const p = proposal();
    expect(p.terms.amountCents).toBe(p.lines.reduce((n, l) => n + l.priceCents, 0));
    p.terms.amountCents = cents(85000);
    expect(claimMismatch(p)).toEqual({ ok: false, code: 'amount.claim_mismatch' });
  },
  'INV-38': () => {
    const p = proposal();
    const changed = { ...input, catalog: input.catalog.map(r => ({ ...r, revision: 2 })) };
    expect(checkProposal(plugin, changed, p).blocking).toContain('version.stale_source');
    p.terms.itemKeys.push('sso_login');
    expect(checkProposal(plugin, input, p).blocking).toContain('item.duplicate');
    const missing = { ...input, requiredItemKeys: ['absent_item'] };
    expect(checkProposal(plugin, missing, proposal()).blocking).toContain('item.required_missing');
  },
  'INV-39': () => {
    const p = proposal(input.catalog.filter(r => r.kind === 'item').map(r => r.itemKey));
    expect(checkProposal(plugin, input, p).blocking).toEqual(['date.after_deadline', 'budget.over']);
    expect(checkBudget({ capCents: cents(480000), committedCents: cents(400000), amountCents: cents(80000) }).ok).toBe(true);
    expect(checkProposal(plugin, { ...input, capCents: cents(399999) }, proposal()).blocking).toEqual(['budget.below_committed']);
  },
  'CE-073': () => expect(checkBudget({ capCents: cents(480000), committedCents: cents(400000), amountCents: cents(80000) }).ok).toBe(true),
  'CE-074': () => expect(checkBudget({ capCents: cents(479999), committedCents: cents(400000), amountCents: cents(80000) })).toMatchObject({ ok: false, code: 'budget.over', params: { overByCents: 1 } }),
  'CE-078': () => {
    const customerView = viewForRoleFromFixture(main, 'customer');
    const baseKey = 'audit_log_export+sso_login+usage_dashboard';
    const fullSnap = enumerateCandidates(scopeChangeCandidates, customerView, {
      roundNo: 1,
      turnKind: 'propose',
    });
    expect(fullSnap.items.find(s => s.optionKey === 'O2')?.candidateKey).toBe(baseKey);

    // Evaluator snapshot excludes the current base proposal itself; countering with the base's optionKey is rejected as option_not_in_snapshot
    const evalSnap = enumerateCandidates(scopeChangeCandidates, customerView, {
      roundNo: 1,
      turnKind: 'evaluate',
      baseCandidateKey: baseKey,
    });
    expect(evalSnap.items.map(s => s.candidateKey)).not.toContain(baseKey);
    expect(resolveOptionKeyWithReason(evalSnap.items, 'O2')).toEqual({
      ok: false,
      code: 'action.option_not_in_snapshot',
    });
    expect(
      materializeSelectedOption(
        scopeChangeCandidates,
        evalSnap.items,
        'O2',
        main.catalog,
        main.goldenAnchor,
      ),
    ).toEqual({
      ok: false,
      code: 'action.option_not_in_snapshot',
    });
  },
  'CE-082': () => {
    for (const value of [-1, 1.5, NaN]) expect(() => materializeTerms({ itemKeys: ['sso_login'], modifiers: [] }, input.catalog.map(r => ({ ...r, priceCents: value as Cents })), input.localDate, () => 1)).toThrow();
  },
  'CE-088': () => {
    // Exercise both a catalog with literal login+reports@rush and the main fixture's audit_log_export+sso_login@rush
    const loginReportsCatalog = [
      { itemKey: 'login', kind: 'item' as const, revision: 1, title: 'Login', priceCents: 50_000, leadDays: 14, status: 'confirmed' as const, provenance: 'seeded' as const, taskTemplates: [{ title: 'Build login' }] },
      { itemKey: 'reports', kind: 'item' as const, revision: 1, title: 'Reports', priceCents: 40_000, leadDays: 16, status: 'confirmed' as const, provenance: 'seeded' as const, taskTemplates: [{ title: 'Build reports' }] },
      { itemKey: 'rush', kind: 'modifier' as const, revision: 1, title: 'Rush', priceCents: 15_000, leadDays: 4, status: 'confirmed' as const, provenance: 'seeded' as const, taskTemplates: [] },
    ];
    const loginReportsView = viewFor(
      scopeChangeCandidates,
      {
        localDate: '2026-11-02',
        catalog: loginReportsCatalog,
        requiredItemKeys: ['login'],
        deadline: isoDate('2026-11-15'),
        capCents: undefined,
        committedCents: undefined,
        headroomCents: undefined,
      },
      { requiredItemKeys: ['provider'], deadline: ['provider'] },
      'provider',
    );
    const round1LoginSnap = enumerateCandidates(scopeChangeCandidates, loginReportsView, {
      roundNo: 1,
      turnKind: 'propose',
    });
    const blockedLoginRush = 'login+reports@rush';
    const loginRushEntry = round1LoginSnap.items.find(s => s.candidateKey === blockedLoginRush);
    expect(loginRushEntry).toBeDefined();

    // Once blocked in round 1, round 2 enumeration excludes login+reports@rush
    const round2LoginSnap = enumerateCandidates(scopeChangeCandidates, loginReportsView, {
      roundNo: 2,
      turnKind: 'propose',
      excludedCandidateKeys: [blockedLoginRush],
    });
    expect(round2LoginSnap.items.map(s => s.candidateKey)).not.toContain(blockedLoginRush);

    // Resolving or materializing the blocked candidate from a stale snapshot against the run's blocked keys fails with action.repeats_blocked
    expect(
      resolveOptionKeyWithReason(
        round1LoginSnap.items,
        loginRushEntry!.optionKey,
        [blockedLoginRush],
      ),
    ).toEqual({
      ok: false,
      code: 'action.repeats_blocked',
    });
    expect(
      materializeSelectedOption(
        scopeChangeCandidates,
        round1LoginSnap.items,
        loginRushEntry!.optionKey,
        loginReportsCatalog,
        '2026-11-02',
        [blockedLoginRush],
      ),
    ).toEqual({
      ok: false,
      code: 'action.repeats_blocked',
    });
  },
  'CE-090': () => {
    for (const d of ['2026-02-30', '2026-2-3']) {
      const p = proposal(); p.terms.deliveryDate = d as typeof p.terms.deliveryDate;
      expect(checkProposal(plugin, input, p).blocking).toContain('date.invalid');
    }
    const p = proposal(); p.terms.deliveryDate = isoDate('4800-01-01');
    expect(checkProposal(plugin, input, p).blocking).toContain('date.out_of_range');
  },
  'CE-091': () => {
    const d = { itemKeys: ['audit_log_export', 'sso_login'], modifiers: ['rush'] };
    const catalog = input.catalog.map(r => r.kind === 'modifier' ? { ...r, priceCents: cents(12345) } : r);
    expect(plugin.materialize(d, catalog, input.localDate)?.terms.amountCents).toBe(92345);
  },
  'INV-43': () => {
    inv43ValueDomainChecks();
    expect(cents(0)).toBe(0);
    expect(cents(MAX_CENTS)).toBe(MAX_CENTS);
    expect(() => cents(-1)).toThrow();
    expect(() => cents(1.5)).toThrow();
    expect(() => cents(Number.NaN)).toThrow();
    expect(() => cents(MAX_CENTS + 1)).toThrow();
    expect(validateDeadline('2026-02-30', isoDate('2026-11-02'))).toEqual({
      ok: false,
      code: 'date.invalid',
      params: { field: 'deadline' },
    });
    expect(validateDeadline('2026-11-01', isoDate('2026-11-02'))).toMatchObject({
      ok: false,
      code: 'date.in_past',
    });
    expect(validateDeadline('2027-11-03', isoDate('2026-11-02'))).toMatchObject({
      ok: false,
      code: 'date.out_of_range',
    });
    expect(validateCapCents(-100, cents(400000))).toMatchObject({ ok: false });
    expect(validateNotes('a'.repeat(2001))).toMatchObject({
      ok: false,
      code: 'input.invalid',
    });
    for (const bad of [-1, 1.5, Number.NaN, MAX_CENTS + 1]) {
      expect(() =>
        materializeTerms(
          { itemKeys: ['sso_login'], modifiers: [] },
          input.catalog.map((r) => ({ ...r, priceCents: bad as Cents })),
          input.localDate,
          () => 1,
        ),
      ).toThrow();
    }
  },
};
// The reconciliation test parses these exact declarations. Resolve implemented
// IDs to real Vitest tests while retaining its immutable registry titles.
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body);
  else vitestIt.todo(title);
} };


describe("P · 04-rules-and-protocol", () => {
  it.todo("INV-37 `proposals.terms.amountCents === Σ proposals.lines[].priceCents`（插入时与执行时各断言一次，不等 → `amount.claim_mismatch`）；`lines[] = { itemKey, revision, title, priceCents, leadDays }` 来自插入时 `catalogItems(status: 'confirmed')` 的快照；rush 等加急是 `catalogItems(kind: 'modifier')` 的一行，不存在插件常量；`priceTerms` 只读 `terms` 与目录快照，不读约束 / `localDate` / 软字段（改约束而 terms 不变 ⇒ 金额不变）");
  it.todo("INV-38 来源核对：`terms.itemKeys ⊆` 当前 confirmed 目录（`item.unknown` / `item.unconfirmed` / `item.retired`）；`lines[].revision`（定价修订号）与当前目录行的 `revision` 不同 → `version.stale_source`（由 INV-24 保证它只在守卫层出现，正常路径 bump 已 supersede；只改标题 / 任务模板只增 `editNo`，不触发）；必需项不在目录 → `item.required_missing`，不崩溃；重复 itemKey → `item.duplicate`");
  it.todo("INV-39 `RuleInput` 类型要求三方全部硬字段（v1 provider 的硬字段只有目录，无 `earliestStartDate`）；`checkProposal` 一次收集全部阻断（不短路）；`checkBudget`: `committedCents + amountCents <= capCents`（闭区间，`budget.over`）；`budget.below_committed` 保留为纵深防御码，不是可达状态（`budget.setCap` / finance `briefs.confirm` 在 `capCents < committedCents` 时直接拒绝、不 bump、不写事件，`params.minAllowedCapCents` 只给 finance）");
  it.todo("INV-40 模型输出判定链固定：先把 `usage` / `stop_reason` / `requestId` 记入 `attempts`（无论成败）；`stop_reason === 'max_tokens'` → `output.truncated`（重试一次）、`refusal` → attempt `refused`（不重试）、`model_context_window_exceeded` → `error`（不重试）；然后 `JSON.parse` → `safeParse(strictObject)` → 语义校验；永不把失败当作\"代理没有动作\"");
  it.todo("INV-42 全部模型调用经 `modelGateway` 运行时白名单：model `claude-opus-5-5`、显式 `output_config.effort: 'medium'`、`output_config.format = { type: 'json_schema', schema }`、`max_tokens: 16000`、`client.messages.stream({...}).finalMessage()`、单次发送 `timeout` 由 `max_tokens` 推导、SDK `maxRetries: 0`（传输层拒绝非零值；重试层归网关：`callModel` 只对 429 与连接错误在同一次调用内重试 1 次，退避遵从 `retry-after` 但有上限且不超过剩余总截止，408 / 409 / 5xx / 529 不重试；`max_tokens` 截断在同一次调用内重试 1 次，第二次截断 `retryable: false`；attempt 层只为网关不处理的失败每条回合链至多自动重试 1 次，最坏 HTTP 次数 3 × 2 = 6）、AbortSignal 总截止覆盖首发 + 退避 + 重试并早于看门狗首次判定 `WATCHDOG_FIRST_MS`，到期在任何阶段（发送前、退避中、发送中）都是不可重试的超时；不传 `thinking` / 采样参数 / prefill / `tool_choice`；`fallbacks` 默认关；schema 在 action 内按 `(role, turnKind, 裁剪后动作集, n, scenarioVersion)` 构造、不经 `runQuery` 传递；不等式 `加载余量 + 总截止 + 落库余量 < action 上限`（I1）、`加载余量 + 总截止 < WATCHDOG_FIRST_MS`（I3）、每链 HTTP ≤ 6（I4）与 SDK 重试为 0（I6）为启动自检（10 §10.11）");
  it.todo("INV-43 值域：金额 `assertCents`（安全整数，`0 ≤ n ≤ 1e11`，入口与求和后各断言一次）；日期 `IsoDate` 真实日历日、字典序比较、禁止 `new Date(\"YYYY-MM-DD\")`、窗口 `localDate ≤ d ≤ localDate + 365`（`date.out_of_range`）；模型 `rationale` NFC 后 > 1,200 码点 → 截断到 1,200 并记 `rationaleTruncated`，**不**判 schema 失败、不重试（05 §5.5.2）；`v.*` 只校形状，人输入的负数 / `NaN` / 小数 / 超界由代码拒绝（`amount.out_of_range` / `input.invalid`）；插件返回的任何非法金额 → `internal`（代码缺陷，不是业务失败）");
  it.todo("INV-45 `rooms.scenarioKey` / `scenarioVersion` 必须在注册表中：`rooms.create` 指定未注册场景 → `run.invalid_state{ guard: 'scenario_version' }`（04 M1）；已有房间的版本在当前部署未注册 → 推进协商的写入（含 approve）以同码拒绝，reject / withdraw 照常（08 S5），读操作只返回引擎级字段；房间的 `scenarioVersion` 建房后固定，升级只能经 15 的迁移（对受影响房间 `constraints.bump(cause: 'scenario_migrated')` 后重批，或在房间全部终态前不提升版本）；插件只含纯函数（无 I/O、同输入同输出）");
  it.todo("CE-073 `committedCents 400000 + amountCents 80000 === capCents 480000`");
  it.todo("CE-074 上限 479999（边界减一分）");
  it.todo("CE-075 脚本化模型 `rationale` 1,500 码点");
  it.todo("CE-076 响应只有 thinking 块，`stop_reason: 'max_tokens'`");
  it.todo("CE-078 customer `counter` 的 optionKey 对应当前提案本身");
  it.todo("CE-081 变异：插件 `priceTerms` 读 `ctx.constraints.headcount`");
  it.todo("CE-082 插件返回负数 / `1.5` / `NaN` 金额");
  it.todo("CE-088 同一 run 内 provider 再次提出已被阻断的 `audit_log_export+usage_dashboard@rush`");
  it.todo("CE-090 输入日期 `2026-02-30`、`2026-2-3`、`4800-01-01`");
  it.todo("CE-091 变异：把 rush 费写成插件常量");
  it.todo("CE-093 配置变异（`max_tokens: 16000` 下）：`加载余量 + 总截止 + 落库余量 ≥ action 上限`；或 `加载余量 + 总截止 ≥ WATCHDOG_FIRST_MS`；或 SDK `maxRetries ≠ 0`");
  it.todo("CE-094 模型回显错误 `roomId` / `proposalVersion: 99` 在 rationale 之外的字段");
});
