/** Canon roles: one browser context each. Slots are customer, provider, and finance. */
export const ROLE_SLOTS = ["customer", "provider", "finance"] as const;

export type RoleSlot = (typeof ROLE_SLOTS)[number];

export type PerRole<T> = Readonly<Record<RoleSlot, T>>;

export function isRoleSlot(value: string): value is RoleSlot {
  return (ROLE_SLOTS as readonly string[]).includes(value);
}

export function mapRoles<T>(fn: (slot: RoleSlot) => T): PerRole<T> {
  return { customer: fn("customer"), provider: fn("provider"), finance: fn("finance") };
}

export async function mapRolesAsync<T>(fn: (slot: RoleSlot) => Promise<T>): Promise<PerRole<T>> {
  const settled = await Promise.allSettled(ROLE_SLOTS.map((slot) => fn(slot)));
  const failures: Array<{ slot: RoleSlot; reason: unknown }> = [];
  const values: Partial<Record<RoleSlot, T>> = {};
  settled.forEach((result, index) => {
    const slot = ROLE_SLOTS[index] as RoleSlot;
    if (result.status === "fulfilled") values[slot] = result.value;
    else failures.push({ slot, reason: result.reason });
  });
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `role slot(s) failed: ${failures
        .map((failure) => `${failure.slot}: ${failure.reason instanceof Error ? failure.reason.message : String(failure.reason)}`)
        .join("; ")}`,
    );
  }
  return values as PerRole<T>;
}
