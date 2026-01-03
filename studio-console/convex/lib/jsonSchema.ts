type JsonSchema = {
    type?: string;
    required?: string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
};

function typeMatches(value: unknown, expected?: string): boolean {
    if (!expected) return true;
    if (expected === "array") return Array.isArray(value);
    if (expected === "object") return !!value && typeof value === "object" && !Array.isArray(value);
    return typeof value === expected;
}

export function parseJsonSchema(raw: string | undefined): JsonSchema | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as JsonSchema;
    } catch {
        return null;
    }
}

export function validateJsonSchemaMinimal(schema: JsonSchema | null, value: unknown): string[] {
    if (!schema) return [];
    const errors: string[] = [];
    if (schema.type && !typeMatches(value, schema.type)) {
        errors.push(`Expected type ${schema.type}`);
        return errors;
    }

    if (schema.type === "object" && schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const required = schema.required ?? [];
        for (const key of required) {
            if (!(key in record)) {
                errors.push(`Missing required key: ${key}`);
            }
        }
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (!(key in record)) continue;
            if (!typeMatches(record[key], propSchema.type)) {
                errors.push(`Invalid type for ${key} (expected ${propSchema.type ?? "any"})`);
            }
        }
    }

    if (schema.type === "array" && schema.items && Array.isArray(value)) {
        for (let idx = 0; idx < value.length; idx += 1) {
            if (!typeMatches(value[idx], schema.items.type)) {
                errors.push(`Invalid item type at index ${idx}`);
                break;
            }
        }
    }

    return errors;
}
