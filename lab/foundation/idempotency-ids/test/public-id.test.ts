import { describe, expect, it } from "vitest";
import { BASE32_ALPHABET, createPublicId, isPublicId, normalizePublicId } from "../src/index";
import { seededBytes } from "./prng";

const BODY16 = /^[0-9a-hjkmnp-tv-z]{16}$/;

describe("createPublicId", () => {
  it("defaults to 16 base32 chars from Web Crypto", () => {
    const id = createPublicId();
    expect(id).toMatch(BODY16);
    expect(isPublicId(id)).toBe(true);
  });

  it("supports prefixes and lengths", () => {
    expect(createPublicId({ prefix: "rm" })).toMatch(/^rm_[0-9a-hjkmnp-tv-z]{16}$/);
    expect(createPublicId({ length: 10 })).toHaveLength(10);
    expect(createPublicId({ length: 64 })).toHaveLength(64);
  });

  it("maps random bytes deterministically and requests the minimal byte count", () => {
    const requested: number[] = [];
    const zeros = (n: number): Uint8Array => {
      requested.push(n);
      return new Uint8Array(n);
    };
    expect(createPublicId({ randomBytes: zeros })).toBe("0".repeat(16));
    expect(createPublicId({ length: 10, randomBytes: zeros })).toBe("0".repeat(10));
    expect(requested).toEqual([10, 7]);
    expect(createPublicId({ randomBytes: (n) => new Uint8Array(n).fill(255) })).toBe("z".repeat(16));
    expect(createPublicId({ randomBytes: seededBytes(7) })).toBe(createPublicId({ randomBytes: seededBytes(7) }));
  });

  it("rejects bad options and short random output", () => {
    expect(() => createPublicId({ length: 9 })).toThrow(RangeError);
    expect(() => createPublicId({ length: 65 })).toThrow(RangeError);
    expect(() => createPublicId({ prefix: "Rm" })).toThrow(TypeError);
    expect(() => createPublicId({ prefix: "r_m" })).toThrow(TypeError);
    expect(() => createPublicId({ prefix: "abcdefghijklm" })).toThrow(TypeError);
    expect(() => createPublicId({ randomBytes: () => new Uint8Array(3) })).toThrow(/expected 10/);
  });

  it("does not collide across 20,000 ids", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => createPublicId()));
    expect(ids.size).toBe(20_000);
  });

  it("uses every alphabet character uniformly in every position", () => {
    const rand = seededBytes(123);
    const n = 32_000;
    const counts = Array.from({ length: 16 }, () => new Map<string, number>());
    for (let i = 0; i < n; i++) {
      const id = createPublicId({ randomBytes: rand });
      for (let p = 0; p < 16; p++) {
        const m = counts[p];
        const ch = id.charAt(p);
        m?.set(ch, (m.get(ch) ?? 0) + 1);
      }
    }
    const expected = n / 32;
    for (const m of counts) {
      expect([...m.keys()].sort().join("")).toBe(BASE32_ALPHABET);
      let chi2 = 0;
      for (const c of m.values()) chi2 += (c - expected) ** 2 / expected;
      expect(chi2).toBeLessThan(80); // 31 dof; p < 1e-5 for a fair source
    }
  });
});

describe("isPublicId / normalizePublicId", () => {
  it("checks the strict canonical shape", () => {
    expect(isPublicId("0123456789abcdef")).toBe(true);
    expect(isPublicId("0123456789ABCDEF")).toBe(false);
    expect(isPublicId("0123456789abcdei")).toBe(false);
    expect(isPublicId("0123456789abcde")).toBe(false);
    expect(isPublicId("rm_0123456789abcdef", { prefix: "rm" })).toBe(true);
    expect(isPublicId("rx_0123456789abcdef", { prefix: "rm" })).toBe(false);
    expect(isPublicId("0123456789", { length: 10 })).toBe(true);
  });

  it("normalises human-typed ids with Crockford aliases", () => {
    expect(normalizePublicId(" ABCD-EFGH-IJKL-MNOP ")).toBe("abcdefgh1jk1mn0p");
    expect(normalizePublicId("RM_0123 4567 89ab cdef")).toBe("rm_0123456789abcdef");
    expect(isPublicId(normalizePublicId("RM_0123-4567-89AB-CDEF"), { prefix: "rm" })).toBe(true);
  });
});
