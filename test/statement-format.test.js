import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatement } from '../tutor/statement-format.js';
import { blocksFromPlainText } from '../public/tutor/statement-view.js';

const description = `Given an array of integers \`nums\` and an integer \`target\`, return the indices.

You may assume that *every* input has **exactly one** solution.

**Example 1:**

\`\`\`java
Input:
nums = [3,4,5,6], target = 7

Output: [0,1]
\`\`\`

Explanation: \`nums[0] + nums[1] == 7\`.

**Constraints:**
* \`2 <= nums.length <= 1000\`
* **Only one valid answer exists.**

<br>
<details class="hint-accordion"><summary>Hint 1</summary><p>Use a <code>hash map</code>.</p></details>`;

test('NeetCode Markdown becomes structured blocks with inline marks', () => {
  const blocks = formatStatement(description);
  assert.deepEqual(blocks.map(block => block.type), ['p', 'p', 'h', 'code', 'p', 'h', 'ul']);
  assert.deepEqual(blocks[0].runs.filter(run => run.code).map(run => run.text), ['nums', 'target']);
  assert.ok(blocks[1].runs.some(run => run.i && run.text === 'every'));
  assert.ok(blocks[1].runs.some(run => run.b && run.text === 'exactly one'));
  assert.equal(blocks[2].text, 'Example 1');
  assert.equal(blocks[3].text, 'Input:\nnums = [3,4,5,6], target = 7\n\nOutput: [0,1]');
  assert.equal(blocks[6].items.length, 2);
  assert.ok(blocks[6].items[1][0].b);
});

test('hints and markup never reach the display blocks', () => {
  const text = JSON.stringify(formatStatement(description));
  assert.doesNotMatch(text, /Hint|hash map|<\/?[a-z]|details/);
  const html = formatStatement('Use <b>bold</b>, <code>x</code>, 10<sup>4</sup> &lt;tag&gt;<script>alert(1)</script> <img src="a.png">.');
  const runs = html[0].runs;
  assert.ok(runs.some(run => run.b && run.text === 'bold'));
  assert.ok(runs.some(run => run.code && run.text === 'x'));
  assert.ok(runs.some(run => run.sup && run.text === '4'));
  // Tags are dropped; decoded entities stay as plain text for textContent rendering.
  assert.doesNotMatch(runs.map(run => run.text).join(''), /<script|<img|<b>/);
  assert.match(runs.map(run => run.text).join(''), /<tag>/);
});

test('plain-text statements get headings, example blocks and constraint lists', () => {
  const blocks = blocksFromPlainText(`Two Sum

Given an array of integers nums, return indices of two numbers.

Example 1
Input: nums = [2,7,11,15], target = 9

Output: [0,1]
Explanation: 2 + 7 = 9.

Constraints
2 <= nums.length <= 10000
Exactly one valid answer exists.`);
  assert.deepEqual(blocks.map(block => block.type), ['p', 'p', 'h', 'code', 'p', 'h', 'ul']);
  assert.equal(blocks[3].text, 'Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]');
  assert.deepEqual(blocks[6].items.map(item => item[0].text), ['2 <= nums.length <= 10000', 'Exactly one valid answer exists.']);
});
