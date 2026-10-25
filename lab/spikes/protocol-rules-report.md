# Spike 报告：协议 schema 与规则引擎可执行实现（protocol-rules）

> 目录：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/protocol-rules/`
> 全程离线：没有任何 Claude API 调用，没有读取或搜索任何密钥。所有 fixture 数据标注 `origin: "fixture"`、`isSimulated: true`。

## 1. 目的

用可运行代码验证 05-protocol 与 06-rules-engine 的核心假设：

1. 服务端信封 `AgentEnvelope` 与模型输出 `AgentModelOutput`（判别联合）能否分离得干净，模型输出里完全没有金额与服务端字段；
2. `ProposalTerms` 的金额与日期能否全部由服务端从报价目录求和/推导；
3. 规则引擎能否写成零依赖纯函数（`checkBudget` / `checkProposal` / `isExecutable`），在边界条件上给出稳定的 reasonCode；
4. 确定性 stub agent 能否与真实代理共用同一个输出 schema，并复现原 README 的预算下调走查；
5. 顺带用我们真实的 schema 复核 SDK 1.1.0 结构化输出 helper 的行为（只生成 JSON Schema，不发请求）。

## 2. 做了什么

### 2.1 命令

```bash
cd .../spikes/protocol-rules
npm install --save-exact zod@4.6.7 @anthropic-ai/sdk@1.1.0 ajv@8.17.1
npm install --save-dev --save-exact typescript@6.0.3 vitest@3.2.4 tsx@4.20.3 @types/node@24.3.0
npx tsc --noEmit                     # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npx vitest run --reporter=verbose    # 输出存于 out/test-output.txt
npx tsx scripts/dump-schemas.ts      # 生成 out/sdk-zodOutputFormat.root.json 与 out/strict.root.json
npx tsx scripts/probe-format-helpers.ts
npx esbuild src/rules.ts --bundle --format=esm --platform=neutral --outfile=out/rules.bundle.js
```

Node v24.21.0，npm 11.19.0。安装一次成功（esbuild postinstall 未获 allowScripts 批准，但不影响 vitest/tsx 运行）。

### 2.2 文件与关键设计

| 文件 | 内容 |
| --- | --- |
| `src/reasonCodes.ts` | 20 个 reasonCode 的单一来源（`as const`），`Issue {reasonCode, params}`；`PRIVATE_PARAM_CODES` 标出参数含私密数值的码 |
| `src/primitives.ts` | 零依赖：`isCents`（安全非负整数）、`sumCents`（溢出返回 null）、`isIsoDate`（严格 `YYYY-MM-DD` + 真实日历日，Date.UTC 回环校验）、`stableStringify`、`contentHash`（Web Crypto SHA-256） |
| `src/protocol.ts` | Zod 4 schema：`AgentModelOutput`（6 个动作的 `z.discriminatedUnion("action")`，全部 `z.strictObject`）、`AgentModelOutputRoot = {turn: AgentModelOutput}`、`AgentEnvelope`、`OutputSource`（stub/fixture 强制 `isSimulated: true`，model 强制 `false`）、`Catalog`、`ScopeChangeConstraints`、`ProposalTerms` |
| `src/rules.ts` | 纯函数 `checkBudget`、`checkProposal`、`isExecutable`；只 `import type` 协议类型，运行时不依赖 zod |
| `src/stubAgent.ts` | `findBestCombination`（枚举 required ∪ preferred 子集，用同一个 `checkProposal` 判定）、`stubAgentTurn`（输出经 `AgentModelOutput.parse`）、`wrapStubTurn`（服务端构造信封） |
| `src/jsonSchema.ts` | `toStrictOutputSchema`：`z.toJSONSchema` 后保留 `enum/const`、`oneOf→anyOf`、剔除子集外关键字并记录被剔除路径；`apiSubsetViolations` 静态检查；`countConstraintKeywords` |
| `src/fixtures.ts` | 场景 fixture：5 个报价项，合计 $1,400；必需项 sso_login + audit_log_export = $800；+usage_dashboard = $900；硬截止 2026-11-20；约束 v1（$5,000/$4,000）、v2（下调到 $4,800）、v3（$4,700，无可行解） |
| `test/*.test.ts` | 5 个文件 92 个用例，全部表驱动（`test.each`） |

**动作集**（`AgentModelOutput.action`）：`propose`、`counter`（必须带 `baseProposalVersion`）、`clarify`（`toRole` + `topic` + `question`）、`recommend_accept`（绑定 `proposalVersion`）、`reject`（结构化 `reason` 枚举）、`escalate`（`kind: infeasible | needs_tradeoff`、`toRole`、`options` 只含范围选择，服务端负责定价）。

**模型能填的只有**：`includedItemKeys`（slug 正则）、`deliveryDate`（`z.iso.date().nullable()`，null 表示"取目录推导出的最早日期"）、它看到过的提案版本号、枚举值和公共说明文本。所有字段都是 required，可空用 `nullable` 而不是 `optional`（规避 "API 是否接受可选属性" 这个待验证项）。

**`checkProposal` 的派生规则**：`lineItems` 按 itemKey 排序；`additionalCostCents = Σ priceCents`；`earliestDeliveryDate = max(item.earliestDeliveryDate)`；`deliveryDate = draft.deliveryDate ?? earliest`；`deferredItemKeys = 目录(非 withdrawn) − included`。检查一次收集全部问题；出现结构性问题（空范围、重复、未知项、非法分、日期格式错、目录版本不符）时 `terms = null`、不跑预算与日期比较；否则即使有 `budget.over` 等规则问题也返回 `terms`，供界面展示"被阻断的具体条款"。

**`isExecutable` 的判定**：① 调用方用 `contentHash(terms)` 重算的哈希必须等于存储哈希；② `proposal.constraintsVersion === current.constraintsVersion`；③ 用**当前**目录和约束重跑 `checkProposal`，并把 `terms.additionalCostCents` 作为 `claimedAdditionalCostCents`、`terms.catalogVersion` 作为 `expectedCatalogVersion`（目录被改价或升版都会被抓到）；④ 每个快照的必需审批人取其对该 proposalId 的**最新**一条审批，必须是 `approve` 且绑定同一 `contentHash` 与当前 `constraintsVersion`。

**stub 排序规则**：可行组合中，① preferred 项数量多者优先；② 增量成本高者优先（用足预算）；③ 排序后键列表字典序小者优先。preferred 超过 12 个直接抛错（2^12 次规则评估的上限）。无可行组合时输出 `escalate/infeasible`，按"仅必需项"方案的 reasonCode 决定对象：预算类 → finance，截止/必需范围类 → customer。

## 3. 实测结果

### 3.1 类型检查与测试

```text
tsc exit=0
 Test Files  5 passed (5)
      Tests  92 passed (92)
   Duration  296ms
```

关键用例（节选自 `out/test-output.txt`，省略耗时）：

```text
✓ checkBudget > phase one fits (USD 4,000 + USD 900 <= USD 5,000)
✓ checkBudget > exactly equal to cap is within
✓ checkBudget > one cent over the cap
✓ checkBudget > old USD 4,900 after cut to USD 4,800
✓ checkBudget > total below committed, zero additional
✓ checkBudget > fractional cents rejected / negative / NaN / unsafe integer / sum overflow rejected
✓ checkProposal > full scope: budget + deadline both reported
✓ checkProposal > empty scope
✓ checkProposal > unknown itemKey
✓ checkProposal > withdrawn item behaves as unknown
✓ checkProposal > duplicate item
✓ checkProposal > date bad separator / not zero padded / Feb 30 / month 13 / with time / empty string
✓ checkProposal > deadline exactly equal passes
✓ checkProposal > exactly earliest passes
✓ checkProposal > before earliest
✓ checkProposal > unconfirmed catalog item
✓ checkProposal > claimed amount mismatch (model/human said USD 850)
✓ checkProposal > required only after cut equals cap exactly
✓ checkProposal > leap day handled by calendar check
✓ isExecutable > budget cut to USD 4,800: stale version + rule fail + all approvals stale
✓ isExecutable > catalog re-priced under same version -> claim mismatch
✓ isExecutable > re-approval under v2 does NOT make the old USD 900 proposal executable (rules still fail)
✓ AgentModelOutput > rejects: model tries to state a price
✓ AgentModelOutput > rejects: deliveryDate omitted (must be explicit null)
✓ AgentEnvelope > rejects: stub output must be marked simulated
✓ stub agent > after cut to $4,800 the stub counters the old proposal with required only (== cap)
✓ stub agent > no feasible option -> escalate infeasible to finance, never invents agreement
✓ stub agent > determinism: 200 runs produce byte-identical output
✓ structured output JSON schema (offline) > jsonSchemaOutputFormat re-strips enum/const unless transform:false
✓ structured output JSON schema (offline) > strict schema rejects a wrong action literal at decode level; SDK schema does not
```

预算下调走查的实际 reasonCode（`isExecutable` 对旧 $900 提案，约束 v1→v2）：
`["version.stale_constraints", "budget.over", "approval.stale", "approval.stale", "approval.stale"]`；
在 v2 下三方重新审批同一提案后仍为 `["budget.over"]`。

### 3.2 JSON Schema 生成（`npx tsx scripts/dump-schemas.ts`）

```text
sdk format type: json_schema
sdk enum/const count: { enum: 0, const: 0 }
strict enum/const count: { enum: 5, const: 6 }
strict dropped keywords: 29 [
  '/properties/turn/oneOf/0/properties/includedItemKeys/maxItems',
  '/properties/turn/oneOf/0/properties/includedItemKeys/items/pattern',
  '/properties/turn/oneOf/0/properties/deliveryDate/anyOf/0/pattern',
  '/properties/turn/oneOf/0/properties/publicRationale/minLength', ...
]
strict subset violations: []
sdk subset violations: []
sdk bare-union root keys: [ '$defs', 'anyOf', 'description' ] (no type)
sdk propose.action: {"type":"string","description":"{const: \"propose\"}"}
strict propose.action: {"type":"string","const":"propose"}
strict propose.deliveryDate: {"anyOf":[{"type":"string","format":"date"},{"type":"null"}]}
sdk counter.baseProposalVersion: {"$ref":"#/$defs/__schema4"}
strict size bytes: 2429 sdk size bytes: 3572
```

### 3.3 SDK helper 探测（`npx tsx scripts/probe-format-helpers.ts`）

```text
jsonSchemaOutputFormat(default) enum/const: { enum: 0, const: 0 }
jsonSchemaOutputFormat(transform:false) enum/const: { enum: 5, const: 6 }
bare union rejected by jsonSchemaOutputFormat: JSON schema must be an object, but got undefined
zodOutputFormat.parse(good): {"turn":{"action":"recommend_accept","proposalVersion":1,"publicRationale":"r"}}
zodOutputFormat.parse(forged) throws: AnthropicError Failed to parse structured output: [
  { "code": "unrecognized_keys", "keys": [ "priceCents" ], ...
```

### 3.4 规则引擎零依赖（esbuild 打包）

```text
out/rules.bundle.js  8.7kb      zod refs in rules bundle: 0
out/stub.bundle.js   772690 bytes（含 zod，未压缩）
```

## 4. 对设计的结论

### 4.1 被实测证实

1. **规则引擎可以是零依赖纯函数**：`rules.ts` + `primitives.ts` 打包后 8.7 KB、0 处 zod 引用；同一份代码被 stub、`isExecutable` 和测试共用。建议 06 把 zod 限定在边界（解析模型输出、mutation 入参），规则层只吃已解析的纯数据。
2. **`checkBudget` 的边界**：`committed + additional <= total` 恰等于上限通过（headroom 100000、overBy 0）；超 1 分即 `budget.over`；总额低于已承诺返回独立码 `budget.total_below_committed`，headroom 为负（-20000）；小数分、负数、NaN、2^53、求和溢出全部 `budget.invalid_amount` 并指明字段。
3. **`checkProposal` 一次收集全部问题**：全量 $1,400 方案同时报 `budget.over` 与 `date.after_deadline`（对应 RA-F03）；结构性问题时 `terms = null`。日期严格校验能拒绝 `2026/11/18`、`2026-11-8`、`2026-02-30`、`2026-13-01`、带时间、空串；接受 2028-02-29，拒绝 2027-02-29；恰等于截止日、恰等于最早交付日都通过。
4. **金额只能来自目录**：模型输出 schema 里没有任何金额字段；附带 `priceCents` 或 `constraintsVersion` 会被 `z.strictObject` 拒绝（SDK `zodOutputFormat.parse` 同样以 `unrecognized_keys` 抛 `AnthropicError`）。目录被改价时，旧提案的 `additionalCostCents` 作为"声明值"与重算值比对，得到 `amount.claim_mismatch`。
5. **原 README 数字表可复现**：stub 在 v1 下选出 required + usage_dashboard = $900（项目合计 $4,900）；下调到 $4,800 后旧方案 `isExecutable` 报 `version.stale_constraints + budget.over + 3×approval.stale`；stub 改为只含必需项的 $800 counter，恰等于上限通过；v3（$4,700）无可行组合，stub 输出 `escalate/infeasible → finance`，不会编造一致。
6. **"版本匹配"和"规则通过"缺一不可**：只靠 constraintsVersion 不够。在 v2 下三方重新审批旧 $900 提案后，版本和审批都对上了，但重跑规则仍是 `budget.over`。`isExecutable` 必须用当前状态重跑规则。
7. **审批绑定内容哈希可行**：`stableStringify` + SHA-256 对键顺序不敏感；`terms` 在派生时已排序归一化，输入顺序不同的同一选择得到同一哈希。绑定旧哈希、绑定其他 proposalId、最新一条是 reject 的审批都被正确判为 stale / missing / rejected。
8. **stub 能与真实代理共用输出 schema**：stub 输出经 `AgentModelOutput.parse`，用 ajv（draft 2020-12）对严格 schema 与 SDK schema 都验证通过；200 次运行字节一致；它用同一个 `checkProposal` 判可行，所以 stub 提出的每个方案都能通过服务端校验。信封层强制 `source.kind = "stub"` 时 `isSimulated: true`（核心 #8）。
9. **SDK 1.1.0 的 `zodOutputFormat` 会丢 `enum/const`**（用本 spike 的真实 schema 复核 04 的结论）：0/0 对比自建生成器的 5/6；`counter.baseProposalVersion` 被改写为 `$ref` 指向只有描述文字的整数。
10. **`z.toJSONSchema` 对判别联合输出 `oneOf`**（被剔除路径里出现 `/turn/oneOf/`），自建生成器改写为 `anyOf` 后静态子集检查 0 违规；严格 schema 2429 字节，SDK 版 3572 字节。
11. **解码层约束的差别在 JSON Schema 层面是真实的**：伪造的 `action: "approve"` 被严格 schema 拒绝，却能通过 SDK 生成的 schema，只有事后的 Zod 能拦住。

### 4.2 被证伪

1. **"把自建 JSON Schema 交给 SDK 的 `jsonSchemaOutputFormat` 就能保留 enum/const"——证伪**。它默认 `transform: true`，同样把 `enum/const` 挪进描述（0/0）；必须传 `{ transform: false }`，或直接把 schema 放进 `output_config.format`。10-agent-runtime 应写明这一点。
2. **"判别联合可以直接作为结构化输出的根"——在 SDK helper 路径上证伪**。`zodOutputFormat(AgentModelOutput)` 生成没有 `type` 的根（`$defs/anyOf/description`），`jsonSchemaOutputFormat` 直接抛 `JSON schema must be an object, but got undefined`。协议应规定模型输出根为 `{ turn: AgentModelOutput }`（本 spike 的 `AgentModelOutputRoot`）。API 本身是否接受根级 `anyOf` 仍待验证，但没有必要冒这个险。
3. **"约束版本号相同就说明提案仍有效 / 重新审批即可恢复可执行"——证伪**（见 4.1 第 6 条）。同理，目录同版本下被改价也必须被抓到，靠的是重算金额与提案声明值比对，而不是版本号。

### 4.3 无法离线验证

1. API 是否接受严格 schema：`properties` 下的 `anyOf` 分支里放 `const`、`format: "date"`、6 个分支的规模；首次编译开销；解码是否真正按分支内 `const` 约束。
2. 真实模型在这套 schema 下是否只引用给出的 itemKey、是否倾向于 `escalate` 而不是硬凑方案、`publicRationale` 是否会夹带对方私密数值（需要隐私金丝雀测试）。
3. Convex 默认运行时（V8 isolate）里 `globalThis.crypto.subtle.digest` 是否可用；不可用时需换纯 JS SHA-256 或放进 Node action。
4. zod 4 在 Convex 函数里的包体积与冷启动影响（stub 打包未压缩约 772 KB，主要是 zod）。
5. 提案 `(roomId, version)` 唯一性与并发写入（需 convex-test / 真实部署）。
6. reasonCode `params` 的受众裁剪：`budget.over` 的 `overByCents/headroomCents` 会泄露 finance 的预算，`date.after_deadline` 会泄露客户私密截止日。本 spike 只用 `PRIVATE_PARAM_CODES` 标出，按受众渲染没有实现。
7. "预算内最多 required + should" 是否是真实代理应有的策略：这是产品问题，stub 只提供确定性基线。

### 4.4 对 05 / 06 的具体建议

- 模型输出根固定为 `{ turn: AgentModelOutput }`；字段全部 required，可空用 `nullable`；全部 `strictObject`。
- 模型调用流水线：`toStrictOutputSchema(AgentModelOutputRoot)` → 直接放入 `output_config.format`（或 `jsonSchemaOutputFormat(schema, { transform: false })`）→ `messages.create` → 先记 usage、查 `stop_reason` → `AgentModelOutputRoot.safeParse` → 服务端构造 `AgentEnvelope` → `checkProposal` 派生 `ProposalTerms` → 追加提案。
- `escalate.options` 只允许范围选择，服务端用 `checkProposal` 给每个选项定价与判定后再展示给被问的人。
- `isExecutable` 采用本 spike 的四段判定（哈希完整性、约束版本、当前状态重跑规则、按 (proposalId, contentHash, constraintsVersion) 绑定的最新审批），在审批前和执行事务内各调用一次。
- reasonCode 渲染必须按受众裁剪 `params`；`PRIVATE_PARAM_CODES` 可作为 07 披露矩阵的输入。

## 5. 可直接复用的代码清单

| 路径 | 用途 |
| --- | --- |
| `spikes/protocol-rules/src/protocol.ts` | 协议 Zod schema：`AgentModelOutput`、`AgentModelOutputRoot`、`AgentEnvelope`、`OutputSource`、`Catalog`、`ScopeChangeConstraints`、`ProposalTerms`、`RuleIssue` |
| `spikes/protocol-rules/src/rules.ts` | `checkBudget`、`checkProposal`、`isExecutable`（零依赖纯函数） |
| `spikes/protocol-rules/src/primitives.ts` | `isCents`、`sumCents`、`isIsoDate`、`compareIsoDate`、`maxIsoDate`、`stableStringify`、`contentHash` |
| `spikes/protocol-rules/src/reasonCodes.ts` | reasonCode 单一来源、`Issue` 类型、`PRIVATE_PARAM_CODES` |
| `spikes/protocol-rules/src/stubAgent.ts` | `findBestCombination`、`stubAgentTurn`、`wrapStubTurn` |
| `spikes/protocol-rules/src/jsonSchema.ts` | `toStrictOutputSchema`、`apiSubsetViolations`、`countConstraintKeywords` |
| `spikes/protocol-rules/src/fixtures.ts` | 场景 fixture（v1 / v2 下调 / v3 无可行解），全部标注模拟 |
| `spikes/protocol-rules/test/*.test.ts` | 92 个表驱动用例，可直接迁入 16-testing 的纯函数单测 |
| `spikes/protocol-rules/scripts/dump-schemas.ts`、`scripts/probe-format-helpers.ts` | 离线 schema 生成与 SDK helper 行为探测 |
| `spikes/protocol-rules/out/strict.root.json` | 生成好的严格 JSON Schema 样例 |
