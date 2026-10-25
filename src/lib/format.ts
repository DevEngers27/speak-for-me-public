import {
  centsToInputString,
  disclosureConsentText,
  formatCents as engineFormatCents,
  formatIsoDate as engineFormatIsoDate,
  isIsoDate,
  parseCents,
  parseIsoDate,
  signedCents,
  type FormatCentsOptions,
} from "@core/engine/ui";
import type { Role } from "@/lib/viewModels/types";

export { centsToInputString, parseCents, parseIsoDate };

/** Integer cents to USD via pure @core/engine/ui. Display only — never used to decide whether a proposal passes. */
export function formatCents(
  cents: number,
  options: FormatCentsOptions = { fraction: "always" },
): string {
  return engineFormatCents(signedCents(Math.trunc(cents)), options);
}

/** Split a YYYY-MM-DD label via pure @core/engine/ui. Never parse it with `new Date`, which can shift the calendar day (FE-D15). */
export function formatIsoDate(iso: string): string {
  if (isIsoDate(iso)) {
    return engineFormatIsoDate(iso, "medium");
  }
  return iso;
}

export function formatRole(role: Role): string {
  if (role === "customer") return "Customer";
  if (role === "provider") return "Provider";
  return "Finance";
}

/** Render only the tagged value already projected by the server. */
export function formatSharedValue(value: import("@/lib/viewModels/types").SharedFact["value"], catalog: VisibleCatalog = []): string {
  if (value === null) return "Not shared";
  switch (value.kind) {
    case "date": return formatIsoDate(value.date);
    case "cents": return formatCents(value.cents);
    case "itemKeys": return formatItemKeys(value.itemKeys, catalog);
    case "enum": return value.value;
  }
}

/** Only labels supplied by the viewer's projected catalog may resolve an item key. */
export type VisibleCatalog = readonly { readonly itemKey: string; readonly title: string }[];
export function formatItemKeys(keys: readonly string[], catalog: VisibleCatalog): string {
  return keys.map(key => catalog.find(item => item.itemKey === key)?.title ?? "Unlisted catalog item").join(", ");
}
export function formatFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    deadline: "Delivery deadline", requiredItemKeys: "Required scope", preferredItemKeys: "Wishlist",
    capCents: "Budget cap", committedCents: "Committed amount", headroomCents: "Remaining headroom", notes: "Private guidance",
  };
  return labels[field] ?? "Shared detail";
}
/** Replace exact known identifiers in existing copy; never look up another role's data. */
export function formatCatalogReferences(text: string, catalog: VisibleCatalog): string {
  const titles = new Map(catalog.map(item => [item.itemKey, item.title]));
  return text.replace(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g, token => titles.get(token) ?? token);
}

export function formatDisclosureConsent(roles: readonly Role[], field: string): string {
  return disclosureConsentText(roles, field).replace(`: ${field}`, `: ${formatFieldLabel(field)}`);
}
