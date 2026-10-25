/** D20 requires expiring lockfile exceptions but gives no renewal horizon.
 * Keep each exception 14–28 days out, deterministically spread by package.
 */
export function cooldownExpiry(packageName, generatedAt = Date.now()) {
  const days = 14 + [...packageName].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 15;
  return new Date(generatedAt + days * 86_400_000).toISOString().slice(0, 10);
}
