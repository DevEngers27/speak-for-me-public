import { fileURLToPath } from "node:url";
import { refuseProbeEnvironment } from "./target.ts";

export function runProbeMain(metaUrl: string, run: () => Promise<void> | void): void {
  const entry = process.argv[1];
  if (entry === undefined) return;
  let invoked = false;
  try {
    invoked = fileURLToPath(metaUrl) === entry || fileURLToPath(metaUrl) === `${entry}`;
  } catch {
    invoked = false;
  }
  if (!invoked) return;
  const refusal = refuseProbeEnvironment(process.env);
  if (refusal) {
    console.error(refusal.message);
    process.exit(2);
  }
  Promise.resolve().then(run).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "probe failed";
    console.error(message.includes("|") ? "probe failed" : message);
    process.exit(message.startsWith("not implemented:") ? 3 : 1);
  });
}
