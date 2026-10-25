# 14 · 首个场景（part2：候选空间、物化、stub、放松选项、场景检查）

> 分片总表见 `14-scenario-scope-change.md` 顶部。代码位于 `core/scenarios/scope-change/`，全部是纯函数，只读传入的 `View`（06 §5）。

## 6. 候选、条款与选项

### 6.1 规则输入与候选空间（成员 `toRuleInput`、`candidateSpace`）

```ts
export type ScopeChangeRuleInput = RuleInputBase & {
  requiredItemKeys: readonly ItemKey[] | undefined;   // customer 硬字段
  deadline: IsoDate | undefined;                      // customer 硬字段
};
export const toRuleInput = (d: RuleDocs): View<ScopeChangeRuleInput> => ({
  viewer: 'system', localDate: d.room.localDate, catalog: d.catalogRows,
  capCents: d.briefs.finance?.hardFields.capCents, committedCents: d.ledgerSumCents,
  headroomCents: d.briefs.finance ? d.briefs.finance.hardFields.capCents - d.ledgerSumCents : undefined,
  requiredItemKeys: d.briefs.customer?.hardFields.requiredItemKeys, deadline: d.briefs.customer?.hardFields.deadline,
});

const live = (v: View<ScopeChangeRuleInput>, kind: 'item' | 'modifier') =>
  v.catalog.filter((r) => r.kind === kind && r.status === 'confirmed').map((r) => r.itemKey).sort(codeUnitCmp);
const maxLead = (v: View<ScopeChangeRuleInput>, keys: readonly ItemKey[]) =>
  Math.max(...keys.map((k) => v.catalog.find((r) => r.itemKey === k)!.leadDays));

export const candidateSpace = (v: View<ScopeChangeRuleInput>) => {
  const items = live(v, 'item'), mods = live(v, 'modifier');
  const req = [...(v.requiredItemKeys ?? [])].sort(codeUnitCmp);
  if (req.some((k) => !items.includes(k)))                       // 必需项不在已确认目录：不崩溃，返回原因（06 R-D9）
    return { drafts: [], emptyReasons: ['item.required_missing' as const] };
  const optional = items.filter((k) => !req.includes(k));
  const drafts: CandidateDraft[] = [];
  for (let mask = 0; mask < 1 << optional.length; mask++) {
    const itemKeys = [...req, ...optional.filter((_, j) => mask & (1 << j))].sort(codeUnitCmp);
    if (itemKeys.length === 0) continue;
    drafts.push({ itemKeys, modifiers: [] });
    const base = addDays(v.localDate, maxLead(v, itemKeys));
    if (v.deadline === undefined || base > v.deadline)            // S-D3：只在需要时生成加急变体
      for (const m of mods) drafts.push({ itemKeys, modifiers: [m] });
  }
  return { drafts, emptyReasons: [] };
};
```

主 fixture 下（锚点 2026-11-02，截止 2026-11-20 已向 provider 披露）provider 视图只剩两个候选：`audit_log_export+sso_login`（$800，11-16）与 `audit_log_export+sso_login+usage_dashboard`（$900，11-18）；含 `slack_alerts` 或 `custom_theme` 的组合即使加急（−4 天）也晚于截止日，被检查 S3 过滤。

### 6.2 物化（成员 `materialize`）

```ts
export const materialize = (d: CandidateDraft, catalog: readonly CatalogRow[], localDate: IsoDate): Materialized | null => {
  const row = (k: ItemKey) => catalog.find((r) => r.itemKey === k)!;   // 只接收由当前目录生成的组合，永不处理旧提案
  const items = d.itemKeys.map(row), mods = d.modifiers.map(row);
  const lead = Math.max(0, Math.max(...items.map((r) => r.leadDays)) - mods.reduce((s, r) => s + r.leadDays, 0));
  const rows = [...items, ...mods].sort((a, b) => codeUnitCmp(a.itemKey, b.itemKey));
  const deliveryDate = addDays(localDate, lead);                         // 插入当天物化，之后不重算（D22）
  const amountCents = sumCents(rows.map((r) => r.priceCents));
  if (amountCents === null) return null;                                 // 极端溢出：丢弃该候选（06 INV-R6）
  return {
    candidateKey: candidateKeyOf(d),
    terms: { itemKeys: [...d.itemKeys], modifiers: [...d.modifiers], deliveryDate, amountCents },
    lines: rows.map((r) => ({ itemKey: r.itemKey, kind: r.kind, revision: r.revision, title: r.title, priceCents: r.priceCents, leadDays: r.leadDays })),
    plannedTasks: rows.flatMap((r) => r.taskTemplates.map((t, i) =>
      ({ itemKey: r.itemKey, templateIndex: i, title: t.title, assigneeRole: t.assigneeRole, dueDate: deliveryDate }))),   // assigneeRole 写入口已限定为 catalog.ownerRole
  };
};
```

插入提案时 `turns.complete` 用房间当天的 `localDate` 物化：若回合跨过午夜，交付日比快照里显示的晚一天，`candidateKey` 不变，随后照常过 `checkProposal`。`humanRequests.answer` 的 `choose_candidate` 例外：先检查请求里显示的交付日是否仍 `≥ localDate + effectiveLeadDays`（否则 `date.before_lead_time`，06 §11.4），通过后就用显示的那一天，保证"人选的就是人看到的"（scenario-plugin review r07）。

### 6.3 stub 策略（成员 `stubDecide`）

```ts
export const stubDecide = (x: StubInput): AgentModelOutput => {
  const wish = new Set<ItemKey>(((x.role === 'customer' ? x.ownSoft : x.sharedSoft).preferredItemKeys ?? []) as ItemKey[]);
  const score = (keys: readonly ItemKey[]) => keys.filter((k) => wish.has(k)).length;
  const best = [...x.snapshot].sort((a, b) => score(b.itemKeys) - score(a.itemKeys)
    || a.amountCents - b.amountCents || codeUnitCmp(a.optionKey, b.optionKey))[0];
  if (x.turnKind === 'propose') return best
    ? { turn: { action: 'propose', optionKey: best.optionKey, rationale: 'stub: most wishlist items, then lowest price' } }
    : { turn: { action: 'escalate', kind: 'infeasible', toRole: 'customer', rationale: 'stub: no candidate in my view' } };
  const cur = x.currentProposal!;
  if (x.role === 'finance') return cur.passesInMyView
    ? { turn: { action: 'recommend_accept', proposalVersion: cur.version, rationale: 'stub: passes my checks' } }
    : { turn: { action: 'reject', proposalVersion: cur.version, reasonKey: 'over_budget', rationale: 'stub: fails my checks' } };
  if (cur.passesInMyView && (!best || score(cur.itemKeys) >= score(best.itemKeys)))
    return { turn: { action: 'recommend_accept', proposalVersion: cur.version, rationale: 'stub: as good as my best option' } };
  if (best && x.allowedActions.includes('counter'))               // 05 §5.7.2：快照（已剔除 base）为空时没有 counter
    return { turn: { action: 'counter', optionKey: best.optionKey, baseProposalVersion: cur.version, rationale: 'stub: prefer my best option' } };
  return { turn: { action: 'reject', proposalVersion: cur.version, reasonKey: 'preference_not_met', rationale: 'stub: no better option' } };
};
```

provider 读的是 customer **已披露**给它的愿望清单（`sharedSoft`）；customer 读自己的；finance 不读软字段。`rationale` 是固定英文，只进本方 attempt（D13）。canary 变体里 stub 会把 `CANARY-RAT-<role>` 追加到 rationale，用于证明 rationale 不外流。

### 6.4 放松选项（成员 `relaxations`）

```ts
export const relaxations = (role: RoleKey, v: View<ScopeChangeRuleInput>, ctx: RelaxCtx): RequestOption[] => {
  const feas = (w: View<ScopeChangeRuleInput>) => enumerateCandidates(scopeChange, w,
    { mode: 'feasibility', exclude: ctx.excludedCandidateKeys }).materialized;   // feasibility 分支没有 limit / 锚点 / mustInclude（06 §10 EnumerateOpts）
  const cheapest = (ms: Materialized[]) => [...ms].sort((a, b) => a.terms.amountCents - b.terms.amountCents
    || codeUnitCmp(a.candidateKey, b.candidateKey))[0];
  if (ctx.kind !== 'infeasible') return [];   // 只有 infeasible 请求用放松选项；choose_candidate 由引擎在 customer 视图下枚举并经 rankForOwner 排序（06 §11.2、§12.1 成员 12）
  if (role === 'customer') {
    const out: RequestOption[] = [];
    const req = [...(v.requiredItemKeys ?? [])];
    for (let size = 1; size < req.length && out.length === 0; size++)          // drop_items：最少删几个必需项，至少保留一个（requiredItemKeys 非空，03 §3.6、12 §12.14）
      for (const drop of combinations(req, size)) {
        const m = cheapest(feas({ ...v, requiredItemKeys: req.filter((k) => !drop.includes(k)) }));
        if (m) out.push(opt('drop_items', { itemKeys: drop }, m));
      }
    if (v.deadline !== undefined) {                                             // extend_deadline：延后幅度最小、且每一档更便宜
      let lastAmount = Infinity;
      for (const m of [...feas({ ...v, deadline: undefined })].sort((a, b) => codeUnitCmp(a.terms.deliveryDate, b.terms.deliveryDate))) {
        if (m.terms.deliveryDate <= v.deadline || m.terms.deliveryDate > addDays(v.localDate, 365)) continue;
        if (m.terms.amountCents < lastAmount) { out.push(opt('extend_deadline', { date: m.terms.deliveryDate }, m)); lastAmount = m.terms.amountCents; }
      }
    }
    return out.slice(0, 3);
  }
  if (role === 'finance' && v.capCents !== undefined && v.committedCents !== undefined) {  // 只有预算拥有者的视图算得出
    const needs = new Map<number, Materialized>();
    for (const m of feas({ ...v, capCents: undefined, committedCents: undefined, headroomCents: undefined })) {
      const need = v.committedCents + m.terms.amountCents;
      if (need > v.capCents && (!needs.has(need) || m.terms.amountCents < needs.get(need)!.terms.amountCents)) needs.set(need, m);
    }
    return [...needs.entries()].sort(([a], [b]) => a - b).slice(0, 3)
      .map(([need, m]) => opt('raise_cap', { amountCents: need }, m, need - v.capCents!));
  }
  return [];
};
// opt(kind, payload, m, deltaCents?) → { optionKey 由引擎编号 'A'..'E'（03 §3.9、05 §5.11.1）, templateKey: `request.${kind}`, effect, shown: { itemKeys, modifiers, amountCents, deliveryDate, deltaCents } }
```

示例（全部只用 `toRole` 自己的视图）：`$4,700` 变体 finance 收到 `raise_cap` 480000（+$100，使 $800 可行）与 490000（+$200，使 $900 可行）；撤下 `audit_log_export` 后 customer 收到 `drop_items [audit_log_export]`（例如 `sso_login` $500，11-13）；11-19 跨过交付日后 customer 收到 `extend_deadline` 2026-11-29（加急 $950）与 2026-12-03（$800）。customer 默认看不到已承诺额，所以它的选项里永远没有由预算推出的数字（inputs/07 第 53 条）。

## 7. 场景检查（成员 `checks`，插在 06 的 E6 与 B1 之间）

```ts
export const checks: readonly CheckDecl<ScopeChangeRuleInput>[] = [
  { checkId: 'required_offered', ownerRole: 'customer', inputs: ['requiredItemKeys'], dependsOn: [],
    run: ({ input }) => {
      if (input.requiredItemKeys === undefined) return { unknown: true };
      const liveItems = new Set(live(input, 'item'));
      const miss = input.requiredItemKeys.filter((k) => !liveItems.has(k));
      return miss.length ? { ok: false, code: 'item.required_missing', params: { itemKeys: miss, reason: 'not_offered' } } : { ok: true };
    } },
  { checkId: 'required_included', ownerRole: 'customer', inputs: ['requiredItemKeys'], dependsOn: ['terms_shape'],
    run: ({ input, x }) => {
      if (input.requiredItemKeys === undefined) return { unknown: true };
      const miss = input.requiredItemKeys.filter((k) => !x.terms.itemKeys.includes(k));
      return miss.length ? { ok: false, code: 'item.required_missing', params: { itemKeys: miss, reason: 'not_included' } } : { ok: true };
    } },
  { checkId: 'by_deadline', ownerRole: 'customer', inputs: ['deadline'], dependsOn: ['terms_shape'],
    run: ({ input, x }) => input.deadline === undefined ? { unknown: true }
      : x.terms.deliveryDate <= input.deadline ? { ok: true }
      : { ok: false, code: 'date.after_deadline', params: { deadline: input.deadline, daysLate: daysBetween(input.deadline, x.terms.deliveryDate) } } },
];
```

三条都归 customer 所有：provider 只得 `fit`；finance 在 customer 把对应字段披露给它时精确可见，否则这些失败折叠进 `private.constraint_unmet`（06 §8）。声明字段与 06 §7.1 的 `CheckDecl` 一致（`ownerRole`、合取的 `inputs`，07 §7.11 的 `projectChecks` 直接消费），整个插件对象以 `satisfies ScenarioPlugin<ScopeChangeRuleInput>` 编译。
