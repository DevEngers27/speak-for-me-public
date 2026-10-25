// scenarios/scope-change/index.ts — skeleton used to validate the ScenarioPlugin contract.
// Numbers follow inputs/02 F14.2 option 1 (simulated); final catalog is owned by doc 14.
import { z } from "zod";
import { isoDateSchema, itemKeySchema, centsSchema, type Check, type IsoDate, type ItemKey } from "../contract";
import type { ScenarioPlugin, EvalContext } from "../plugin";

// ---- catalog attrs (provider supply only; priority lives in customer brief, F02.1 note) ----
const attrs = z.strictObject({
  leadTimeDays: z.number().int().min(0).max(365),
  // confirmed conditional term, e.g. rush fee charged when delivery <= customer's preferredDate
  rushFee: z.strictObject({ feeCents: centsSchema, leadTimeDays: z.number().int().min(0) }).optional(),
});
type Attrs = z.infer<typeof attrs>;

// ---- briefs ----
const customerBrief = z.strictObject({
  requiredItemKeys: z.array(itemKeySchema).min(1),
  deferrableItemKeys: z.array(itemKeySchema),
  deadline: isoDateSchema,          // hard
  preferredDate: isoDateSchema,     // soft
  goal: z.string().max(500),        // info, never in projection (Q12: not a constraint)
});
const providerBrief = z.strictObject({
  capacityNote: z.string().max(500),   // info; private
  minNoticeDays: z.number().int().min(0),  // hard: earliest start
});
const financeBrief = z.strictObject({
  note: z.string().max(500),           // info; budget numbers live in budgets table
});
type Briefs = { customer: z.infer<typeof customerBrief>; provider: z.infer<typeof providerBrief>; finance: z.infer<typeof financeBrief> };

// ---- constraints ----
interface Constraints {
  missingBriefs: string[];
  required: ItemKey[]; deferrable: ItemKey[];
  deadline: IsoDate | null; preferredDate: IsoDate | null;
  minNoticeDays: number | null;      // raw hard value; date math against today happens in validateProposal
}

// ---- model draft & terms ----
const draft = z.strictObject({
  itemKeys: z.array(z.string()).min(1).max(12),
  deferredItemKeys: z.array(z.string()).max(12),
  deliveryDate: z.iso.date(),
  useRush: z.boolean(),
});
type Draft = z.infer<typeof draft>;
interface Terms { itemKeys: ItemKey[]; deferredItemKeys: ItemKey[]; deliveryDate: IsoDate; rushItemKeys: ItemKey[] }

declare function addDays(d: IsoDate, n: number): IsoDate;       // engine/contract date helper
const sorted = (xs: string[]) => [...new Set(xs)].sort();

export const scopeChange: ScenarioPlugin<Attrs, Briefs, Constraints, Draft, Terms> = {
  key: "scope_change", version: 1, supportedVersions: [1], label: "Software service scope change", currency: "USD",

  roles: {
    customer: { label: "Customer", side: "buyer", seats: 1, agent: "llm", briefSchema: customerBrief,
      briefFields: {
        requiredItemKeys: { label: "Required items", hardness: "hard", shareable: true },
        deferrableItemKeys: { label: "Can be deferred", hardness: "hard", shareable: true },
        deadline: { label: "Hard deadline", hardness: "hard", shareable: true },
        preferredDate: { label: "Preferred date", hardness: "soft", shareable: true },
        goal: { label: "Goal", hardness: "info", shareable: true },
      } },
    provider: { label: "Service provider", side: "seller", seats: 1, agent: "llm", briefSchema: providerBrief,
      briefFields: {
        capacityNote: { label: "Capacity note", hardness: "info", shareable: false },
        minNoticeDays: { label: "Minimum notice (days)", hardness: "hard", shareable: true },
      } },
    finance: { label: "Finance", side: "buyer", seats: 1, agent: "rule", briefSchema: financeBrief,
      briefFields: { note: { label: "Note", hardness: "info", shareable: false } } },
  },

  catalog: { ownerRole: "provider", attrsSchema: attrs, allowAgentSuggestions: true, maxItems: 12 },
  budget: { enabled: true, ownerRole: "finance", numbersVisibleTo: ["finance", "customer"] },

  deriveConstraints({ briefs }) {
    const c = briefs.customer?.data, p = briefs.provider?.data;
    return {
      missingBriefs: (["customer", "provider", "finance"] as const).filter((r) => !briefs[r]),
      required: sorted(c?.requiredItemKeys ?? []), deferrable: sorted(c?.deferrableItemKeys ?? []),
      deadline: c?.deadline ?? null, preferredDate: c?.preferredDate ?? null,
      minNoticeDays: p?.minNoticeDays ?? null,
    };
  },
  // preferredDate is soft -> excluded. Never project values derived from today (part4 boundary B3).
  hardConstraintProjection: (c) => ({ required: c.required, deferrable: c.deferrable, deadline: c.deadline,
                                      minNoticeDays: c.minNoticeDays, missing: c.missingBriefs }),

  draftTermsSchema: draft,
  buildTerms(d, ctx) {
    const itemKeys = sorted(d.itemKeys), deferred = sorted(d.deferredItemKeys);
    const unknown = [...itemKeys, ...deferred].filter((k) => !ctx.catalog.has(k));
    if (unknown.length) return { ok: false, checks: [fail("scope.items", "UNKNOWN_ITEM", { itemKeys: unknown }, "provider")] };
    if (itemKeys.some((k) => deferred.includes(k)))
      return { ok: false, checks: [fail("scope.items", "ITEM_BOTH_INCLUDED_AND_DEFERRED", {}, undefined)] };
    const rushItemKeys = d.useRush ? itemKeys.filter((k) => ctx.catalog.get(k)!.attrs.rushFee) : [];
    return { ok: true, terms: { itemKeys, deferredItemKeys: deferred, deliveryDate: d.deliveryDate, rushItemKeys } };
  },
  sourceItemKeys: (t) => t.itemKeys,
  priceTerms(t, ctx) {
    const lines = t.itemKeys.map((k) => { const it = ctx.catalog.get(k)!;
      return { itemKey: k, revision: it.revision, quantity: 1, unitPriceCents: it.unitPriceCents, lineCents: it.unitPriceCents, label: it.title }; });
    for (const k of t.rushItemKeys) { const it = ctx.catalog.get(k)!, fee = it.attrs.rushFee!.feeCents;
      lines.push({ itemKey: k, revision: it.revision, quantity: 1, unitPriceCents: fee, lineCents: fee, label: `Rush: ${it.title}` }); }
    return { lines, totalCents: lines.reduce((s, l) => s + l.lineCents, 0) };
  },

  validateProposal(t, _price, ctx) {
    const c = ctx.constraints, out: Check[] = [];
    const missing = c.required.filter((k) => !t.itemKeys.includes(k));
    out.push(check("scope.required_items", missing.length === 0, "MISSING_REQUIRED_ITEM", { itemKeys: missing }, "customer"));
    const badDefer = t.deferredItemKeys.filter((k) => !c.deferrable.includes(k));
    out.push(check("scope.deferrable", badDefer.length === 0, "DEFERRED_NOT_ALLOWED", { itemKeys: badDefer }, "customer"));
    out.push(check("scope.not_past", t.deliveryDate >= ctx.today, "DATE_IN_PAST", { deliveryDate: t.deliveryDate }));
    out.push(check("scope.deadline", c.deadline !== null && t.deliveryDate <= c.deadline, "DATE_AFTER_DEADLINE",
                   { deliveryDate: t.deliveryDate }, "customer"));       // masked for provider unless shared
    const earliest = earliestDelivery(t, ctx);
    out.push(check("scope.lead_time", t.deliveryDate >= earliest, "DATE_BEFORE_LEAD_TIME", { earliest }, "provider"));
    return out;
  },
  enumerateFeasible(ctx, limits) { return enumerateSubsets(ctx, limits); },   // 2^n over non-required items, n <= 12
  pickStub: (cands) => cands[0] ?? null,                                      // candidates pre-sorted: most should-items, then cheapest

  buildTradeoffRequests({ ctx, enumeration, trigger }) {
    if (trigger === "below_committed")
      return [{ targetRole: "finance", blockingReasonCodes: ["BUDGET_BELOW_COMMITTED"], questionCode: "Q_RAISE_CAP",
                options: [{ optionKey: "raise", kind: "raise_cap", params: {}, effect: { target: "budget", newTotalCents: ctx.budget!.committedCents } }] }];
    if (enumeration.candidates.length >= 2)   // e.g. A+B standard vs A+R on time -> customer picks
      return [{ targetRole: "customer", blockingReasonCodes: ["NEEDS_TRADEOFF"], questionCode: "Q_PICK_CANDIDATE",
                options: enumeration.candidates.slice(0, 3).map((_, i) => ({ optionKey: `c${i}`, kind: "choose_candidate", params: {}, effect: { target: "choose_candidate", candidateIndex: i } })) }];
    return [
      { targetRole: "finance", blockingReasonCodes: enumeration.blockersSeen, questionCode: "Q_NO_FEASIBLE_FINANCE",
        options: [{ optionKey: "raise", kind: "raise_cap", params: { minHeadroomCents: minFeasibleAmount(ctx) },
                    effect: { target: "budget", newTotalCents: ctx.budget!.committedCents + minFeasibleAmount(ctx) } }] },
      { targetRole: "provider", blockingReasonCodes: enumeration.blockersSeen, questionCode: "Q_CHEAPER_ITEM",
        options: [{ optionKey: "cheaper", kind: "confirm_cheaper_item", params: {}, effect: { target: "catalog_request", ownerRole: "provider", note: "cheaper_required_item" } }] },
    ];
  },
  checkTradeoffAnswer: () => ({ ok: true }),

  requiredApprovers: () => [{ role: "customer", kind: "terms" }, { role: "provider", kind: "terms" }, { role: "finance", kind: "budget" }],
  deriveExecution(t, price, ctx) {
    const tasks = t.itemKeys.flatMap((k) => ctx.catalog.get(k)!.taskTemplates.map((tt) => ({
      key: `${k}:${tt.key}`, title: tt.title, assigneeRole: tt.assigneeRole, sourceItemKey: k,
      dueDate: tt.dueOffsetDays === undefined ? t.deliveryDate : addDays(ctx.executedOn, tt.dueOffsetDays) })));
    return { changeOrder: { title: `Scope change: ${t.itemKeys.join(" + ")}`, lines: price.lines,
                            summaryParams: { deliveryDate: t.deliveryDate, deferred: t.deferredItemKeys } }, tasks };
  },

  reasonCodes: [/* MISSING_REQUIRED_ITEM, DEFERRED_NOT_ALLOWED, DATE_IN_PAST, DATE_AFTER_DEADLINE (provider: masked),
                   DATE_BEFORE_LEAD_TIME, ITEM_BOTH_INCLUDED_AND_DEFERRED, NEEDS_TRADEOFF, Q_* question codes */],
  templates: {
    proposalSummary: (t, p, _aud, f) => `Provider proposes ${f.items(t.itemKeys)} for ${f.cents(p.totalCents)}, delivery ${f.date(t.deliveryDate)}`
      + (t.deferredItemKeys.length ? `; ${f.items(t.deferredItemKeys)} deferred.` : "."),
    sharedFact: (role, field, value, f) => `${f.role(role)} shared ${field}: ${String(value)}`,
    tradeoffOption: (o) => o.kind,
    changeOrderTitle: (t, f) => `Scope change: ${f.items(t.itemKeys)}`,
  },
  agentInstructions: { customer: "Protect required items and the hard deadline.", provider: "Propose only confirmed catalog items." },
  fixtures: { demo: undefined as never /* see scope-change fixture in part4 §4.1 */ },
  runtime: { maxRounds: 3, timeZoneDefault: "America/Los_Angeles" },
};

// helpers (bodies omitted in skeleton)
declare function check(id: string, ok: boolean, code: string, params: Record<string, unknown>, owner?: string): Check;
declare function fail(id: string, code: string, params: Record<string, unknown>, owner?: string): Check;
declare function earliestDelivery(t: Terms, ctx: EvalContext<Attrs, Constraints>): IsoDate;
declare function enumerateSubsets(ctx: EvalContext<Attrs, Constraints>, l: { maxCandidates: number; maxEvaluations: number }): { candidates: Terms[]; exhaustive: boolean; blockersSeen: string[] };
declare function minFeasibleAmount(ctx: EvalContext<Attrs, Constraints>): number;
