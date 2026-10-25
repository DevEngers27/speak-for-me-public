/**
 * Pure JSON Schema -> strict JSON Schema transformer for structured model output
 * (canon §1.4, D09; 05 §5.4.3–5.4.4).
 *
 * Merges the spike generators (`lab/spikes/anthropic-zod/src/strict-format.ts` and
 * `lab/spikes/protocol-rules/src/jsonSchema.ts`) without importing `zod` so this
 * module can live in `core/engine/`.
 */

export type JsonSchemaNode = Record<string, unknown>;

export class StrictSchemaError extends Error {
  override readonly name = "StrictSchemaError";
}

export const SUPPORTED_STRING_FORMATS: ReadonlySet<string> = new Set<string>([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const ALLOWED_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "type",
  "anyOf",
  "allOf",
  "description",
  "title",
  "properties",
  "required",
  "additionalProperties",
  "format",
  "items",
  "minItems",
  "$ref",
  "$defs",
  "enum",
  "const",
]);

/**
 * Property names explicitly allowed in `AgentModelOutput` that reference
 * server-known integers or recipient roles (canon §1.4, 05 §5.4.4).
 */
export const ALLOWED_MODEL_REFERENCE_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "proposalVersion",
  "baseProposalVersion",
  "toRole",
]);

/**
 * Forbidden property name patterns in model output schemas (canon §1.4, D09, D10, 05 §5.4.4):
 * - Money / budget: cents, amount, price, cost, usd, currency, total, fee, budget, cap, headroom, shortfall
 * - Version / revision snapshots: version, constraintsVersion, catalogVersion, schemaVersion, revision, etc.
 *   (except `proposalVersion` and `baseProposalVersion` which are small integer references)
 * - Identity / envelope / IDs: userId, actorUserId, memberId, participantId, roomId, runId, turnId,
 *   attemptId, proposalId, executionId, envelopeId, agentId, id, role, fromRole, ownerRole, actor,
 *   tokenIdentifier, clerkUserId, createdBy
 * - Server-materialized terms: deliveryDate, deadline, itemKeys, itemKey, modifiers, termsKey,
 *   candidateKey, executionKey
 */
export const FORBIDDEN_PROPERTY_NAME_PATTERN =
  /cents|amount|price|cost|usd|currency|total|fee|budget|^cap$|capcents|headroom|shortfall|microusd|version|revision|userid|actor|memberid|participantid|clerk|tokenidentifier|roomid|runid|turnid|attemptid|proposalid|executionid|envelopeid|agentid|^id$|^role$|fromrole|ownerrole|createdby|deliverydate|deadline|itemkeys?|modifiers|termskey|candidatekey|executionkey/i;

function isPlainObject(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a single property name is forbidden in a model-output schema.
 */
export function isForbiddenPropertyName(propName: string): boolean {
  if (ALLOWED_MODEL_REFERENCE_PROPERTIES.has(propName)) {
    return false;
  }
  return FORBIDDEN_PROPERTY_NAME_PATTERN.test(propName);
}

/**
 * Recursively traverses a JSON Schema and throws a `StrictSchemaError` if any object
 * `properties` map declares a forbidden property name (money, version, identity, raw terms).
 */
export function assertNoForbiddenPropertyNames(schema: unknown, path = ""): void {
  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      assertNoForbiddenPropertyNames(schema[i], `${path}/${i}`);
    }
    return;
  }
  if (!isPlainObject(schema)) {
    return;
  }

  if (isPlainObject(schema.properties)) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propPath = `${path}/properties/${propName}`;
      if (isForbiddenPropertyName(propName)) {
        throw new StrictSchemaError(
          `Forbidden property name "${propName}" at ${propPath} (model schema must not contain money, version, or identity fields)`,
        );
      }
      assertNoForbiddenPropertyNames(propSchema, propPath);
    }
  }

  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"] as const) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      for (let i = 0; i < branch.length; i++) {
        assertNoForbiddenPropertyNames(branch[i], `${path}/${key}/${i}`);
      }
    }
  }

  if (isPlainObject(schema.items)) {
    assertNoForbiddenPropertyNames(schema.items, `${path}/items`);
  }

  for (const defsKey of ["$defs", "definitions"] as const) {
    const defs = schema[defsKey];
    if (isPlainObject(defs)) {
      for (const [defName, defSchema] of Object.entries(defs)) {
        assertNoForbiddenPropertyNames(defSchema, `${path}/${defsKey}/${defName}`);
      }
    }
  }

  if (isPlainObject(schema.additionalProperties)) {
    assertNoForbiddenPropertyNames(schema.additionalProperties, `${path}/additionalProperties`);
  }
}

function transformNode(
  input: unknown,
  path: string,
  isRoot: boolean,
  dropped: string[],
): JsonSchemaNode {
  if (!isPlainObject(input)) {
    throw new StrictSchemaError(`Schema node at ${path || "/"} must be an object`);
  }

  const s: JsonSchemaNode = { ...input };
  const out: JsonSchemaNode = {};

  const take = (k: string): unknown => {
    const v = s[k];
    delete s[k];
    return v;
  };

  if (isRoot) {
    delete s.$schema;
  } else if ("$schema" in s) {
    delete s.$schema;
    dropped.push(`${path}/$schema`);
  }

  const defs = take("$defs");
  if (isPlainObject(defs)) {
    const transformedDefs: JsonSchemaNode = {};
    for (const [defKey, defVal] of Object.entries(defs)) {
      transformedDefs[defKey] = transformNode(defVal, `${path}/$defs/${defKey}`, false, dropped);
    }
    out.$defs = transformedDefs;
  }

  const ref = take("$ref");
  const rawType = take("type");
  const rawAnyOf = take("anyOf");
  const rawOneOf = take("oneOf");
  const rawAllOf = take("allOf");

  const hasCombinator =
    Array.isArray(rawAnyOf) || Array.isArray(rawOneOf) || Array.isArray(rawAllOf);

  if (isRoot) {
    if (ref !== undefined) {
      throw new StrictSchemaError(
        'Root schema must be an inline object wrapping { turn: ... }, not a $ref',
      );
    }
    if (rawType !== "object" || hasCombinator) {
      throw new StrictSchemaError(
        `Root schema must have type: "object" wrapping { turn: ... } (got ${
          rawType === undefined ? "no type" : JSON.stringify(rawType)
        })`,
      );
    }
    const rootProps = s.properties;
    if (
      !isPlainObject(rootProps) ||
      !Object.hasOwn(rootProps, "turn") ||
      Object.keys(rootProps).length !== 1
    ) {
      throw new StrictSchemaError(
        "Root schema must be an object with exact property { turn: ... }",
      );
    }
  }

  if (ref !== undefined) {
    if (typeof ref !== "string" || ref.length === 0) {
      throw new StrictSchemaError(`Invalid $ref at ${path || "/"}`);
    }
    out.$ref = ref;
    return out;
  }

  if (!hasCombinator && typeof rawType !== "string") {
    throw new StrictSchemaError(
      `Schema node at ${path || "/"} is missing required "type" (or anyOf/oneOf/allOf/$ref)`,
    );
  }

  if (Array.isArray(rawAnyOf)) {
    if (rawAnyOf.length === 0) {
      throw new StrictSchemaError(`Empty anyOf at ${path || "/"}`);
    }
    out.anyOf = rawAnyOf.map((branch, idx) =>
      transformNode(branch, `${path}/anyOf/${idx}`, false, dropped),
    );
  } else if (Array.isArray(rawOneOf)) {
    if (rawOneOf.length === 0) {
      throw new StrictSchemaError(`Empty oneOf at ${path || "/"}`);
    }
    out.anyOf = rawOneOf.map((branch, idx) =>
      transformNode(branch, `${path}/oneOf/${idx}`, false, dropped),
    );
  } else if (Array.isArray(rawAllOf)) {
    if (rawAllOf.length === 0) {
      throw new StrictSchemaError(`Empty allOf at ${path || "/"}`);
    }
    out.allOf = rawAllOf.map((branch, idx) =>
      transformNode(branch, `${path}/allOf/${idx}`, false, dropped),
    );
  }

  if (typeof rawType === "string") {
    out.type = rawType;
  }

  for (const k of ["enum", "const", "description", "title"] as const) {
    const v = take(k);
    if (v !== undefined) {
      out[k] = v;
    }
  }

  if (rawType === "object") {
    const rawProps = take("properties");
    if (rawProps !== undefined && !isPlainObject(rawProps)) {
      throw new StrictSchemaError(`"properties" at ${path || "/"} must be an object`);
    }
    const propsObj = (rawProps ?? {}) as JsonSchemaNode;
    const transformedProps: JsonSchemaNode = {};
    for (const [propKey, propVal] of Object.entries(propsObj)) {
      transformedProps[propKey] = transformNode(
        propVal,
        `${path}/properties/${propKey}`,
        false,
        dropped,
      );
    }
    out.properties = transformedProps;
    take("additionalProperties");
    out.additionalProperties = false;

    const propKeys = Object.keys(transformedProps);
    const rawRequired = take("required");
    if (
      !Array.isArray(rawRequired) ||
      !rawRequired.every((k): k is string => typeof k === "string")
    ) {
      if (propKeys.length > 0 || rawRequired !== undefined) {
        throw new StrictSchemaError(
          `Object schema at ${path || "/"} must have a "required" array covering all declared properties`,
        );
      }
      out.required = [];
    } else {
      const reqSet = new Set(rawRequired);
      const missing = propKeys.filter((k) => !reqSet.has(k));
      if (missing.length > 0) {
        throw new StrictSchemaError(
          `Object schema at ${path || "/"} must require all declared properties (missing: ${missing.join(", ")})`,
        );
      }
      const unknown = rawRequired.filter((k) => !Object.hasOwn(transformedProps, k));
      if (unknown.length > 0) {
        throw new StrictSchemaError(
          `Object schema at ${path || "/"} lists undeclared required properties (${unknown.join(", ")})`,
        );
      }
      out.required = [...reqSet];
    }
  } else if (rawType === "string") {
    const format = take("format");
    if (typeof format === "string" && SUPPORTED_STRING_FORMATS.has(format)) {
      out.format = format;
      if ("pattern" in s) {
        delete s.pattern;
        dropped.push(`${path}/pattern`);
      }
    } else if (format !== undefined) {
      s.format = format;
    }
  } else if (rawType === "array") {
    const items = take("items");
    if (items !== undefined) {
      out.items = transformNode(items, `${path}/items`, false, dropped);
    }
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) {
      out.minItems = minItems;
    } else if (minItems !== undefined) {
      s.minItems = minItems;
    }
  }

  const rest = Object.entries(s);
  if (rest.length > 0) {
    for (const [k] of rest) {
      dropped.push(`${path}/${k}`);
    }
    const hint = "{" + rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") + "}";
    out.description =
      typeof out.description === "string" && out.description.length > 0
        ? `${out.description}\n\n${hint}`
        : hint;
  }

  return out;
}

export type StrictOutputSchema = JsonSchemaNode & {
  readonly type: "object";
  readonly properties: { readonly turn: JsonSchemaNode };
  readonly required: readonly string[];
  readonly additionalProperties: false;
  /** Non-enumerable self-reference for compatibility with `{ schema, dropped }` callers. */
  readonly schema: JsonSchemaNode;
  /** Non-enumerable list of JSON Pointers for keywords folded into `description`. */
  readonly dropped: readonly string[];
};

/**
 * Transforms a JSON Schema (as produced by `z.toJSONSchema`) into a strict JSON Schema
 * suitable for `output_config.format`:
 * - Rejects forbidden property names (money, version, identity) via `assertNoForbiddenPropertyNames`.
 * - Requires root `{ type: "object", properties: { turn: ... } }`.
 * - Throws on any schema node without `type` (unless it is a combinator `anyOf`/`oneOf`/`allOf` or `$ref`).
 * - Preserves `enum` and `const`.
 * - Rewrites `oneOf` to `anyOf`.
 * - Forces `additionalProperties: false` on every object node.
 * - Moves unsupported constraint keywords (`minLength`, `maxLength`, `minimum`, `maximum`, etc.) into `description`.
 */
export function toStrictOutputSchema(jsonSchema: unknown): StrictOutputSchema {
  if (!isPlainObject(jsonSchema)) {
    throw new StrictSchemaError("Schema root must be a non-null object");
  }
  assertNoForbiddenPropertyNames(jsonSchema);

  const dropped: string[] = [];
  const strict = transformNode(jsonSchema, "", true, dropped);
  const frozenDropped = Object.freeze(dropped);

  Object.defineProperty(strict, "schema", {
    value: strict,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(strict, "dropped", {
    value: frozenDropped,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return strict as StrictOutputSchema;
}

/** Static check against the documented structured-output JSON Schema subset. */
export function apiSubsetViolations(schema: unknown, path = ""): string[] {
  const violations: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => violations.push(...apiSubsetViolations(s, `${path}/${i}`)));
    return violations;
  }
  if (!isPlainObject(schema)) return violations;

  for (const k of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(k)) {
      violations.push(`${path}: unsupported keyword ${k}`);
    }
  }

  if (schema.type === "object" || "properties" in schema) {
    if (schema.additionalProperties !== false) {
      violations.push(`${path}: additionalProperties must be false`);
    }
    const props = isPlainObject(schema.properties) ? Object.keys(schema.properties) : [];
    const req = Array.isArray(schema.required) ? schema.required : [];
    for (const p of props) {
      if (!req.includes(p)) {
        violations.push(`${path}: optional property ${p}`);
      }
    }
  }

  if (typeof schema.minItems === "number" && schema.minItems > 1) {
    violations.push(`${path}: minItems > 1`);
  }
  if (typeof schema.format === "string" && !SUPPORTED_STRING_FORMATS.has(schema.format)) {
    violations.push(`${path}: format ${schema.format}`);
  }

  for (const [k, child] of Object.entries(schema)) {
    if (k === "enum" || k === "const" || k === "required") continue;
    if ((k === "properties" || k === "$defs") && isPlainObject(child)) {
      for (const [pk, pv] of Object.entries(child)) {
        violations.push(...apiSubsetViolations(pv, `${path}/${k}/${pk}`));
      }
      continue;
    }
    violations.push(...apiSubsetViolations(child, `${path}/${k}`));
  }
  return violations;
}

/** Count `enum` and `const` keywords in a JSON Schema tree. */
export function countConstraintKeywords(schema: unknown): { enum: number; const: number } {
  const acc = { enum: 0, const: 0 };
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!isPlainObject(n)) return;
    if ("enum" in n) acc.enum++;
    if ("const" in n) acc.const++;
    for (const [k, c] of Object.entries(n)) {
      if (k !== "enum" && k !== "const") walk(c);
    }
  };
  walk(schema);
  return acc;
}
