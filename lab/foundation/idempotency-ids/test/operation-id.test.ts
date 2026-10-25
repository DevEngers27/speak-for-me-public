import { describe, expect, it } from "vitest";
import {
  composeKey,
  defineOperationKey,
  parseComposedKey,
  parseOperationId,
  sha256,
  type OperationKeyValues,
} from "../src/index";

const execKey = defineOperationKey({ kind: "demo-exec", fields: ["targetId"] });
const commitKey = defineOperationKey({ kind: "demo-commit", schemeVersion: 2, fields: ["scopeId", "revision"] });

describe("defineOperationKey: golden values", () => {
  // Expected digests were computed independently with node:crypto createHash over the
  // hand-written canonical payload. If these change, every stored key changes: that
  // is a breaking migration, never a refactor.
  it("pins the derivation format", async () => {
    expect(await execKey.derive({ targetId: "t1" })).toBe("demo-exec:v1:6azdt0y2w2c7jrzjj3p0j2fy2ep7669s");
    expect(await commitKey.derive({ scopeId: "s_42", revision: 6 })).toBe(
      "demo-commit:v2:gsbfvr084vz64wyg8t24sfahktqtfhr0",
    );
    const once = defineOperationKey({ kind: "demo-once", fields: [] });
    expect(await once.derive({})).toBe("demo-once:v1:1f9f6xy49k5gxrz2h4mqwbmzwnw611tk");
  });
});

describe("defineOperationKey: determinism", () => {
  it("returns the same id for the same tuple, regardless of property order", async () => {
    const a = await commitKey.derive({ scopeId: "s_1", revision: 3 });
    const b = await commitKey.derive({ revision: 3, scopeId: "s_1" });
    const c = await commitKey.derive({ scopeId: "s_1", revision: 3 });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("is stable across many repeated derivations", async () => {
    const ids = await Promise.all(Array.from({ length: 200 }, () => execKey.derive({ targetId: "same" })));
    expect(new Set(ids).size).toBe(1);
  });

  it("is order-independent for nested object values too", async () => {
    const k = defineOperationKey({ kind: "demo-nested", fields: ["terms"] });
    expect(await k.derive({ terms: { a: 1, b: [1, 2] } })).toBe(await k.derive({ terms: { b: [1, 2], a: 1 } }));
  });
});

describe("defineOperationKey: sensitivity", () => {
  const base = { scopeId: "s_1", revision: 3 } as const;

  it("changes when any single field changes", async () => {
    const ref = await commitKey.derive(base);
    const variants: Array<OperationKeyValues<"scopeId" | "revision">> = [
      { ...base, scopeId: "s_2" },
      { ...base, scopeId: "S_1" },
      { ...base, scopeId: "s_1 " },
      { ...base, scopeId: "" },
      { ...base, revision: 4 },
      { ...base, revision: -3 },
      { ...base, revision: 3.5 },
      { ...base, revision: "3" },
      { ...base, revision: null },
    ];
    const ids = await Promise.all(variants.map((v) => commitKey.derive(v)));
    for (const id of ids) expect(id).not.toBe(ref);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("changes when values are swapped between fields", async () => {
    const k = defineOperationKey({ kind: "demo-pair", fields: ["a", "b"] });
    expect(await k.derive({ a: "x", b: "y" })).not.toBe(await k.derive({ a: "y", b: "x" }));
  });

  it("separates kinds and scheme versions (domain separation)", async () => {
    const sameFieldsOtherKind = defineOperationKey({ kind: "demo-exec2", fields: ["targetId"] });
    const sameKindV2 = defineOperationKey({ kind: "demo-exec", schemeVersion: 2, fields: ["targetId"] });
    const v1 = await execKey.derive({ targetId: "t1" });
    const other = await sameFieldsOtherKind.derive({ targetId: "t1" });
    const v2 = await sameKindV2.derive({ targetId: "t1" });
    expect(parseOperationId(v1)?.digest).not.toBe(parseOperationId(other)?.digest);
    expect(parseOperationId(v1)?.digest).not.toBe(parseOperationId(v2)?.digest);
  });

  it("is sensitive to array order (callers must sort set-like values)", async () => {
    const k = defineOperationKey({ kind: "demo-set", fields: ["ids"] });
    expect(await k.derive({ ids: ["a", "b"] })).not.toBe(await k.derive({ ids: ["b", "a"] }));
  });

  it("does not normalise Unicode in values", async () => {
    expect(await execKey.derive({ targetId: "é" })).not.toBe(await execKey.derive({ targetId: "é" }));
  });

  it("produces distinct ids for 5,000 distinct tuples", async () => {
    const ids = await Promise.all(Array.from({ length: 5000 }, (_, i) => execKey.derive({ targetId: `t${i}` })));
    expect(new Set(ids).size).toBe(5000);
  });
});

describe("defineOperationKey: validation", () => {
  it("rejects missing, undefined and undeclared fields", async () => {
    const values = { scopeId: "s" } as unknown as OperationKeyValues<"scopeId" | "revision">;
    await expect(commitKey.derive(values)).rejects.toThrow(/Missing field revision/);
    const undef = { scopeId: "s", revision: undefined } as unknown as OperationKeyValues<"scopeId" | "revision">;
    await expect(commitKey.derive(undef)).rejects.toThrow(/Missing field revision/);
    const extra = { targetId: "t", extra: 1 } as unknown as OperationKeyValues<"targetId">;
    await expect(execKey.derive(extra)).rejects.toThrow(/Undeclared field extra/);
  });

  it("rejects values without a canonical form", async () => {
    const k = defineOperationKey({ kind: "demo-any", fields: ["v"] });
    await expect(k.derive({ v: Number.NaN })).rejects.toThrow(/Non-finite/);
    await expect(k.derive({ v: [1, undefined] as unknown as number[] })).rejects.toThrow(/undefined array element/);
  });

  it("validates the spec eagerly", () => {
    expect(() => defineOperationKey({ kind: "Bad", fields: [] })).toThrow(/Invalid operation kind/);
    expect(() => defineOperationKey({ kind: "a:b", fields: [] })).toThrow(/Invalid operation kind/);
    expect(() => defineOperationKey({ kind: "x".repeat(41), fields: [] })).toThrow(/Invalid operation kind/);
    expect(() => defineOperationKey({ kind: "ok", schemeVersion: 0, fields: [] })).toThrow(/schemeVersion/);
    expect(() => defineOperationKey({ kind: "ok", schemeVersion: 1.5, fields: [] })).toThrow(/schemeVersion/);
    expect(() => defineOperationKey({ kind: "ok", fields: ["a", "a"] })).toThrow(/Duplicate field a/);
    expect(() => defineOperationKey({ kind: "ok", fields: ["1a"] })).toThrow(/Invalid field name/);
  });

  it("uses an injected SHA-256 implementation", async () => {
    const calls: number[] = [];
    const spy = async (data: Uint8Array): Promise<Uint8Array> => {
      calls.push(data.length);
      return sha256(data);
    };
    expect(await execKey.derive({ targetId: "t1" }, { sha256: spy })).toBe(await execKey.derive({ targetId: "t1" }));
    expect(calls).toEqual(['{"f":{"targetId":"t1"},"k":"demo-exec","v":1}'.length]);
  });
});

describe("parseOperationId / owns", () => {
  it("parses ids and attributes them to their key", async () => {
    const id = await commitKey.derive({ scopeId: "s", revision: 1 });
    expect(parseOperationId(id)).toEqual({ kind: "demo-commit", schemeVersion: 2, digest: id.split(":")[2] });
    expect(commitKey.owns(id)).toBe(true);
    expect(execKey.owns(id)).toBe(false);
    const v1 = defineOperationKey({ kind: "demo-commit", fields: ["scopeId", "revision"] });
    expect(v1.owns(id)).toBe(false);
  });

  it("rejects malformed ids", () => {
    for (const bad of ["", "demo:v1:short", "demo:v0:" + "0".repeat(32), "demo:v1:" + "i".repeat(32), "Demo:v1:" + "0".repeat(32)]) {
      expect(parseOperationId(bad)).toBeNull();
    }
  });
});

describe("composeKey", () => {
  it("builds readable keys", () => {
    expect(composeKey("exec", "k57abc")).toBe("exec:k57abc");
    expect(composeKey("demo", "a", 7, "b")).toBe("demo:a:7:b");
    expect(composeKey("solo")).toBe("solo");
  });

  it("is injective: separators inside segments cannot forge other tuples", () => {
    const tuples: Array<Array<string | number>> = [
      ["a:b", "c"],
      ["a", "b:c"],
      ["a", "b", "c"],
      ["a%3Ab", "c"],
      ["a%", "3Ab", "c"],
      [""],
      ["", ""],
      [],
      [":"],
    ];
    const keys = tuples.map((t) => composeKey("k", ...t));
    expect(new Set(keys).size).toBe(tuples.length);
  });

  it("round-trips through parseComposedKey", () => {
    const tuples = [["a:b", "%", "%3A", "", "é\u{1F600}"], [], ["x"]];
    for (const t of tuples) expect(parseComposedKey(composeKey("rt", ...t))).toEqual({ kind: "rt", segments: t });
    expect(parseComposedKey(composeKey("rt", 42))).toEqual({ kind: "rt", segments: ["42"] });
    expect(parseComposedKey("rt:%zz")).toBeNull();
    expect(parseComposedKey("Bad:x")).toBeNull();
  });

  it("rejects invalid kinds and non-integer numbers", () => {
    expect(() => composeKey("Bad", "x")).toThrow(/Invalid operation kind/);
    expect(() => composeKey("k", 1.5)).toThrow(/safe integer/);
    expect(() => composeKey("k", Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
  });
});

describe("typed tuples (compile-time checks, enforced by `npm run typecheck`)", () => {
  it("rejects missing, extra and undefined fields at compile time", async () => {
    const reject = async (p: () => Promise<string>): Promise<void> => {
      await expect(p()).rejects.toThrow(TypeError);
    };
    // @ts-expect-error missing field `revision`
    await reject(() => commitKey.derive({ scopeId: "s" }));
    // @ts-expect-error undeclared field `extra`
    await reject(() => execKey.derive({ targetId: "t", extra: 1 }));
    // @ts-expect-error undefined is not a JSON value
    await reject(() => execKey.derive({ targetId: undefined }));
    expect(execKey.fields).toEqual(["targetId"]);
  });
});
