import { z } from 'zod';

// Some providers cannot compile deeply nested length/range constraints. Request
// the same object shape, then enforce all bounds and references locally before use.
export function providerSchema(schema) {
  const bounds = new Set(['maxItems','minItems','maxLength','minLength','pattern']);
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema), (key, value) => bounds.has(key) ? undefined : value));
}
