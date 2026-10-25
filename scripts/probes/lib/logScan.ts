import { scan } from '../../../lab/spikes/privacy-canary/src/scanner.ts';
import type { SecretField } from '../../../lab/spikes/privacy-canary/src/types.ts';
export type LogScanAssessment = { entryCount: number; startedAt: string; finishedAt: string; pass: boolean };
export function assessLogScan(input: { entryCount: number; startedAt: string; finishedAt: string }): LogScanAssessment {
  return { ...input, pass: input.entryCount > 0 };
}
/** Reuse the canary scanner, including encoded, money, date and key variants. */
export function scanLogLines(lines: readonly string[], secrets: readonly SecretField[]) {
  const report = scan([...secrets], lines.map((line, index) => ({ id: String(index), kind: 'log', audience: 'ops', content: line })));
  return { entryCount: lines.length, violations: report.violations.map(hit => ({ secretId: hit.secretId, line: hit.surfaceId, variant: hit.variant })), pass: lines.length > 0 && report.violations.length === 0 };
}
