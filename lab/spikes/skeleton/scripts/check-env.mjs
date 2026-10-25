// Reports presence (never values) of the Next-side variables.
const keys = ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"];
let missing = 0;
for (const key of keys) {
  const present = Boolean(process.env[key]?.trim());
  console.log(`${key}: ${present ? "set" : "missing"}`);
  if (!present) missing += 1;
}
console.log("Convex-side variables (CLERK_JWT_ISSUER_DOMAIN, ANTHROPIC_API_KEY) are checked by `npx convex env list`.");
if (missing > 0) {
  console.log("Running in unconfigured mode: data features are disabled.");
  process.exitCode = 1;
}
