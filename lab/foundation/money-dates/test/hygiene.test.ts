// Guards the module's core promises against future edits: src/ never touches
// the host clock, host timezone, Intl, randomness, or float parsing, and has
// no imports beyond its own files.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const srcDir = new URL("../src/", import.meta.url).pathname;
const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/\bnew Date\b|\bDate\.(now|parse|UTC)\b/, "host clock / Date"],
  [/\bIntl\b|toLocale\w*String/, "Intl / locale formatting"],
  [/\bgetTimezoneOffset\b|\bprocess\.env\b|\bTZ\b/, "host timezone"],
  [/\bMath\.random\b/, "randomness"],
  [/\bparseFloat\b|\btoFixed\b|\bNumber\.parseFloat\b/, "float parsing / rounding"],
];

describe("source hygiene", () => {
  test("src/ has files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s avoids forbidden APIs", (file) => {
    const code = readFileSync(join(srcDir, file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)) // drop comment lines
      .join("\n");
    for (const [re, label] of FORBIDDEN) {
      expect(re.test(code), `${file} uses ${label}`).toBe(false);
    }
    for (const m of code.matchAll(/from\s+"([^"]+)"/g)) {
      expect(m[1]!.startsWith("./"), `${file} imports ${m[1]}`).toBe(true);
    }
  });
});
