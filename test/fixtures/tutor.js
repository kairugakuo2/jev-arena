export const statement = 'Given an integer array nums and target, return indices of two distinct elements that sum to target. Exactly one answer exists. 2 <= nums.length <= 10000. Values can repeat.';
export function graphFixture() {
  return {
    title: 'Two Sum', concept: { concepts: ['Complement lookup'], constraints: ['Distinct indices', 'Repeated values allowed'], correctness: ['Return two distinct indices whose values sum to target'], inputOutput: 'Integer array and target → pair of indices' },
    families: [
      { id: 'pairs', name: 'Enumerate pairs', label: 'brute_force', description: 'Check every distinct index pair.', time: 'O(n^2)', space: 'O(1)', complexityNotes: 'Constant auxiliary space.', dataStructures: ['array'], invariantIds: ['distinct'], patterns: ['nested loops'], prerequisites: ['pair enumeration'], mistakes: ['Reusing an index'], terminalRequirements: ['All unordered pairs checked'], optimality: 'Not time optimal' },
      { id: 'lookup', name: 'Complement map', label: 'optimal', description: 'Look up prior complements.', time: 'O(n) expected', space: 'O(n)', complexityNotes: 'Expected constant-time hashing; worst-case collisions may degrade runtime.', dataStructures: ['hash map'], invariantIds: ['distinct','prior'], patterns: ['target minus value', 'lookup before insert'], prerequisites: ['complement equation'], mistakes: ['Insert before lookup'], terminalRequirements: ['Return matching prior and current indices'], optimality: 'Linear input-reading lower bound; auxiliary-space tradeoff' },
    ],
    invariants: [{ id: 'distinct', description: 'Never use one index twice', familyIds: ['pairs','lookup'] }, { id: 'prior', description: 'Map contains only previous indices', familyIds: ['lookup'] }],
    nodes: [
      { id: 'enumerate', description: 'Enumerating distinct pairs', kind: 'partial', familyIds: ['pairs'], observableSignals: ['inner loop starts at i+1'] },
      { id: 'complement', description: 'Deriving target minus value', kind: 'partial', familyIds: ['lookup'], observableSignals: ['complement expression'] },
      { id: 'hash', description: 'Store prior values and indices', kind: 'valid', familyIds: ['lookup'], observableSignals: ['map lookup before insert'] },
      { id: 'reuse', description: 'Using one element twice', kind: 'dead_end', familyIds: ['lookup'], observableSignals: ['insert before check without distinct-index guard'] },
    ],
    edges: [{ id: 'optimize', from: ['enumerate','complement'], to: 'hash', kind: 'optimization', conditions: ['preserve distinct indices'], temporaryBreakage: ['Loops may coexist while being replaced'] }, { id: 'repair', from: ['reuse'], to: 'hash', kind: 'repair', conditions: ['lookup before insertion'], temporaryBreakage: [] }],
    failureModes: [{ id: 'same-index', familyIds: ['lookup'], layer: 'implementation', description: 'Self-match', observableSignals: ['index inserted before matching'], counterexample: 'nums=[3,2,4], target=6 must return [1,2]', repairs: ['check before inserting'] }],
    edgeCases: [{ input: 'nums=[3,3], target=6', expected: '[0,1]', diagnoses: ['duplicate values and distinct indices'] }],
    trajectoryIndicators: [{ direction: 'hotter', layer: 'algorithm', evidence: 'Replace repeated scan with complement map', caveats: ['Map naming alone is insufficient'], relatedIds: ['optimize','prior'] }, { direction: 'neutral_uncertain', layer: 'implementation', evidence: 'Syntax temporarily unfinished', caveats: ['Judge intent conservatively'], relatedIds: [] }],
    coverage: { completeness: 'non_exhaustive', knownGaps: ['Sorting with original indices is not covered by this tiny test fixture'], assumptions: ['Hash operations expected O(1)'] },
  };
}
export function evaluationFixture() {
  return { problemId: 'a'.repeat(64), graphVersion: 'v1', language: 'python', sessionId: 'session-123', baselineRevision: 0, currentRevision: 1,
    beforeCode: 'def twoSum(nums, target):\n    pass', afterCode: 'def twoSum(nums, target):\n    seen = {}',
    recentEdits: [{ beforeRevision: 0, afterRevision: 1, changes: [{ from: 30, to: 34, insert: 'seen = {}' }] }] };
}
