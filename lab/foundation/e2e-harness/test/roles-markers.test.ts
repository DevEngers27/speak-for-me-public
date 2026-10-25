import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMarkers } from "../src/markers.ts";
import { ROLE_SLOTS, isRoleSlot, mapRoles, mapRolesAsync } from "../src/roles.ts";

describe("roles", () => {
  it("has exactly three positional slots", () => {
    assert.deepEqual([...ROLE_SLOTS], ["A", "B", "C"]);
    assert.ok(isRoleSlot("B"));
    assert.ok(!isRoleSlot("D"));
    assert.deepEqual(mapRoles((s) => s.toLowerCase()), { A: "a", B: "b", C: "c" });
  });

  it("mapRolesAsync runs slots concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapRolesAsync(async (slot) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return slot;
    });
    assert.deepEqual(result, { A: "A", B: "B", C: "C" });
    assert.equal(peak, 3);
  });

  it("mapRolesAsync reports every failing slot and waits for all", async () => {
    let finished = 0;
    await assert.rejects(
      mapRolesAsync(async (slot) => {
        await new Promise((r) => setTimeout(r, slot === "B" ? 30 : 5));
        finished++;
        if (slot !== "B") throw new Error(`bad ${slot}`);
        return slot;
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(error.message, /A: bad A; C: bad C/);
        return true;
      },
    );
    assert.equal(finished, 3);
  });
});

describe("findMarkers", () => {
  it("reports each marker per source with an excerpt", () => {
    const hits = findMarkers(
      [
        { source: "dom", text: "<p>hello CANARY-1 world</p>" },
        { source: "ws:received", text: '{"x":"CANARY-1","y":"CANARY-2"}' },
        { source: "ws:sent", text: "nothing here" },
      ],
      ["CANARY-1", "CANARY-2", ""],
    );
    assert.deepEqual(
      hits.map((h) => `${h.marker}@${h.source}`),
      ["CANARY-1@dom", "CANARY-1@ws:received", "CANARY-2@ws:received"],
    );
    assert.ok(hits[0]?.excerpt.includes("hello CANARY-1 world"));
  });

  it("returns nothing when no marker occurs", () => {
    assert.deepEqual(findMarkers([{ source: "dom", text: "clean" }], ["CANARY"]), []);
  });
});
