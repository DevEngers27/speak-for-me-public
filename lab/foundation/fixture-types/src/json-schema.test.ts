import { describe, expect, it } from "vitest";
import { scenarioFixtureJsonSchema } from "./schema";

type Node = { properties?: Record<string, Node>; items?: Node; [key: string]: unknown };

describe("scenarioFixtureJsonSchema", () => {
  const schema = scenarioFixtureJsonSchema() as Node;
  const item = schema.properties?.["catalog"]?.properties?.["items"]?.items;

  it("is closed and requires provenance", () => {
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toContain("provenance");
    expect(schema.properties?.["provenance"]?.properties?.["simulated"]?.["const"]).toBe(true);
  });

  it("keeps integer cents and calendar dates", () => {
    expect(item?.properties?.["priceCents"]).toMatchObject({ type: "integer", minimum: 0 });
    expect(item?.properties?.["earliestDate"]).toMatchObject({ type: "string", format: "date" });
    expect(item?.["additionalProperties"]).toBe(false);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(scenarioFixtureJsonSchema())).toBe(JSON.stringify(schema));
  });
});
