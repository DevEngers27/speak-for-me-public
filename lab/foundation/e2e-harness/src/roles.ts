/**
 * Role slots are positional and scenario-agnostic. The engine maps its own
 * scenario roles (whatever the design settles on) onto slots A/B/C; the
 * harness never knows business role names.
 */
export const ROLE_SLOTS = ["A", "B", "C"] as const;

export type RoleSlot = (typeof ROLE_SLOTS)[number];

/** A value for every role slot. */
export type PerRole<T> = Readonly<Record<RoleSlot, T>>;

export function isRoleSlot(value: string): value is RoleSlot {
  return (ROLE_SLOTS as readonly string[]).includes(value);
}

/** Build a PerRole value synchronously. */
export function mapRoles<T>(fn: (slot: RoleSlot) => T): PerRole<T> {
  return { A: fn("A"), B: fn("B"), C: fn("C") };
}

/**
 * Build a PerRole value by running `fn` for all slots concurrently.
 * If any slot rejects, the returned promise rejects with an AggregateError
 * naming every failed slot (so one role failing does not hide another).
 * All slots are always awaited, so no work is left dangling.
 */
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
      failures.map((f) => f.reason),
      `role slot(s) failed: ${failures
        .map((f) => `${f.slot}: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`)
        .join("; ")}`,
    );
  }
  return values as PerRole<T>;
}
