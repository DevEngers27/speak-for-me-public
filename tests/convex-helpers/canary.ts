/** W2-2: test harness only. No registered Convex function or production data access. */
import {
  canarySecrets,
  lintCanaries as lintFixtureCanaries,
  normalizeText,
  type CanarySecret,
  type CanaryLintIssue,
  type PublicText,
} from '../../core/scenarios/scope-change/fixtures/canaries';
import { materializeFixture } from '../../core/scenarios/scope-change/fixtures';
import type { ScopeChangeFixture, Role } from '../../core/scenarios/scope-change/fixtures/main';

export type CanaryNeedle = CanarySecret;
export interface CanaryHit { path: string; secretId: string }
export interface ScanOptions {
  /** Omit to scan room-class material for all private needles. */
  viewer?: Role | 'outsider';
  /** Explicit role grants derived from the disclosure configuration under test. */
  allowedRoles?: Readonly<Record<string, readonly Role[]>>;
  maxDepth?: number;
}

/** These values carry opaque identifiers/timestamps, not business values. */
export function isOpaqueCanaryField(key: string): boolean {
  return key === '_id' || key === 'id' || key.endsWith('Id') ||
    ['_creationTime', 'at', 'commitTs', 'cursor', 'requestId'].includes(key);
}

/** Derive pins from the actual fixture rather than copied expected constants. */
export function canaryNeedles(fixture: ScopeChangeFixture): CanaryNeedle[] {
  const fx = materializeFixture(fixture, fixture.goldenAnchor);
  const cap = fx.briefs.finance.hardFields.capCents;
  const baseline = fx.ledgerBaseline.amountCents;
  // The scripted budget change is relative to fixture's cap, just as the canary variant.
  const capAfter = cap - 31_110;
  const requiredAmount = fx.catalog.filter(row => fx.briefs.customer.hardFields.requiredItemKeys.includes(row.itemKey)).reduce((n, row) => n + row.priceCents, 0);
  const initialAmount = requiredAmount + (fx.catalog.find(row => row.itemKey === 'usage_dashboard')?.priceCents ?? 0);
  const amounts: Record<string, number> = {
    'finance.capCents.v1': cap,
    'finance.capCents.v2': capAfter,
    'finance.committedCents': baseline,
    'finance.headroomCents.v1': cap - baseline,
    'finance.headroomCents.v2': capAfter - baseline,
    'finance.phaseOneCommittedCents': baseline + initialAmount,
    'finance.overByCentsAfterCut': baseline + initialAmount - capAfter,
    'finance.committedAfterExecuteCents': baseline + requiredAmount,
    'finance.remainingAfterExecuteCents': capAfter - baseline - requiredAmount,
  };
  return [
    ...canarySecrets(fx.briefs.customer.hardFields.deadline).map(secret => ({ ...secret, value: amounts[secret.id] ?? secret.value })),
    ...(['customer', 'provider', 'finance'] as const).map(role => ({ id: `${role}.approvalNote`, ownerRole: role, kind: 'string' as const, value: `CANARY-NOTE-${role.toUpperCase()}`, allowedRoles: [], origin: 'brief' as const, provenance: 'seeded' as const })),
  ];
}

/** Reuses the fixture's audited money/date variants and extends encoded text matching. */
function matches(text: string, needle: CanaryNeedle): boolean {
  if (lintFixtureCanaries([needle], [{ label: '', text }]).some(issue => issue.code === 'COLLIDES_WITH_PUBLIC_VALUE')) return true;
  if (needle.kind !== 'string') return false;
  const normalized = normalizeText(text).toLowerCase();
  const value = String(needle.value);
  const variants = [encodeURIComponent(value), btoa(value), [...value].reverse().join('')];
  return variants.some(variant => normalized.includes(variant.toLowerCase()));
}

/** Reports paths only; a failed assertion must never repeat private values. */
export function scanCanaries(payload: unknown, needles: readonly CanaryNeedle[], options: ScanOptions = {}): CanaryHit[] {
  if (!needles.length) throw new Error('Canary needle list must not be empty');
  const hits: CanaryHit[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > (options.maxDepth ?? 64)) throw new Error('Canary payload exceeds maximum depth');
    if (value && typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (!isOpaqueCanaryField(key)) visit(child, `${path}.${key}`, depth + 1);
      }
      seen.delete(value);
      return;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return;
    for (const needle of needles) {
      const grants = options.allowedRoles?.[needle.id] ?? needle.allowedRoles;
      if (options.viewer && (options.viewer === needle.ownerRole || grants.includes(options.viewer as Role))) continue;
      if (matches(String(value), needle)) hits.push({ path, secretId: needle.id });
    }
  };
  visit(payload, '$', 0);
  return hits;
}
export const findCanaries = scanCanaries;
export function assertNoCanaries(payload: unknown, needles: readonly CanaryNeedle[], options: ScanOptions = {}): void {
  const hits = scanCanaries(payload, needles, options);
  if (hits.length) throw new Error(`Canary disclosure at ${hits.map(hit => hit.path).join(', ')}`);
}
export function lintCanaries(needles: readonly CanaryNeedle[], publicTexts: readonly PublicText[]): CanaryLintIssue[] {
  return lintFixtureCanaries(needles, publicTexts).map(issue => ({ ...issue, detail: 'Fixture canary collision or invalid needle' }));
}
