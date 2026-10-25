import { describe, expect, test } from "vitest";
import {
  StrictSchemaError,
  apiSubsetViolations,
  assertNoForbiddenPropertyNames,
  countConstraintKeywords,
  isForbiddenPropertyName,
  toStrictOutputSchema,
} from "./strictSchema";

const canonicalTurnRawSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    turn: {
      oneOf: [
        {
          type: "object",
          properties: {
            action: { type: "string", const: "propose" },
            optionKey: {
              type: "string",
              enum: ["O1", "O2"],
              description: "One optionKey from <candidates>.",
            },
            rationale: {
              type: "string",
              minLength: 1,
              maxLength: 1200,
              description: "Private note for your own principal.",
            },
          },
          required: ["action", "optionKey", "rationale"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            action: { type: "string", const: "counter" },
            optionKey: { type: "string", enum: ["O1", "O2"] },
            baseProposalVersion: {
              type: "integer",
              minimum: 1,
              maximum: 1000000,
              description: "Proposal version number shown in <room_state>.",
            },
            rationale: { type: "string", minLength: 1, maxLength: 1200 },
          },
          required: ["action", "optionKey", "baseProposalVersion", "rationale"],
        },
        {
          type: "object",
          properties: {
            action: { type: "string", const: "clarify" },
            toRole: { type: "string", enum: ["customer", "provider", "finance"] },
            topicKey: { type: "string", enum: ["budget_cap", "scope_priority"] },
            rationale: { type: "string", minLength: 1, maxLength: 1200 },
          },
          required: ["action", "toRole", "topicKey", "rationale"],
        },
        {
          type: "object",
          properties: {
            action: { type: "string", const: "recommend_accept" },
            proposalVersion: { type: "integer", minimum: 1, maximum: 1000000 },
            rationale: { type: "string", minLength: 1, maxLength: 1200 },
          },
          required: ["action", "proposalVersion", "rationale"],
        },
        {
          type: "object",
          properties: {
            action: { type: "string", const: "reject" },
            proposalVersion: {
              anyOf: [{ type: "integer", minimum: 1, maximum: 1000000 }, { type: "null" }],
            },
            reasonKey: {
              type: "string",
              enum: ["scope_insufficient", "delivery_too_late", "price_poor_value", "other"],
            },
            rationale: { type: "string", minLength: 1, maxLength: 1200 },
          },
          required: ["action", "proposalVersion", "reasonKey", "rationale"],
        },
        {
          type: "object",
          properties: {
            action: { type: "string", const: "escalate" },
            kind: { type: "string", enum: ["infeasible", "needs_tradeoff"] },
            toRole: { type: "string", enum: ["customer", "provider", "finance"] },
            rationale: { type: "string", minLength: 1, maxLength: 1200 },
          },
          required: ["action", "kind", "toRole", "rationale"],
        },
      ],
    },
  },
  required: ["turn"],
  additionalProperties: false,
};

describe("core/engine/strictSchema", () => {
  test("preserves enum/const, rewrites oneOf -> anyOf, strips $schema, and forces additionalProperties: false (D09)", () => {
    const strict = toStrictOutputSchema(canonicalTurnRawSchema);

    expect(strict.$schema).toBeUndefined();
    expect(strict.type).toBe("object");
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(["turn"]);

    const turnNode = strict.properties.turn;
    expect(turnNode.oneOf).toBeUndefined();
    expect(Array.isArray(turnNode.anyOf)).toBe(true);
    expect((turnNode.anyOf as unknown[]).length).toBe(6);

    // Every enum and const across all 6 branches is preserved.
    expect(countConstraintKeywords(strict)).toEqual({ enum: 7, const: 6 });

    // No unsupported keywords remain; static API subset check passes.
    expect(apiSubsetViolations(strict)).toEqual([]);

    // Unsupported numeric/length constraints are folded into description and recorded in dropped.
    const proposeBranch = (turnNode.anyOf as Record<string, unknown>[])[0]!;
    expect(proposeBranch.additionalProperties).toBe(false);
    const rationaleProp = (proposeBranch.properties as Record<string, Record<string, unknown>>)
      .rationale!;
    expect(rationaleProp.minLength).toBeUndefined();
    expect(rationaleProp.maxLength).toBeUndefined();
    expect(rationaleProp.description).toContain("{minLength: 1, maxLength: 1200}");
    expect(strict.dropped.length).toBeGreaterThan(0);
  });

  test("handles supported string formats, array minItems, and $defs/$ref", () => {
    const raw = {
      type: "object",
      $defs: {
        TagList: {
          type: "array",
          items: {
            type: "string",
            format: "uuid",
            pattern: "^[0-9a-f-]+$",
          },
          minItems: 1,
          maxItems: 5,
        },
      },
      properties: {
        turn: {
          type: "object",
          properties: {
            action: { type: "string", const: "propose" },
            tags: { $ref: "#/$defs/TagList" },
            extraTags: {
              type: "array",
              items: { type: "string", format: "custom-unsupported" },
              minItems: 2,
            },
          },
          required: ["action", "tags", "extraTags"],
        },
      },
      required: ["turn"],
    };

    const strict = toStrictOutputSchema(raw);
    expect(apiSubsetViolations(strict)).toEqual([]);

    const defs = strict.$defs as Record<string, Record<string, unknown>>;
    expect(defs.TagList?.minItems).toBe(1);
    expect(defs.TagList?.maxItems).toBeUndefined();
    expect(defs.TagList?.description).toBe("{maxItems: 5}");
    const tagItems = defs.TagList?.items as Record<string, unknown>;
    expect(tagItems.format).toBe("uuid");
    expect(tagItems.pattern).toBeUndefined();

    const extraTags = (
      (strict.properties.turn.properties as Record<string, Record<string, unknown>>).extraTags
    )!;
    expect(extraTags.minItems).toBeUndefined();
    expect(extraTags.description).toBe("{minItems: 2}");
    expect((extraTags.items as Record<string, unknown>).format).toBeUndefined();
    expect((extraTags.items as Record<string, unknown>).description).toBe(
      '{format: "custom-unsupported"}',
    );
  });

  test("requires root to be an object { turn: ... }", () => {
    // Bare discriminated union at root
    expect(() =>
      toStrictOutputSchema({
        oneOf: [{ type: "object", properties: { action: { type: "string", const: "propose" } } }],
      }),
    ).toThrow(StrictSchemaError);

    // Non-object root type
    expect(() =>
      toStrictOutputSchema({
        type: "string",
      }),
    ).toThrow(StrictSchemaError);

    // Object root without `turn` property
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          action: { type: "string", const: "propose" },
        },
        required: ["action"],
      }),
    ).toThrow(/turn/);

    // Object root with extra property alongside `turn`
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
          extra: { type: "string" },
        },
        required: ["turn", "extra"],
      }),
    ).toThrow(/turn/);

    // Root reference to a primitive ($ref at root must not bypass root validation, W0-3-r02)
    expect(() =>
      toStrictOutputSchema({
        $ref: "#/$defs/S",
        $defs: {
          S: { type: "string" },
        },
      }),
    ).toThrow(StrictSchemaError);

    // Root reference even when $defs entry is an object
    expect(() =>
      toStrictOutputSchema({
        $ref: "#/$defs/Root",
        $defs: {
          Root: {
            type: "object",
            properties: {
              turn: {
                type: "object",
                properties: { action: { type: "string" } },
                required: ["action"],
              },
            },
            required: ["turn"],
          },
        },
      }),
    ).toThrow(StrictSchemaError);
  });

  test("rejects empty, partial, or missing required arrays at root and nested levels (W0-3-r03)", () => {
    // Empty required array at root
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
              rationale: { type: "string" },
            },
            required: ["action", "rationale"],
          },
        },
        required: [],
      }),
    ).toThrow(StrictSchemaError);

    // Missing required array at root
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
            },
            required: ["action"],
          },
        },
      }),
    ).toThrow(StrictSchemaError);

    // Partial required array at nested level (missing rationale)
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
              rationale: { type: "string" },
            },
            required: ["action"],
          },
        },
        required: ["turn"],
      }),
    ).toThrow(/missing: rationale/);

    // Empty required array at nested level
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
              rationale: { type: "string" },
            },
            required: [],
          },
        },
        required: ["turn"],
      }),
    ).toThrow(StrictSchemaError);

    // Missing required array at nested level
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
              rationale: { type: "string" },
            },
          },
        },
        required: ["turn"],
      }),
    ).toThrow(StrictSchemaError);
  });

  test("throws on nodes without type (unless combinator or $ref)", () => {
    // Empty `{}` node (e.g. from z.any() / z.unknown())
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {},
        },
        required: ["turn"],
      }),
    ).toThrow(/missing required "type"/);

    // Node with description/properties but missing `type`
    expect(() =>
      toStrictOutputSchema({
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { description: "missing type" },
            },
            required: ["action"],
          },
        },
        required: ["turn"],
      }),
    ).toThrow(/missing required "type"/);
  });

  test("assertNoForbiddenPropertyNames and toStrictOutputSchema reject money, version, and identity property names", () => {
    // Allowed canonical reference names pass
    expect(() => assertNoForbiddenPropertyNames(canonicalTurnRawSchema)).not.toThrow();
    expect(isForbiddenPropertyName("proposalVersion")).toBe(false);
    expect(isForbiddenPropertyName("baseProposalVersion")).toBe(false);
    expect(isForbiddenPropertyName("toRole")).toBe(false);
    expect(isForbiddenPropertyName("optionKey")).toBe(false);
    expect(isForbiddenPropertyName("rationale")).toBe(false);

    const forbiddenNames = [
      // Money / budget
      "priceCents",
      "amountCents",
      "totalBudgetCents",
      "capCents",
      "headroomCents",
      "overByCents",
      "shortfallCents",
      "costMicroUsd",
      "price",
      "amount",
      "cost",
      "usd",
      "currency",
      "total",
      "fee",
      "budget",
      "cap",
      // Version / revision snapshots
      "version",
      "constraintsVersion",
      "constraintVersion",
      "catalogVersion",
      "schemaVersion",
      "scenarioVersion",
      "protocolVersion",
      "revision",
      "catalogRevision",
      // Identity / envelope
      "id",
      "userId",
      "actorUserId",
      "memberId",
      "participantId",
      "roomId",
      "runId",
      "turnId",
      "attemptId",
      "proposalId",
      "executionId",
      "envelopeId",
      "agentId",
      "role",
      "fromRole",
      "ownerRole",
      "actor",
      "tokenIdentifier",
      "clerkUserId",
      "createdBy",
      // Server-materialized terms / dates
      "deliveryDate",
      "deadline",
      "itemKeys",
      "itemKey",
      "modifiers",
      "termsKey",
      "candidateKey",
      "executionKey",
    ];

    for (const forbidden of forbiddenNames) {
      expect(isForbiddenPropertyName(forbidden), `${forbidden} should be forbidden`).toBe(true);

      const badSchema = {
        type: "object",
        properties: {
          turn: {
            type: "object",
            properties: {
              action: { type: "string", const: "propose" },
              [forbidden]: { type: "string" },
            },
            required: ["action", forbidden],
          },
        },
        required: ["turn"],
      };

      expect(() => assertNoForbiddenPropertyNames(badSchema), `reject ${forbidden}`).toThrow(
        StrictSchemaError,
      );
      expect(() => toStrictOutputSchema(badSchema), `toStrictOutputSchema reject ${forbidden}`).toThrow(
        StrictSchemaError,
      );
    }
  });
});
