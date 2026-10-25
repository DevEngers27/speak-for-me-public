/** Test identities are claims only; membership always comes from production APIs. */
import type {TestConvex} from 'convex-test';
import schema from '../../convex/schema';
import type {Role} from '../../convex/model/common';
export const TEST_ROLES=['customer','provider','finance'] as const;
export function asRole(t:TestConvex<typeof schema>,role:Role|string,emailVerified=true){return t.withIdentity({subject:role,issuer:'https://w21.clerk.accounts.dev',name:role,email:`${role}@example.com`,emailVerified});}
