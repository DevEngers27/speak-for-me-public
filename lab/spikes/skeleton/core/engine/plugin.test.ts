import { describe, expect, test } from "vitest";
import { defineScenario } from "./plugin";
import { scopeChangePlugin } from "../scenarios/scope-change";

describe("defineScenario", () => {
  test("accepts the scope-change plugin", () => {
    expect(scopeChangePlugin.id).toBe("scope-change");
  });
  test("rejects malformed ids and duplicate roles", () => {
    expect(() => defineScenario({ id: "Bad Id", version: 1, roles: [] })).toThrow(/Invalid scenario id/);
    expect(() => defineScenario({ id: "x", version: 1, roles: ["a", "a"] })).toThrow(/Duplicate roles/);
  });
});
