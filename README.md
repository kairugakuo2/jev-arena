# Jev Lab — version 4

A local home for small projects that make Jev's decisions visible. The first project is **AI Gladiator**, a continuous 2D fight. Everything uses plain HTML, CSS and JavaScript with one tiny Node server, one shared Gateway key, and no framework or build step.

## Run
Use Node.js 22.18 or newer. In this folder's VS Code terminal:

```sh
npm install
npm start
```

Open http://localhost:3000 to see the Jev Lab dashboard. Choose **AI Gladiator**, or open http://localhost:3000/arena directly. Click **Play** inside Arena. There are no turns or move confirmations.

## Lab structure

- `/` is the project dashboard and shared Gateway status.
- `/arena` is AI Gladiator.
- `/api/arena/decide` is Arena's project-specific Jev endpoint.
- `/api/status` reports whether the shared server process has a Gateway key configured; it never returns the key.
- `.env` is loaded once by the local server, so future projects can use the same `AI_GATEWAY_API_KEY` through their own server endpoints.
- Arena's browser assets live under `public/arena/`, leaving room for future project folders without generic `app.js` or `styles.css` collisions.

The old `/api/decide` path remains as a compatibility alias. Future projects should receive descriptive routes such as `/api/router/decide` and their own page directory, while credential loading stays centralized in `server.js`.

- **A / D** or **left / right arrows**: hold to run.
- **Space**, **W** or **up arrow**: jump. Release and press again to jump after landing.
- **J**: hold to attack when the cooldown allows.
- **K** or **Shift**: hold to defend.
- **P**: toggle pause; **Esc**: pause.
- On touch devices, hold the on-screen buttons (multiple fingers work for move + attack).

You can move while jumping, attacking, defending, or waiting for Jev. Characters can pass through each other. Leaving the browser window or hiding its tab pauses the game automatically. Reset returns to a paused fresh battle. Refresh after frontend edits; restart Node after server/.env edits. VS Code Live Server alone cannot provide the Jev endpoint.

## Two independent clocks

1. **Physics:** a fixed 60 Hz step updates both fighters, movement, gravity, cooldowns, stamina and collisions. Rendering uses requestAnimationFrame. A long frame gap is capped rather than replaying seconds of missed combat.
2. **AI:** while playing, the client submits the latest snapshot at most twice per second, with **one request in flight**. Slower responses reduce the actual rate. Rule mode updates locally every 200 ms.

Jev returns one of 12 controls: IDLE, LEFT, RIGHT, JUMP, ATTACK, DEFEND, LEFT_ATTACK, RIGHT_ATTACK, LEFT_DEFEND, RIGHT_DEFEND, JUMP_ATTACK, JUMP_DEFEND. Combined choices apply their controls together.

A successful decision holds its controls for **up to 700 ms**. Then the controls release unless refreshed. A response older than **1.2 seconds** is displayed as stale and **not applied**. API responses never replace the world state or teleport fighters. Every jump, attack and hit is checked against current physics, stamina, position and cooldown.

The server cancels slow model evaluations after 2 seconds; the browser has a 2.5-second limit. Errors stop AI controls and trigger bounded retry backoff (up to 8 seconds), but player movement stays live. Pause, reset, mode switches and victory invalidate pending responses. **No new API requests occur while paused.** An already submitted provider request may still complete after pause, but its result is ignored.

Jev mode therefore makes more API calls than the old turn-based version; approximately 2 starts/sec at most while playing. Rule mode needs no API. The target is a responsive small demo, not a zero-latency or competitively balanced network AI.

## Combat rules
- Arena x range: 0.35–9.65, continuous coordinates. Running speed: 3.4 units/sec.
- Jump costs **12 stamina**, with automatic gravity/landing. You can steer in mid-air.
- Attack costs **18 stamina**, with **0.65 sec cooldown**. Holding J repeats attacks only when ready.
- Hits require horizontal separation <= **1.25 units** and vertical separation <= **0.8 units**. Misses still consume stamina.
- Normal damage: **16**. Guarded damage: **4**.
- Guard drains **8 stamina/sec**, halves running speed, and counters a hit for **6 damage** if the defender can spend **8 stamina**. Attacking releases guard.
- Releasing guard recovers **12 stamina/sec**, up to 100.
- Simultaneous attacks resolve together; simultaneous knockouts draw. Battles time out after 180 active seconds.
- No dice, healing or potions. Timing, spacing and stamina supply the tactical choices.

## Credentials
The private `.env` already contains `AI_GATEWAY_API_KEY` on this machine. A fresh clone needs an .env made from .env.example:

```dotenv
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
PORT=3000
```

Node loads this file on startup; an existing shell variable takes precedence. Never put credentials in public/. The key file is ignored by Git and never served to the browser. The server uses a public-file allowlist and rejects foreign Host/Origin headers. It binds to 127.0.0.1; this is a local prototype, not public hosting infrastructure.

A real v3 Jev request succeeded with HTTP 200 and native probabilities in approximately 700 ms on September 20, 2026. Account credits and provider availability still apply. The UI's “key configured” label checks presence only. Manage access in your [Vercel Gateway dashboard](https://vercel.com/gakuo-kairus-projects/~/ai).

## Inspect the decisions

**Live snapshot → local server → Jev evaluation → probabilities + control intent → current physics executes controls.**

State includes health, fractional stamina, x/y coordinates, vx/vy velocities, guard status, attack cooldown, elapsed simulation time and the most recently observed control for each fighter. Distance is Euclidean; attack range uses the horizontal and vertical checks above.

The collapsible state panel shows the exact most recently submitted snapshot, which may differ from the current arena while a request is in flight. The decision inspector labels the snapshot time and response latency; stale decisions are explicitly marked ignored. The question panel shows the question from the latest completed request.

Jev probabilities are native probabilities over the **12 control choices**, not private reasoning or chances of winning. They are not sampled at random: the returned choice is used. Missing probabilities are not invented. Rule mode shows deterministic 100%/0% outputs with a rule explanation.

We follow [Vercel's official Jev evaluation guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk): `experimental_evaluate` from `ai`, model `typesafe-ai/jev`, typed choice questions and `answers.action.choice/probabilities`. The API remains experimental. Version 3 changes our state and controls, not the provider API.

## Files / first code to read
```text
public/index.html          Jev Lab dashboard and project directory
public/hub.css             Dashboard styling
public/hub.js              Shared Gateway status display
public/arena.html          Arena page and keyboard guide
public/arena/game.js       Read first: physics and simultaneous combat
public/arena/app.js        Read second: input, game clock, Jev scheduling
jev-ai.js                  Read third: live-state question and SDK request
public/arena/rule-ai.js    Simple local control policy
public/arena/styles.css    Arena styling and CSS fighters
server.js                  Shared key, route allowlist and state validation
test/game.test.js          Offline mechanics / SDK-schema tests
test/navigation.test.js    Dashboard, Arena and endpoint route tests
package.json        npm start / npm test; ai is the only direct dependency
package-lock.json   Pinned dependency tree
.env.example        Blank credential template
.npmrc              Enables the SDK's required peer dependencies
.gitignore          Excludes credentials and node_modules
CHANGELOG.md        Release notes
README.md           This guide
```

## Verify / version control
```sh
npm test
git status
git log --oneline --decorate
```

Offline tests cover simultaneous movement, arena bounds, jumping/landing/aerial steering, attacks and misses, cooldowns, guard/counter mechanics, stamina, simultaneous knockouts, time limits, rule AI, numeric snapshot validation and the SDK choice schema. Browser checks additionally exercise actual held keyboard/pointer controls, movement during pending/failed requests, one request in flight, pause, stale results and reset safety.

Private repository: https://github.com/kairugakuo2/jev-arena

- `v1.0.0`: original distance-based battle.
- `v2.0.0`: turn-based movement/attack combinations.
- `v3.0.0`: real-time keyboard arena.
- `v4.0.0`: Jev Lab dashboard and project-specific Arena page.

For future changes, create a branch, test, commit selected source files and push. Never force-add .env. To inspect an older version without replacing this game:
```sh
git worktree add ../Jev-v2 v2.0.0
```
