import type { RoomView, MyBriefView, SharedFact } from "@/lib/viewModels/types";

type OwnRequest = Extract<NonNullable<RoomView["openRequest"]>, { mine: true }>;
export type RequestOption = OwnRequest["options"][number];
export type DisclosureOption = Extract<RequestOption, {type: "disclose"}>;
export const missingOptionDetail = "This option needs more detail from the server before you can choose it";

export function hasDisclosure(option: RequestOption): option is DisclosureOption {
  return option.type === "disclose" && !!option.disclose.field &&
    option.disclose.toRoles.length > 0 &&
    option.disclose.toRoles.every(role => ["customer", "provider", "finance"].includes(role));
}

/** The value comes only from briefs.mine, never from request metadata or othersSee. */
export function ownDisclosureValue(option: DisclosureOption, brief: MyBriefView | null | undefined): SharedFact["value"] {
  return ownBriefFieldValue(option.disclose.field, brief);
}

export function ownBriefFieldValue(field: string, brief: MyBriefView | null | undefined): SharedFact["value"] {
  if (!brief?.latest) return null;
  const hard = brief.latest.hardFields;
  const soft = brief.latest.softFields;
  if (brief.role === "customer" && "deadline" in hard) {
    if (field === "deadline") return {kind:"date",date:hard.deadline};
    if (field === "requiredItemKeys") return {kind:"itemKeys",itemKeys:hard.requiredItemKeys};
    if (field === "preferredItemKeys" && "preferredItemKeys" in soft) return {kind:"itemKeys",itemKeys:soft.preferredItemKeys};
  }
  if (brief.role === "finance" && "capCents" in hard) {
    if (field === "capCents") return {kind:"cents",cents:hard.capCents};
    if (brief.finance) {
      if (field === "committedCents") return {kind:"cents",cents:brief.finance.committedCents};
      if (field === "headroomCents") return {kind:"cents",cents:hard.capCents-brief.finance.committedCents};
    }
  }
  return null;
}

export function capAmount(option: RequestOption): number | null {
  if (option.type !== "raise_cap") return null;
  return typeof option.effect.amountCents === "number" && Number.isSafeInteger(option.effect.amountCents) ? option.effect.amountCents : null;
}

export function canAnswerOption(option: RequestOption, brief?: MyBriefView | null): boolean {
  if (!option.answerable) return false;
  switch (option.type) {
    case "disclose": return hasDisclosure(option) && ownDisclosureValue(option, brief) !== null;
    case "pass_to_next": return ["customer", "provider", "finance"].includes(option.toRole);
    case "raise_cap": return capAmount(option) !== null;
    case "drop_items": return brief?.role === "customer" && !!brief.latest && "requiredItemKeys" in brief.latest.hardFields && Array.isArray(option.effect.itemKeys) && option.effect.itemKeys.every(key => typeof key === "string");
    case "extend_deadline": return typeof option.effect.date === "string" && !!option.effect.date;
    case "choose_candidate": case "keep_as_is": case "end_run": case "retry_turn": return true;
    default: return false;
  }
}

/** Build constraints from the declared effect and the viewer’s own brief; no money or date arithmetic. */
export function optionConstraintChange(option: RequestOption, brief?: MyBriefView | null) {
  switch (option.type) {
    case "raise_cap": return capAmount(option) === null ? null : {kind: "cap" as const, newCapCents: option.effect.amountCents};
    case "drop_items": return brief?.role === "customer" && brief.latest && "requiredItemKeys" in brief.latest.hardFields ? {kind: "customer_hard" as const, requiredItemKeys: brief.latest.hardFields.requiredItemKeys.filter(key => !option.effect.itemKeys.includes(key))} : null;
    case "extend_deadline": return {kind: "customer_hard" as const, deadline: option.effect.date};
    default: return null;
  }
}
