import { describe, expect, it } from 'vitest';
import { readConfig } from './config';
import { checkConfigHealth, configHealthFrom, reportedAgentMode } from './configHealth';
const cases: { name: string; env: Record<string, string | undefined>; valid: boolean }[] = [
  { name: 'missing tier', env: {}, valid: false },
  ...['', 'test', 'production'].map(tier => ({ name: `invalid tier ${tier}`, env: { DEPLOYMENT_TIER: tier }, valid: false })),
  ...['dev', 'preview', 'prod'].map(tier => ({ name: `${tier} defaults`, env: { DEPLOYMENT_TIER: tier }, valid: true })),
  { name: 'preview stub', env: { DEPLOYMENT_TIER: 'preview', AGENT_MODE: 'stub' }, valid: true },
  { name: 'preview live with key', env: { DEPLOYMENT_TIER: 'preview', AGENT_MODE: 'live', ANTHROPIC_API_KEY: 'secret' }, valid: false },
  { name: 'preview live missing key', env: { DEPLOYMENT_TIER: 'preview', AGENT_MODE: 'live' }, valid: false },
  ...['dev', 'prod'].flatMap(tier => [
    { name: `${tier} live with key`, env: { DEPLOYMENT_TIER: tier, AGENT_MODE: 'live', ANTHROPIC_API_KEY: 'secret' }, valid: true },
    { name: `${tier} live without key`, env: { DEPLOYMENT_TIER: tier, AGENT_MODE: 'live' }, valid: false },
    { name: `${tier} live blank key`, env: { DEPLOYMENT_TIER: tier, AGENT_MODE: 'live', ANTHROPIC_API_KEY: '  ' }, valid: false },
  ]),
  ...['', 'other'].map(mode => ({ name: `invalid agent mode ${mode}`, env: { DEPLOYMENT_TIER: 'dev', AGENT_MODE: mode }, valid: false })),
  ...['true', 'false', '', 'on', 'off', 'garbage'].flatMap(value => (['AGENTS_ENABLED', 'MODEL_FALLBACKS'] as const).map(field => ({
    name: `${field}=${value}`, env: { DEPLOYMENT_TIER: 'dev', [field]: value }, valid: value === 'true' || value === 'false',
  }))),
  { name: 'issuer presence only', env: { DEPLOYMENT_TIER: 'dev', CLERK_JWT_ISSUER_DOMAIN: 'private-issuer' }, valid: true },
  { name: 'all invalid enums', env: { DEPLOYMENT_TIER: 'test', AGENT_MODE: 'other', AGENTS_ENABLED: 'on', MODEL_FALLBACKS: 'on' }, valid: false },
];
const fieldNames = { DEPLOYMENT_TIER: 'tier', AGENT_MODE: 'agentMode', AGENTS_ENABLED: 'agentsEnabled', MODEL_FALLBACKS: 'modelFallbacks', ANTHROPIC_API_KEY: 'anthropicKeyConfigured', CLERK_JWT_ISSUER_DOMAIN: 'clerkIssuerConfigured' } as const;
describe('15 §15.3 health/runtime configuration parity', () => {
  it.each(cases)('$name', ({ env, valid }) => {
    const runtime = readConfig(env);
    const health = configHealthFrom(env, true);
    expect(runtime.configValid).toBe(valid);
    expect(health).toEqual({ ...runtime, tier: runtime.tier ?? 'missing', draining: true, invalidFields: runtime.invalidFields.map(field => fieldNames[field]) });
    expect(checkConfigHealth(env)).toEqual({ ...health, draining: false, ok: runtime.configValid });
    expect(reportedAgentMode(env)).toBe(runtime.agentMode);
    expect(JSON.stringify(health)).not.toMatch(/secret|private-issuer/);
  });
  it('preserves runtime defaults for prod with AGENT_MODE unset', () => {
    expect(configHealthFrom({ DEPLOYMENT_TIER: 'prod' }, false)).toMatchObject({ agentMode: 'stub', agentsEnabled: true, configValid: true });
  });
  it('maps invalid enum fields to the operations DTO names', () => {
    expect(checkConfigHealth({ DEPLOYMENT_TIER: 'dev', MODEL_FALLBACKS: 'on' })).toMatchObject({ ok: false, configValid: false, modelFallbacks: false, invalidFields: ['modelFallbacks'] });
  });
});
