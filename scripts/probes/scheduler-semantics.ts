import { makeFunctionReference } from 'convex/server';
import { probeClient } from './lib/client.ts';
import { runProbeMain } from './lib/run.ts';
import { writeEvidence } from './lib/evidence.ts';
runProbeMain(import.meta.url, async () => {
  const client = probeClient({ issuer: 'https://seed.invalid', subject: 'scheduler_probe' });
  const kick = makeFunctionReference<'mutation', { fail: boolean }, string>('devProbes:schedulerSemanticsKick');
  const observe = makeFunctionReference<'query', { id: string }, string | null>('devProbes:schedulerSemanticsState');
  const jobs = await Promise.all([false, true].map(async fail => ({ fail, id: await client.mutation(kick, { fail }) })));
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 30_000;
  let states: (string | null)[] = [];
  do {
    states = await Promise.all(jobs.map(job => client.query(observe, { id: job.id })));
    if (states.every(state => state === 'success' || state === 'failed' || state === 'canceled')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  const pass = states[0] === 'success' && states[1] === 'failed';
  await writeEvidence('scheduler-semantics', { startedAt, finishedAt: new Date().toISOString(), states, pass, scope: 'scheduled action success/failure terminal states; does not measure mutation retry count' });
  if (!pass) throw new Error('scheduler-semantics failed: terminal states differ or timed out');
});
