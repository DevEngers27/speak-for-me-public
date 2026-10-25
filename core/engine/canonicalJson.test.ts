import { describe, expect, it } from "vitest";
import { canonicalEquals, canonicalJson, CanonicalJsonError, type JsonValue } from "./canonicalJson";

describe("canonicalJson", () => {
  it("serialises primitives like JSON.stringify", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson(1.5e-7)).toBe("1.5e-7");
    expect(canonicalJson(1e21)).toBe("1e+21");
    expect(canonicalJson(123456789012)).toBe("123456789012");
    expect(canonicalJson("a\"b\\c\n")).toBe(JSON.stringify("a\"b\\c\n"));
  });

  it("sorts object keys recursively and emits no whitespace", () => {
    const value = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } };
    expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("is independent of key insertion order", () => {
    const a: JsonValue = { x: 1, y: { p: true, q: null }, z: [1, 2] };
    const b: JsonValue = { z: [1, 2], y: { q: null, p: true }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalEquals(a, b)).toBe(true);
  });

  it("keeps array order significant", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("orders keys by UTF-16 code units (JCS order), not locale", () => {
    // U+00E9 (233) sorts after "z" (122); U+1F600 (surrogates D83D..) sorts before U+FB01 (FB01).
    const value = { "é": 1, z: 2, Z: 3, "\u{1F600}": 4, "ﬁ": 5, "10": 6, "9": 7 };
    expect(canonicalJson(value)).toBe('{"10":6,"9":7,"Z":3,"z":2,"é":1,"\u{1F600}":4,"ﬁ":5}');
  });

  it("escapes lone surrogates so distinct strings stay distinct", () => {
    expect(canonicalJson("\ud800")).toBe('"\\ud800"');
    expect(canonicalJson("\ud800")).not.toBe(canonicalJson("�"));
  });

  it("does not normalise Unicode: NFC and NFD forms differ", () => {
    expect(canonicalJson("é")).not.toBe(canonicalJson("é"));
  });

  it("omits undefined object properties", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalEquals({ a: undefined }, {})).toBe(true);
  });

  it("accepts null-prototype objects", () => {
    const obj = Object.create(null) as Record<string, JsonValue>;
    obj["b"] = 2;
    obj["a"] = 1;
    expect(canonicalJson(obj)).toBe('{"a":1,"b":2}');
  });

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { k: 1 };
    expect(canonicalJson({ a: shared, b: [shared] })).toBe('{"a":{"k":1},"b":[{"k":1}]}');
  });

  const rejected: Array<[string, unknown, string]> = [
    ["NaN", Number.NaN, "$"],
    ["Infinity", { a: Number.POSITIVE_INFINITY }, "$.a"],
    ["bigint", { a: [1n] }, "$.a[0]"],
    ["function", { f: () => 1 }, "$.f"],
    ["symbol value", Symbol("s"), "$"],
    ["top-level undefined", undefined, "$"],
    ["undefined array element", [1, undefined], "$[1]"],
    ["sparse array", [1, , 3], "$[1]"],
    ["Map", new Map(), "$"],
    ["class instance", { x: new (class Point {})() }, "$.x"],
    ["typed array", { bytes: new Uint8Array(2) }, "$.bytes"],
    ["symbol key", { [Symbol("k")]: 1 }, "$"],
    ["non-identifier path", { "a b": [Number.NaN] }, '$["a b"][0]'],
  ];
  for (const [name, value, path] of rejected) {
    it(`rejects ${name} with a path`, () => {
      let caught: unknown;
      try {
        canonicalJson(value as JsonValue);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CanonicalJsonError);
      expect((caught as CanonicalJsonError).path).toBe(path);
    });
  }

  it("rejects cycles", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    expect(() => canonicalJson(a as JsonValue)).toThrow(/Circular reference at \$\.self/);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalJson(arr as JsonValue)).toThrow(/Circular reference at \$\[0\]/);
  });

  it("enforces maxDepth", () => {
    let deep: JsonValue = 1;
    for (let i = 0; i < 10; i++) deep = [deep];
    expect(canonicalJson(deep, { maxDepth: 10 })).toBe("[".repeat(10) + "1" + "]".repeat(10));
    expect(() => canonicalJson(deep, { maxDepth: 9 })).toThrow(/maxDepth=9/);
    expect(() => canonicalJson(1, { maxDepth: -1 })).toThrow(RangeError);
  });

  it("round-trips through JSON.parse to an equal canonical form", () => {
    const value: JsonValue = { s: "\u{1F600}é\t", n: [0, -1.25, 1e-9], o: { b: null, a: false } };
    const text = canonicalJson(value);
    expect(canonicalJson(JSON.parse(text) as JsonValue)).toBe(text);
  });
});
