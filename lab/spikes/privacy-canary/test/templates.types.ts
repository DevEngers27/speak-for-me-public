// Compile-time proofs, checked by `tsc --noEmit`. Each @ts-expect-error MUST produce an error,
// otherwise tsc fails with "Unused '@ts-expect-error' directive".
import { makeFixture } from '../src/fixture.ts';
import {
  catalogKeys, defineTemplate, isoDate, sumCatalog,
  type CheckedTemplate, type Placeholders, type ProposalSlots,
} from '../src/templates.ts';

const fx = makeFixture();
const keys = catalogKeys(fx.catalog, ['LOGIN']);
const capCents = fx.constraints.capCents; // a plain number from finance's private constraints

// 1. Amount slot only accepts a PublicCents minted by sumCatalog.
const ok: ProposalSlots = { actorRole: 'provider', itemKeys: keys, amountCents: sumCatalog(fx.catalog, keys), deliveryDate: isoDate('2026-11-14'), deferredItemKeys: [] };
void ok;
// @ts-expect-error raw private number cannot become a public amount
const badAmount: ProposalSlots = { ...ok, amountCents: capCents };
// @ts-expect-error free text is not an ItemKey
const badKey: ProposalSlots = { ...ok, itemKeys: ['CANARY-FIN-7731'] };
// @ts-expect-error unvalidated string is not an IsoDate
const badDate: ProposalSlots = { ...ok, deliveryDate: '2026-11-14' };
// @ts-expect-error excess property check on a literal: private field rejected
const extra: ProposalSlots = { actorRole: 'provider', itemKeys: keys, amountCents: sumCatalog(fx.catalog, keys), deliveryDate: isoDate('2026-11-14'), deferredItemKeys: [], capCents };
void badAmount; void badKey; void badDate; void extra;

// 2. Structural typing hole (documented): a NON-literal wider object passes the type check.
//    This is why renderProposalSummary picks fields explicitly and the Proxy test checks reads.
const wider = { ...ok, capCents, canary: 'CANARY-FIN-7731' };
const accepted: ProposalSlots = wider; // compiles: TS cannot forbid extra props here
void accepted;

// 3. Template placeholders must be a subset of the declared formatters.
const F = { actor: 1, items: 1, amount: 1 } as const;
type P = Placeholders<'{actor} proposes {items} for {amount}'>; // "actor" | "items" | "amount"
const p: P = 'amount';
void p;
defineTemplate(F, '{actor} proposes {items} for {amount}');
// @ts-expect-error {capCents} is not an allowlisted slot
defineTemplate(F, '{actor} proposes {items}; cap {capCents}');
type Bad = CheckedTemplate<'cap {floorCents}', typeof F>;
// @ts-expect-error Bad resolves to never
const bad: Bad = 'cap {floorCents}';
void bad;
