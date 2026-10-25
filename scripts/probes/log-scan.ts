import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { canarySecrets } from "../../core/scenarios/scope-change/fixtures/canaries.ts";
import { isoDate } from "../../core/scenarios/scope-change/fixtures/anchor.ts";
import { writeEvidence } from "./lib/evidence.ts";
import { assessLogScan, scanLogLines } from "./lib/logScan.ts";
import { refuseProbeEnvironment } from "./lib/target.ts";

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Start `npx convex logs --jsonl` before the flow. Kill it ~10s after. Zero lines fails. */
export function startLogCapture(): { stop: () => Promise<ReturnType<typeof scanLogLines>> } {
  const child = spawn("npx", ["convex", "logs", "--jsonl"], { stdio: ["ignore", "pipe", "pipe"] });
  let content = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    content += chunk.toString("utf8");
  });
  return {
    stop: () => new Promise((resolve) => {
      setTimeout(() => {
        child.kill();
        resolve(scanLogLines(content.split("\n").filter(Boolean), canarySecrets(isoDate(process.env.PROBE_DEADLINE ?? "2026-11-24"))));
      }, 10_000);
    }),
  };
}

export { assessLogScan };

if (invokedDirectly()) {
  const refusal = refuseProbeEnvironment(process.env);
  if (refusal) {
    console.error(refusal.message);
    process.exit(2);
  }
  const file = process.argv[2];
  if (!file) { console.error('not implemented: live flow orchestration; pass a captured JSONL file and PROBE_DEADLINE'); process.exit(3); }
  readFile(file, 'utf8').then(async content => {
    const result = scanLogLines(content.split('\n').filter(Boolean), canarySecrets(isoDate(process.env.PROBE_DEADLINE ?? '2026-11-24')));
    await writeEvidence('log-scan', result);
    if (!result.pass) process.exitCode = 1;
  }).catch(() => { console.error('log-scan failed to read evidence'); process.exitCode = 1; });
}
