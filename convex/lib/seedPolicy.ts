/** Finance cannot confirm a cap under the committed baseline (INV-39 / CE-155). Seed must not forge that row. */
export function seedRefusesBelowCommitted(capCents: number, committedCents: number): boolean {
  return Number.isSafeInteger(capCents) && Number.isSafeInteger(committedCents) && capCents < committedCents;
}
