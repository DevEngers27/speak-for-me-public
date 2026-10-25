import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTier, readConfig } from "./config";
afterEach(() => vi.unstubAllEnvs());
describe("runtime config", () => {
  it("15.3 tier is required and rejects unknown values", () => {
    for (const tier of [undefined, "", "test", "production"]) {
      expect(readConfig({ DEPLOYMENT_TIER: tier }).invalidFields).toContain("DEPLOYMENT_TIER");
    }
    for (const tier of ["dev", "preview", "prod"]) expect(readConfig({ DEPLOYMENT_TIER: tier }).configValid).toBe(true);
  });
  it("15.3 preview requires stub even with a configured key", () => {
    expect(readConfig({ DEPLOYMENT_TIER: "preview", AGENT_MODE: "live", ANTHROPIC_API_KEY: "secret" }).invalidFields).toEqual(["AGENT_MODE"]);
  });
  it("15.3 live requires a nonempty key", () => {
    expect(readConfig({ DEPLOYMENT_TIER: "prod", AGENT_MODE: "live", ANTHROPIC_API_KEY: "  " }).invalidFields).toEqual(["ANTHROPIC_API_KEY"]);
    expect(readConfig({ DEPLOYMENT_TIER: "prod", AGENT_MODE: "live", ANTHROPIC_API_KEY: "secret" }).configValid).toBe(true);
  });
  it("15.3 MODEL_FALLBACKS defaults off and agents default enabled", () => {
    expect(readConfig({ DEPLOYMENT_TIER: "dev" })).toMatchObject({ agentMode: "stub", modelFallbacks: false, agentsEnabled: true });
    expect(readConfig({ DEPLOYMENT_TIER: "dev", MODEL_FALLBACKS: "true", AGENTS_ENABLED: "false" })).toMatchObject({ modelFallbacks: true, agentsEnabled: false });
  });
  it("15.3 invalid enum values fail closed", () => {
    expect(readConfig({ DEPLOYMENT_TIER: "dev", AGENT_MODE: "other", MODEL_FALLBACKS: "yes", AGENTS_ENABLED: "no" }).invalidFields).toEqual(["AGENT_MODE", "AGENTS_ENABLED", "MODEL_FALLBACKS"]);
  });
  it("15.3 health contains no environment values or secrets", () => {
    const config = readConfig({ DEPLOYMENT_TIER: "dev", ANTHROPIC_API_KEY: "secret", CLERK_JWT_ISSUER_DOMAIN: "private-issuer" });
    expect(JSON.stringify(config)).not.toMatch(/secret|private-issuer/);
  });
  it("15.3 assertTier uses runtime test tier and checks deployment confirmation", async () => {
    const ctx = { meta: { getDeploymentMetadata: async () => ({ name: "test" }) } } as Parameters<typeof assertTier>[0];
    await expect(assertTier(ctx, ["test"], { confirmDeployment: "test" })).resolves.toBeUndefined();
    await expect(assertTier(ctx, ["prod"])).rejects.toThrow(/internal/);
    await expect(assertTier(ctx, ["test"], { confirmDeployment: "prod" })).rejects.toThrow(/internal/);
  });
});

describe('runtime tier cannot be enabled through environment', () => {
  const deployment = (name: string) => ({ meta: { getDeploymentMetadata: async () => ({ name }) } }) as Parameters<typeof assertTier>[0];
  it.each(['dev', 'preview', 'prod', 'test'])('real dev deployment with DEPLOYMENT_TIER=%s cannot use test-only entries', async tier => {
    vi.stubEnv('DEPLOYMENT_TIER', tier);
    await expect(assertTier(deployment('dev-deployment'), ['test'])).rejects.toThrow(/internal/);
  });
  it('invalid environment test tier also refuses dev/preview entries', async () => {
    vi.stubEnv('DEPLOYMENT_TIER', 'test');
    await expect(assertTier(deployment('dev-deployment'), ['dev', 'preview', 'test'])).rejects.toThrow(/internal/);
  });
  it('runtime test deployment grants test regardless of environment', async () => {
    vi.stubEnv('DEPLOYMENT_TIER', 'prod');
    await expect(assertTier(deployment('test'), ['test'])).resolves.toBeUndefined();
  });
});
