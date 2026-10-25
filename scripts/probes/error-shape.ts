import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { probeClient } from './lib/client.ts';
import { runProbeMain } from './lib/run.ts';
import { writeEvidence } from './lib/evidence.ts';
export const EXPECTED_CODE = 'auth.unauthenticated';
runProbeMain(import.meta.url, async () => {
  const client = probeClient();
  let data: unknown;
  try { await client.mutation(makeFunctionReference<'mutation'>('rooms:create'), { title: 'Probe', scenarioKey: 'scope_change', timeZone: 'UTC', myRole: 'customer' }); }
  catch (error) { if (error instanceof ConvexError) data = error.data; }
  const pass = typeof data === 'object' && data !== null && (data as { code?: unknown }).code === EXPECTED_CODE;
  await writeEvidence('error-shape', { pass, expectedCode: EXPECTED_CODE, observedCode: pass ? EXPECTED_CODE : null });
  if (!pass) throw new Error('error-shape failed: unexpected wire error');
});
