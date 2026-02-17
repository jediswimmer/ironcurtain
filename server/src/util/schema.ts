/**
 * Utility to convert Zod schemas to JSON Schema objects for MCP tool registration.
 *
 * MCP expects JSON Schema for inputSchema. Zod provides a runtime-validated
 * superset. This bridge produces a clean JSON Schema object from a Zod schema.
 */

import type { ZodType, ZodObject, ZodRawShape } from "zod";

/**
 * Convert a Zod schema to a plain JSON Schema object suitable for MCP tool registration.
 *
 * This is a lightweight converter that handles the shapes we actually use.
 * For full fidelity, consider zod-to-json-schema, but we avoid the extra dependency.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return zodTypeToJson(schema);
}

function zodTypeToJson(schema: ZodType): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case "ZodObject":
      return zodObjectToJson(schema as ZodObject<ZodRawShape>);
    case "ZodString":
      return withDescription(def, { type: "string" });
    case "ZodNumber":
      return withDescription(def, { type: "number" });
    case "ZodBoolean":
      return withDescription(def, { type: "boolean" });
    case "ZodArray":
      return withDescription(def, {
        type: "array",
        items: zodTypeToJson(def.type as ZodType),
      });
    case "ZodEnum":
      return withDescription(def, {
        type: "string",
        enum: (def as { values: string[] }).values,
      });
    case "ZodOptional":
      return zodTypeToJson(def.innerType as ZodType);
    case "ZodDefault":
      return zodTypeToJson(def.innerType as ZodType);
    case "ZodNullable": {
      const inner = zodTypeToJson(def.innerType as ZodType);
      return { ...inner, nullable: true };
    }
    case "ZodLiteral":
      return withDescription(def, { type: typeof def.value, const: def.value });
    case "ZodRecord":
      return withDescription(def, {
        type: "object",
        additionalProperties: zodTypeToJson(def.valueType as ZodType),
      });
    case "ZodTuple": {
      const items = (def.items as ZodType[]).map(zodTypeToJson);
      return withDescription(def, { type: "array", items, minItems: items.length, maxItems: items.length });
    }
    default:
      return { type: "object" };
  }
}

function zodObjectToJson(schema: ZodObject<ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const fieldDef = (value as { _def: Record<string, unknown> })._def;
    properties[key] = zodTypeToJson(value as ZodType);

    // A field is required unless it's ZodOptional or ZodDefault
    const fieldTypeName = fieldDef.typeName as string;
    if (fieldTypeName !== "ZodOptional" && fieldTypeName !== "ZodDefault") {
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

  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  if (def.description) {
    result.description = def.description;
  }

  return result;
}

function withDescription(
  def: Record<string, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (def.description) {
    return { ...schema, description: def.description as string };
  }
  return schema;
}
