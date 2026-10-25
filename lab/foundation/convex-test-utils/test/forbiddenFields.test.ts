import { describe, expect, test } from "vitest";
import {
  ForbiddenFieldsError,
  assertNoCanaries,
  assertNoForbiddenFields,
  assertPatternsMatch,
  findCanaries,
  findForbiddenFields,
} from "../src";

const payload = {
  title: "ok",
  owner: { name: "o", privateMemo: "x" },
  list: [{ body: "b" }, { body: "c", nested: { privateMemo: "y", "weird key": 1 } }],
  bytes: new ArrayBuffer(4),
};

describe("findForbiddenFields", () => {
  test("bare key matches at any depth, including inside arrays", () => {
    expect(findForbiddenFields(payload, ["privateMemo"]).map((v) => v.path)).toEqual([
      "$.owner.privateMemo",
      "$.list[1].nested.privateMemo",
    ]);
  });

  test("anchored dotted paths with * and **", () => {
    expect(findForbiddenFields(payload, ["owner.privateMemo"]).map((v) => v.path)).toEqual([
      "$.owner.privateMemo",
    ]);
    expect(findForbiddenFields(payload, ["list.*.body"]).map((v) => v.path)).toEqual([
      "$.list[0].body",
      "$.list[1].body",
    ]);
    expect(findForbiddenFields(payload, ["list.**.privateMemo"]).map((v) => v.path)).toEqual([
      "$.list[1].nested.privateMemo",
    ]);
    expect(findForbiddenFields(payload, ["**.title"]).map((v) => v.path)).toEqual(["$.title"]);
    expect(findForbiddenFields(payload, ["privateMemo.x"])).toEqual([]);
    expect(findForbiddenFields(payload, ["*"])).toHaveLength(4); // top-level keys only
  });

  test("RegExp matches key names; stateful flags are neutralised", () => {
    const re = /memo$/gi;
    expect(findForbiddenFields(payload, [re])).toHaveLength(2);
    expect(findForbiddenFields(payload, [re])).toHaveLength(2);
  });

  test("odd keys are quoted in paths; ArrayBuffers are not walked", () => {
    expect(findForbiddenFields(payload, ["weird key"]).map((v) => v.path)).toEqual([
      '$.list[1].nested["weird key"]',
    ]);
    expect(findForbiddenFields(payload, ["byteLength"])).toEqual([]);
  });

  test("key presence counts even when the value is undefined, unless opted out", () => {
    const p = { secret: undefined };
    expect(findForbiddenFields(p, ["secret"])).toHaveLength(1);
    expect(findForbiddenFields(p, ["secret"], { ignoreUndefinedValues: true })).toHaveLength(0);
  });

  test("cycles terminate; excessive depth fails closed", () => {
    const a: Record<string, unknown> = { secret: 1 };
    a.self = a;
    expect(findForbiddenFields(a, ["secret"])).toHaveLength(1);
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 10; i++) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    expect(() => findForbiddenFields(root, ["secret"], { maxDepth: 5 })).toThrow(/maxDepth/);
  });

  test("primitives and null are clean; bad patterns are rejected", () => {
    expect(findForbiddenFields(null, ["x"])).toEqual([]);
    expect(findForbiddenFields("x", ["x"])).toEqual([]);
    expect(() => findForbiddenFields({}, [])).toThrow(/empty/);
    expect(() => findForbiddenFields({}, ["a..b"])).toThrow(/invalid/);
  });
});

describe("assertNoForbiddenFields", () => {
  test("throws with every violating path", () => {
    let err: unknown;
    try {
      assertNoForbiddenFields(payload, ["privateMemo"], { label: "notes.listForItem" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenFieldsError);
    expect((err as ForbiddenFieldsError).violations).toHaveLength(2);
    expect((err as Error).message).toMatch(/notes\.listForItem contains 2 forbidden field/);
    expect(() => assertNoForbiddenFields({ title: "x" }, ["privateMemo"])).not.toThrow();
  });

  test("assertPatternsMatch catches misspelled patterns", () => {
    expect(() => assertPatternsMatch(payload, ["privateMemo", /memo/i])).not.toThrow();
    expect(() => assertPatternsMatch(payload, ["privateMemmo"])).toThrow(/privateMemmo/);
  });
});

describe("canaries", () => {
  test("finds canaries in values and keys without echoing them in errors", () => {
    const p = { summary: "contains CANARY-123 inside", other: [{ "CANARY-123": true }] };
    expect(findCanaries(p, ["CANARY-123"]).map((h) => `${h.path}:${h.where}`)).toEqual([
      "$.summary:value",
      '$.other[0]["CANARY-123"]:key',
    ]);
    expect(() => assertNoCanaries(p, ["CANARY-123"])).toThrow(/2 canary hit/);
    try {
      assertNoCanaries(p, ["CANARY-123"]);
    } catch (e) {
      expect((e as Error).message).not.toContain("contains CANARY-123 inside");
    }
    expect(() => assertNoCanaries({ a: "clean" }, ["CANARY-123"])).not.toThrow();
  });
});
