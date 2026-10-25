import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BATTERY_REGISTRY,
  COUNTEREXAMPLES,
  INVARIANTS,
  reconcileBattery,
  UNCOVERED_INV_IDS,
  type BatteryEntry,
  type BatteryLayer,
} from "../index";

const LAYER_DIRS: Record<BatteryLayer, { dir: string; ext: string }> = {
  P: { dir: "tests/battery/pure", ext: ".test.ts" },
  CT: { dir: "tests/battery/convex", ext: ".test.ts" },
  RD: { dir: "tests/battery/real-deploy", ext: ".test.ts" },
  E2E: { dir: "tests/battery/e2e", ext: ".spec.ts" },
};

// Ratchet records executable tests, including pure/04's map-backed registrations.
const UNTESTED_BASELINE = 46; // Recomputed after merging W2-14 onto main (frontend)
const executedIds = new Set<string>();
for (const {dir, ext} of Object.values(LAYER_DIRS)) {
  for (const file of readdirSync(dir).filter(file => file.endsWith(ext) && file !== 'reconciliation.test.ts')) {
    const content = readFileSync(path.join(dir, file), 'utf8');
    for (const match of content.matchAll(/^\s*it\(["']((?:INV|CE)-(?:\d+|M1)) /gm)) executedIds.add(match[1]!);
    const map = content.match(/const implemented[^\n]*= \{([\s\S]*?)^\};/m)?.[1] ?? '';
    for (const match of map.matchAll(/^\s*['"]((?:INV|CE)-(?:\d+|M1))['"]:/gm)) executedIds.add(match[1]!);
  }
}

describe("battery registry reconciliation", () => {
  it("contains all 80 invariants (INV-01..INV-79 and INV-M1) and 175 counterexamples (CE-001..CE-175)", () => {
    expect(INVARIANTS).toHaveLength(80);
    expect(INVARIANTS.find(entry => entry.id === 'INV-M1')).toBeDefined();
    expect(COUNTEREXAMPLES).toHaveLength(175);
    expect(BATTERY_REGISTRY).toHaveLength(255);

    for (let i = 1; i <= 79; i++) {
      const id = `INV-${String(i).padStart(2, "0")}`;
      const entry = INVARIANTS.find((item) => item.id === id);
      expect(entry, `Missing invariant ${id}`).toBeDefined();
      expect(entry?.title.startsWith(`${id} `)).toBe(true);
    }

    for (let i = 1; i <= 175; i++) {
      const id = `CE-${String(i).padStart(3, "0")}`;
      const entry = COUNTEREXAMPLES.find((item) => item.id === id);
      expect(entry, `Missing counterexample ${id}`).toBeDefined();
      expect(entry?.title.startsWith(`${id} `)).toBe(true);
    }
  });

  it("asserts every INV has >= 1 CE (allowing explicitly listed uncovered INVs) and every CE references a known INV", () => {
    for (const id of ['INV-07', 'INV-19', 'INV-09', 'CE-006', 'INV-37', 'CE-073']) expect(executedIds.has(id), id).toBe(true);
    expect(executedIds.has('INV-13')).toBe(true);
    const report = reconcileBattery(BATTERY_REGISTRY, UNCOVERED_INV_IDS, executedIds);
    expect(report.emptyCoverCounterexamples).toEqual([]);
    expect(report.unknownCoverReferences).toEqual([]);
    expect(report.unexpectedUncoveredInvariants).toEqual([]);
    expect(report.unexpectedCoveredInvariants).toEqual([]);
    expect(report.structureOk).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.untestedIds).toHaveLength(UNTESTED_BASELINE);
  });

  it("rejects uncovered INVs outside the allowlist and unknown INV references in CEs", () => {
    const synthetic: BatteryEntry[] = [
      ...BATTERY_REGISTRY,
      {
        id: "INV-99",
        kind: "INV",
        layer: "P",
        chapter: "01-privacy-delegation",
        title: "INV-99 synthetic uncovered invariant",
        covers: ["INV-99"],
      },
      {
        id: "CE-999",
        kind: "CE",
        layer: "P",
        chapter: "01-privacy-delegation",
        title: "CE-999 synthetic broken counterexample",
        covers: ["INV-404"],
      },
    ];
    const report = reconcileBattery(synthetic, UNCOVERED_INV_IDS);
    expect(report.ok).toBe(false);
    expect(report.unexpectedUncoveredInvariants).toContain("INV-99");
    expect(report.unknownCoverReferences).toContainEqual({ ceId: "CE-999", invId: "INV-404" });
  });

  it("matches every registry entry 1-to-1 with a pending or implemented test in the corresponding layer and chapter file", () => {
    const todosOnDisk = new Map<string, { layer: BatteryLayer; chapter: string }>();

    for (const [layer, { dir, ext }] of Object.entries(LAYER_DIRS) as Array<
      [BatteryLayer, { dir: string; ext: string }]
    >) {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(ext) && file !== "reconciliation.test.ts",
      );
      for (const file of files) {
        const chapter = file.slice(0, -ext.length);
        const content = readFileSync(path.join(dir, file), "utf8");
        for (const line of content.split("\n")) {
          const match = line.match(/^\s*it(?:\.todo)?\(("(?:[^"\\]|\\.)*")(?:\);|,)/);
          if (!match?.[1]) continue;
          const title = JSON.parse(match[1]) as string;
          expect(todosOnDisk.has(title), `Duplicate todo title: ${title}`).toBe(false);
          todosOnDisk.set(title, { layer, chapter });
        }
      }
    }

    expect(todosOnDisk.size).toBe(BATTERY_REGISTRY.length);
    for (const entry of BATTERY_REGISTRY) {
      const found = todosOnDisk.get(entry.title);
      expect(found, `Missing test for ${entry.id}`).toEqual({
        layer: entry.layer,
        chapter: entry.chapter,
      });
    }
  });
});

// W1-1F: titles and ids must continue to match the design source after regeneration.
it('registry ids and verbatim titles match the current design source', () => {
  const directory = 'docs/design-work/final-v2';
  const sources = readdirSync(directory).filter(file => /^00-invariants-part\d+\.md$/.test(file));
  sources.push('16-testing-part8.md');
  const titles = new Map<string, string>();
  for (const file of sources) {
    for (const line of readFileSync(path.join(directory, file), 'utf8').split('\n')) {
      const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim());
      if (cells.length < 4) continue;
      let id = cells[0]!;
      if (file === '16-testing-part8.md' && /^17[1-5]$/.test(id)) id = `CE-${id}`;
      if (!/^(?:INV-(?:\d+|M1)|CE-\d+)$/.test(id) || titles.has(id)) continue;
      titles.set(id, `${id} ${cells[1]!.replace(/\\\|/g, '|')}`);
    }
  }
  expect(titles.size).toBe(255);
  for (const entry of BATTERY_REGISTRY) expect(entry.title, entry.id).toBe(titles.get(entry.id));
});

// W1-1F-r03: a formerly uncovered invariant cannot silently acquire a CE mapping.
it('rejects counterexample coverage of an explicitly uncovered invariant', () => {
  const corrupt = BATTERY_REGISTRY.map(entry => entry.id === 'CE-143' ? { ...entry, covers: [...entry.covers, 'INV-79', 'INV-M1'] } : entry);
  const report = reconcileBattery(corrupt, UNCOVERED_INV_IDS);
  expect(report.unexpectedCoveredInvariants).toEqual(['INV-79', 'INV-M1']);
  expect(report.structureOk).toBe(false);
  expect(report.ok).toBe(false);
  expect(BATTERY_REGISTRY.find(entry => entry.id === 'CE-143')?.covers).toEqual(['INV-76', 'INV-68']);
});
