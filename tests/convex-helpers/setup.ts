/// <reference types="vite/client" />
// Keep Convex-root-relative keys for fixture registration and function references.
// Include generated facades, but never enumerate the test helpers themselves.
const loaders = import.meta.glob(["../../convex/**/*.*s", "!../../convex/**/*.*.*s"]);
export const modules = Object.fromEntries(Object.entries(loaders).map(([name, load]) => [name.replace('../../convex/', './'), load]));

// W2-4: lifecycle suites register their convex-test instances; constructed violation
// tests can supply expected findings, while ordinary fixtures must remain live.
import { afterEach, expect } from 'vitest';
import type { TestConvex } from 'convex-test';
import type { Id } from '../../convex/_generated/dataModel';
import { livenessFindings } from '../../convex/testing';
const tracked: { t: TestConvex<typeof import('../../convex/schema').default>; roomId: Id<'rooms'>; expectFindings: string[] }[] = [];
export function trackLiveness(t: TestConvex<typeof import('../../convex/schema').default>, roomId: Id<'rooms'>, expectFindings: string[] = []) { tracked.push({ t, roomId, expectFindings }); }
afterEach(async () => {
  const instances = tracked.splice(0);
  for (const { t, roomId, expectFindings } of instances) {
    const findings = await t.run(ctx => livenessFindings(ctx, roomId));
    expect([...new Set(findings.map(f => f.invariant))].sort()).toEqual([...expectFindings].sort());
  }
});

// Every registered execution room is audited after its scenario.
type Audit = { name: string; run: () => Promise<readonly { code: string; check: string }[]>; expected: string[] };
const roomAudits: Audit[] = [];
export function registerRoomInvariantAudit(name: string, run: Audit['run']) {
  const audit: Audit = { name, run, expected: [] };
  roomAudits.push(audit);
  return { expectFindings(codes: readonly string[]) { audit.expected = [...codes]; } };
}
afterEach(async () => {
  for (const audit of roomAudits.splice(0)) {
    const findings = await audit.run();
    expect([...new Set(findings.map(f => f.code))].sort(), `${audit.name}: ${findings.map(f=>f.check).join(',')}`).toEqual([...audit.expected].sort());
  }
});
