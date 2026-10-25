# W1-5 invariant check, part 2: deviations

Severity scale: blocker = breaks a canon §0 core; high = a contract later tasks will copy; medium = local error; low = naming or docs. No blockers found.

## i01 · high · An escalation-built request cannot be answered (INV-73, D15 exits, INV-64)
- **Evidence:** For `agent_escalated` with `escalation.kind = 'infeasible'`, hr:49-51 routes the request to the relaxation role (finance in the fixture). The test rev:114-121 locks in the result `{kind:'agent_escalated', toRole:'finance'}`. But `answerEffect` (hr:131) throws `invalid_escalation_role` for any `agent_escalated` request whose toRole is neither provider nor customer. The check runs before the effect is dispatched, so even `end_run` throws. Probe: answering with raise_cap or end_run both throw.
- **Effect:** `needs_input` has no usable exit until the 7-day TTL.
- **Second problem:** `resolveRound` passes `requestKind:'infeasible'` through (rr:52), while the builder keeps `agent_escalated`. The two functions disagree on the kind.
- **Design:** D15 says every request carries an exit; INV-73 says every effect has a transition; INV-64. On the kind itself, 05 §5.10/§5.11.2 (accepted infeasible escalation opens an `infeasible` request) conflicts with 06 §11.2 and INV-74.
- **Fix:**
  - Pick one kind for accepted infeasible escalations and use it in both functions. 05 says `infeasible`; or get a design ruling.
  - In `answerEffect`, apply the role check only to `keep_as_is` semantics.
  - Add a test that answers every option of every request the builder produces.

## i02 · high · `pass_to_next` is missing (canon D15 / C54; 04 R21, §4.8.2-3, SM-31)
- **Evidence:**
  - The `Effect` union (rules/types.ts:22) has no `pass_to_next {toRole}`.
  - The infeasible branch (hr:50-76) never adds it.
  - `ANSWER_EFFECTS` (hr:117-126) has no entry for it.
  - The context has no per-run record of used (from, to) pairs.
- **Design:** Infeasible requests, including the fallback, must offer `pass_to_next {toRole: next relaxation role}`. It is offered based on position only, never on the last role, at most once per run per (from, to). The answer marks the request answered and builds a new infeasible request from the target's own view, with no bump.
- **Caveat:** 05 §5.11 and the repo's 03 `requestEffectV` still lack it (chapter lag). The canon wins.
- **Fix:**
  - Add the effect.
  - Emit it when `toRole` is not last in `relaxationOrder` and the pair is unused; keep total options within A..E.
  - Map it to `{bumpsConstraints:false, next:'reroute_infeasible'}`.
  - Add a test mirroring SM-31.

## i03 · high · Counter feedback forwards the customer's own option label (07 DX-11, 05 §5.8.3 row 4, §5.7.2, INV-08)
- **Evidence:** `RoundFeedback.counter.optionKey` (rr:25,58) is the customer's label from the customer's snapshot (rr:6). Tests rev:27 and pc:18 lock in `optionKey:'O2'`.
- **Design:** The candidate is re-labelled in the provider's new snapshot ("still in lexicographic place; `<room_state>` says which O"). Only the forwarded candidate's provider-side label or terms may enter the provider's context.
- **Risk:** The customer's label is a position in a view filtered by private fields. Rendered to the provider, it leaks more than the declassified bit.
- **Fix:** Carry only `candidateKey` in the feedback. The provider's O-label is assigned when the next snapshot is built (and is passed as mustInclude). Update both tests.

## i04 · high · `disclose` is mapped to `same_turn` even for the infeasible fallback (04 R20, §4.8.2, 05 §5.11.4, D15)
- **Evidence:** hr:122 maps `disclose` to `same_turn`, and hr:132 never looks at the request kind. Probe: `answerEffect(disclose, {kind:'infeasible'})` returns `same_turn`.
- **Design:** For an infeasible fallback request, the answer re-runs the S0 precheck in the same transaction. If still infeasible, open a new infeasible request; if feasible, start the provider turn. There is no asker turn to reopen.
- **Fix:** Make the `next` value for `disclose` depend on the kind: `clarify` gives `same_turn`; `infeasible` gives `rerun_precheck`. Add a test.

## i05 · medium · Customer `agent_escalated` never offers `keep_as_is` (D15, 05 §5.11.2, 04 R14/§4.8.2)
- **Evidence:** hr:99 offers keep_as_is only to the provider for `agent_escalated`, and to `rounds_exhausted`. Probe: customer options are `[choose_candidate, choose_candidate, end_run]`. Yet `answerEffect` maps the customer's keep_as_is to `next_round` (hr:135), and rev:79 tests an option the builder never emits.
- **Design:** The code follows 06 §11.2; the canon (D15) wins.
- **Fix:** Push keep_as_is for the tradeoff owner's `agent_escalated` (it degrades to `end_run` when the run cannot continue).

## i06 · medium · Exhaustion cause and questionKey are lost (D15, 05 §5.8.5, 04 R6/§4.8.3, INV-72)
- **Evidence:** The `rounds_exhausted` decision (rr:31,35-38) merges the rounds limit, the propose cap and `providerHasCandidates=false` without saying which. `HumanRequestDraft` (hr:10) has no questionKey. keep_as_is depends on a caller-supplied `canContinue` instead of the cause.
- **Design:** `questionKey = request.rounds_exhausted.{rounds|no_candidates|call_limit|spend_limit}`, and keep_as_is is offered only for `rounds`.
- **Fix:** Add `cause` to the decision and `questionKey` to the draft; derive keep_as_is from the cause, not having been extended, and the provider having candidates left.

## i07 · medium · `recommend_accept` is not bound to the proposal version (04 R5, 05 P05)
- **Evidence:** rr:4 makes `proposalVersion` optional, and rr:56 treats `undefined` as a match. Probe: versions (3, undefined) reach `pending_approval`. pc:11,15 lock in acceptance with no versions at all.
- **Design:** R5 requires every evaluator to recommend the **same** `proposalVersion`.
- **Fix:** Make `proposalVersion` required and compare it strictly; fix the fixtures.

## i08 · medium · Clarify request has no `end_run` (04 H1 guard, 04 SM-18, 06 §11.2)
- **Evidence:** hr:103 skips `end_run` for clarify; pt:18 locks in `['disclose','keep_as_is']`. The H1 guard in `openHumanRequestTx` ("last option is the end_run exit") will reject this draft.
- **Design:** 05 §5.11.2 omits `end_run` for clarify, so the chapters conflict.
- **Fix:** Get a design ruling and align either the code (append `end_run`) or 04 H1/SM-18.

## i09 · medium · The rules compatibility wrapper is a second, non-canonical contract (canon §1.6, D15, 05 §5.10/§5.11.1, 04 R6)
core/engine/rules/humanRequests.ts:7-20 is exported from `core/engine/rules`. It:
- emits `opt_N` option keys (`optionKeyStyle:'legacy'`) instead of `A..E`;
- hardcodes `canContinue: true`, so keep_as_is is offered even under call/spend limits;
- hardcodes `openRequestCount: 0`, which bypasses the one-open guard;
- routes `needs_tradeoff` to the model's `toRole` (probe: finance throws) instead of the code-chosen tradeoff owner;
- shares the name `buildHumanRequests` with the protocol function, with a different signature.

**Fix:** Pass limits, extension status and the open count through; use A..E keys and route to the tradeoff owner. Or retire the wrapper and point W1-1 tests at the protocol API.

## i10 · low · Naming and role literals
- `RoundContext.effectiveMaxRounds` (rr:18): 05 §5.8.1 and §5.20 say there is no derived effectiveMaxRounds. Rename to `maxRounds`.
- The engine hardcodes role names: `'customer'` (rr:31,35) and `'provider'`/`'customer'` defaults (hr:130-131). Take them from the plugin.

## i11 · low · Coverage gaps
- Battery 09 INV-74 (and INV-68) are still `it.todo` even though their pure clauses are covered. The fix brief allowed this.
- No tests for:
  - a finance counter being ignored;
  - the customer's 4th counter still being forwarded;
  - $4,799.99 (05 §5.18 lists it);
  - CE-007 without disclosure;
  - `candidate_not_in_view`;
  - the extended-maxRounds boundary;
  - `HUMAN_REQUEST_TTL_DAYS === 7`.

## Checked and found satisfied
- **Serial guards:** order prefix, short circuit, extras, the `initiallyBlocked` contract.
- **Priority order:** clarify > escalate > accept > counter > other.
- **Round boundary:** `roundNo >= max` exhausts.
- **Blocked proposals:** cost no evaluation and give `blocked`-only feedback.
- **Propose/counter cap:** min(4, plugin) with the correct `>=` / `<=` semantics.
- **One open request:** `!== 0` guard.
- **Request recipient:** relaxationOrder selection (empty own view, and one relaxation must restore feasibility); fallback disclose to unrevealed relaxation roles.
- **Option limits:** drop ≤2, extend ≤1, A..E.
- **Choice options:** choose_candidate only from the customer's own view, current candidate first.
- **Projection:** projected options pass `assertOptionsProjected`; finance-private canaries pass.
- **No close option:** nothing maps to `rooms.close`.
