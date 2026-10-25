import { REDACTABLE_FIELDS } from "@core/engine";

export { REDACTABLE_FIELDS };

export const REDACTED = "[redacted]";

export const TERMS_KEY_FIELDS = [
  "proposals.terms.itemKeys",
  "proposals.terms.modifiers",
  "proposals.terms.deliveryDate",
  "proposals.terms.amountCents",
] as const;

type Flat<T> = { [K in keyof T]: T[K] extends readonly string[] ? `${K & string}.${T[K][number]}` : never }[keyof T];
type Redactable = Flat<typeof REDACTABLE_FIELDS>;
type TermsKeyField = (typeof TERMS_KEY_FIELDS)[number];
const _disjoint: [Extract<Redactable, TermsKeyField>] extends [never] ? true : never = true;
export const REDACTABLE_DISJOINT: true = _disjoint;

export const REDACTABLE_TABLES = ["users", "members", "invites", "rooms", "briefs", "approvals"] as const;
export type RedactableTable = (typeof REDACTABLE_TABLES)[number];

export function redactableField(table: string, field: string): boolean {
  if (!Object.hasOwn(REDACTABLE_FIELDS, table)) return false;
  const fields: readonly string[] = REDACTABLE_FIELDS[table as keyof typeof REDACTABLE_FIELDS];
  return fields.includes(field);
}
