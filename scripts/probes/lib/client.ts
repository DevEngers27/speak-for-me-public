import { ConvexHttpClient } from 'convex/browser';
import { refuseProbeEnvironment } from './target.ts';
export function probeClient(identity?: { subject: string; issuer: string; email?: string; emailVerified?: boolean }, env: Record<string, string | undefined> = process.env) {
  const refusal = refuseProbeEnvironment(env);
  if (refusal) throw new Error(refusal.message);
  if (!env.CONVEX_URL) throw new Error('Refused: CONVEX_URL required');
  const client = new ConvexHttpClient(env.CONVEX_URL);
  if (identity) {
    const key = env.CONVEX_ADMIN_KEY;
    if (!key) throw new Error('Refused: CONVEX_ADMIN_KEY required');
    (client as unknown as { setAdminAuth(key: string, identity: object): void }).setAdminAuth(key, identity);
  }
  return client;
}
