/**
 * Utility to convert Zod schemas to JSON Schema objects for MCP tool registration.
 *
 * MCP expects JSON Schema for inputSchema. Zod provides a runtime-validated
 * superset. This bridge produces a clean JSON Schema object from a Zod schema.
 *
 * Written against Zod 4 internals (`schema._zod.def.type`, `schema.description`).
 * It deliberately mirrors the output of the previous Zod 3 converter so the
 * MCP tool schemas stay byte-for-byte identical (z.toJSONSchema would add
 * `$schema`, `additionalProperties: false`, `prefixItems`, defaults, etc.).
 */

import type { ZodType } from "zod";

type Def = Record<string, unknown> & { type: string };

function defOf(schema: ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

/**
 * Convert a Zod schema to a plain JSON Schema object suitable for MCP tool registration.
 *
 * This is a lightweight converter that handles the shapes we actually use.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return zodTypeToJson(schema);
}

function zodTypeToJson(schema: ZodType): Record<string, unknown> {
  const def = defOf(schema);

  switch (def.type) {
    case "object":
      return zodObjectToJson(schema);
    case "string":
      return withDescription(schema, { type: "string" });
    case "number":
      return withDescription(schema, { type: "number" });
    case "boolean":
      return withDescription(schema, { type: "boolean" });
    case "array":
      return withDescription(schema, {
        type: "array",
        items: zodTypeToJson(def.element as ZodType),
      });
    case "enum":
      return withDescription(schema, {
        type: "string",
        enum: Object.values(def.entries as Record<string, string>),
      });
    case "optional":
    case "default":
      return zodTypeToJson(def.innerType as ZodType);
    case "nullable": {
      const inner = zodTypeToJson(def.innerType as ZodType);
      return { ...inner, nullable: true };
    }
    case "literal": {
      const value = (def.values as unknown[])[0];
      return withDescription(schema, { type: typeof value, const: value });
    }
    case "record":
      return withDescription(schema, {
        type: "object",
        additionalProperties: zodTypeToJson(def.valueType as ZodType),
      });
    case "tuple": {
      const items = (def.items as ZodType[]).map(zodTypeToJson);
      return withDescription(schema, { type: "array", items, minItems: items.length, maxItems: items.length });
    }
    default:
      return { type: "object" };
  }
}

function zodObjectToJson(schema: ZodType): Record<string, unknown> {
  const shape = defOf(schema).shape as Record<string, ZodType>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodTypeToJson(value);

    // A field is required unless it's optional or has a default
    const fieldType = defOf(value).type;
    if (fieldType !== "optional" && fieldType !== "default") {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  if (schema.description) {
    result.description = schema.description;
  }

  return result;
}

function withDescription(schema: ZodType, json: Record<string, unknown>): Record<string, unknown> {
  if (schema.description) {
    return { ...json, description: schema.description };
  }
  return json;
}
