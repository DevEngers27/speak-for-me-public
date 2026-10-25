import type { AuthConfig } from "convex/server";

// CLERK_JWT_ISSUER_DOMAIN lives in the Convex deployment env (`npx convex env set`),
// not in Next's .env.local. Missing config fails closed at push time.
// `applicationID: "convex"` must match the JWT `aud` (Clerk native integration or
// a JWT template named "convex").
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!domain) {
  throw new Error("Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment environment.");
}

export default {
  providers: [{ domain, applicationID: "convex" }],
} satisfies AuthConfig;
