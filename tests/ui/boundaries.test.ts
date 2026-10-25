// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("F8 executable boundary regressions", () => {
  it("W1-6-r05 lint rejects actual main-engine, scenario, and relative-core imports and accepts the UI entry", async () => {
    const eslint = new ESLint();
    for (const specifier of ["@core/engine", "@core/scenarios/scope-change/fixtures", "../../core/engine/index"]) {
      const results = await eslint.lintText(`import * as value from '${specifier}'; export { value };`, { filePath: "src/lib/boundary-counterexample.ts" });
      expect(results.flatMap((result) => result.messages).some((message) => message.ruleId === "no-restricted-imports")).toBe(true);
    }
    const valid = await eslint.lintText("import { APP_NAME } from '@core/engine/ui'; export { APP_NAME };", { filePath: "src/lib/boundary-positive.ts" });
    expect(valid.flatMap((result) => result.messages)).toEqual([]);
  });

  it("I-FE-10 W1-6-r03 traverses the reachable product import graph and rejects prototype or role-switch imports", () => {
    const seen = new Set<string>();
    function visit(path: string) {
      path = resolve(path);
      if (seen.has(path)) return;
      seen.add(path);
      const text = readFileSync(path, "utf8");
      expect(text).not.toMatch(/MockWorkspace|Preview as|lib\/mock|components\/mock/);
      for (const match of text.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)) {
        const specifier = match[2]!;
        const base = specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(path), specifier) : null;
        if (base === null) continue;
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
        if (target) visit(target);
      }
    }
    for (const route of ["src/app/(app)/layout.tsx", "src/app/(app)/rooms/layout.tsx", "src/app/(app)/rooms/page.tsx", "src/app/(app)/rooms/new/page.tsx", "src/app/(app)/rooms/[roomId]/layout.tsx", ...["", "/brief", "/people", "/results", "/timeline", "/requests/[requestId]", "/proposals/[proposalId]"].map((suffix) => `src/app/(app)/rooms/[roomId]${suffix}/page.tsx`)]) visit(route);
    expect(seen.size).toBeGreaterThan(25);
    expect([...seen].some((path) => path.endsWith("RoomScreens.tsx"))).toBe(true);
  });
});
