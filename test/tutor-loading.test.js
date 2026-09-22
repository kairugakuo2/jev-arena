import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerSchema } from '../tutor/provider-schema.js';
import { graphSchema, validateGraph } from '../tutor/schema.js';
import { graphFixture } from './fixtures/tutor.js';

test('provider schema keeps shape without expensive decoder bounds; local validation stays strict', () => {
  const schema = providerSchema(graphSchema);
  assert.equal(schema.type,'object');
  assert.ok(schema.required.includes('families'));
  assert.doesNotMatch(JSON.stringify(schema), /"(?:maxItems|minItems|maxLength|minLength|pattern)":/);
  const graph = graphFixture();
  graph.families = [];
  assert.throws(() => validateGraph(graph));
});
