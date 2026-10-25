// engine/contract — pure types and helpers shared by engine and scenario plugins.
// Allowed imports: zod only. No convex, no SDK, no react, no clock, no env.
import { z } from "zod";

// ---------- primitives ----------
export type RoleKey = string;          // declared by plugin, e.g. "customer"
export type ItemKey = string;          // unique per room catalog, e.g. "LOGIN"
export type ReasonCode = string;       // UPPER_SNAKE, global namespace (engine + plugin)
export type IsoDate = string;          // "YYYY-MM-DD", real calendar day
export type Cents = number;            // safe integer, >= 0
export type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export const itemKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/);
export const reasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,47}$/);
export const centsSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
// z.iso.date() rejects 2026-02-30 (RA-B10); single source for client + server.
export const isoDateSchema = z.iso.date();

export function assertCents(n: number): asserts n is Cents {
  if (!Number.isSafeInteger(n) || n < 0) throw new PluginContractError("BAD_CENTS");
}
export class PluginContractError extends Error {
  constructor(public readonly code: string) { super(code); }
}

// ---------- catalog ----------
export type CatalogStatus = "draft" | "confirmed" | "withdrawn";
export type CatalogOrigin = "owner" | "agent_suggestion" | "fixture";

/** Engine-owned fields of a catalog item. Scenario-specific data lives in attrs. */
export interface CatalogItemView<A> {
  itemKey: ItemKey;
  revision: number;              // +1 on every confirmed change; refs pin (itemKey, revision)
  status: CatalogStatus;
  title: string;                 // owner free text; becomes visible to all once confirmed
  unitPriceCents: Cents;
  validUntil?: IsoDate;          // optional quote expiry (F06.6)
  attrs: A;                      // validated by plugin.catalog.attrsSchema
  taskTemplates: TaskTemplate[]; // part of approved content (Q10)
  origin: CatalogOrigin;
  simulated: boolean;
}
export interface TaskTemplate { key: string; title: string; assigneeRole: RoleKey; dueOffsetDays?: number }
export interface SourceRef { itemKey: ItemKey; revision: number }

// ---------- briefs ----------
export type FieldHardness = "hard" | "soft" | "info";
export interface BriefFieldSpec {
  label: string;
  hardness: FieldHardness;       // hard -> part of hardConstraintProjection
  shareable: boolean;            // owner MAY choose to disclose; default undisclosed
  help?: string;
}
export interface BriefView<B> {
  role: RoleKey;
  revision: number;
  status: "draft" | "confirmed";
  data: B;                       // validated by role.briefSchema
  sharedFields: string[];        // explicit per-field disclosure (F07.7)
}

// ---------- budget (engine-owned ledger, read-only for plugins) ----------
export interface BudgetView {
  totalCents: Cents;
  committedCents: Cents;         // sum of commitments ledger (F02.3), never stored
}
export interface BudgetCheck {
  ok: boolean;
  reasonCode: "FITS_BUDGET" | "OVER_BUDGET" | "BUDGET_BELOW_COMMITTED";
  headroomCents: number;         // total - committed - amount; buyer-side only
}
/** Engine function. Equal to cap passes (<=). */
export function checkBudget(b: BudgetView, amountCents: Cents): BudgetCheck {
  if (b.totalCents < b.committedCents)
    return { ok: false, reasonCode: "BUDGET_BELOW_COMMITTED", headroomCents: b.totalCents - b.committedCents };
  const headroom = b.totalCents - b.committedCents - amountCents;
  return { ok: headroom >= 0, reasonCode: headroom >= 0 ? "FITS_BUDGET" : "OVER_BUDGET", headroomCents: headroom };
}

// ---------- checks & reason codes ----------
export type DisclosureLevel = "detail" | "summary" | "masked";
export interface Check {
  checkId: string;               // stable id, e.g. "engine.budget", "scope.required_items"
  ok: boolean;
  reasonCode: ReasonCode;
  params: Record<string, JsonValue>;
  ownerRole?: RoleKey;           // whose constraint; drives masking
}
export interface ReasonCodeSpec<P extends z.ZodType = z.ZodType> {
  code: ReasonCode;
  ownerRole?: RoleKey;
  severity: "ok" | "blocking" | "warning";
  paramsSchema: P;
  disclosure: Record<RoleKey, DisclosureLevel>;   // every declared role must appear
  templates: Partial<Record<"detail" | "summary", (p: z.infer<P>, f: Fmt) => string>>;
  tradeoffTargetRole?: RoleKey;  // who can resolve it (customer: defer; finance: raise cap)
}

// ---------- pricing ----------
export interface PriceLine { itemKey: ItemKey; revision: number; quantity: number; unitPriceCents: Cents; lineCents: Cents; label: string }
export interface PriceBreakdown { lines: PriceLine[]; totalCents: Cents }

// ---------- approvals & execution ----------
export type ApprovalKind = "terms" | "budget";
export interface ApproverRequirement { role: RoleKey; kind: ApprovalKind }
export interface ChangeOrderSpec { title: string; lines: PriceLine[]; summaryParams: Record<string, JsonValue> }
export interface TaskSpec { key: string; title: string; assigneeRole: RoleKey; dueDate?: IsoDate; sourceItemKey?: ItemKey }

// ---------- human requests (tradeoffs) ----------
export interface TradeoffOptionSpec {
  optionKey: string;             // stable within one request
  kind: string;                  // plugin-declared, e.g. "defer_item", "raise_cap", "accept_later_date"
  params: Record<string, JsonValue>;
  // which constraint write the answer performs; engine routes to the owner-role mutation path
  effect: { target: "brief"; role: RoleKey; patch: Record<string, JsonValue> }
        | { target: "budget"; newTotalCents: Cents }
        | { target: "catalog_request"; ownerRole: RoleKey; note: string }   // asks owner to confirm cheaper item
        | { target: "choose_candidate"; candidateIndex: number };          // pick one feasible candidate
}
export interface TradeoffRequestSpec {
  targetRole: RoleKey;
  blockingReasonCodes: ReasonCode[];
  questionCode: ReasonCode;      // question text rendered from template, never model text
  options: TradeoffOptionSpec[]; // 1..6
}

// ---------- formatting (passed into templates; the only formatter they may use) ----------
export interface Fmt {
  cents(n: number): string;      // "$4,900" / "$4,900.50", currency from room
  date(d: IsoDate): string;      // UTC render of calendar day
  items(keys: ItemKey[]): string;// "LOGIN + REPORTS"
  role(r: RoleKey): string;      // role label
}

// ---------- stable hashing for constraint projection ----------
/** Canonical JSON: sorted object keys, no undefined, arrays kept in order. */
export function canonicalJson(v: JsonValue): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, JsonValue>)[k])}`).join(",")}}`;
}
// stableHash(v) = sha256(canonicalJson(v)); implementation choice (crypto.subtle vs pure JS)
// is pending verification for the Convex default runtime — see part5 待验证.
