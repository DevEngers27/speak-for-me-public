# W1-5 invariant check: re-check of fad964b

Scope: `git diff fad964b~1 fad964b` (12 files) and the new `tests/engine/protocol.cn002.test.ts`, judged against CN-002 (`_changes/CN-002-protocol-chapter-lag.md`), the canon and 04.

Method:
- Read-only review.
- Recompiled the protocol modules with tsc into scratchpad `w15build2/` and re-ran the earlier probes as `w15probe/probe3.cjs`.
- `tsc --noEmit -p tests/tsconfig.json` passes.
- The test suite was not run (it writes caches into the worktree); the implementer reports it green.
- No repo file was touched.

Paths: `hr` = core/engine/protocol/humanRequests.ts, `rr` = core/engine/protocol/resolveRound.ts, `cn` = tests/engine/protocol.cn002.test.ts.

## Status of i01-i11

| id | status | evidence |
|---|---|---|
| i01 | resolved | An accepted infeasible escalation now opens an `infeasible` request (hr:33). answerEffect returns the table entry before any role check (hr:144-149), and the role check applies only to keep_as_is. Probe: the request built for finance answers raise_cap → superseded and end_run → ended_no_agreement. Across 9 request shapes, 0 options are unanswerable (cn "CN-002 answers every option…"). |
| i02 | resolved | `pass_to_next {toRole}` is in Effect (rules/types.ts:22), RequestEffect and the projection (disc +`pass_to_next`), and in `ANSWER_EFFECTS` as `reroute_infeasible`. It is offered by position only (hr: nextRole/mayPass), never on the last role, once per pair (`passedPairs`), fallback included. A reroute builds from the target's own view (`order=[reroutedToRole]`). cn "SM-31 …". Probe: fallback = disclose, pass_to_next(finance), end_run; rerouted finance request = disclose(capCents), end_run; a bogus reroute throws. Follow-up: `convex/schema.ts` `requestEffectV` still lacks pass_to_next (and `disclose.toRoles`); that is the 03 part of CN-002, pending. |
| i03 | resolved | `RoundFeedback.counter` is `{candidateKey}` only (rr:27,66); the customer's `O4` is dropped (probe). Tests updated (rev:27, pc:19, cn "fourth customer counter…"). |
| i04 | resolved | `disclose` is mapped by kind: clarify → same_turn, otherwise → rerun_precheck (hr:144). `ANSWER_EFFECTS.disclose` = `by_request_kind`. cn "disclosure resumes clarify but reruns infeasible precheck". |
| i05 | resolved | The customer's `agent_escalated` request now offers keep_as_is (probe: choose, choose, keep_as_is, end_run). Answer: next_round, or ended when the run cannot continue (cn "needs_tradeoff offers next-round keep_as_is…"). |
| i06 | partial | The decision now carries `cause` (rr:41-44), the draft carries `questionKey` (hr:125), and keep_as_is is derived from the cause (hr:105-107); cn "round exhaustion questionKey…". **But** reaching the provider propose cap is mapped to `call_limit` (rr:43); the design says `no_candidates` (new i12). Offer and answer eligibility also diverge (new i13). |
| i07 | resolved | `proposalVersion` is required and compared strictly (rr:5,64). Probe: an undefined version gives next_round. cn "recommend_accept requires the exact envelope version…". |
| i08 | resolved | Every request ends with end_run, clarify included (hr:114); pt "clarify discloses…" now expects `[disclose, keep_as_is, end_run]`. |
| i09 | partial | The wrapper now spreads the full RequestContext. It requires openRequestCount, canContinue and exhaustedCause and uses A..E keys; needs_tradeoff is routed to the owner (probe: finance → customer). cn "compatibility wrapper forwards…". Remaining (low): two exported functions are still named `buildHumanRequests` with different signatures (canon §1.6). A caller that omits `openRequestCount` fails with a misleading `human_request_already_open`; this fails closed. |
| i10 | resolved | `maxRounds` replaces `effectiveMaxRounds`; roles come from `plugin.protocol` and `relaxationOrder[0]` (rr:20,37-39; hr:142-143). The 'finance'/'customer' literals left in `projectRequestOptions` are W1-4 code, out of scope. |
| i11 | resolved | Battery 09 INV-74 is a real test (`checkPureRoundInvariant`; INV-68 stays todo, it needs convex-test). Tests added for: finance counter ignored, 4th customer counter, $4,799.99, CE-007 undisclosed, candidate_not_in_view, extended maxRounds, TTL = 7, single-candidate full round. Minor: cn:95-96 asserts inside an `if`, which could silently skip. |

## Defects introduced or exposed by the fix

### i12 · medium · Provider propose cap is labelled `call_limit` instead of `no_candidates`
- **Evidence:** rr:43 sets `cause = … proposalCounts[proposer] >= cap ? 'call_limit' : 'rounds'`. Probe: `{provider: 4}` gives `cause: 'call_limit'`, even at the last round.
- **Design:** 04 R6 and the §4.3.4 last row: "provider has proposed 4 times → rounds_exhausted (`no_candidates`, no turn created)". 05 §5.8.5 uses `call_limit` / `spend_limit` only for the run's attempt and dollar caps (10, `run.call_limit`).
- **Impact:** Wrong question text (it tells the customer the run hit its call budget), and a mislabelled contract value that 10 and 12 will copy. keep_as_is is withheld either way, so run behaviour does not change.
- **Fix:** Map the propose cap to `no_candidates`. Keep `call_limit` / `spend_limit` only for `limitCause`. Add a test for `{provider: 4}`.

### i13 · medium · keep_as_is offer and answer use different eligibility rules
- **Evidence:** The builder offers keep_as_is when `cause === 'rounds' ∧ !keepAsIsUsed ∧ providerHasCandidates ∧ proposals < cap ∧ retryAllowed !== false` and ignores `ctx.canContinue` (hr:105-107). `answerEffect` extends only if `!keepAsIsUsed ∧ canContinue` (hr:148); otherwise it returns ended_no_agreement.
- **Probe:** With `{exhaustedCause:'rounds', canContinue:false}`, the request offers keep_as_is ("extend one round"), but answering it ends the run. cn:78 locks in "offered with canContinue false".
- **Design:** D15 and 05 §5.8.5 say a rounds_exhausted keep_as_is means `maxRounds += 1`; if it is offered, answering it must extend.
- **Fix:** Use one predicate for both. Either drop `canContinue` from the rounds_exhausted path and pass the same cause and eligibility facts to `answerEffect`, or have the builder honour `canContinue` too. Then add an offer→answer consistency test.

### i14 · low · The provider-candidate check reuses the choose-candidate exclusion set
- **Evidence:** hr:105 runs `candidates(view(proposer))` with `ctx.excludedCandidateKeys`. That set is the rounds_exhausted choose exclusion (blocked ∪ rejected, 05 §5.8.5), which must not exclude the current proposal.
- **Design:** The provider's snapshot excludes `excludedCandidateKeys(run)` = proposed ∪ rejected ∪ failed-recheck (05 §5.7.2 / P11).
- **Probe:** With the run exclusions the provider view is empty, yet keep_as_is is still offered when only blocked and rejected keys are passed. The result is one pointless extension that re-exhausts at once as `no_candidates` (05 §5.8.5: "otherwise one more round would immediately exhaust").
- **Fix:** Add a separate `providerExcludedCandidateKeys` (or a `providerHasCandidates` input) to RequestContext.

### Docs notes (no code change)
- CN-002 ruling 5 says "no chapter change needed", but the INV-74 text (and the battery title, which must stay verbatim) still says "feedback contains the counter's optionKey" and "needs_input(agent_escalated)". CN-002 should list INV-74 for both wordings.
- `resolveRound` returns the caller-supplied `escalation.toRole`, while buildHumanRequests routes needs_tradeoff to the owner. The caller (the future `acceptEscalation`) must pass the code-chosen role, as cn:143 notes.

## Verdict
**merge**: no high or blocker remains or was introduced. Follow-ups: i12 and i13 (medium) before the persistence task copies these contracts; i14 and the i09 residual (low); and the CN-002 schema / 03 application (pass_to_next, `disclose.toRoles`).
