/** Optional transport using the installed, logged-in Convex CLI. No credentials are exported. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getFunctionName } from 'convex/server';
const exec = promisify(execFile);
export function parseCliOutput(stdout) { return stdout.trim() ? JSON.parse(stdout) : null; }
export function extractCliErrorCode(stderr) {
  return typeof stderr === 'string' ? /"code"\s*:\s*"([a-z_]+\.[a-z_]+)"/.exec(stderr)?.[1] || 'verification.failed' : 'verification.failed';
}
export function cliClientFactory(deployment, cwd = process.cwd()) {
  assert(/^[a-z0-9-]+$/.test(deployment), 'Explicit deployment required.');
  return identity => {
    const run = async (reference, args) => {
      const parameters = ['exec', 'convex', 'run', getFunctionName(reference), JSON.stringify(args || {}), '--deployment', deployment];
      if (identity) parameters.push('--identity', JSON.stringify(identity));
      try {
        const { stdout } = await exec('pnpm', parameters, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 300000 });
        return parseCliOutput(stdout);
      } catch (error) {
        // The raw stderr may include transport data. Expose only a typed error code.
        const code = extractCliErrorCode(error.stderr);
        throw Object.assign(new Error('CLI operation failed.'), { data: { code: code || 'verification.failed' } });
      }
    };
    return { query: run, mutation: run, action: run };
  };
}
export async function readIdentityConfiguration(deployment) {
  const env = {};
  for (const name of ['CLERK_JWT_ISSUER_DOMAIN', 'E2E_CUSTOMER_SUBJECT', 'E2E_PROVIDER_SUBJECT', 'E2E_FINANCE_SUBJECT']) {
    try {
      const { stdout } = await exec('pnpm', ['exec', 'convex', 'env', 'get', name, '--deployment', deployment], { maxBuffer: 65536, timeout: 30000 });
      env[name] = stdout.trim() || undefined;
    } catch { if (name === 'CLERK_JWT_ISSUER_DOMAIN') throw new Error('Could not read target issuer.'); }
  }
  return env;
}
