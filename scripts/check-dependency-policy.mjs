import { cooldownExpiry } from './lib/cooldown-exceptions.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const excluded = [...workspace.split('minimumReleaseAgeExclude:')[1].matchAll(/^  - ['"]?([^'"\n]+)['"]?$/gm)].map(match => match[1]);
const manifestPath = 'scripts/cooldown-exceptions.json';
if (process.argv.includes('--generate')) {
  const generatedAt = Date.now();
  for (const name of excluded) assert.ok(lock.includes(`${name}:`) || lock.includes(`'${name}':`), `Missing lock entry: ${name}`);
  writeFileSync(manifestPath, JSON.stringify(excluded.map(name => ({ package: name, expires: cooldownExpiry(name, generatedAt) })), null, 2) + '\n');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.deepEqual(manifest.map(entry => entry.package), excluded);
for (const entry of manifest) {
  assert.ok(lock.includes(`${entry.package}:`) || lock.includes(`'${entry.package}':`));
  assert.ok(Date.parse(entry.expires + 'T23:59:59Z') >= Date.now(), `Expired cooldown exception: ${entry.package}. Review the package and run policy:check --generate to renew.`);
}
assert.match(workspace, /minimumReleaseAge: 10080/);
assert.deepEqual([...workspace.matchAll(/^  ([\w-]+): true$/gm)].map(match => match[1]).sort(), ['esbuild', 'unrs-resolver']);
console.log(`Dependency policy passed: ${manifest.length} lockfile exceptions with expiry dates.`);
