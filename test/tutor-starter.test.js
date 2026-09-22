import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterFor, readingLevel } from '../public/tutor/reading.js';

test('starter keeps NeetCode signature and adds a language-specific instruction', () => {
  assert.equal(starterFor({ python:'class Solution:\n    def twoSum(self, nums, target):\n        ' },'python'),
    '# Write your code inside the method below.\nclass Solution:\n    def twoSum(self, nums, target):\n        ');
  assert.equal(starterFor({ javascript:'class Solution { twoSum(nums, target) {} }' },'javascript'),
    '// Write your code inside the method below.\nclass Solution { twoSum(nums, target) {} }');
});

test('probability bands distinguish cooler and warmer readings', () => {
  assert.equal(readingLevel(8), 'Much colder');
  assert.equal(readingLevel(30), 'Cooler');
  assert.equal(readingLevel(50), 'Neutral or uncertain');
  assert.equal(readingLevel(70), 'Warmer');
  assert.equal(readingLevel(93), 'Much hotter');
});
