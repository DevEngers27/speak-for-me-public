/** Unique users writer; fixture actors may reuse ensureViewerCore (12 §12.5). */
import type { UserIdentity } from 'convex/server';
import type { MutationCtx } from '../_generated/server';
import { nowMs } from '../lib/time';
import { patchUser } from '../lib/db';

export async function ensureViewerCore(ctx: MutationCtx, actor: UserIdentity, _args: Record<string, never>) {
  void _args;
  const existing = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', actor.tokenIdentifier)).unique();
  const name = typeof actor.name === 'string' ? actor.name.normalize('NFC').trim() : '';
  const displayName = [...name].slice(0, 80).join('') || 'Member';
  let isTestAccount = false;
  try { isTestAccount = new URL(actor.issuer).hostname.endsWith('.clerk.accounts.dev'); } catch { /* Unrecognized issuers are not dev instances. */ }
  if (existing && existing.displayName === displayName && existing.isTestAccount === isTestAccount) return { userId: existing._id, changed: false };
  const now = nowMs(ctx);
  if (existing) {
    await patchUser(ctx, existing._id, { displayName, isTestAccount, updatedAt: now });
    return { userId: existing._id, changed: true };
  }
  const userId = await ctx.db.insert('users', { tokenIdentifier: actor.tokenIdentifier, displayName, isTestAccount, createdAt: now, updatedAt: now });
  return { userId, changed: true };
}

/** Fixture identities reuse the sole users writer, then act through production cores. */
export async function upsertFixtureActors(ctx: MutationCtx, env: Record<string, string | undefined>) {
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN?.trim() || 'https://seed.invalid';
  const entries = await Promise.all((['customer', 'provider', 'finance'] as const).map(async role => {
    const subject = env[`E2E_${role.toUpperCase()}_SUBJECT`]?.trim() || `seed_${role}`;
    const tokenIdentifier = `${issuer}|${subject}`;
    const { userId } = await ensureViewerCore(ctx, { issuer, subject, tokenIdentifier, name: role }, {});
    return [role, { userId, provenance: 'seeded' as const, email: `${role}@seed.invalid`, emailVerified: true as const }] as const;
  }));
  return Object.fromEntries(entries) as Record<'customer' | 'provider' | 'finance', typeof entries[number][1]>;
}
