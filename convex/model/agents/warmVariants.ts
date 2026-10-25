// 05 §5.5.3: "动作全开" variants — provider n=1..12, customer n=1..12, finance.
export type WarmVariant = { readonly role: "provider" | "customer" | "finance"; readonly n: number };

export const WARM_SCHEMA_VARIANTS: readonly WarmVariant[] = [
  ...Array.from({ length: 12 }, (_, index): WarmVariant => ({ role: "provider", n: index + 1 })),
  ...Array.from({ length: 12 }, (_, index): WarmVariant => ({ role: "customer", n: index + 1 })),
  { role: "finance", n: 1 },
];

/** Minimal completion budget. Never 0: max_tokens 0 is rejected with output_config.format. */
export const WARM_MAX_TOKENS = 16;
