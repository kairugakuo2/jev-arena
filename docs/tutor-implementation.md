# Jev coding workspace implementation

Working notes for the Coding Navigator, started September 21, 2026.

## Tasks

1. CodeMirror editor, monotonic meter, and revision-aware scheduler; deterministic timing tests.
2. Versioned solution graph schema, mapmaker/critic/navigator prompts, MiMo generation and cache; validation tests.
3. Tutor HTTP routes, student workspace, and dashboard entry; endpoint and browser checks.
4. Live provider smoke/latency measurements, whole-feature review, and documentation.

## Decisions

- Work in the existing clean checkout on `codex/coding-workspace`, keeping the existing local Gateway configuration available. No worktree copy or credential duplication is needed.
- Bundle only the tutor's browser entry with esbuild; Arena remains plain JavaScript. Serve dependencies locally to work with the localhost-only security policy.
- Graph generation is an asynchronous job with polling; the browser receives problem metadata, never reference solutions. A server-side disk cache survives restarts.
- Model judgments are binary direction probabilities. A balanced reading covers both uncertain and neutral evidence and is not a completion score.

## Progress

- Baseline: 14 tests pass. No pre-existing changes.
- Tasks 1–3 complete on this branch (editor, scheduler, schema, prompts, routes, dashboard card). 31 tests pass, build clean. Nothing committed yet.
- Task 4, live provider checks (2026-09-21):
  - Mapmaker model `xiaomi/mimo-v2.6-flash` cannot do schema-enforced structured output through the Gateway (`responseFormat` unsupported; falls back to prompted JSON and truncates/malforms on a 35 KB+ graph). Also tried `google/gemini-2.5-flash`: rejected outright — "schema produces a constraint that has too many states for serving" (`graphSchema` is too large/nested for its constrained decoding).
  - Switched `MAP_MODEL` to `openai/gpt-5-mini`, which honors the schema correctly (`tutor/models.js`). Generation takes ~70–85s and ~20KB output for Two Sum, comfortably inside the 180s timeout.
  - Live generate→critique→repair run for Two Sum with gpt-5-mini: first pass and the one repair attempt were both rejected by the critic, each time for real, substantive issues (a self-contradictory complexity claim, an imprecise two-pointer invariant, an edge case that violates the problem's own "exactly one answer" guarantee). Nothing invalid reached the cache — the review gate is working as designed — but it means Two Sum hasn't produced a cached graph yet, and the critic was also rejecting on pure wording nitpicks that shouldn't block approval.
  - Fix: split the critic's output into `issues` (blocking, material defects only) and `suggestions` (advisory wording/clarity notes that don't block approval). Updated `critiqueSchema`, the critic prompt, and `PROMPT_VERSION` → `tutor-v2` (`tutor/schema.js`, `tutor/prompts.js`, `tutor/models.js`). Updated `test/tutor-models.test.js` fixtures to match. 31 tests still pass after the change.
  - Navigator (`typesafe-ai/jev`) latency/quality, tested against a manually-repaired graph before the model switch: 250–750ms per call, well inside the 2.3s timeout, and directionally correct on hand-built cases (empty→brute = hotter, brute→hashmap = much hotter, hashmap→broken-sort = colder, cosmetic rename ≈ neutral-leaning-hotter). Separately: when evaluate calls were fired back-to-back or ~1s apart, roughly half returned "Service temporarily unavailable" / "upstream provider experiencing high demand" from the Gateway. The scheduler's 750ms-minimum-gap + exponential backoff already covers single-user retries, but this is worth re-checking once a graph is cached under the new model, since real usage will hit this same limit.

  - With the split, Two Sum was approved on the first pass (~90s, 5 families, 0 blocking issues, 6 suggestions) and cached.
  - End to end through `/api/tutor/evaluate`: 260–880ms per reading, correct direction on all hand-built cases. About 1 in 5 calls still hit transient Gateway "high demand" errors; the scheduler retries them.
  - Browser check passed: editor, auto-indent, live meter glide and draft persistence all work, no console errors.
- Copy and styling cleanup across dashboard, Arena and Navigator; README rewritten for a public repo. Released as 5.0.0.
