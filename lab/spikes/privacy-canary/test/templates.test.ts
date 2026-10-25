import { describe, expect, it } from 'vitest';
import { makeFixture, secretsOf } from '../src/fixture.ts';
import { scan } from '../src/scanner.ts';
import {
  CONSTRAINTS_CHANGED, catalogKeys, isoDate, leakyRoleAConstraintsChanged, renderConstraintsChanged,
  renderProposalSummary, sumCatalog, TemplateInputError, type ConstraintsChangedPayload, type ProposalSlots,
} from '../src/templates.ts';
import { ROOM_ROLES, type SecretField } from '../src/types.ts';

const fx = makeFixture();
const keys = catalogKeys(fx.catalog, ['LOGIN', 'REPORTS']);
const slots: ProposalSlots = {
  actorRole: 'provider', itemKeys: keys, amountCents: sumCatalog(fx.catalog, keys),
  deliveryDate: isoDate('2026-11-14'), deferredItemKeys: catalogKeys(fx.catalog, ['EXPORT']),
};

/** Records every property read on the object (deeply for nested objects/arrays). */
function tracked<T extends object>(obj: T, log: string[], prefix = ''): T {
  return new Proxy(obj, {
    get(t, p, r) {
      if (typeof p === 'string') log.push(prefix + p);
      const v = Reflect.get(t, p, r);
      return v && typeof v === 'object' ? tracked(v as object, log, `${prefix}${String(p)}.`) : v;
    },
  });
}

describe('proposal summary template', () => {
  it('renders the reference sentence exactly', () => {
    const s = renderProposalSummary(slots, fx.catalog);
    console.log('rendered:', s);
    expect(s).toBe('Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred.');
  });

  it('reads only allowlisted slots even when handed an object full of secrets', () => {
    const wide = { ...slots, capCents: 480000, canary: 'CANARY-FIN-7731', floorCents: 81700, rationale: 'cap is $4,800', publicSummary: 'CANARY-FIN-7731' };
    const log: string[] = [];
    const out = renderProposalSummary(tracked(wide, log) as ProposalSlots, fx.catalog);
    const top = [...new Set(log.filter((k) => !k.includes('.')))].sort();
    console.log('top-level keys read:', top.join(','));
    expect(top).toEqual(['actorRole', 'amountCents', 'deferredItemKeys', 'deliveryDate', 'itemKeys']);
    expect(scan(secretsOf(fx), [{ id: 'sum', kind: 'proposal_public_summary', audience: 'room', content: out }]).violations).toEqual([]);
  });

  it('rejects free text smuggled through typed slots at runtime', () => {
    const bad = (patch: Record<string, unknown>) => () => renderProposalSummary({ ...slots, ...patch } as unknown as ProposalSlots, fx.catalog);
    expect(bad({ itemKeys: ['CANARY-FIN-7731'] })).toThrow(TemplateInputError);
    expect(bad({ itemKeys: ['LOGIN', 'CAP_480000'] })).toThrow('UNKNOWN_ITEM');
    expect(bad({ itemKeys: ['AUDIT'] })).toThrow('UNKNOWN_ITEM'); // unconfirmed catalog item
    expect(bad({ deliveryDate: 'cap is 4800' })).toThrow('INVALID_DATE');
    expect(bad({ deliveryDate: '2026-02-30' })).toThrow('INVALID_DATE');
    expect(bad({ amountCents: 480000 })).toThrow('INVALID_AMOUNT'); // not the catalog sum
    expect(bad({ actorRole: 'CANARY-FIN-7731' })).toThrow('INVALID_ROLE');
  });

  it('fuzz: 500 random fixtures with random secrets attached never leak through the template', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const allKeys = ['LOGIN', 'REPORTS', 'EXPORT'];
    let rendered = 0;
    for (let i = 0; i < 500; i++) {
      const capCents = 100000 + Math.floor(rnd() * 900000) * 100 + 13; // odd cents -> never equals a catalog sum
      const canary = `CANARY-FIN-${Math.floor(rnd() * 1e6)}`;
      const secrets: SecretField[] = [
        { id: 'cap', ownerRole: 'finance', kind: 'money', value: capCents, allowedRoles: [], origin: 'constraint' },
        { id: 'canary', ownerRole: 'finance', kind: 'string', value: canary, allowedRoles: [], origin: 'brief' },
      ];
      const pick = allKeys.filter(() => rnd() > 0.4);
      if (!pick.length) continue;
      const ks = catalogKeys(fx.catalog, pick);
      const rest = catalogKeys(fx.catalog, allKeys.filter((k) => !pick.includes(k)));
      const wide = { actorRole: 'provider' as const, itemKeys: ks, amountCents: sumCatalog(fx.catalog, ks), deliveryDate: isoDate('2026-11-14'), deferredItemKeys: rest, capCents, canary, note: `cap ${capCents} ${canary}` };
      const out = renderProposalSummary(wide, fx.catalog);
      rendered++;
      expect(scan(secrets, [{ id: 'x', kind: 'proposal_public_summary', audience: 'room', content: out }]).violations).toEqual([]);
    }
    console.log('fuzz rendered', rendered, 'summaries with 0 leaks');
  });
});

describe('per-audience constraints_changed templates', () => {
  const payload: ConstraintsChangedPayload = { fromCapCents: 500000, toCapCents: 480000, committedCents: 400000, constraintsVersion: 2, blockedProposalVersion: 3, blockedAmountCents: 90000 };

  it('renders three audiences', () => {
    for (const r of ROOM_ROLES) console.log(`${r}: ${renderConstraintsChanged(payload, r, true)}`);
    expect(renderConstraintsChanged(payload, 'provider', true)).toBe('Finance constraint changed (v2); proposal v3 blocked');
    expect(renderConstraintsChanged(payload, 'customer', true)).toBe('+$900 change / $4,900 committed after approval / $4,800 cap / over by $100');
    expect(renderConstraintsChanged(payload, 'customer', false)).toBe('Finance constraint changed (v2); proposal v3 blocked');
  });

  it('each template reads only the payload fields it declares', () => {
    for (const t of Object.values(CONSTRAINTS_CHANGED)) {
      const log: string[] = [];
      t.render(tracked(payload, log));
      expect([...new Set(log)].sort()).toEqual([...t.reads].sort());
    }
  });

  it('scanner: correct templates have 0 violations; Role-A leaky template is caught', () => {
    const secrets = secretsOf(fx);
    const good = ROOM_ROLES.map((r) => ({ id: `ev:${r}`, kind: 'event_rendered' as const, audience: [r], content: renderConstraintsChanged(payload, r, true) }));
    expect(scan(secrets, good).violations).toEqual([]);
    const leaky = scan(secrets, [{ id: 'ev:roleA', kind: 'event_rendered', audience: 'room', content: leakyRoleAConstraintsChanged(payload) }]);
    console.log('Role-A leaky template violations:', leaky.violations.map((v) => `${v.secretId}(${v.variant}) -> ${v.unauthorizedAudience}`).join('; '));
    expect(leaky.violations.map((v) => v.secretId)).toEqual(expect.arrayContaining(['finance.capCents.v2', 'finance.capCents.v1']));
  });
});
