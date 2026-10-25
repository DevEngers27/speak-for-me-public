// scenarios/event-budget/index.ts — second skeleton, deliberately different in shape:
// per-head pricing (quantity from constraints), exclusive groups, fixed event date (no date
// dimension to negotiate), conditional finance approval above a finance-set limit.
import { z } from "zod";
import { centsSchema, isoDateSchema, type Check, type IsoDate, type ItemKey, type PriceLine } from "../contract";
import type { ScenarioPlugin, EvalContext } from "../plugin";

const attrs = z.strictObject({
  category: z.enum(["venue", "catering", "av", "photo"]),
  pricing: z.enum(["fixed", "per_attendee"]),
  exclusiveGroup: z.string().optional(),        // at most one item per group (e.g. one venue)
  capacity: z.number().int().positive().optional(),
});
type Attrs = z.infer<typeof attrs>;

const hostBrief = z.strictObject({
  eventDate: isoDateSchema,                     // hard, fixed — not negotiated
  headcount: z.number().int().min(1).max(5000), // hard; drives per-attendee quantity
  mustHaveCategories: z.array(z.enum(["venue", "catering", "av", "photo"])).min(1),  // hard
  niceToHaveCategories: z.array(z.enum(["venue", "catering", "av", "photo"])),       // soft
});
const plannerBrief = z.strictObject({ bookingCutoffDays: z.number().int().min(0) });   // hard
const financeBrief = z.strictObject({
  // finance delegates: below this amount the budget approval is still required (engine guard),
  // above it a second finance approver is NOT possible in v1 (seats: 1) -> see part4 §4.2 tradeoff.
  hostSelfApproveLimitCents: centsSchema,        // hard; changes required approvers
});
type Briefs = { host: z.infer<typeof hostBrief>; planner: z.infer<typeof plannerBrief>; finance: z.infer<typeof financeBrief> };

interface Constraints {
  missingBriefs: string[];
  eventDate: IsoDate | null; headcount: number | null;
  mustHave: string[]; niceToHave: string[];
  bookingCutoffDays: number | null; hostSelfApproveLimitCents: number | null;
}

// The model only picks items. Quantity is NOT a model field: it is copied from constraints
// into terms at buildTerms time, so terms stay immutable when headcount later changes.
const draft = z.strictObject({ itemKeys: z.array(z.string()).min(1).max(12) });
type Draft = z.infer<typeof draft>;
interface Terms { itemKeys: ItemKey[]; headcount: number; eventDate: IsoDate }

const sorted = (xs: string[]) => [...new Set(xs)].sort();
declare function daysBetween(a: IsoDate, b: IsoDate): number;

export const eventBudget: ScenarioPlugin<Attrs, Briefs, Constraints, Draft, Terms> = {
  key: "event_budget", version: 1, supportedVersions: [1], label: "Event budget", currency: "USD",
  roles: {
    host: { label: "Host team", side: "buyer", seats: 1, agent: "llm", briefSchema: hostBrief,
      briefFields: {
        eventDate: { label: "Event date", hardness: "hard", shareable: true },
        headcount: { label: "Headcount", hardness: "hard", shareable: true },
        mustHaveCategories: { label: "Must have", hardness: "hard", shareable: true },
        niceToHaveCategories: { label: "Nice to have", hardness: "soft", shareable: true },
      } },
    planner: { label: "Event planner", side: "seller", seats: 1, agent: "llm", briefSchema: plannerBrief,
      briefFields: { bookingCutoffDays: { label: "Booking cutoff (days before event)", hardness: "hard", shareable: true } } },
    finance: { label: "Finance", side: "buyer", seats: 1, agent: "rule", briefSchema: financeBrief,
      briefFields: { hostSelfApproveLimitCents: { label: "Host approval limit", hardness: "hard", shareable: false } } },
  },
  catalog: { ownerRole: "planner", attrsSchema: attrs, allowAgentSuggestions: false, maxItems: 12 },
  budget: { enabled: true, ownerRole: "finance", numbersVisibleTo: ["finance", "host"] },

  deriveConstraints({ briefs }) {
    const h = briefs.host?.data, p = briefs.planner?.data, f = briefs.finance?.data;
    return { missingBriefs: (["host", "planner", "finance"] as const).filter((r) => !briefs[r]),
      eventDate: h?.eventDate ?? null, headcount: h?.headcount ?? null,
      mustHave: sorted(h?.mustHaveCategories ?? []), niceToHave: sorted(h?.niceToHaveCategories ?? []),
      bookingCutoffDays: p?.bookingCutoffDays ?? null, hostSelfApproveLimitCents: f?.hostSelfApproveLimitCents ?? null };
  },
  hardConstraintProjection: (c) => ({ eventDate: c.eventDate, headcount: c.headcount, mustHave: c.mustHave,
    bookingCutoffDays: c.bookingCutoffDays, limit: c.hostSelfApproveLimitCents, missing: c.missingBriefs }),

  draftTermsSchema: draft,
  buildTerms(d, ctx) {
    const itemKeys = sorted(d.itemKeys), c = ctx.constraints;
    const unknown = itemKeys.filter((k) => !ctx.catalog.has(k));
    if (unknown.length) return { ok: false, checks: [mk("event.items", false, "UNKNOWN_ITEM", { itemKeys: unknown }, "planner")] };
    if (c.headcount === null || c.eventDate === null)
      return { ok: false, checks: [mk("event.brief", false, "BRIEF_MISSING", {}, "host")] };
    return { ok: true, terms: { itemKeys, headcount: c.headcount, eventDate: c.eventDate } };
  },
  sourceItemKeys: (t) => t.itemKeys,
  priceTerms(t, ctx) {
    const lines: PriceLine[] = t.itemKeys.map((k) => { const it = ctx.catalog.get(k)!;
      const quantity = it.attrs.pricing === "per_attendee" ? t.headcount : 1;   // quantity from TERMS, not constraints
      return { itemKey: k, revision: it.revision, quantity, unitPriceCents: it.unitPriceCents,
               lineCents: quantity * it.unitPriceCents, label: it.title }; });
    return { lines, totalCents: lines.reduce((s, l) => s + l.lineCents, 0) };      // engine asserts safe integer
  },
  validateProposal(t, _p, ctx) {
    const c = ctx.constraints, out: Check[] = [];
    const cats = new Set(t.itemKeys.map((k) => ctx.catalog.get(k)!.attrs.category));
    const missing = c.mustHave.filter((m) => !cats.has(m as Attrs["category"]));
    out.push(mk("event.must_have", missing.length === 0, "MISSING_REQUIRED_CATEGORY", { categories: missing }, "host"));
    const groups = new Map<string, number>();
    for (const k of t.itemKeys) { const g = ctx.catalog.get(k)!.attrs.exclusiveGroup; if (g) groups.set(g, (groups.get(g) ?? 0) + 1); }
    out.push(mk("event.exclusive", [...groups.values()].every((n) => n <= 1), "EXCLUSIVE_GROUP_CONFLICT", {}, "planner"));
    // stale quantity: terms snapshot vs current constraint (headcount changed after proposal)
    out.push(mk("event.headcount", t.headcount === c.headcount, "QUANTITY_STALE", { proposed: t.headcount }, "host"));
    const venueCap = t.itemKeys.map((k) => ctx.catalog.get(k)!.attrs.capacity).find((x) => x !== undefined);
    out.push(mk("event.capacity", venueCap === undefined || venueCap >= t.headcount, "CAPACITY_EXCEEDED", { capacity: venueCap ?? null }, "planner"));
    const cutoffOk = c.bookingCutoffDays === null || daysBetween(ctx.today, t.eventDate) >= c.bookingCutoffDays;
    out.push(mk("event.cutoff", cutoffOk, "PAST_BOOKING_CUTOFF", {}, "planner"));
    return out;
  },
  enumerateFeasible: (ctx, limits) => enumerateWithGroups(ctx, limits),  // pick <=1 per group x optional items
  pickStub: (c) => c[0] ?? null,
  buildTradeoffRequests: ({ ctx }) => [{ targetRole: "host", blockingReasonCodes: ["NEEDS_TRADEOFF"], questionCode: "Q_REDUCE_HEADCOUNT",
    options: [{ optionKey: "hc", kind: "reduce_headcount", params: { maxHeadcount: maxAffordableHeadcount(ctx) },
                effect: { target: "brief", role: "host", patch: { headcount: maxAffordableHeadcount(ctx) } } }] }],
  checkTradeoffAnswer: () => ({ ok: true }),

  // Conditional rule: finance must always sign the budget (engine guard 3 forbids dropping it when
  // amount > 0). What varies is whether the host's terms approval is enough on the buyer side:
  // above the limit, finance ALSO signs terms. Shows that conditional approvers fit the contract.
  requiredApprovers(_t, price, c) {
    const base = [{ role: "host", kind: "terms" as const }, { role: "planner", kind: "terms" as const },
                  { role: "finance", kind: "budget" as const }];
    return c.hostSelfApproveLimitCents !== null && price.totalCents > c.hostSelfApproveLimitCents
      ? [...base, { role: "finance", kind: "terms" as const }] : base;
  },
  deriveExecution: (t, price) => ({ changeOrder: { title: `Event booking: ${t.itemKeys.join(" + ")}`, lines: price.lines,
    summaryParams: { eventDate: t.eventDate, headcount: t.headcount } },
    tasks: t.itemKeys.map((k) => ({ key: `book:${k}`, title: `Book ${k}`, assigneeRole: "planner", dueDate: t.eventDate, sourceItemKey: k })) }),

  reasonCodes: [/* MISSING_REQUIRED_CATEGORY, EXCLUSIVE_GROUP_CONFLICT, QUANTITY_STALE, CAPACITY_EXCEEDED, PAST_BOOKING_CUTOFF, Q_REDUCE_HEADCOUNT */],
  templates: {
    proposalSummary: (t, p, _a, f) => `Planner proposes ${f.items(t.itemKeys)} for ${t.headcount} guests, ${f.cents(p.totalCents)}, on ${f.date(t.eventDate)}.`,
    sharedFact: (r, field, v, f) => `${f.role(r)} shared ${field}: ${String(v)}`,
    tradeoffOption: (o) => o.kind,
    changeOrderTitle: (t, f) => `Event booking: ${f.items(t.itemKeys)}`,
  },
  agentInstructions: {},
  fixtures: {},
  runtime: { maxRounds: 2, timeZoneDefault: "America/Los_Angeles" },
};

declare function mk(id: string, ok: boolean, code: string, params: Record<string, unknown>, owner?: string): Check;
declare function enumerateWithGroups(ctx: EvalContext<Attrs, Constraints>, l: { maxCandidates: number; maxEvaluations: number }): { candidates: Terms[]; exhaustive: boolean; blockersSeen: string[] };
declare function maxAffordableHeadcount(ctx: EvalContext<Attrs, Constraints>): number;
