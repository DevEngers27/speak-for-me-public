# CN-006 — `briefs.updateSoft` (soft guidance notes without a constraints bump)

**Status:** applied 2026-10-24 (owner-approved 2026-10-24, "补"). Edited files (all under `design/final-v2/`): `12-api.md`, `12-api-part3.md`, `12-api-part5.md`, `12-api-part8.md`, `13-frontend-part2.md`, `13-frontend-part3.md`, `13-frontend-part5.md`, `03-schema-part3.md`, `03-schema-part9.md`, `03-schema-part10.md`, `03-schema-part11.md`, `07-permissions-privacy-part3.md`, `07-permissions-privacy-part6.md`, `07-permissions-privacy-part7.md`, `16-testing-part3.md`, `16-testing-part5.md`. Old → new pairs: `scratchpad/ext-apply-fixup/log-cn006.md`. Deviations from the text below are listed under "Application notes" at the end.

## Why
The UI baseline (screens page 4, "Guide my agent") lets a principal give free-text guidance to their own agent between turns. The design maps this to the brief's `softFields.notes` (13 §13.6; 07 A2 private soft information), but 12-api only defines `briefs.confirm`, which writes a full brief version and re-runs the constraint change path. W2-6 stage A had to stub the call and disable live guidance saving.

## Decision
Add `briefs.updateSoft({ roomId, notes })` (public mutation, `memberMutation`, any role with a confirmed brief):
- Creates a new brief version equal to the caller's latest confirmed version with `softFields.notes` replaced (append-only `insertBriefVersion`); hard fields, disclosures and all other soft fields are copied unchanged.
- Never calls `withConstraintChange` and never bumps `constraintsVersion` (notes are not part of `hardProjection`); writes one `brief_soft_updated` event visible to the owner only (`visibility: 'private'`), no `disclosure_changed`, no shared-fact rows.
- Validation: `notes` is NFC-normalised, ≤ 2,000 code points, `^[^<>]*$` is **not** required (the text is only ever rendered inside the principal's own `<principal_notes>` block after `sanitizeUntrustedText` + `encodeBlock`); empty string clears the notes.
- Errors: `auth.not_member`, `brief.not_confirmed` (no confirmed brief yet → use `briefs.confirm`), `input.invalid { field: 'notes' }`, `run.invalid_state { room_status }` for executed / closed rooms.
- Rate limit: counts in D12 ⑥ `constraint_writes`? **No** — it is not a constraint write; it uses a new `soft_writes` bucket, 30 per user per room per hour (append-only addition to the bucket table in 03 §3.11.3).
- Returns `{ briefVersion }`.
- Privacy: INV-03 unchanged (own brief ∪ own notes only reach the owner's prompt); INV-19 unchanged (no cross-role field).

## Affected chapters
12-api §12.8 (new row + error table), 13-frontend §13.6 (Guide my agent binds to it; chips append fixed sentences; "Earlier guidance" = notes history from `briefs.mine.versions`), 03-schema §3.11.3 (bucket), 16 TC rows (one unit test per error + privacy canary that the provider / other buyer prompt never contains the notes), battery CE for "notes update does not bump cv".

## Implementation
Packet W2-9 (backend, after W2-7): `convex/briefs.ts` `updateSoft`, tests, battery wiring; W2-6 stage B wires the UI.

## Application notes (2026-10-24)
- **Error code reused, not added.** `brief.not_confirmed` was not created. 12 §12.4 already has `run.invalid_state{ guard: "brief_missing" }` with this meaning, used by `budget.setCap` and `sharedFacts.add`. `briefs.updateSoft` throws that code, so `API_ERROR_CODES` (13 codes), 06 `REASON_CODES` and the 12 §12.4 table are unchanged. TC-AUTH-16 asserts the reused code.
- **Section numbers.** Briefs is 12 §12.9, because 12 §12.8 is the shared constraint-write flow; the new entry sits under §12.9 after `briefs.confirm`. 13 §13.6 is the trade-off page and had no "Guide my agent" panel. The panel is now specified as 13 §13.10 F (new), is listed in the 13 §13.4 right column, and 13 §13.6 item 8 points to it.
- **Supporting changes the binding needed:** a new literal `briefs.source: "soft_update"` (03 §3.6); `notes` added to the `briefs.mine.versions[]` items (12 §12.17), which "Earlier guidance" reads; `events.rateUser` now also allows `"soft_writes"` (03 §3.11); the `insertBriefVersion` helper row (03 §3.13.1) gains the `soft_update` branch; `briefs.confirm` no longer says every `insertBriefVersion` writes `brief_confirmed`; 12 §12.2 item 7, §12.3, §12.21 and §12.22 and 07 §7.12.2 list the function; the "four buckets" wording became "five" in 12 B7, 12 §12.4 and 07 §7.7.
- **No `visibility` field on events** (03 §3.11 / 07 PV-12). Instead, `brief_soft_updated` is defined to render only to its owner, with `restrictedRef → briefs`.
- **Prompt path.** The chapters escape `<principal_notes>` with `encodeBlock` (05 §5.13.2). They have no `sanitizeUntrustedText`, so that name was not introduced.
- **Validation.** Only `notes` is validated. Copied fields are not re-validated, which matches the error list: for example, a deadline that is now in the past does not block a notes update.
- **Battery CE not added.** 00-invariants owns CE-001…170, and its brief-related table (§2.1, CE-001…035) has no free number. 16 §16.11.3 registers new CEs from CE-176 if one is wanted. TC-VER-16 covers "no cv bump, no shared fact".
- **Residual signal.** Other buyers (and the provider before `open`) still see the author's brief version number and `confirmedAt` advance (DX-7). A soft-only `briefs.confirm` shows the same. The notes text itself never crosses roles.
- **Not edited (outside the chapters named above):** 09 §9.2 bump matrix (no M row for `briefs.updateSoft`); the `insertBriefVersion` caller lists in 02-domain-model-part2 and 01-product; 15-operations-part3 rate table; canon §1.6 function list (read-only).
