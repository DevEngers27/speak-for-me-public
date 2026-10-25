// Canary scanner: finds private values in visible surfaces and decides whether the audience is allowed.
import {
  OPS, ROOM_ROLES,
  type AudienceMember, type Hit, type Role, type ScanReport, type SecretField, type Surface,
} from './types.ts';
import { decodedViews, matchersFor, normalizeText, skeleton, type Matcher } from './variants.ts';

export function expandAudience(a: Surface['audience'], roomRoles: readonly Role[] = ROOM_ROLES): AudienceMember[] {
  if (a === 'room') return [...roomRoles];
  if (a === 'ops') return [OPS];
  return [...a];
}

/** Members of the audience that the secret's disclosure policy does not allow. */
export function unauthorizedFor(secret: SecretField, audience: AudienceMember[]): AudienceMember[] {
  const allowed = new Set<AudienceMember>([secret.ownerRole, ...secret.allowedRoles]);
  return audience.filter((m) => !allowed.has(m));
}

interface Leaf { path: string; text: string }

/** Walk JSON-like content; object keys are scanned too (a secret can hide in a key). */
export function leaves(content: unknown, path = '$', out: Leaf[] = []): Leaf[] {
  if (content === null || content === undefined) return out;
  if (typeof content === 'string') out.push({ path, text: content });
  else if (typeof content === 'number' || typeof content === 'bigint' || typeof content === 'boolean') {
    out.push({ path, text: String(content) });
  } else if (Array.isArray(content)) content.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (typeof content === 'object') {
    for (const [k, v] of Object.entries(content as Record<string, unknown>)) {
      out.push({ path: `${path}.<key:${k}>`, text: k });
      leaves(v, `${path}.${k}`, out);
    }
  }
  return out;
}

function runMatchers(text: string, matchers: Matcher[]): { variant: string; matched: string }[] {
  const norm = normalizeText(text);
  const sk = skeleton(text);
  const found: { variant: string; matched: string }[] = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    const target = m.onSkeleton ? sk : norm;
    const r = m.re.exec(target);
    if (r) found.push({ variant: m.variant, matched: r[0] });
  }
  // keep the most specific: if exact matched, skip skeleton duplicates
  if (found.some((f) => f.variant === 'string:exact-ci')) {
    return found.filter((f) => f.variant !== 'string:skeleton');
  }
  return found;
}

export interface ScanOptions { roomRoles?: readonly Role[]; decode?: boolean }

export function scan(secrets: SecretField[], surfaces: Surface[], opts: ScanOptions = {}): ScanReport {
  const decode = opts.decode ?? true;
  const compiled = secrets.map((s) => ({ secret: s, matchers: matchersFor(s) }));
  const hits: Hit[] = [];
  let scannedLeaves = 0;
  for (const surface of surfaces) {
    const audience = expandAudience(surface.audience, opts.roomRoles);
    for (const leaf of leaves(surface.content)) {
      scannedLeaves++;
      const views = [{ via: undefined as string | undefined, text: leaf.text }];
      if (decode) for (const v of decodedViews(leaf.text)) views.push(v);
      for (const { secret, matchers } of compiled) {
        const seen = new Set<string>();
        for (const view of views) {
          for (const f of runMatchers(view.text, matchers)) {
            const key = f.variant + '|' + (view.via ?? '');
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push({
              secretId: secret.id,
              surfaceId: surface.id,
              surfaceKind: surface.kind,
              path: leaf.path,
              variant: f.variant,
              matched: f.matched,
              ...(view.via ? { decodedVia: view.via } : {}),
              unauthorizedAudience: unauthorizedFor(secret, audience),
            });
          }
        }
      }
    }
  }
  return {
    hits,
    violations: hits.filter((h) => h.unauthorizedAudience.length > 0),
    scannedSurfaces: surfaces.length,
    scannedLeaves,
  };
}

export interface CanaryLintIssue {
  secretId: string;
  code: 'COLLIDES_WITH_PUBLIC_VALUE' | 'LOW_ENTROPY' | 'COLLIDES_WITH_OTHER_SECRET';
  detail: string;
}

/**
 * Fixture hygiene: a canary that also appears in legitimately public text (catalog prices,
 * template output) cannot distinguish leak from disclosure. Run before every canary test.
 */
export function lintCanaries(secrets: SecretField[], publicTexts: { label: string; text: string }[]): CanaryLintIssue[] {
  const issues: CanaryLintIssue[] = [];
  for (const s of secrets) {
    const ms = matchersFor(s);
    for (const p of publicTexts) {
      const f = runMatchers(p.text, ms);
      if (f.length) issues.push({ secretId: s.id, code: 'COLLIDES_WITH_PUBLIC_VALUE', detail: `${p.label}: "${f[0]!.matched}" (${f[0]!.variant})` });
    }
    if (s.kind === 'money' && Number(s.value) % 10000 === 0 && Number(s.value) < 100000) {
      issues.push({ secretId: s.id, code: 'LOW_ENTROPY', detail: `round small amount ${Number(s.value) / 100} dollars matches many unrelated texts` });
    }
    for (const o of secrets) {
      if (o === s || o.kind !== s.kind) continue;
      if (String(o.value) === String(s.value)) issues.push({ secretId: s.id, code: 'COLLIDES_WITH_OTHER_SECRET', detail: o.id });
    }
  }
  return issues;
}

export function formatHit(h: Hit): string {
  const who = h.unauthorizedAudience.length ? `LEAK to [${h.unauthorizedAudience.join(',')}]` : 'allowed';
  return `${who} ${h.secretId} @ ${h.surfaceId} ${h.path} variant=${h.variant}${h.decodedVia ? ' via=' + h.decodedVia : ''} matched="${h.matched}"`;
}
