export const PROBE_ROUNDS = 20;

export const PROBE_TABLE = [
  "approve_last_two",
  "start_follow_up_twice",
  "approve_last_repeat",
  "approve_same_user",
  "start_run_repeat",
  "join_same_role",
  "cap_vs_last_approval",
  "reject_vs_last_approval",
  "withdraw_vs_last_approval",
  "complete_vs_bump",
] as const;

export type ProbeName = (typeof PROBE_TABLE)[number];

export type ConcurrencyEvidence = {
  probe: string;
  method: "multi_http_client" | "parallel_cli" | "ui_double_click";
  deployment: string;
  tier: "dev";
  gitSha: string;
  n: number;
  rounds: number;
  validRounds: number;
  maxOverlapPerRound: number[];
  results: { ok: number; rejected: number; errorCodes: Record<string, number> };
  invariant: { name: string; expected: number; observed: number[]; pass: boolean };
  occRetriesObserved: "unknown";
  startedAt: string;
  finishedAt: string;
};

export function evidenceFileName(date: string, probe: string): string {
  return `probe-results/${date}-${probe}.json`;
}

export function buildConcurrencyEvidence(input: Omit<ConcurrencyEvidence, "occRetriesObserved" | "tier"> & { tier?: "dev" }): ConcurrencyEvidence {
  return { ...input, tier: "dev", occRetriesObserved: "unknown" };
}

/** Evidence is written only after an actual observation; never includes credentials. */
export async function writeEvidence(probe: string, evidence: unknown): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir('probe-results', { recursive: true });
  await writeFile(evidenceFileName(new Date().toISOString().slice(0, 10), probe), JSON.stringify(evidence, null, 2));
}
