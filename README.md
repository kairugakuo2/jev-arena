# Jev Lab

Small local projects built on [`typesafe-ai/jev`](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), a model on the Vercel AI Gateway that answers multiple-choice questions with a probability for each option. Everything runs through one small Node server, and the Gateway key never reaches the browser.

There are two projects:

- **AI Gladiator** (`/arena`): a real-time 2D fight. About twice a second Jev reads both fighters' state and picks one of 12 controls. The page shows the probability it gave each one.
- **Coding Navigator** (`/tutor`): paste a LeetCode-style problem and write a solution in Python or JavaScript. While you type, a meter shows whether your recent edits are moving toward a working algorithm. It never shows you the answer.

## Run it

You need Node.js 22.18 or newer and a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API key.

```sh
npm install
cp .env.example .env   # then add your AI_GATEWAY_API_KEY
npm start
```

Open http://localhost:3000. `npm start` bundles the Navigator's editor first. The Arena also has a rule-based opponent that works without a key.

```sh
npm test
```

## How the Coding Navigator works

It uses two models:

1. **Mapmaker** (`openai/gpt-5-mini`, runs once per problem). It reads the problem and writes a structured map of the solution space: brute-force, acceptable and optimal approaches, the partial states between them, common dead ends, edge cases, and signs of progress. A second pass reviews the map. Only material errors, like a wrong expected output, send it back for repair. The approved map is cached in `.cache/tutor/`. This step takes about a minute and a half.
2. **Navigator** (`typesafe-ai/jev`, runs continuously). It gets the map, your code before and after your latest edits, and a short edit history. It returns `{ hotter, colder }` probabilities. Calls usually take 300–800 ms.

The browser samples your code about 300 ms after you stop typing, or every second if you keep typing. Only one request is in flight at a time, and a response that arrives after newer edits is dropped. The meter eases toward each new reading rather than jumping.

The reading describes the direction of your latest edits. It isn't a score or a measure of how finished you are. Your code is sent to the models for evaluation, but it is never run.

You can change the mapmaker with `TUTOR_MAP_MODEL` in `.env`. It needs a model that supports schema-enforced structured output through the Gateway.

## AI Gladiator controls

- **A / D** or **← / →**: run
- **Space**, **W** or **↑**: jump
- **J**: attack (0.65 s cooldown)
- **K** or **Shift**: guard
- **P** or **Esc**: pause

Physics runs at a fixed 60 Hz. Jev's decisions are applied only if they arrive within 1.2 seconds, and each one lasts up to 0.7 seconds. Full rules are in the in-page guide.

## Layout

```text
server.js              Local server: static allowlist, security headers, API routes
jev-ai.js              Arena's Jev request
public/index.html      Project dashboard
public/arena.html      AI Gladiator (logic in public/arena/)
public/tutor.html      Coding Navigator (browser code in public/tutor/)
tutor/                 Navigator server code: prompts, schema, graph cache, routes
test/                  node:test suites
```

## Security notes

This is a local prototype, not something to host publicly. The server binds to `127.0.0.1`, rejects foreign `Host` and `Origin` headers, serves only allowlisted files, and keeps the key in `.env`, which is gitignored.
