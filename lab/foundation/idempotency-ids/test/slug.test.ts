import { describe, expect, it } from "vitest";
import { isAsciiSlug, slugCandidate, slugify, truncateSlug, uniqueSlug } from "../src/index";
import { seededBytes } from "./prng";

const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
const FALLBACK = /^untitled-[0-9a-z]{7}$/;

describe("slugify (ascii)", () => {
  const cases: Array<[string, string]> = [
    ["Hello, World!", "hello-world"],
    ["  --Crème Brûlée--  ", "creme-brulee"],
    ["Straße", "strasse"],
    ["Øresund Æble", "oresund-aeble"],
    ["Łódź", "lodz"],
    ["Þór Ðuro", "thor-duro"],
    ["İstanbul", "istanbul"],
    ["ǅemal", "dzemal"],
    ["Don't stop", "dont-stop"],
    ["rock ’n’ roll", "rock-n-roll"],
    ["ＡＢＣ１２３", "abc123"],
    ["ﬁle №5", "file-no5"],
    ["x² + y²", "x2-y2"],
    ["C++ & C#", "c-c"],
    ["snake_case.and/slashes", "snake-case-and-slashes"],
    ["Room 会议 2026", "room-2026"],
    ["a​b c\td", "a-b-c-d"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(slugify(input)).toBe(expected);
    });
  }

  it("treats NFC and NFD input identically", () => {
    expect(slugify("Café")).toBe(slugify("Café"));
    expect(slugify("한")).toBe(slugify("한"));
  });

  it("falls back to a stable, distinct hash slug when nothing ASCII is left", () => {
    const a = slugify("你好世界");
    const b = slugify("再见世界");
    expect(a).toMatch(FALLBACK);
    expect(b).toMatch(FALLBACK);
    expect(a).not.toBe(b);
    expect(slugify("你好世界")).toBe(a);
    expect(slugify("Привет")).toMatch(FALLBACK);
    expect(slugify("🚀🚀")).toMatch(FALLBACK);
    expect(slugify("")).toMatch(FALLBACK);
    expect(slugify("!!!")).not.toBe(slugify("???"));
  });

  it("supports a custom fallback prefix and validates it", () => {
    expect(slugify("你好", { fallbackPrefix: "room" })).toMatch(/^room-[0-9a-z]{7}$/);
    expect(() => slugify("x", { fallbackPrefix: "Room!" })).toThrow(TypeError);
    expect(() => slugify("x", { fallbackPrefix: "" })).toThrow(TypeError);
  });

  it("is idempotent", () => {
    for (const input of ["Hello, World!", "Straße", "你好", "", "a".repeat(200), "x-y--z"]) {
      const once = slugify(input);
      expect(slugify(once)).toBe(once);
    }
  });

  it("always yields a valid ASCII slug within maxLength (seeded random Unicode)", () => {
    const rand = seededBytes(42);
    const ranges: Array<[number, number]> = [[0x20, 0x7e], [0xa0, 0x24f], [0x300, 0x36f], [0x4e00, 0x4fff], [0x1f300, 0x1f64f], [0xd800, 0xdfff]];
    for (let n = 0; n < 500; n++) {
      const bytes = rand(40);
      let s = "";
      for (let i = 0; i < 40; i += 2) {
        const [lo, hi] = ranges[(bytes[i] ?? 0) % ranges.length] ?? [0x61, 0x7a];
        s += String.fromCodePoint(lo + (((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)) % (hi - lo + 1));
      }
      const maxLength = 8 + ((bytes[0] ?? 0) % 60);
      const out = slugify(s, { maxLength });
      expect(isAsciiSlug(out, maxLength)).toBe(true);
    }
  });
});

describe("slugify (unicode)", () => {
  const cases: Array<[string, string]> = [
    ["你好，世界", "你好-世界"],
    ["Привет, Мир!", "привет-мир"],
    ["ＡＢＣ", "abc"],
    ["Café au lait", "café-au-lait"],
    ["नमस्ते दुनिया", "नमस्ते-दुनिया"],
    ["🚀 launch", "launch"],
    ["́orphan mark", "orphan-mark"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(slugify(input, { script: "unicode" })).toBe(expected.normalize("NFC"));
    });
  }

  it("falls back for input without letters or digits", () => {
    expect(slugify("🚀🚀", { script: "unicode" })).toMatch(FALLBACK);
  });

  it("counts code points and never splits a surrogate pair", () => {
    const out = slugify("\u{20000}".repeat(20), { script: "unicode", maxLength: 8 });
    expect(Array.from(out)).toHaveLength(8);
    expect(out.length).toBe(16);
    expect(LONE_SURROGATE.test(out)).toBe(false);
  });
});

describe("length handling", () => {
  it("defaults to 64 and hard-cuts a single long word", () => {
    expect(slugify("a".repeat(100))).toBe("a".repeat(64));
  });

  it("prefers a word boundary when it keeps at least half the budget", () => {
    expect(slugify("alpha beta gamma delta", { maxLength: 12 })).toBe("alpha-beta");
    expect(slugify("alpha beta gamma delta", { maxLength: 10 })).toBe("alpha-beta");
    expect(slugify("a " + "b".repeat(50), { maxLength: 10 })).toBe("a-bbbbbbbb");
  });

  it("never leaves a trailing hyphen", () => {
    for (let max = 8; max <= 30; max++) {
      const out = slugify("ab cd ef gh ij kl mn op qr st uv wx yz", { maxLength: max });
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("fits the fallback into small budgets", () => {
    expect(slugify("你好", { maxLength: 8 })).toMatch(/^[0-9a-z]{7}$/);
    expect(slugify("你好", { maxLength: 12 })).toMatch(/^unti-[0-9a-z]{7}$/);
  });

  it("validates maxLength", () => {
    expect(() => slugify("x", { maxLength: 7 })).toThrow(RangeError);
    expect(() => slugify("x", { maxLength: 257 })).toThrow(RangeError);
    expect(() => slugify("x", { maxLength: 10.5 })).toThrow(RangeError);
    expect(slugify("x", { maxLength: 8 })).toBe("x");
  });

  it("truncateSlug leaves short slugs alone", () => {
    expect(truncateSlug("abc", 8)).toBe("abc");
  });
});

describe("slugCandidate / uniqueSlug", () => {
  it("numbers candidates within maxLength", () => {
    expect(slugCandidate("report", 1)).toBe("report");
    expect(slugCandidate("report", 2)).toBe("report-2");
    expect(slugCandidate("abcdefgh", 10, 8)).toBe("abcde-10");
    expect(slugCandidate("a".repeat(64), 2)).toBe("a".repeat(62) + "-2");
    expect(() => slugCandidate("x", 0)).toThrow(RangeError);
  });

  it("finds the first free candidate with sync or async predicates", async () => {
    const taken = new Set(["report", "report-2"]);
    expect(await uniqueSlug("report", (s) => taken.has(s))).toBe("report-3");
    expect(await uniqueSlug("report", async (s) => taken.has(s))).toBe("report-3");
    expect(await uniqueSlug("fresh", () => false)).toBe("fresh");
  });

  it("gives up after maxAttempts", async () => {
    await expect(uniqueSlug("x", () => true, { maxAttempts: 3 })).rejects.toThrow(/after 3 attempts/);
  });
});
