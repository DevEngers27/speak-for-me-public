import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { probeClient } from './lib/client.ts';
import { runProbeMain } from './lib/run.ts';
import { writeEvidence } from './lib/evidence.ts';
export const EXPECTED_CODE = 'amount.out_of_range';
runProbeMain(import.meta.url, async () => {
  const client = probeClient({ issuer: process.env.CLERK_JWT_ISSUER_DOMAIN || 'https://seed.invalid', subject: process.env.E2E_FINANCE_SUBJECT || 'seed_finance', email: 'finance@seed.invalid', emailVerified: true });
  const { roomId } = await client.mutation(makeFunctionReference<'mutation', { stopBeforeRole: 'finance' }, { roomId: string }>('seed:fromFixture'), { stopBeforeRole: 'finance' });
  let code: unknown;
  try { await client.mutation(makeFunctionReference<'mutation'>('ledger:recordBaseline'), { roomId, amountCents: NaN }); }
  catch (error) { if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) code = (error.data as { code?: unknown }).code; }
  const pass = code === EXPECTED_CODE;
  await writeEvidence('nan-probe', { pass, expectedCode: EXPECTED_CODE, observedCode: typeof code === 'string' ? code : null });
  if (!pass) throw new Error('nan-probe failed: unexpected wire error');
});
