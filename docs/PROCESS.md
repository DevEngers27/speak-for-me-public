# How Speak for Me is being built

## Why this document

Speak for Me (see `README.md`) is a multi-party AI negotiation workspace: participants privately delegate goals to agents, deterministic code validates the outcome, humans approve one specific version, and execution happens once.

A dispatcher agent (Claude, Fable 5.1) cuts the design into small work orders, hands each to an external coding agent, gates the result mechanically, arranges independent reviews, and merges. That is why you see PR titles like "W1-2 engine: ...", commit trailers naming models and tools, issues labelled `wave-0/1/2`, audits under `docs/reviews/`, change notices (`CN-nnn`) beside the design, and a test battery full of `it.todo`.

State on 2026-10-24: wave 0 (foundation and its review fixes) is merged. Most of wave 1 (pure engine: rules, candidates, privacy projections, protocol, web scaffold) is merged; the `scope_change` scenario plugin (W1-3, PR #41) was still open when this was written. Next: the wave-1 fix packs (W1-4F privacy, W1-1F rules, W1-7 foundation sync) and wave 2 (Convex functions, scheduler, gateway, frontend wiring, real-deployment verification). GitHub Issues are the live board; this is a dated snapshot.

## Source of truth and precedence

The design lives in `docs/design-work/final-v2/` (its index, `README.md`, is written in Chinese). From most to least authoritative:

1. `00-canon*.md`: decisions D01-D27 and conflict rulings C1-C60.
2. The chapters `01-` to `18-`.
3. `00-invariants*.md`: the invariants table with `INV-` and `CE-` (counterexample) ids.
4. The test battery under `tests/battery/`.

When implementation finds that two chapters disagree, the ruling is recorded as a change notice in `docs/design-work/final-v2/_changes/CN-nnn-*.md` (CN-001 to CN-004 exist). A CN overrides the text it amends. Precedence: the canon wins; if the canon is silent, the owning chapter wins; otherwise the stricter, fail-closed reading applies. Items marked "needs ruling" wait for the owner. Implementers leave them as they are and list them in their result notes.

Every packet cites the design copy commit it was written against. The post-fix design v2 is on main as `0275517`; the older snapshot `e2f99d0` is explicitly not to be used.

## How a task flows

1. **Packet.** The dispatcher writes a task packet: a Markdown work order with an id (W1-2, W1-4F, W2-GW ...), common rules, a read-first list (design sections, existing code), numbered deliverables with expected test titles, acceptance criteria, and the output format. Packets explain scope and do not restrict paths; the implementer judges which files need to change and says so in its notes. Packets, runner scripts and the gate live outside the repository, in the sibling directory `speak-for-me-wt/_tools/`.
2. **Worktree and branch.** One git worktree and one branch per task, cut from `origin/main`: `wave0/<id>`, `wave1/<id>`, `wave2/<id>`.
3. **Implementation.** An external coding agent is run headless in that worktree with the packet as its prompt. It writes code and tests and runs lint, typecheck and the full tests itself. It does not commit or push. If main moved, it fast-forwards to `origin/main` and re-runs the checks.
4. **Result.** The final message must match `result.schema.json`: `status` (`done` or `blocked`), `summary`, `files_changed`, `commands_run`, `acceptance_passed`, `review_items_resolved` (audit or review ids closed), `blockers`, and `notes` (trimmed outputs, rule-to-test map, remaining todos, needs-ruling items left alone).
5. **Gate.** The mechanical gate runs before any review (next section).
6. **Review ladder.** Independent review and invariant check, then a fix loop (next section).
7. **PR and squash merge.** One PR per task, closing the task's issue; the dispatcher squash-merges, so main has one commit per task.

Fix packs follow the same flow. Deviations an audit finds in merged code become a new packet. Example: W1-4F (issue #46) closes `AUD-PRIVACY-01..14` from the invariant audit of main at `c7864d9` (`docs/reviews/audit-main-c7864d9/`; other medium and low items are tracked in #42). Each deliverable names the rule it fixes and a test titled with that rule's id.

## Who does what

| Family | Model and tool | Role |
| --- | --- | --- |
| OpenAI | `gpt-6.1-sol` via Codex CLI | Implementer; reviewer of other families' work |
| Google | `gemini-4-argon-high` via Antigravity CLI (`agy`) | Implementer; reviewer of other families' work |
| xAI | `grok-4.7` via Cursor agent | Implementer or reviewer (e.g. the wave-0 batch review) |
| Anthropic | Claude Opus (`claude-opus-5-5`) | Read-only invariant checks against `00-invariants` and the canon; design revision and audit work |
| Anthropic | Claude Fable 5.1 (`claude-fable-5-1`) | Dispatcher: writes packets, runs the gate, assigns reviewers, posts review comments, merges. Never implements. |

## Gates and reviews

**Mechanical gate** (`gate.sh`, run on every task before any review):

- Lists changed files; unexpected ones are an advisory note, not a failure.
- Secret scan over changed files (Anthropic, GitHub, AWS and Clerk key patterns). A hit fails.
- Runtime dependency diff: prints any change to `dependencies`; packets forbid new ones unless listed, so the dispatcher judges what is shown.
- Frozen-lockfile install, then `lint`, `typecheck` and `test`. The test script runs the vitest projects and `scripts/check-boundaries.mjs`, the engine purity and layer scan: `core/engine/` and `core/scenarios/` stay pure TypeScript (no zod, convex, Date, Intl, Math.random, fetch), and zod and Convex appear only under `convex/`.

CI (`.github/workflows/ci.yml`) repeats these on every PR and adds the dependency policy check, a Convex codegen freshness check, and a build.

**Review ladder** (after the gate passes):

- Mechanical tasks are batch-reviewed together.
- Every logic task gets one read-only review from a model family other than the implementer's. Examples: W1-2 (Gemini, reviewed by Codex) and W1-5 (Codex, reviewed by Gemini).
- Findings become a fix round by the implementer on the same branch, or an issue (for example #38, #42, #49), followed by re-checks.
- Then a Claude Opus invariant check against `00-invariants` and the canon, re-checked after fixes, then merge.
- Core pieces (approval-and-execute in one mutation, the constraints bump, privacy projections) carry the `core` label and get the invariant check with extra emphasis.
- Reviews and checks are posted as PR comments before merge; audits and batch reviews are also committed under `docs/reviews/`.

## Conventions (commits, PRs, issues)

- **Commits.** Squash-merged, subject ends with the PR number. Body: a paragraph of what changed, then trailers naming the model and the tool:

  ```
  Task: W1-5
  Design: 05-protocol; 00-canon D08 D11 D12 D15; 04-state-machines-part2; CN-002
  Implemented-by: gpt-6.1-sol (codex)
  Reviewed-by: gemini-4-argon-high (agy review + re-check); claude-opus-5-5 (invariant check + re-check)
  Merged-by: claude-fable-5-1 (dispatcher)
  ```

  Docs-only commits use `Task: docs` and `Revised-by:` or `Audited-by:` instead of `Implemented-by:`.
- **PRs.** The body lists What / Design references / Acceptance / Review / Attribution, and ends with `Closes #<issue>`.
- **Issues.** One issue per task, with a wave label (`wave-0`, `wave-1`, `wave-2`) and a kind label (`mechanical`, `logic`, `core`). Follow-ups and audit findings get their own issues (W1-4F is #46: `wave-1`, `logic`, `core`).

## Tests and the invariant battery

`tests/battery/` holds the invariant and counterexample battery in four layers: `pure/`, `convex/`, `real-deploy/` and `e2e/`. Every `INV-` and `CE-` id starts as an `it.todo` titled with its id. A task that makes an id testable turns it into a real test, keeping the title.

`reconcileBattery` reports ids with no executed test (`untestedIds`; a todo counts as untested). That number may only decrease. Packets ask that the baseline for this count (`tests/battery/pure/reconciliation.test.ts`) be lowered by the ids converted, never raised.

Rule for new packets: one test per invariant or table row, with the title starting with the row id (for example `PV-05 ...`, `DX-7 ...`, `TC-PRIV-21 ...`). Fix packs also ask for evidence that the new tests fail with the fix reverted. Run lint, typecheck and tests with `npx --yes pnpm@11.25.0 check`.

## Where to look

- `README.md`: product principles and layout.
- `docs/design-work/final-v2/`: canon, chapters, `00-invariants*.md`, `_changes/` (CN notices), `_fix/` and `99-review-log.md` (revision logs).
- `docs/reviews/`: audits and review reports.
- `core/engine/`, `core/scenarios/scope-change/`: pure engine and scenario code.
- `convex/`: schema and backend. `src/`: Next.js app. `tests/battery/`: invariant battery.
- `scripts/check-boundaries.mjs`: purity and layer scan.
- `.github/workflows/ci.yml`: CI. GitHub Issues and PRs: task board and review comments.
