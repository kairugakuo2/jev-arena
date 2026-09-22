# Version history

## 6.0.0 — Redesign

- New look across the site: a light layout with indigo as the brand color, while the code editor and arena stage stay dark.
- Shared design system in `public/site.css` (colors, type, navigation, buttons, badges, footer) used by every page.
- Self-hosted Outfit, Inter and JetBrains Mono fonts (SIL Open Font License), since the security policy blocks font CDNs.
- Home page rebuilt as a landing page with real screenshots, a "how Jev decides" walkthrough and a project section for each tool.
- Arena: recolored fighters, a proper segmented opponent switch, sentence-case move names and plain-text key hints instead of symbol glyphs.
- Navigator: light problem library and direction panel around a dark editor. Fixed the One Dark theme overriding the editor's own colors.
- Added a favicon, served fonts and images with correct content types, and checked text contrast and keyboard focus on every page.

## 5.3.0 — Faster problem loading

- Questions and starter code now appear as soon as they're imported (under a second), and you can start coding while Jev builds its solution map in the background. Edits made during preparation are included in the first reading.
- Optional reference downloads run in parallel and no longer delay the question.
- Problem preparation is queued instead of rejected while another problem is preparing.
- Switched the default mapmaker to `google/gemini-2.5-flash-lite` with a more compact map. First-time preparation dropped from about 90 seconds to about 20.
- Added Retry feedback and Choose another problem controls when preparation fails.
- Library difficulty badges are color-coded: green for Easy, yellow for Medium, red for Hard.
- Fixed importer timeouts that could let the test process exit early.

## 5.2.0 — Starter code and clearer live readings

- Library problems now open with NeetCode's Python or JavaScript starter signatures and a short writing prompt.
- The editor stays visibly unavailable until a problem is prepared, avoiding silent edits with no Jev reading.
- Added five descriptive hotter/colder probability bands; they remain directional readings, not correctness grades.
- Removed roadmap, attempts, manual completion and progress filtering. Existing local progress is cleared while drafts are retained.

## 5.1.0 — NeetCode 150 library

- Made a searchable, filterable NeetCode 150 library the default Coding Navigator entry while preserving Custom paste mode.
- Added Continue your roadmap, filtered Surprise me, manual completion tracking and separate Python/JavaScript drafts with bounded local LRU storage.
- Added a strict server-side NeetCode importer with exact host allowlists, redirect/time/body limits, content validation, private atomic caching, seven-day revalidation and stale fallback.
- Enriched solution-graph preparation with hidden NeetCode article prose and complete Python/JavaScript references without exposing references or graphs to the browser.
- Added visible import/map/review/ready stages, NeetCode attribution and a Custom fallback when first import fails.
- Fixed UTF-8 editor limits, oversized-to-valid document transitions, bounded edit-history compaction and permanent retries for deterministic client errors.
- Added deterministic catalog, importer, cache, API, local progress, draft, accessibility and regression coverage. Live NeetCode and Gateway checks remain optional.

## 5.0.0 — Coding Navigator

- Added the Coding Navigator at `/tutor`: a CodeMirror editor with a live hotter/colder meter.
- A mapmaker model (`openai/gpt-5-mini`) builds a reviewed, cached map of each problem's solution space. Jev compares each batch of edits against it.
- Continuous-typing scheduler: one request in flight, newest snapshot wins, stale responses are dropped, failures back off.
- Rewrote dashboard, Arena and Navigator copy and simplified their styling.

## 4.0.0 — Jev Lab dashboard

- Turned localhost:3000 into a project dashboard named Jev Lab.
- Moved AI Gladiator to `/arena` with a visible return link to the Lab.
- Isolated Arena browser assets under `/arena/` for future project pages.
- Added `/api/arena/decide`; retained `/api/decide` as a compatibility alias.
- Added shared Gateway status and a single server-side key explanation.
- Added desktop/mobile navigation and routing tests.

## 3.0.0 — Real-time keyboard arena

- Removed turn-taking and move-selection/commit controls.
- Hold A/D or arrows to move continuously, Space/W/up to jump, J to attack, K/Shift to guard.
- Shared 60 Hz physics with gravity, aerial steering, cooldowns, continuous stamina and simultaneous damage.
- Jev chooses short control intents from live position/velocity/cooldown snapshots independently of player input.
- At most two request starts per second, one in flight; expired intents stop, stale responses are ignored.
- Play/pause, automatic pause on blur/hidden page, request backoff, and reset/mode-switch cancellation.
- On-screen hold controls for touch and keyboard-accessible buttons.
- Verified real Jev response with the new schema; one live test completed in about 700 ms.


## 2.0.0 — Movement arena

- Seven-lane 2D platform, with visible grounded/airborne positions.
- Choose stay, left, right or jump, then attack or defend each turn.
- Jump dodge, downward jump attacks, and stamina-limited defensive counters.
- Jev selects one of eight combined turns; native probabilities remain inspectable.
- Rule opponent, API validation, tests and guide updated for coordinates.
- Potions removed to keep the new control scheme focused.

## 1.0.0 — Original prototype

- Shared distance and five actions: attack, defend, approach, retreat, heal.
- Alternating turns, rule opponent, Jev probability inspector and local proxy.
- Original version preserved in Git as tag `v1.0.0`.
