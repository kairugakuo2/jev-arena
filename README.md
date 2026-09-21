# Jev Arena — AI Gladiator

A small, turn-based browser game for inspecting how Jev chooses actions. Plain HTML, CSS and JavaScript; one local Node server; one direct dependency (`ai`). No build step, database, account system or framework.

## Run locally in VS Code

Use **Node.js 22.18 or newer**. Open this folder in VS Code and run in its terminal:

```sh
cd /Users/gman/Development/Projects/Jev
npm install
npm start
```

Open **http://localhost:3000**. Stop with Ctrl+C. Restart after editing server files or `.env`; refresh the browser after editing frontend files. Use this server instead of VS Code Live Server: the Jev endpoint needs Node.

`npm install` restores the version in the lockfile. If deliberately upgrading later, use `npm install ai@latest`; the evaluation API is experimental, so retest after upgrading. `.npmrc` enables the SDK's required peer dependencies (including zod) even if your global npm settings disable them. Only `ai` is declared as a direct dependency.

## Credentials

A dedicated `jev-arena-local` key was created in your sole Vercel team, `gakuo-kairus-projects`, and saved directly to the project's `.env`, with owner-only file permissions. No key is in source files or the browser. The earlier key pasted in chat was not copied into this project.

**Live test result:** Vercel returned HTTP 403 with `customer_verification_required`: the team needs a valid payment card on file before AI Gateway serves requests. Enable access in [your AI Gateway dashboard](https://vercel.com/gakuo-kairus-projects/~/ai), then retry a Jev turn. This requires your account action; no payment information is handled by the game. Rule-Based AI works immediately, with no API or payment required.

For a fresh copy on another machine, copy `.env.example` to `.env` only if `.env` does not already exist, then edit it in VS Code:

```dotenv
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
PORT=3000
```

The SDK automatically reads `AI_GATEWAY_API_KEY` from the server environment. `npm start` loads `.env` using Node's built-in loader; an existing shell environment variable takes precedence. Obtain a key from Vercel AI Gateway, not an OpenAI or TypeSafe direct key. Do not put it in `public/`, browser storage, or source control. `.env` and `.env.*` are ignored, except for the blank `.env.example` template. The local server serves an explicit public-file allowlist, so requesting `/.env` returns 404.

The server binds only to `127.0.0.1` and rejects foreign Host/Origin headers. This is a local educational app, not a public hosting setup. Each Jev turn makes a paid-provider request according to your Gateway plan; rule mode makes none. The green “key configured” label reports key presence, not verified billing/access.

## Files

```text
Jev/
├── public/
│   ├── index.html       # Layout, health bars, controls, inspector
│   ├── styles.css       # Responsive arena and simple CSS fighters
│   ├── app.js           # Browser turn loop, requests, rendering
│   ├── game.js          # Deterministic combat rules and state snapshot
│   └── rule-ai.js       # Plain if/else opponent
├── jev-ai.js            # Jev question, actual API call, result validation
├── server.js            # Static files + POST /api/decide
├── test/game.test.js    # Node tests, no network or paid calls
├── package.json
├── package-lock.json
├── .npmrc
├── .env.example         # Empty credential template
├── .env                 # Your private key; ignored, never served
├── .gitignore
└── README.md
```

## How the game works

Both fighters start with 100 health, 100 stamina, one potion and a shared distance of 2. You act first, then the AI responds to the state **after** your action. Combat is deterministic; there are no random damage rolls.

- **ATTACK:** distance must be 1 and stamina at least 20. Spend 20 stamina, deal 24 damage (6 if the opponent is defending).
- **DEFEND:** restore up to 25 stamina and guard against the next opposing turn. Your guard expires when you take your next action.
- **APPROACH:** decrease distance by 1 and restore up to 10 stamina; minimum distance is 1.
- **RETREAT:** increase distance by 1 and restore up to 10 stamina; maximum distance is 3.
- **HEAL:** consume one potion to restore up to 30 health. Unavailable at full health or without a potion.

Health and stamina cap at 100. Unavailable moves are disabled. Hover a disabled button to see its condition. Zero health ends the battle immediately, so a defeated fighter never gets an extra turn. After 50 completed rounds, the result is a draw. Switch modes between turns to compare the engines without resetting the state; New battle resets all combat data.

## The decision flow

1. `app.js` applies your move through `executeAction()`.
2. `decisionState()` creates a copy of AI/player resources, guard flags, shared distance and previous actions.
3. **Jev mode:** the browser POSTs that snapshot to `/api/decide`. The server validates it and `jev-ai.js` calls `experimental_evaluate` with `model: 'typesafe-ai/jev'`, that exact state, and a typed `choice` question with five criteria.
4. Jev returns `answers.action.choice` and `answers.action.probabilities`. The server checks both; it does not generate a chain of thought. The UI displays the actual distribution without rescaling it. A missing distribution is marked unavailable rather than invented.
5. The game executes Jev's returned choice, updates health/stamina/distance, and leaves the decision visible in the inspector and battle log. The state and full question can be expanded for inspection.

**Rule mode:** step 3 instead calls the local `chooseRuleAction()` function: heal below 25 health if possible; otherwise approach if far away; otherwise attack with at least 20 stamina; otherwise defend. The inspector shows the matching rule and a 100%/0% deterministic outcome, clearly labeled as rules—not a model probability.

The action percentages express Jev's distribution over this particular choice question. They are **not** private reasoning, damage chances, or probabilities of winning the battle. Display rounding can make the total slightly different from 100%. The game executes the returned choice directly; it does not randomly sample the distribution. Identical combat inputs have deterministic mechanical outcomes, but repeated model evaluations need not be identical.

Timeouts, authentication errors, malformed answers and illegal model choices pause the AI turn. No fallback is silently attributed to Jev. Retry repeats the same AI state without repeating your move, or switch to Rule-Based AI and press Continue. New battle invalidates late responses so they cannot affect the new game.

## First three pieces of code to read

1. **`public/game.js` → `newGame()`, `decisionState()`, `executeAction()`**: all state and combat mechanics in one small file.
2. **`jev-ai.js` → `buildJevRequest()`, `chooseJevAction()`**: the exact question, real API call and probability validation. The call is marked `THE JEV CALL`.
3. **`public/app.js` → `playerTurn()`, `aiTurn()`, `renderDecision()`**: follow the complete state → request → decision → action → display loop. Compare with `public/rule-ai.js` afterwards.

## API choices and assumptions

- “Jev” means TypeSafe AI's structured evaluation model, accessed through Vercel AI Gateway because you already use Gateway credentials. It is **not** the GPT text-generation model discussed earlier.
- The integration follows [Vercel's official Jev + AI SDK guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk) and [Jev model card](https://vercel.com/ai-gateway/models/jev), checked September 20, 2026. AI SDK 7.0.107 was installed; the guide requires 7.0.105 or newer. The evaluation API is experimental.
- The documented request uses `state` and `questions.action` with `type: 'choice'`, `instructions`, and a `criteria` map. The documented response is `answers.action` with `type`, `choice`, and optional `probabilities` keyed by action name. No chat-completions schema or prompted probability estimates are used.
- Guard flags and the player's potion count are added to your example state because they affect meaningful choices. Distance is one shared value rather than two independent distances.
- The server tells Jev which actions are legal. Model compliance is not assumed: unavailable choices are rejected and shown as errors rather than executed or silently substituted.
- Native Jev probabilities are supported by the official API contract; live success has **not** been confirmed for this account because of the billing-verification block above. Combat and UI verification do not imply a successful paid API call.

## Verify

```sh
npm test
```

Tests cover attack constraints, guard timing, healing, distance/stamina limits, end-of-game behavior, rule priorities, full deterministic combat, state snapshots, request validation and response validation. They never call the paid service.
