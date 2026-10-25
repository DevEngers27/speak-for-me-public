# Speak for Me (skeleton)

Next.js 16.4 (App Router) + Convex 1.48 + Clerk 7.9 + TypeScript 6. No business logic yet.

## Quick start

```bash
pnpm install
pnpm check            # lint + typecheck + test + build, no credentials needed
pnpm dev              # renders in "unconfigured" mode until env vars are set
```

To connect services: copy `.env.example` to `.env.local`, run `pnpm convex:dev`
(creates a dev deployment, writes `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL`,
regenerates `convex/_generated`), then `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-frontend-api>`.

## Layout and dependency direction

```
core/                      pure TypeScript, no framework imports (eslint-enforced)
  engine/                  plugin contract, domain types, deterministic rules
  scenarios/scope-change/  first scenario plugin; imports core/engine only
convex/                    Convex deployment code (functions + schema)
  schema.ts                composes engine tables + scenario tables
  auth.config.ts           Clerk issuer; fails closed if unset
  engine/                  generic engine functions (api.engine.*)
  scenarios/scopeChange/   scenario-specific functions/tables (api.scenarios.scopeChange.*)
  _generated/              committed; CI fails if it drifts
  test.setup.ts            convex-test module map (two dots => never deployed)
src/                       Next.js app
  app/                     routes; /rooms is protected in proxy.ts
  components/providers.tsx ConvexClientProvider + BackendGate
  lib/config.ts            server-only service config
  proxy.ts                 Next 16 proxy (Node runtime): optimistic auth gate
```

Allowed imports: `core <- convex`, `core <- src`, and `src -> @convex/_generated/{api,dataModel}` only.
`convex` never imports `src`; `core` never imports `convex`, `src`, React, Next or Clerk.

Aliases: `@/*` -> `src/*`, `@core/*` -> `core/*`, `@convex/*` -> `convex/*` (root `tsconfig.json`);
`convex/tsconfig.json` declares `@core/*` for the Convex bundler (esbuild reads it).

## Credential-free mode

| Missing | Behavior |
| --- | --- |
| Any of `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | No `ClerkProvider`/`ConvexReactClient` is mounted; a banner lists the missing names; `BackendGate` renders fallbacks |
| Clerk keys | `proxy.ts` redirects `/rooms(.*)` to `/setup?missing=clerk` (fail closed) |
| `CLERK_JWT_ISSUER_DOMAIN` (Convex env) | `convex/auth.config.ts` throws, so the backend push fails |

Authorization never happens in Next: `auth.protect()` in `proxy.ts` is an optimistic
sign-in check. Every Convex function must call `requireIdentity` and then check room membership.

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Next (public) | per environment; inlined into client bundles at build |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next (public) | passed to `ClerkProvider` from the server layout |
| `CLERK_SECRET_KEY` | Next server | never reaches the browser |
| `CONVEX_DEPLOYMENT` | local CLI | written by `convex dev` |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | `npx convex env set` |
| `ANTHROPIC_API_KEY` | Convex | model calls happen only in Convex actions |

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm lint` | ESLint (Next core-web-vitals + TS + layering rules), zero warnings |
| `pnpm typecheck` | `tsc` for the Next project and for `convex/` separately |
| `pnpm test` | Vitest projects: `convex` (convex-test, edge-runtime) and `core` (node) |
| `pnpm build` | `next build` |
| `pnpm convex:codegen:offline` | Regenerates `convex/_generated` without a deployment (no components) |

## Testing notes

- Put Convex tests next to functions as `*.test.ts`; import `modules` from `convex/test.setup.ts`.
- Vite 8 does not support the extglob `./**/!(*.*.*)*.*s` shown in Convex docs; the setup file uses explicit negations.
- convex-test does not simulate concurrency; OCC and idempotency races need a real dev deployment.

## CI

`.github/workflows/ci.yml`: install (frozen lockfile) -> codegen drift check -> lint -> typecheck -> test -> build, with no secrets.
