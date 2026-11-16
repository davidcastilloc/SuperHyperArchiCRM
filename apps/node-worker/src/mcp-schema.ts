import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function unwrapZod(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
} {
  let current: z.ZodTypeAny = schema;
  let optional = false;
  // Unwrap ZodOptional, ZodDefault, ZodNullable, ZodEffects
  for (let i = 0; i < 6; i++) {
    const def = current._def as {
      typeName?: string;
      innerType?: z.ZodTypeAny;
      schema?: z.ZodTypeAny;
    };
    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
      optional = true;
      if (def.innerType) {
        current = def.innerType;
        continue;
      }
    }
    if (def.typeName === 'ZodNullable' && def.innerType) {
      current = def.innerType;
      continue;
    }
    if (def.typeName === 'ZodEffects' && def.schema) {
      current = def.schema;
      continue;
    }
    break;
  }
  return { inner: current, optional };
}

function zodToJsonSchemaNode(schema: z.ZodTypeAny): JsonSchema {
  const { inner } = unwrapZod(schema);
  const def = inner._def as {
    typeName?: string;
    shape?: () => Record<string, z.ZodTypeAny>;
    values?: readonly string[];
    value?: unknown;
    type?: z.ZodTypeAny;
  };

  switch (def.typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values ?? [] };
    case 'ZodLiteral':
      return { const: def.value };
    case 'ZodArray':
      return {
        type: 'array',
        items: def.type ? zodToJsonSchemaNode(def.type) : {},
      };
    case 'ZodObject': {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const { optional } = unwrapZod(field);
        properties[key] = zodToJsonSchemaNode(field);
        if (!optional) {
          required.push(key);
        }
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    default:
      return {};
  }
}

/** Adapts a Zod v3 schema to StandardSchemaWithJSON for MCP Server v2. */
export function zod3ToStandardSchema<T extends z.ZodTypeAny>(
  schema: T,
): StandardSchemaWithJSON<z.infer<T>, z.infer<T>> {
  const cachedJson = zodToJsonSchemaNode(schema);
  return {
    '~standard': {
      version: 1,
      vendor: 'zod',
      validate(value: unknown) {
        const result = schema.safeParse(value);
        if (result.success) {
          return { value: result.data as z.infer<T> };
        }
        return {
          issues: result.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        };
      },
      jsonSchema: {
        input: () => cachedJson,
        output: () => ({ type: 'object' }),
      },
    },
  };
}
