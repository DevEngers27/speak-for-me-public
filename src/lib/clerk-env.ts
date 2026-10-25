// Shared by proxy.ts (Node runtime) and server code. No "server-only" import
// because proxy.ts is bundled separately; it still never runs in the browser.
export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && process.env.CLERK_SECRET_KEY?.trim(),
  );
}
