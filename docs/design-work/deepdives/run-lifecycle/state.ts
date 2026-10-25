// convex/lib/state.ts (excerpt) — run & turn transition tables. Every status write goes through these.
import type { Infer } from "convex/values";
import { RUN_STATUSES, TURN_STATUSES, runStatusV, turnStatusV } from "../schema";

export type RunStatus = Infer<typeof runStatusV>;
export type TurnStatus = Infer<typeof turnStatusV>;

// Compile-time check: the literal tuple and the validator never drift (F03.13).
type _RunEq = [RunStatus] extends [(typeof RUN_STATUSES)[number]]
  ? [(typeof RUN_STATUSES)[number]] extends [RunStatus] ? true : never
  : never;
const _runEq: _RunEq = true;
type _TurnEq = [TurnStatus] extends [(typeof TURN_STATUSES)[number]]
  ? [(typeof TURN_STATUSES)[number]] extends [TurnStatus] ? true : never
  : never;
const _turnEq: _TurnEq = true;

export const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "negotiating",
  "pending_approval",
  "needs_input",
  "failed",
]);
/** G1: statuses in which a turn result may still be persisted. */
export const TURN_ACCEPTING_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["negotiating", "failed"]);

/**
 * Run transitions. Key = from, value = allowed targets.
 * Who triggers each edge is documented in run-lifecycle-part2.md §4.1.
 */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  negotiating: ["pending_approval", "needs_input", "failed", "superseded", "cancelled"],
  pending_approval: ["confirmed", "negotiating", "needs_input", "superseded", "cancelled"],
  needs_input: ["negotiating", "superseded", "cancelled"],
  failed: ["negotiating", "superseded", "cancelled"],
  superseded: [],
  cancelled: [],
  confirmed: [],
};

export const TURN_TRANSITIONS: Record<TurnStatus, readonly TurnStatus[]> = {
  running: ["succeeded", "invalid_output", "failed", "stale"],
  succeeded: [],
  invalid_output: [],
  failed: [],
  stale: [],
};

export class TransitionError extends Error {
  constructor(kind: "run" | "turn", from: string, to: string) {
    super(`illegal ${kind} transition ${from} -> ${to}`);
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) throw new TransitionError("run", from, to);
}
export function assertTurnTransition(from: TurnStatus, to: TurnStatus): void {
  if (!TURN_TRANSITIONS[from].includes(to)) throw new TransitionError("turn", from, to);
}

/** errorCode -> terminal turn status + whether the app layer may auto-retry. */
export const ERROR_POLICY = {
  schema_invalid: { status: "invalid_output", autoRetry: true },
  max_tokens: { status: "invalid_output", autoRetry: true },
  rules_rejected: { status: "invalid_output", autoRetry: true },
  timeout: { status: "failed", autoRetry: true },
  action_crashed: { status: "failed", autoRetry: true },
  api_error: { status: "failed", autoRetry: false },
  refusal: { status: "failed", autoRetry: false },
  bad_request: { status: "failed", autoRetry: false },
  auth_error: { status: "failed", autoRetry: false },
  agents_disabled: { status: "failed", autoRetry: false },
  call_cap_reached: { status: "failed", autoRetry: false },
  room_daily_cap: { status: "failed", autoRetry: false },
  global_daily_cap: { status: "failed", autoRetry: false },
  internal_error: { status: "failed", autoRetry: false },
  run_superseded: { status: "stale", autoRetry: false },
  run_cancelled: { status: "stale", autoRetry: false },
  guard_rejected: { status: "stale", autoRetry: false },
} as const satisfies Record<string, { status: TurnStatus; autoRetry: boolean }>;
export type TurnErrorCode = keyof typeof ERROR_POLICY;
