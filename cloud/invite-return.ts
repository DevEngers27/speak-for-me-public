// Invitation secrets remain in this tab, never in Clerk redirect query strings.
const key = "sfm:pending-invite";
const maxAgeMs = 10 * 60 * 1000;
export function rememberInviteFragment(): boolean {
  try {
    if (window.location.hash) sessionStorage.setItem(key, JSON.stringify({ hash: window.location.hash, expires: Date.now() + maxAgeMs }));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
export function restoreInviteFragment(): void {
  if (window.location.pathname !== "/invite") return;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw || window.location.hash) return;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null || !("hash" in saved) || !("expires" in saved)) return;
    if (typeof saved.hash !== "string" || !saved.hash.startsWith("#") || typeof saved.expires !== "number" || saved.expires <= Date.now()) return;
    history.replaceState(history.state, "", `/invite${saved.hash}`);
  } catch { /* A missing or expired invitation must be reopened from its original link. */ }
}
