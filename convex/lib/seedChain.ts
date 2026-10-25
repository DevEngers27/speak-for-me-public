/** Seed orchestration has no raw writes: all domain changes use production cores. */
import { canarySecrets, fixtureForVariant, lintCanaries, materializeFixture, publicMoneyText, isoDate, type ScopeChangeFixture } from '@core/scenarios/scope-change/fixtures';
import type { Id, Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createCore as createRoomCore } from '../model/rooms';
import { createCore as createInviteCore, acceptCore as acceptInviteCore } from '../model/invites';
import { recordBaselineCore } from '../model/ledger';
import { confirmCore as confirmCatalogCore } from '../model/catalog';
import { confirmCore as confirmBriefCore } from '../model/briefs';
import { upsertFixtureActors } from '../model/users';
import { appError } from './errors';
import { loadScopeChangeFixture } from './scopeChangeFixture';
import { seedRefusesBelowCommitted } from './seedPolicy';
import { assertTier } from './config';
const ROLES = ['customer', 'provider', 'finance'] as const;
type SeedRole = typeof ROLES[number];
export type SeedArgs = { fixtureKey?: string; stopBeforeRole?: SeedRole | null };
function loadSeed(fixtureKey: string | undefined): ScopeChangeFixture {
  const key = fixtureKey ?? "main";
  if (key === "below_committed") {
    throw appError("budget.below_committed", { belowByCents: 10_000, minAllowedCapCents: 400_000 });
  }
  if (key !== "main" && key !== "canary") throw appError("input.invalid", { field: "fixtureKey" });
  const seed = fixtureForVariant(key);
  loadScopeChangeFixture(seed);
  const materialized = materializeFixture(seed, seed.goldenAnchor);
  const secrets = canarySecrets(materialized.briefs.customer.hardFields.deadline);
  // Coverage: catalog keys, titles and individual catalog prices only.
  // Does not yet cover subset sums, cap differences or public dates.
  const publicTexts = seed.catalog.map((row) => ({
    label: `catalog.${row.itemKey}`,
    text: `${row.itemKey} ${row.title} ${publicMoneyText(row.priceCents)}`,
  }));
  if (lintCanaries(secrets, publicTexts).length > 0) throw appError("input.invalid", { field: "canaries" });
  if (seedRefusesBelowCommitted(seed.briefs.finance.hardFields.capCents, seed.ledgerBaseline.amountCents)) {
    throw appError("budget.below_committed", {
      belowByCents: seed.ledgerBaseline.amountCents - seed.briefs.finance.hardFields.capCents,
      minAllowedCapCents: seed.ledgerBaseline.amountCents,
    });
  }
  return seed;
}


export async function runSeedChain(ctx: MutationCtx, args: SeedArgs, env: Record<string, string | undefined> = process.env): Promise<{ roomId: Id<'rooms'> }> {
  await assertTier(ctx, ['dev', 'preview', 'test']);
  const seed = loadSeed(args.fixtureKey);
  const actors = await upsertFixtureActors(ctx, env);
  const creator = actors[seed.room.creatorRole];
  const { roomId } = await createRoomCore(ctx, creator, { title: seed.room.title, scenarioKey: 'scope_change', timeZone: seed.room.timeZone, myRole: seed.room.creatorRole });
  for (const role of ROLES) {
    if (role === seed.room.creatorRole) continue;
    const { inviteId } = await createInviteCore(ctx, creator, { roomId, role, invitedEmail: actors[role].email });
    await acceptInviteCore(ctx, actors[role], { invite: { by: 'email', inviteId } });
  }
  await recordBaselineCore(ctx, actors.finance, { roomId, amountCents: seed.ledgerBaseline.amountCents });
  await confirmCatalogCore(ctx, actors.provider, { roomId, expectedConstraintsVersion: 0, rows: seed.catalog.map(row => ({ ...row, taskTemplates: row.taskTemplates.map(t => ({ ...t, assigneeRole: 'provider' as const })) })) });
  const room = (await ctx.db.get(roomId))!;
  const materialized = materializeFixture(seed, isoDate(room.localDate));
  for (const role of seed.confirmOrder) {
    if (role === args.stopBeforeRole) continue;
    const brief = materialized.briefs[role];
    const hardFields: Doc<'briefs'>['hardFields'] = role === 'customer'
      ? { schemaKey: 'scope_change.customer.v1', ...materialized.briefs.customer.hardFields, requiredItemKeys: [...materialized.briefs.customer.hardFields.requiredItemKeys] }
      : role === 'finance' ? { schemaKey: 'scope_change.finance.v1', ...materialized.briefs.finance.hardFields }
      : { schemaKey: 'scope_change.provider.v1' };
    const softFields: Doc<'briefs'>['softFields'] = role === 'customer'
      ? { schemaKey: 'scope_change.customer.v1', ...materialized.briefs.customer.softFields, preferredItemKeys: [...materialized.briefs.customer.softFields.preferredItemKeys] }
      : role === 'finance' ? { schemaKey: 'scope_change.finance.v1', notes: brief.softFields.notes }
      : { schemaKey: 'scope_change.provider.v1', notes: brief.softFields.notes };
    const disclosures = Object.fromEntries(Object.entries(brief.disclosures).map(([field, roles]) => [field, [...roles]]));
    // confirmCore owns validation, disclosures, openIfReady, startRunTx, createTurnTx,
    // beginAttemptTx and scheduling. There is no separate draft persistence API.
    await confirmBriefCore(ctx, actors[role], { roomId, expectedConstraintsVersion: 0, hardFields, softFields, disclosures });
  }
  return { roomId };
}
