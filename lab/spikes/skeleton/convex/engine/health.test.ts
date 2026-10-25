import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("engine/health", () => {
  test("ping is public and reports registered scenarios", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.engine.health.ping, {})).resolves.toEqual({
      ok: true,
      engineVersion: "0.0.0",
      scenarios: ["scope-change"],
    });
  });

  test("whoami fails closed without an identity", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.engine.health.whoami, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("whoami returns the mocked Clerk identity", async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity({ subject: "user_alice", issuer: "https://clerk.test" });
    const me = await asAlice.query(api.engine.health.whoami, {});
    expect(me.subject).toBe("user_alice");
    expect(me.tokenIdentifier).toContain("user_alice");
  });
});
