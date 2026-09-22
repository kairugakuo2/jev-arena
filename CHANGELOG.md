# Version history

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
