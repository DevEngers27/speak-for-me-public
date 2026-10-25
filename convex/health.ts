import { v } from 'convex/values';
import { anonQuery } from './lib/functions';

// 11 §11.6: the sole public anonymous query, containing no stored/user data.
export const ping = anonQuery('health.ping')({
  args: {}, returns: v.object({ ok: v.literal(true) }),
  handler: async () => ({ ok: true as const }),
});
