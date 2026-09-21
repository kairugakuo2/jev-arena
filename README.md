# Jev Arena — version 2
A small, turn-based **2D** game for learning how Jev makes decisions. Plain HTML/CSS/JavaScript and a tiny Node server. No build tools, framework, database or multiplayer.

## Run in VS Code
Use Node.js **22.18 or newer**, open this folder, and run:

```sh
npm install
npm start
```

Open http://localhost:3000. Stop with Ctrl+C. Restart after changing server files or credentials; refresh after frontend changes. Use the Node server, not VS Code Live Server, because Jev needs the private API endpoint.

## Play
Each turn has **two selections**, committed together:
1. Choose **Stay, Left, Right or Jump**.
2. Click **Attack or Defend**.

The AI has exactly the same eight combinations. The player goes first, then the AI sees the updated state. Battles end at zero health, or draw after 50 rounds.

- There are seven lanes (shown as 1–7, stored as x = 0–6).
- Left/right moves one lane and costs **5 stamina**. Stay is free. You cannot move through your opponent or leave the platform.
- Jump costs **15 stamina**. You remain airborne for the opponent's next turn, then land when you act again. You must spend one turn on the ground before jumping again.
- Attack costs **20 additional stamina**, even on a miss. Both movement and attack costs must be affordable before committing.
- Attacks reach one horizontal lane. Ground attacks deal **24 damage** but cannot hit airborne opponents. Jump attacks deal **16 damage** and can reach down to grounded opponents or hit airborne opponents.
- Defend restores **25 stamina** after movement and puts up a guard until your next turn. Guard reduces damage to **6**.
- A living guard **counters a ground attacker for 12 damage**, spending **10 stamina** if available. Jump attacks avoid this counter.
- Health and stamina cap at 100. No potions in v2.

The game still uses deterministic damage so decisions stay understandable. It is no longer just a damage race: countering can beat an opponent who hits first, jumping dodges ground strikes, and movement changes whether a swing connects. This is a small tactical prototype, not a claim of perfect competitive balance. The AI still has the informational advantage of reacting after your move.

**Try:** close the gap while defending, jump-attack a guarding enemy, then retreat-and-defend while recovering stamina. Watch the predicted hit/miss hint before committing.

## Jev and credentials
Keep `AI_GATEWAY_API_KEY` in the project's **.env** file (already configured on this machine). On another machine, copy `.env.example` to `.env` and edit:

```dotenv
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
PORT=3000
```

Use a Vercel AI Gateway key. Never put it in `public/`. Node loads .env; a preexisting shell variable takes precedence. .env is Git-ignored and never served or pushed to GitHub.

The last live request in v1 was blocked by Vercel's requirement for a payment card in the team's [AI Gateway dashboard](https://vercel.com/gakuo-kairus-projects/~/ai). Unless you have enabled access since then, use Rule-Based AI immediately or enable your account and retry. A “key configured” label only means a key exists.

## Inspect the decision
**Game state → server validation → Jev choice request → probabilities + chosen combination → movement then combat.**

`decisionState()` includes each fighter's health, stamina, x/y position and guard, geometric distance, and previous combined actions. The collapsible debug panel shows the exact state submitted after your move.

`jev-ai.js` calls the official SDK's `experimental_evaluate` with model `typesafe-ai/jev`. A single choice question covers:
`STAY_ATTACK`, `STAY_DEFEND`, `LEFT_ATTACK`, `LEFT_DEFEND`, `RIGHT_ATTACK`, `RIGHT_DEFEND`, `JUMP_ATTACK`, `JUMP_DEFEND`.

The inspector shows **native probabilities over complete turns**, not separately estimated movement probabilities, chain-of-thought, or chances of winning. We execute the returned choice directly without random sampling. Missing probabilities are shown as unavailable, not invented. Illegal or malformed answers pause the AI turn, with retry/mode-switch recovery. Reset cancels pending browser requests and ignores late responses.

Rule-Based AI uses simple priorities: jump to reach an airborne target or avoid a counter, attack exposed targets, approach while defending, otherwise recover. Its 100%/0% display is clearly labeled deterministic.

## Files and where to start
```text
public/
  index.html       Interface and field guide
  styles.css       Arena, fighters, responsive layout
  game.js          Pure mechanics and coordinates (read first)
  rule-ai.js       Traditional if/else AI
  app.js           Turn loop and rendering (read third)
jev-ai.js          Jev request and result validation (read second)
server.js          Static server and /api/decide proxy
test/game.test.js  Offline tests
package.json      Commands and SDK dependency
package-lock.json Reproducible installation
.env.example      Blank credential template
.npmrc            Enables the SDK's required peer dependencies
.gitignore        Excludes private credentials and dependencies
CHANGELOG.md      Version notes
README.md         This guide
```

Only `ai` is a direct dependency; npm also installs its required peers/transitive packages. The local server binds to 127.0.0.1, validates incoming state/size/origin, and serves only an explicit public-file allowlist.

## Version control
This project has its own Git repository, separate from any parent folder's repository. The original prototype was committed before any v2 changes.

- `v1.0.0`: original distance-based battle.
- `v2.0.0`: movement arena.
- Private GitHub repository: https://github.com/kairugakuo2/jev-arena

Useful commands:
```sh
git status
git log --oneline --decorate
git diff v1.0.0 v2.0.0
```

For future work, make a branch, edit/test, then commit selected source files:
```sh
git switch -c my-next-change
npm test
git add public/game.js
git commit -m "Describe what changed"
git push -u origin my-next-change
```

Never force-add .env. To explore v1 safely without replacing your current game, create a separate checkout:
```sh
git worktree add ../Jev-v1 v1.0.0
```

## Verification and API assumptions
```sh
npm test
```

Tests cover positions and bounds, collisions, stamina budgets, jump cooldown and landing, attack misses, counters and knockout order, a full rule battle, validated coordinate state, and the real SDK's schema using a mock evaluation model. They do not spend API credits.

Jev means TypeSafe's evaluation model through Vercel Gateway, following the [official Jev SDK guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk). The evaluation API remains experimental; AI SDK 7.0.107 is recorded in the lockfile. We use its typed `choice` request and `answers.action.choice/probabilities`, not chat completions or generated probability estimates.

Version 2 changes the question's allowed choices and the state schema, not the provider API. Combat rules explicitly use horizontal range plus an elevation check; displayed Euclidean distance is diagnostic. No real-time physics or hidden random combat outcomes are involved.
