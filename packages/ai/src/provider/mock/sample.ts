/**
 * A deterministic value that satisfies a small JSON Schema subset (object, string, integer,
 * number, boolean, null, enum, const, nullable type arrays). Lets the mock answer structured
 * output tasks without a script.
 */
export function sampleFromSchema(schema: Record<string, unknown>): unknown {
  if ('const' in schema) return schema['const'];
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  const rawType = schema['type'];
  const types: unknown[] = Array.isArray(rawType) ? (rawType as unknown[]) : [rawType];
  const type = types.find((t) => t !== 'null') ?? types[0];
  switch (type) {
    case 'object': {
      const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
      const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const prop = props[key];
        if (!prop) continue;
        const propTypes = Array.isArray(prop['type']) ? prop['type'] : [prop['type']];
        // Optional values (nullable) stay null so the mock stays minimal.
        out[key] = propTypes.includes('null') ? null : sampleFromSchema(prop);
      }
      return out;
    }
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 1;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default: {
      const text = '(모의 응답) 문제에서 요구하는 동작을 한 문장으로 정리해 보세요.';
      const max = typeof schema['maxLength'] === 'number' ? schema['maxLength'] : text.length;
      return text.slice(0, max);
    }
  }
}
