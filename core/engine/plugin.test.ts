import { describe, expect, test } from "vitest";
import { defineScenario, SCENARIO_KEY_PATTERN } from "./plugin";
import { SCENARIO_KEY, scopeChangePlugin } from "../scenarios/scope-change";

describe("defineScenario", () => {
  test("accepts the scope-change plugin", () => {
    expect(scopeChangePlugin.id).toEqual({ key: SCENARIO_KEY, version: 1 });
    expect(SCENARIO_KEY_PATTERN.test(scopeChangePlugin.id.key)).toBe(true);
    expect(() =>
      defineScenario({ ...scopeChangePlugin, id: { key: "scope-change", version: 1 } }),
    ).toThrow(/Invalid scenario id/);
  });
  test("rejects malformed ids and duplicate roles", () => {
    expect(() =>
      defineScenario({ ...scopeChangePlugin, id: { key: "Bad Id", version: 1 } }),
    ).toThrow(/Invalid scenario id/);
    expect(() =>
      defineScenario({
        ...scopeChangePlugin,
        roles: [scopeChangePlugin.roles[0]!, scopeChangePlugin.roles[0]!],
      }),
    ).toThrow(/Duplicate roles/);
  });
});
