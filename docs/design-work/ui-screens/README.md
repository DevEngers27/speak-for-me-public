# UI screens (visual and copy baseline for W2-6) — v2 (11 pages)

Source: `speak-for-me-screens-v2.pdf` (11 pages, received 2026-10-24 evening), rendered as `page-1.png` … `page-11.png`; the first version (8 pages) is kept under `v1/`. Pages 1–8 are unchanged from v1 except the agent-card status vocabulary (now Scheduled / Running / Listening); pages 9–11 add the provider and finance views that item 4 asked for. The owner accepted it as the visual and copy baseline for W2-6 (frontend wired to real queries) with the exceptions below. Where a screen and the design text disagree, the design text wins (`docs/design-work/final-v2`, precedence in `docs/PROCESS.md`).

| Page | Screen | Viewer |
| --- | --- | --- |
| 1 | "How a room works": the four steps (Your brief → Negotiation meeting → Decide → Agreement), who acts, when it needs you | — |
| 2 | Workbench, S7 constraints changed, agents working; transcript panel | customer |
| 3 | Workbench, agent asking the human (infeasible / needs_tradeoff request card) | customer |
| 4 | Workbench, agent paused; "Guide your agent" panel | customer |
| 5 | Decide page: "Do you accept these exact terms?" (terms, code checks, agent suggestion, what gets recorded, approval status) | customer |
| 6 | Results page: "Change order CO-1 is recorded", why this result, tasks | customer |
| 7 | Mobile: meeting view | customer |
| 8 | Mobile: the question card | customer |
| 9 | Workbench, S7 constraints changed — **provider** view: one neutral sentence for the change, other agents' status collapsed, historical proposal shown as Superseded, no brief classes, "Other parties' briefs and limits never appear here" | provider |
| 10 | Decide page — **provider** view: `Fit: ok` only ("You see whether the proposal fits, not why"), no deadline, no brief column, tasks for you | provider |
| 11 | My brief + Update budget cap — **finance** view (S6 two of three approved): cap shared / committed and headroom private, approvals on v1, previewChange impact (constraints become v2, v1 over by $100 no longer applies, 2 approvals no longer apply, negotiation restarts) | finance |

## What the screens get right (keep)

One question per screen; "Needs you" as the only required human moment; "suggestion only, never counted as approval"; visible version binding (Proposal vN · Constraints vM, "No longer applies", re-decide on the new version); "Checked by code against constraints" separated from agent opinion; the agent's limits spelled out ("Your agent can't: …"); the decide page states exactly what will be recorded and that no payment happens; "Why this result"; "Only you" markers and "Private briefs never appear here".

## Must change before W2-6 copies them (acceptance criteria) — items 1, 2, 3, 5 are still open in v2 (unchanged pages); item 4 is closed

Owner ruling (2026-10-24 evening): items 1, 2, 3 and 5 are **not** sent back to the designer. W2-6 implements the design-correct behaviour directly (DX-3 viewer-split waiting copy with the provider seeing only "Waiting on others"; no "Let my agent choose"; `end_run` exit on every question card; D15 blocked-option variant with no amounts). The screens stay the visual reference for layout and tone only.

Resolution note (2026-10-25, from the stage B real-fixture check): item 5 has **no producing path in scope_change v1** — the customer's `rounds_exhausted` request is exactly [choose_candidate ×2, keep_as_is, end_run]; candidate options are enumerated in the customer's own view and are deliberately not pre-filtered against Finance's undisclosed cap (06 §11.3 #4 — a `blocked` marker on an over-cap candidate would itself leak Finance's headroom); an over-cap choice is rejected only when answered (≤ 1 bit, D12 ⑥). The D15 `blocked` form remains a valid schema branch and the UI renders it (synthetic canary); a customer option never shows "$100.00 over the cap".

1. **"Others see 'Waiting on Customer'" (pages 3, 8)** — DX-3 / canon D12 ⑦: the target role sees the question; the other buyer sees `kind + toRole`; the provider sees only `run_waiting`, never which role. Copy and agent-card states split accordingly; no provider-visible string combines a role name with "waiting".
2. **"Let my agent choose" (pages 3, 8)** — not a D15 effect and contradicts "your agent won't guess". Remove it; if a "continue without deciding" exit is wanted, it is `keep_as_is` with honest copy (the pre-declared rule decides, not the agent).
3. **No end_run exit on the question card** — CN-002: every human request ends with `end_run` ("End the negotiation", confirmed, → `ended_no_agreement`). "Answer later" (7-day TTL) may stay beside it.
4. **Provider and finance views** — delivered in v2 (pages 9–11) and they pass the privacy checklist: provider S7 shows only "Constraints changed (v2). Proposals are being re-checked." in banner and transcript (14 §8.3), other agents collapsed to Scheduled / Running, the historical proposal as Superseded with no checks, items without brief classes; provider decide shows `Fit: ok` only, no deadline, no brief column; finance sees its own cap / committed / headroom with sharing labels and a previewChange impact that matches 12 §12.17. Keep as the reference for those roles. Residual notes: the customer and provider use different words for the same stale proposal ("No longer applies" vs "Superseded") — intentional per D12 ① (provider gets the coarser status) but W2-6 should source both labels from one status map; the finance preview footnote ("checked only for the current proposal") is correct per design.
5. **"$100.00 over the cap" in an option (pages 3, 8)** — valid only when the cap is disclosed to the customer (main fixture). The undisclosed variant must be the D15 `blocked` form: no amounts, "Needs Finance to raise the budget." Draw both variants.

## Confirmed against the design (resolution)

6. **"Pause my agent" (page 4)** — not in the design: canon C6 removed the `paused` run state; failures go to `needs_input` + `agent_failed`. Recommendation: drop Pause and keep Guide; a human-initiated hold would need a design change (new request kind with TTL and end_run; provider sees `run_waiting`).
7. **"Guide my agent" free text (page 4)** — maps to the brief's `softFields.notes` ("Only you and your agent see this", 13 §13.6; A2 private soft info in 07): `briefs.updateSoft({ notes })`, new brief version, no constraints bump, ≤ 2,000 code points after NFC, rendered only inside the principal's own prompt block. The three chips append fixed sentences; "Earlier guidance" is the notes history. No new table or mutation.
8. **"+$900.00 budget commitment" (page 5)** — the amount is the public proposal amount, but the phrase implies finance's ledger. Customer copy: "a $900.00 change order"; finance copy may add committed / headroom figures.

Also: the prototype chrome (Viewing-as switcher, walkthrough tabs, "Needs backend" tags) stays out of product routes (13 FE-D14 / I-FE-10; see issue #49).
