/** W2-1: 03 §3.13 unique-writer grep. Later lanes extend this registry. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNIQUE_WRITERS: Readonly<Record<string, readonly string[]>> = {
  users: ['convex/model/users.ts'],
  events: ['convex/model/events.ts'],
  rooms: ['convex/lib/db.ts'],
  members: ['convex/model/members.ts'],
  invites: ['convex/model/invites.ts'],
  briefs: ['convex/model/briefs.ts'],
  catalogItems: ['convex/model/catalog.ts'],
  ledgerEntries: ['convex/model/ledger.ts'],
  sharedFacts: ['convex/model/sharedFacts.ts'],
};
export function findWriterViolations(file: string, source: string): string[] {
  if (/(?:^|\/)_generated\/|\.(?:test|fixture)\.ts$/.test(file)) return [];
  const violations: string[] = [];
  for (const match of source.matchAll(/\.insert\(\s*['"]([^'"]+)['"]/g)) {
    const allowed = UNIQUE_WRITERS[match[1]!];
    if (allowed && !allowed.includes(file)) violations.push(`${file}: ${match[1]} insert outside its unique writer`);
  }
  if (file !== 'convex/lib/db.ts' && /\.db\.(?:patch|replace|delete)\s*\(/.test(source)) violations.push(`${file}: raw database mutation outside facade`);
  if (file !== 'convex/model/events.ts' && /\bcommitTs\s*:/.test(source) && !['convex/lib/db.ts', 'convex/schema.ts'].includes(file)) violations.push(`${file}: commitTs written outside appendEvents`);
  return violations;
}
export function checkArchitecture(root = process.cwd()): string[] {
  const violations: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(path.join(root, dir), {withFileTypes: true})) {
      if (entry.name === '_generated') continue;
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.ts')) violations.push(...findWriterViolations(file, readFileSync(path.join(root, file), 'utf8')));
    }
  }
  walk('convex');
  return violations;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkArchitecture();
  if (violations.length) throw new Error(violations.join('\n'));
  console.log('W2-1 architecture: unique writers and write facade passed.');
}
