# Review guide v2 · Appendix: open rulings and what was decided (2026-10-24)

> Companion to `review-guide-v2.md` and `-part2.md` (Q1–Q27, baseline 1ed6c68). Sources: `_changes/CN-001…006`, `review-ext/.../consolidated.json`, `_fix/ext-apply-*-log.md`, issues #62 #68–#71 #75–#79 #83 #86. Quotes are verbatim and short. Paths are relative to `docs/design-work/final-v2/`. "Unverified" means I did not check the code.

## 1. Status

The v2 design lives in the repo at `docs/design-work/final-v2` and has moved on since the guide's baseline. #80 (99ad831) synced the external-review apply: 120 consolidated items, of which 88 were confirmed. Of those, 78 were applied to chapters, 7 went to CN-005 (canon is read-only for the apply step), CONS-15 was rejected, and CONS-113 and CONS-39 were never picked up by any group. #80 also brought in the verifier fix-ups and the UI owner ruling. 2d23268 re-synced the battery titles. #82 (63c9486) applied CN-006. main is now 1a5b88b.

The CN-001…004 status lines still say "pending application", but the CNs were applied (see `_fix/cn-apply-*-log.md`). CN-005 says "pending canon ruling". Of the guide's questions, Q7 and Q8 are now decided. Q1–Q6 and Q9–Q27 are still open in the guide, and the Q1–Q6 rows are repeated in §3 with the current code state.

## 2. Decided

| Ruling | Where recorded | Effect |
| --- | --- | --- |
| CN-002 #1–#11 proposed rulings accepted (owner, 2026-10-24) | `_changes/CN-002`; applied per `_fix/cn-apply-*-log.md` | `pass_to_next`, `infeasible` request on accepted escalation, `keep_as_is` for the customer, `end_run` on clarify, rounds_exhausted questionKey. Answers guide Q8-6 |
| CN-003 #1–#5 accepted (owner, 2026-10-24) | `_changes/CN-003` | Enumeration lives in the engine; counter allowed at n ≥ 1; `preferredItemKeys`; feasibility mode has no limit; `viewFor` is the only view constructor. Answers Q7 and Q8-5 |
| CN-004 proposed rulings accepted (owner, 2026-10-24): #1, #2, #3 (16 + 2 members), #4, #5, the add-fields part of #6, the sharedFacts / DX-13 / preferredItemKeys parts of #7, the NFKC / provenance / lint-whitelist parts of #8 | `_changes/CN-004` | `projectChecks` only; Effect uses `type`; `blocked` and `shown` both kept; CN-001 retry rules win (SDK 0 retries, one gateway retry), so INV-42 now reads `maxRetries: 0`; `config_invalid`; visibility source is `sharedFacts`. Answers Q8-1…Q8-4. The "needs ruling" parts are still open (§3, Q1–Q6) |
| UI screens items 1/2/3/5 are implemented per the design and not sent back to the designer (owner, 2026-10-24) | `docs/design-work/ui-screens/README.md` (#80) | W2-6 builds the DX-3 waiting copy, removes "Let my agent choose", adds `end_run` on every question card, and adds the D15 blocked option |
| CN-006 `briefs.updateSoft` approved, "补" (owner, 2026-10-24) | `_changes/CN-006` (#82); code in #84 | New brief version that changes only `softFields.notes`, with no cv bump. Reuses `run.invalid_state{guard:"brief_missing"}`. New `soft_writes` bucket (30/user/room/h). Not edited: 09 §9.2, 15 rate table, canon §1.6 |

## 3. Open rulings

Columns: **A / B** gives the two conflicting texts. **Proposed** is the resolution stated in the source. **Code** is what main does now.

### 3.1 Canon and invariants (CN-005 and related)

| Id | A | B | Proposed | Code | Tracked |
| --- | --- | --- | --- | --- | --- |
| CONS-04 | D04: "`itemKey ∉` 旧执行的 `terms.itemKeys`" (one hop) | CN-005: "链可以延长：CO-1 → CO-2 → CO-3" (INV-52 promise) | **A** = union over the whole ancestor chain (cycle check, bound, fail closed). **B** = forbid follow-ups of follow-ups | One hop (`convex/model/followUp.ts:11-18`) | #71 |
| CONS-08 (+CONS-61) | D04: "**只有两个写入豁免**" | 04 G1: "attempt → `stale`，用量照记" | **A** = a third, internal-only exemption, `settleAttemptTx` (attempt usage, run $, `spendCounters` only). **B** = reject it; 10 §10.8 / §10.7.2 revert | No `settleAttemptTx` in `convex/`; `openRoomTx` rejects statuses not in `allow` (`convex/lib/db.ts:55`) | #77 i05 |
| CONS-82 | D12 ⑥: "`run_starts`…含系统自动开局" (bounds prechecks) | CN-005: R2/R3 publish and "根本到不了 B6a" | **A** = no parked-precheck state; reword D12 ⑥: `run_starts` limits model turns only; `price_writes` and the hard sub-bucket bound prechecks; answers count; `clock` counts in no bucket | Unverified | CN-005 |
| CONS-118 | D12 ⑥: "合计每天至多数十 bit" | CN-005: "DX-12 没有日总量桶" | **A** = new daily DX-12 bucket (e.g. ≤ 6). **B** = reword only: DX-12 is rate-limited, with no daily bound | No DX-12 bucket in the design; code unverified | CN-005 |
| CONS-42 | D10: "provider 快照剔除 `excludedCandidateKeys(run)`" (includes failed choices) | 07 DX-12 audience: "customer（`toRole`）" | **A** = split by recipient: the provider excludes its own and publicly rejected keys; failed choices go only to `chooseExcludedKeys` | Failed choices are in the provider set (`convex/model/runs.ts:135-137`) | #77 n02 |
| CONS-114 | D12 ⑧: "哪个最后都可以" | D12 ⑧ / 12 §12.9: "本房间曾确认过的目录键" | **A** = "any independent remaining condition may be last"; rewrite CE-154 (baseline last); new case: customer brief before catalog → `item.unknown` | CE-154 only covers "stays setup" (#79 i12) | CN-005 |
| CONS-26 | D19/D27: UI still shows v1 "No longer current" | INV-11: "历史提案只显示存储状态" | **A** = `lastInvalidatedProposal` plus checks frozen at the bump. **B** = keep as is. The CN group leans to the slot-only part of A | B (no such field in code) | CN-005 |
| CONS-48 | D14 cursor: "`(roomId, commitTs, seq)`" (raw rows) | 12 §12.17: "页大小因此稳定" (false per review) | **A** = paginate commit headers; D14: "the cursor is at commit granularity". **B** = per-audience groups, which revises D14's rejection | Raw rows (`convex/timeline.ts:7`); TC-PRIV-25 depends on this | CN-005 |
| CONS-113 | D22 / INV-36: "`localDate(插入日) + max(leadDays)`" | 14 §6.2: "`- mods.reduce((s, r) => s + r.leadDays, 0)`" | **A** = new CN: `effectiveLeadDays` from `materialize`; update D10/D22, INV-36, 04 P1, 05, 18. Not in CN-005 | Follows 14 (`core/scenarios/scope-change/algorithms.ts:29-35`) | None (gap) |
| W-1 wording | CONS-07 §1.5: "目录超过 12 个 item 或 2 个 modifier"; CONS-18 D10: "`lines[{itemKey, revision, priceCents, title}]`"; CONS-79 D18: "`ctx.meta.getDeploymentMetadata().name`" | 03 §3.13.1 (template sum ≤ 50); D25 (`kind`, `leadDays`); 11 §11.10 (`await`) | **A** = sync the canon wording only (add the "> 50 templates" sense; "see D25"; `await`) | Code follows the chapters | CN-005 |
| IC-4 | D18: "`seed.reset` 为 dev / preview-only" | 12 §12.20: "`assertTier(["dev","preview","test"]`" | None stated | Follows 12 (W2-7, PR #67 open) | #75 |
| IC-5 | CE-117: "第二次 `run.invalid_state{ guard: 'baseline_exists' }`" | 12 §12.10: "金额相同 → `unchanged`（双击安全）" | None stated | Follows 12 | #79 i12 |

### 3.2 Policy items from the external review (owner, no CN; A = current canon)

| Id | Conflict (§) | B (alternative) | Tracked |
| --- | --- | --- | --- |
| CONS-40 | D12: "政策性接受"每个提案 ≤ 1 bit"的固有披露" vs explicit owner disclosure (00-brief §3.1) | Versioned per-signal owner consent. Overlaps Q21 / U-06 | consolidated |
| CONS-44 | D22: "**调用方一律传 `rooms.localDate`**", so approval can happen at a stale date | Roll the date (`rollLocalDateTx`) before approval/execution | consolidated |
| CONS-49 | 03 §3.11.3: "`budget.setCap` 与 customer 硬字段变更共用的子桶" vs ADR-D17 | Per-role quotas; new D12 ruling | consolidated |
| CONS-63 | Execution write set excludes `sharedFacts`, so committed/headroom can go stale (03 §3.13.1, paraphrase) | Refresh at commit via `appendLedgerEntry` | consolidated |
| CONS-70 | D15 resumes by recipient, so a provider-origin `needs_tradeoff` spends a round (05 §5.11.4, paraphrase) | Resume by source turn kind | consolidated |
| CONS-86 | 12 §12.12 ⑤ blocks titles containing "`candidates`…`system`" with `disclosure.blocked` (code: `convex/model/guards.test.ts:7`) | Block only encoded delimiter forms | consolidated |
| CONS-88 | 14 §6.2: "若回合跨过午夜，交付日比快照里显示的晚一天" | Rebuild turns whose snapshot date differs | consolidated |
| CONS-93 | 06 §10.1 complete enumeration at 12 items; no max-size benchmark yet | Lower the catalog bounds after measuring | consolidated |
| CONS-100 | D06 keeps the `react` depth guard, which v1 cannot reach (code keeps it, #70 i10) | One explicit change → bump → startRun sequence | consolidated |
| CONS-117 | 07 DX-7 author metadata can reveal the previous waiting role | Hide or group metadata for nonrecipients | consolidated |

### 3.3 Chapter-level (Claude invariant checks)

| Id | A | B | Proposed | Code | Tracked |
| --- | --- | --- | --- | --- | --- |
| IC-1 | 09 §9.6.7: "id 存 rooms.clockFnId" (also eval-ref fields, 09 §9.3) | 03 §3.5 `rooms`: no `clockFnId` field | Checker: 03 adds `rooms.clockFnId`, then a point read | Dedupes over the 64 newest jobs (`convex/model/clock.ts:35-46`) | #70 n03 |
| IC-2 | 09 §9.6.7: `CLOCK_STATUSES = ["setup", "open"]` | 12 §12.20: "遍历 `rooms.by_status = open`" (15 the same) | None stated | setup + open (`convex/clock.ts:20`) | #70, #75 |
| IC-3 | 12 §12.20: "默认写入限额 16,000 的 8 倍余量" | 16 TC-OPS-06: "留 10 倍余量" | None stated | The test measures a small probe (#75 i07) | #75 |
| IC-6 | 12 §12.15 ⑧: "`reasonKey` 必须属于场景枚举" → `input.invalid` | Code: a key outside `usableBy` → `auth.role_forbidden` | Checker: "ruling needed" | `convex/approvals.ts:79` | #71 i09 |

### 3.4 CN-004 "needs ruling" (guide Q1–Q6; answer with the guide's A/B)

| Q | A | B | Guide proposal | Code | Tracked |
| --- | --- | --- | --- | --- | --- |
| Q1 | 14 §7: `run: ({ input, x })` | Code: `{ input; proposal; terms; lines }`; 06 §7.1 is still undefined | B | B (`core/engine/rules/types.ts:14`) | — |
| Q2 | 03 §3.11.1: `turn_failed` payload carries `failureKind` | D14 / INV-12: room-visible payload only | B | A: payload carries it (`convex/model/runs.ts:571`) | — |
| Q3 | 14 §5: "`retired`（终态）" | 14 §5 / canon §1.2: "重新上架…新行 `revision + 1`" | B | Fails closed with `item.retired` | #79 |
| Q4 | D12 ①: provider sees "`superseded / rejected / executed / current`" | 07 §7.9.3 / INV-11: "`superseded / rejected / stale / executed`" | A | The provider agent sees raw `stale` | #78 i11 |
| Q5 | 07 §7.9 matrix "代理" column | 07 §7.14.1 `AgentContextData` | A | The column is not read | — |
| Q6 | 07 §7.16: "You lowered the budget cap: $5,000 → $4,800" | 14 §8.3: "You changed the budget cap from $5,000 to $4,800" | B | Tail sentence pending | #70 |

Still open in the guide and not repeated here: Q9–Q13 (A/B) and Q14–Q27 (defaults).

## 4. Rejected or needs no ruling

- **CONS-15**: rejected after reading. A same-version grant only reveals values the viewer was already entitled to (07 §7.8.3; `_fix/ext-apply-rules-privacy-log.md` "驳回理由").
- **Reviewer misreads (16)**: CONS-11, 53, 54, 56, 58, 65, 69, 75, 81, 89, 94, 97, 98, 103, 106, 109. **Already resolved (5)**: CONS-50, 51, 55, 64, 101. **Out of scope**: CONS-105. CONS-61 follows CONS-08.
- **12 §12.6 vs 03 §3.3.3 follow-up provenance** (#71): fixed in #80. 12 now says `inheritProvenance(旧房间, followedExecution)`, and the code agrees (`followUp.ts:40`).
- **INV-42 wording** (#68, W2-GW check): now reads `maxRetries: 0`, and the registry was re-synced (2d23268).
- **CN-004 #7 `briefVersion` scope** (#79): 07 DX-7 and 12 §12.17 both say provider-only after open. The guide says no answer is needed, and the code matches.
- **#83** (B1 module load): fixed on PR #85 (ef4c854, real deploy smoke PASS). The PR is not merged yet.
- **#62** (codegen drift): a tooling choice (commit the real codegen, or pin the offline flags, plus a CI drift check) owned by W2-7. It is not a design ruling.
- **CONS-39** (stale U-10 / 18 index): a docs-only item that no group processed.

## 5. How to answer

1. Reply with one line per id: `CONS-04 A`, `IC-2 B`, `Q4 A`.
2. In §3.1 and §3.3, **A** = the Proposed column and **B** = the named alternative. If no B is named, B means the column-B text wins.
3. Where Proposed says "none stated", choose which text wins: `IC-3 A` means 12 wins.
4. §3.2: **A** keeps the current canon; **B** adopts the alternative. Adopting B needs a new CN.
5. Q1–Q6 use the guide's own A/B (§3a). Q9–Q27 are unchanged.
6. "Agree rest" accepts every Proposed value. Unanswered items stay open.
7. Once ruled, items in CN-005 go to one canon edit, with battery titles changed in the same edit.
8. IC rulings go to the owning chapter, then to the issue listed.
9. CONS-113 needs a new CN (CN-007) whatever you answer.
10. Unverified cells are marked; please challenge them.

## Late addition (2026-10-25) — IC-7: D22 time-zone offset fallback after V-D2 passed
- **Conflict:** canon D22 says "Intl.DateTimeFormat 时区支持待验证，V-D2 通过则删偏移退路". The real-deploy runtime probe (dev deployment, PR #92) reports `intlTimeZone: ok` — V-D2 has passed — yet the hotfix kept a DST-aware offset fallback (`convex/lib/time.ts`, UTC + America/Los_Angeles only, fails closed for other zones → `rooms.create` returns `input.invalid` for them) and reports `ops.configHealth.timeZoneMode: 'intl' | 'offset'`.
- **Proposed resolution (A):** follow D22 literally — delete `offsetDate` / `timeZoneMode`, record V-D2 PASS in the verification appendix (16 §16.8.1). **(B):** amend D22 to keep the fallback as a deliberate defence (then widen its zone table or document the fail-closed set). Code today: B (fallback present, Intl path active).
- **Tracking:** issue "W2-12 follow-ups" (i04); PR #92.
