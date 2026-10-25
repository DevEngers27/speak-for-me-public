# Speak for Me

## Public submission snapshot

This repository contains the current files from `DevEngers27/speak-for-me`, branch `final_product`, source commit `35583479330922e791d27a5bfd30ee913c4d2e5d`. It excludes the source repository's Git history and other branches. Existing contributor attribution and bundled third-party license notices are preserved. The snapshot publisher does not claim sole authorship of the underlying implementation.

Historical evidence documents describe their original runs; the public snapshot has not independently rerun those checks.


[Open the deployed product](https://speak-for-me-calhacks.lgc783656618.chatgpt.site) · Public website; Google sign-in through Clerk protects member-only rooms.

A cloud workspace for software scope-change negotiation. Customer, Provider, and Finance privately delegate goals, review source-backed proposals, and approve exact terms. Code validates permissions, arithmetic, scope, dates, and sources. The final required human approval records the internal outcome atomically.

This `final_product` release preserves the authoritative `DevEngers27/speak-for-me` implementation and the team's PR 101 fixes. It replaces the earlier incompatible demonstration; the old $900 → $700 video is not evidence for this product.

Google sign-in through Clerk is the released authentication route. The public app has been verified with one real account through room creation and Provider private-brief save/reload. The full three-account workflow remains a separate acceptance check.

## What works, and what remains

The isolated real Convex backend is `benevolent-jackal-41`. The release probes made **seven real `claude-opus-5-5` calls**, produced a $900 proposal, invalidated its two approvals after a budget cut, and produced an $800 required-only alternative. The autonomous run then requested human input; it did **not** independently reach agreement.

An explicit Customer choice selected the existing $800 proposal. Three fresh decisions followed, and the final vote created one execution, one change order, one ledger commitment, and two tasks. The recovery probe also passed its duplicate-final-approval, projected-privacy, and follow-up checks. These probes used synthetic identities through Convex administrator impersonation. **They are not evidence of three Clerk browser sign-ins.**

| Release evidence | Result |
| --- | --- |
| Actual cloud/model progression | Seven completed calls; $900 → $800 proposal; safe human escalation |
| Autonomous completion | Not achieved; smoke probe correctly remains `pass: false` at `needs_input` |
| Explicit human recovery | Passed; final approval executes; one outcome and two tasks |
| Permission/privacy checks | Probe rejected anonymous/non-member reads and Provider budget writes; tested projections passed |
| Infeasible budget | Separate deployed $4,700 precheck and explicit end-run passed; no model attempt, execution or new commitment |
| Follow-up | Created once; setup state; Finance must confirm the suggested baseline |
| Engineering validation | Source-repository CI 40202735745 (private; see the bundled validation report) at `97c1417` passed: 2,154 passing tests, 39 TODO tests, 7 skipped files; lint, typechecks, boundaries, policy and both builds passed; see [VALIDATION.md](docs/release/VALIDATION.md) |
| Three real Clerk accounts and browser synchronization | Pending; full three-account browser workflow has not yet been exercised |
| Corrected frontend deployment | Latest publication October 25 at 14:09:28 UTC; canonical homepage, actual one-account Clerk sign-in, inbox and test-room creation verified; public website |
| New video and report | 177.0-second 1080p/30fps H.264/AAC video complete; decode/subtitle and review of unchanged scenes and updated identity/closing frames passed; 7-page PDF ready. Video is illustrative, not a live three-account recording |

Read the actual evidence: [live smoke](probe-results/2026-10-25-release-live-smoke.json), [human recovery](probe-results/2026-10-25-release-human-recovery.json), and [safe public trace](probe-results/2026-10-25-release-public-trace.json). The earlier failed [preflight](probe-results/2026-10-25-release-live-smoke-preflight.json) is retained. See the [deployment receipt](probe-results/2026-10-25-release-deployment.json), [validation report](docs/release/VALIDATION.md), and [product report](docs/release/PRODUCT_REPORT.md) for interpretation and remaining gates.

## The canonical workflow

1. Each role confirms a structured private brief and chooses which fields to share. Provider confirms item prices and lead times; Finance owns the baseline and cap.
2. The initial example has a $5,000 cap, $4,000 committed, and a $900 package: SSO login $500, Audit log export $300, Usage dashboard $100.
3. Customer and Provider approve. Before Finance's final vote, the cap falls to $4,800. Old approvals no longer authorize execution.
4. A supported $800 proposal retains the two required features and defers the dashboard. In the measured run, Customer explicitly selected this alternative after agent escalation.
5. All three roles approve the current version. The final vote records the outcome immediately; there is no separate Execute button. Finance sees $4,800 committed and zero headroom.

Provider never receives private cap, commitments, headroom, or budget-derived checks. Customer sees only explicitly disclosed fields; the main fixture shares the cap, not all its underlying inputs. A separate [deployed $4,700 probe](probe-results/2026-10-25-release-infeasible-smoke.json) passed: Finance received raise-cap/end-run choices, Provider saw generic waiting, and explicit end-run produced no execution or new commitment. The deterministic precheck stopped before the first model attempt.

Executed rooms are terminal. Tasks can be completed and later work can start a linked follow-up room. No payment, binding signature, or external ERP update occurs.

## Cloud delivery and development

The cloud application is the primary product. `cloud/` is a thin SPA hosting adapter around the canonical React components and generated Convex API; it does not introduce another business engine. Its build targets the isolated backend and the working Google sign-in through Clerk. The corrected frontend is deployed. Browser checks verified its canonical homepage, actual one-account Clerk sign-in, decision inbox and test-room creation. Three-account browser acceptance remains pending. The owner authorized public website access at 14:35:34 UTC. Provider private-brief confirmation and save/reload were also verified; repository and hosted-video judge access remain separate checks.

Requires Node 24.x and pnpm 11.25.0. For development and verification:

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 check
npx --yes pnpm@11.25.0 build
npx --yes pnpm@11.25.0 cloud:typecheck
npx --yes pnpm@11.25.0 cloud:build
```

Checks/builds do not require live credentials. To run the optional Next.js development server, copy `.env.example` only if `.env.local` does not already exist, set the intended Clerk and Convex configuration, then run:

```sh
npx --yes pnpm@11.25.0 env:check
npx --yes pnpm@11.25.0 dev
```

Localhost is a developer option, not a substitute deliverable. Protected `/rooms` routes fail closed without authentication. Set the matching `CLERK_JWT_ISSUER_DOMAIN` and model credentials in the **Convex deployment**, not only in Next.js. Confirm the target before backend deployment; never deploy this schema over another project's database. Keep secret values out of Git and recordings.

## Architecture and contribution rules

```text
core/engine/                  Pure rules, protocol, privacy and execution contracts
core/scenarios/scope-change/  Canonical catalog, scenario and synthetic fixtures
convex/                      Authorized functions, storage, scheduling and model calls
src/app/                     Next.js public, authentication and protected routes
src/components/              Canonical inbox, room, brief, decision and results UI
cloud/                       Thin SPA adapter for cloud hosting
probe-results/               Measured evidence, including failed runs
scripts/release/              Reproducible release probes
```

Dependency direction is engine ← scenario ← Convex ← UI. Core stays deterministic and framework-free. Preserve generated API types, layer checks, append-only history, role projections, and teammate work. Follow [docs/PROCESS.md](docs/PROCESS.md) and [authoritative design](docs/design-work/final-v2/README.md). The invariant battery's todos and skipped tests remain incomplete evidence.

## Presentation and remaining gates

The [demonstration script](docs/release/DEMO_SCRIPT.md), [requirements audit](docs/release/REQUIREMENTS_AUDIT.md), and [product report](docs/release/PRODUCT_REPORT.md) distinguish implemented, tested, illustrative, and pending work. The [completed video](submission/speak-for-me-team-demo.mp4), [English subtitles](submission/speak-for-me-team-demo-en.srt), [poster](submission/speak-for-me-team-poster.png), screenshots and video source archive are packaged under `submission/`. The [seven-page product PDF](submission/speak-for-me-team-product-report.pdf) and its [editable source](submission/speak-for-me-team-product-report-source.zip) are included. The video is an illustrative React-component walkthrough. Its Google identity label refers to the released Google sign-in through Clerk; it does not claim a direct GIS-to-Convex integration. It cannot certify Clerk sign-in, cloud WebSocket synchronization, or the live model trace.

The [Devpost entry draft](submission/DEVPOST_DRAFT.md) contains the finished project story and separately labeled submission fields. The [demonstration is on YouTube](https://youtu.be/GpGHtLMbCKw) as an unlisted video, with upload checks reporting no issues. The [Speak for Me Devpost submission](https://devpost.com/software/speak-for-me-wgp9ck), project `1263563`, is submitted: Devpost showed **SUBMITTED, 5/5 steps done** on October 25, 2026 (San Francisco time). The user confirmed a single participant and no teammates; repository contributor credit remains intact. See the [official submission checklist](docs/release/SUBMISSION_CHECKLIST.md) for event-wide requirements and source links. Verify the saved video embed, intended judge access, and submission confirmation; three real browser identities and authenticated editor/synchronization checks are our outstanding product gates. Mana evidence applies only if entering its optional sponsor category. User interviews are not a verified universal requirement. Research, savings, and sponsor claims remain unverified where evidence is absent; no eligibility or award qualification is guaranteed. V1 intentionally defers conversational extraction, notifications, external payments/signatures, cross-room budgets, and same-room post-execution revisions.
