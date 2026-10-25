import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HarnessConfigError, checkClerkCredentials, loadHarnessConfig, parseBaseUrl } from "../src/env.ts";

const clerkEnv = {
  E2E_AUTH: "clerk",
  E2E_ROLE_A_IDENTIFIER: "role-a+clerk_test@example.com",
  E2E_ROLE_B_IDENTIFIER: "role-b+clerk_test@example.com",
  E2E_ROLE_C_IDENTIFIER: "+15555550100",
};

describe("loadHarnessConfig", () => {
  it("defaults to no base URL and no auth", () => {
    assert.deepEqual(loadHarnessConfig({}), { baseUrl: undefined, auth: { mode: "none" } });
  });

  it("treats blank values as unset", () => {
    assert.deepEqual(loadHarnessConfig({ BASE_URL: "  ", E2E_AUTH: "" }), { baseUrl: undefined, auth: { mode: "none" } });
  });

  it("normalises BASE_URL with a trailing slash", () => {
    assert.equal(loadHarnessConfig({ BASE_URL: "http://localhost:3000" }).baseUrl, "http://localhost:3000/");
    assert.equal(parseBaseUrl("https://staging.example.com/app"), "https://staging.example.com/app/");
  });

  it("rejects malformed or unsafe BASE_URL values", () => {
    for (const bad of ["localhost:3000/x y", "ftp://example.com", "https://user:pw@example.com", "https://example.com/?a=1", "not a url"]) {
      assert.throws(() => parseBaseUrl(bad), HarnessConfigError, bad);
    }
  });

  it("rejects unknown auth modes", () => {
    assert.throws(() => loadHarnessConfig({ E2E_AUTH: "password" }), /must be "none" or "clerk"/);
  });

  it("parses clerk mode with test identifiers and picks the OTP strategy", () => {
    const config = loadHarnessConfig(clerkEnv);
    assert.equal(config.auth.mode, "clerk");
    if (config.auth.mode !== "clerk") return;
    assert.deepEqual(config.auth.identities.A, { slot: "A", identifier: "role-a+clerk_test@example.com", strategy: "email_code" });
    assert.deepEqual(config.auth.identities.C, { slot: "C", identifier: "+15555550100", strategy: "phone_code" });
    assert.equal(config.auth.bootPath, "/");
    assert.equal(config.auth.reuseSession, true);
  });

  it("requires an identifier for every role in clerk mode", () => {
    const { E2E_ROLE_B_IDENTIFIER: _omit, ...env } = clerkEnv;
    assert.throws(() => loadHarnessConfig(env), /E2E_ROLE_B_IDENTIFIER is required/);
  });

  it("refuses non-test identifiers (real emails, real phone numbers)", () => {
    assert.throws(() => loadHarnessConfig({ ...clerkEnv, E2E_ROLE_A_IDENTIFIER: "someone@example.com" }), /\+clerk_test/);
    assert.throws(() => loadHarnessConfig({ ...clerkEnv, E2E_ROLE_C_IDENTIFIER: "+14155551234" }), /test phone/);
    // "+clerk_test" in the domain part does not count.
    assert.throws(() => loadHarnessConfig({ ...clerkEnv, E2E_ROLE_A_IDENTIFIER: "a@x+clerk_test.com" }), HarnessConfigError);
  });

  it("refuses two roles sharing one identity (case-insensitive email)", () => {
    assert.throws(
      () => loadHarnessConfig({ ...clerkEnv, E2E_ROLE_B_IDENTIFIER: "ROLE-A+clerk_test@example.com" }),
      /role A and role B share/,
    );
  });

  it("validates boot path and reuse flag", () => {
    assert.throws(() => loadHarnessConfig({ ...clerkEnv, E2E_CLERK_BOOT_PATH: "//evil.example" }), /absolute path/);
    assert.throws(() => loadHarnessConfig({ ...clerkEnv, E2E_AUTH_REUSE: "yes" }), /1\/0\/true\/false/);
    const config = loadHarnessConfig({ ...clerkEnv, E2E_CLERK_BOOT_PATH: "/sign-in", E2E_AUTH_REUSE: "0" });
    assert.ok(config.auth.mode === "clerk" && config.auth.bootPath === "/sign-in" && !config.auth.reuseSession);
  });
});

describe("checkClerkCredentials (fake values only)", () => {
  const pk = "pk_test_ZmFrZS5leGFtcGxlJA";

  it("requires a publishable key and refuses production keys", () => {
    assert.throws(() => checkClerkCredentials({ CLERK_TESTING_TOKEN: "t" }), /PUBLISHABLE_KEY/);
    assert.throws(() => checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: "pk_live_x", CLERK_TESTING_TOKEN: "t" }), /development key/);
  });

  it("prefers a pre-minted testing token (no secret key in the test process)", () => {
    assert.equal(checkClerkCredentials({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk, CLERK_TESTING_TOKEN: "t" }), "preminted-testing-token");
  });

  it("falls back to a development secret key and refuses live secrets", () => {
    assert.equal(checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: pk, CLERK_SECRET_KEY: "sk_test_FAKE" }), "dev-secret-key");
    assert.throws(() => checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: pk, CLERK_SECRET_KEY: "sk_live_FAKE" }), /development key/);
    assert.throws(() => checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: pk }), /CLERK_TESTING_TOKEN or CLERK_SECRET_KEY/);
  });

  it("never echoes key material in error messages", () => {
    try {
      checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: pk, CLERK_SECRET_KEY: "sk_live_SENTINEL123" });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof HarnessConfigError);
      assert.ok(!error.message.includes("SENTINEL123"));
    }
  });
});
