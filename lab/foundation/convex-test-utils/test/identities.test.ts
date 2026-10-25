import { describe, expect, test } from "vitest";
import { api } from "../example/convex/_generated/api";
import {
  ANONYMOUS,
  DEFAULT_TEST_ISSUER,
  defineRoles,
  makeIdentity,
  withRole as withRoleUnbound,
} from "../src";
import { makeT, roles, withRole } from "./fixtures";

describe("defineRoles", () => {
  test("identities are deterministic and use the iss|sub tokenIdentifier format", () => {
    const id = roles.identity("owner");
    expect(id).toEqual({
      name: "owner",
      subject: "user_owner",
      issuer: DEFAULT_TEST_ISSUER,
      tokenIdentifier: `${DEFAULT_TEST_ISSUER}|user_owner`,
    });
    expect(Object.isFrozen(id)).toBe(true);
    expect(roles.names).toEqual(["owner", "member", "outsider"]);
    expect(roles.roleOf(roles.tokenIdentifier("member"))).toBe("member");
    expect(roles.roleOf("nobody")).toBeUndefined();
  });

  test("custom issuer, subject and extra claims", () => {
    const r = defineRoles(
      { admin: { subject: "user_123", email: "a@example.test" } },
      { issuer: "https://idp.example.test" },
    );
    expect(r.identity("admin")).toMatchObject({
      subject: "user_123",
      email: "a@example.test",
      tokenIdentifier: "https://idp.example.test|user_123",
    });
  });

  test("rejects reserved, empty and colliding definitions", () => {
    expect(() => defineRoles({ [ANONYMOUS]: {} })).toThrow(/reserved/);
    expect(() => defineRoles({})).toThrow(/at least one/);
    expect(() => defineRoles({ a: { subject: "same" }, b: { subject: "same" } })).toThrow(/share tokenIdentifier/);
    expect(() => makeIdentity("")).toThrow(/non-empty/);
    expect(() => makeIdentity("s", {}, "bad|issuer")).toThrow(/must not contain/);
  });
});

describe("withRole against a real convex-test backend", () => {
  test("the backend sees exactly the registry identity", async () => {
    const t = makeT();
    expect(await withRole(t, "owner").query(api.identity.whoami, {})).toEqual({
      tokenIdentifier: roles.tokenIdentifier("owner"),
      subject: "user_owner",
      issuer: DEFAULT_TEST_ISSUER,
    });
    expect(await withRoleUnbound(t, roles, "member").query(api.identity.whoami, {})).toMatchObject({
      subject: "user_member",
    });
  });

  test("ANONYMOUS returns the accessor unchanged; root t stays anonymous", async () => {
    const t = makeT();
    withRole(t, "owner"); // must not mutate t
    expect(await withRole(t, ANONYMOUS).query(api.identity.whoami, {})).toBeNull();
    expect(await t.query(api.identity.whoami, {})).toBeNull();
  });
});
