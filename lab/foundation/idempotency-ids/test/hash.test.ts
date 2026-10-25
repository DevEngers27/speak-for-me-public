import { describe, expect, it } from "vitest";
import { canonicalDigest, encodeBase32, encodeHex, sha256, sha256Hex, utf8Encode } from "../src/index";

const RFC4648 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
/** Translate an unpadded RFC 4648 base32 vector into this package's alphabet. */
const toCrockford = (rfc: string): string => [...rfc].map((c) => CROCKFORD.charAt(RFC4648.indexOf(c))).join("");

describe("encodeBase32", () => {
  // RFC 4648 section 10 test vectors, padding removed.
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [input, expected] of vectors) {
    it(`encodes ${JSON.stringify(input)}`, () => {
      expect(encodeBase32(utf8Encode(input))).toBe(toCrockford(expected));
    });
  }

  it("handles all-zero and all-one bytes", () => {
    expect(encodeBase32(new Uint8Array([0]))).toBe("00");
    expect(encodeBase32(new Uint8Array([255, 255, 255, 255, 255]))).toBe("zzzzzzzz");
  });

  it("produces ceil(bits/5) characters", () => {
    for (let n = 0; n <= 40; n++) {
      expect(encodeBase32(new Uint8Array(n).fill(0xa5)).length).toBe(Math.ceil((n * 8) / 5));
    }
  });
});

describe("sha256", () => {
  it("matches FIPS 180-2 vectors", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes strings as UTF-8", async () => {
    expect(await sha256Hex("é")).toBe(await sha256Hex(new Uint8Array([0xc3, 0xa9])));
  });

  it("accepts an injected implementation and validates its output size", async () => {
    const fake = async (data: Uint8Array): Promise<Uint8Array> => new Uint8Array(32).fill(data.length);
    expect(encodeHex(await sha256("abc", { sha256: fake }))).toBe("03".repeat(32));
    const broken = async (): Promise<Uint8Array> => new Uint8Array(16);
    await expect(sha256("abc", { sha256: broken })).rejects.toThrow(/expected 32/);
  });

  it("canonicalDigest ignores key order", async () => {
    const a = await canonicalDigest({ a: 1, b: [1, 2] });
    const b = await canonicalDigest({ b: [1, 2], a: 1 });
    expect(encodeHex(a)).toBe(encodeHex(b));
    expect(encodeHex(a)).toBe(await sha256Hex('{"a":1,"b":[1,2]}'));
  });
});
