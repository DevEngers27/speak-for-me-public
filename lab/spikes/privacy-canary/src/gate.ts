// Write-time disclosure gate for human-authored text that other parties (or their agents) will see.
import { secretsOf, type Fixture } from './fixture.ts';
import { scan } from './scanner.ts';
import { ROOM_ROLES, type Hit, type Role } from './types.ts';

type GateHit = Pick<Hit, 'secretId' | 'variant' | 'unauthorizedAudience'>;
export type GateResult =
  | { ok: true }
  | { ok: false; code: 'DISCLOSURE_BLOCKED'; hits: GateHit[] } // contains another party's private value
  | { ok: false; code: 'NEEDS_OWN_DISCLOSURE_CONFIRMATION'; hits: GateHit[] }; // only the author's own values

/**
 * A shared fact authored by `author` goes to every other role. Block it when it contains a value the
 * author may know but some recipient may not (e.g. customer pasting finance's cap). The caller shows
 * the secretId list to the author only; error messages carry no values.
 */
export function checkDisclosure(fx: Fixture, author: Role, text: string, confirmOwn = false): GateResult {
  const audience = ROOM_ROLES.filter((r) => r !== author);
  const secrets = secretsOf(fx);
  const report = scan(secrets, [{ id: 'draft.sharedFact', kind: 'agent_context', audience, content: text }]);
  const owner = new Map(secrets.map((s) => [s.id, s.ownerRole]));
  const toHit = (h: Hit): GateHit => ({ secretId: h.secretId, variant: h.variant, unauthorizedAudience: h.unauthorizedAudience });
  const foreign = report.violations.filter((h) => owner.get(h.secretId) !== author);
  if (foreign.length) return { ok: false, code: 'DISCLOSURE_BLOCKED', hits: foreign.map(toHit) };
  if (report.violations.length && !confirmOwn) {
    return { ok: false, code: 'NEEDS_OWN_DISCLOSURE_CONFIRMATION', hits: report.violations.map(toHit) };
  }
  return { ok: true };
}

export function submitSharedFact(fx: Fixture, author: Role, text: string, confirmOwn = false): GateResult {
  const r = checkDisclosure(fx, author, text, confirmOwn);
  if (r.ok) fx.briefs[author].sharedFacts.push(text);
  return r;
}
