// Tiny local HTTP server: static browser files + one secret-bearing Jev endpoint.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chooseJevAction, buildJevRequest } from "./jev-ai.js";
import { ACTIONS, distanceBetween } from "./public/game.js";

const files = {
  "/": ["index.html", "text/html"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/game.js": ["game.js", "text/javascript"],
  "/rule-ai.js": ["rule-ai.js", "text/javascript"],
};
const port = Number(process.env.PORT || 3000);
const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
let activeRequest = false;

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

// Build a known, bounded object. Never forward arbitrary user text to the model.
export function validateState(input) {
  const state = {};
  const fields = {
    health: [0.0001, 100],
    stamina: [0, 100],
    x: [0.35, 9.65],
    y: [0, 2.5],
    vx: [-3.4, 3.4],
    vy: [-12, 8],
    cooldown: [0, 0.65],
  };
  for (const actor of ["ai", "player"]) {
    const f = input?.[actor];
    if (!f || typeof f.defending !== "boolean")
      throw new Error("Invalid fighter state.");
    state[actor] = {};
    for (const [key, [min, max]] of Object.entries(fields)) {
      if (
        typeof f[key] !== "number" ||
        !Number.isFinite(f[key]) ||
        f[key] < min ||
        f[key] > max
      )
        throw new Error("Invalid fighter state.");
      state[actor][key] = f[key];
    }
    state[actor].defending = f.defending;
  }
  const distance = distanceBetween(state.ai, state.player);
  if (
    typeof input.distance !== "number" ||
    !Number.isFinite(input.distance) ||
    Math.abs(input.distance - distance) > 0.00001
  )
    throw new Error("Invalid distance.");
  state.distance = distance;
  if (
    typeof input.elapsed !== "number" ||
    !Number.isFinite(input.elapsed) ||
    input.elapsed < 0 ||
    input.elapsed > 181
  )
    throw new Error("Invalid time.");
  state.elapsed = input.elapsed;
  for (const key of ["previous_player_action", "previous_ai_action"]) {
    if (input[key] !== null && !ACTIONS.includes(input[key]))
      throw new Error("Invalid previous action.");
    state[key] = input[key];
  }
  return state;
}

export const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  );
  // Localhost binding + Host/Origin checks stop other websites using your local key.
  if (!hosts.has(request.headers.host))
    return json(response, 403, { error: "Local requests only." });
  if (
    request.headers.origin &&
    ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(
      request.headers.origin,
    )
  ) {
    return json(response, 403, {
      error: "Cross-origin requests are not allowed.",
    });
  }
  const path = new URL(request.url, `http://localhost:${port}`).pathname;
  if (request.method === "GET" && path === "/api/status") {
    return json(response, 200, {
      configured: Boolean(process.env.AI_GATEWAY_API_KEY),
    });
  }
  if (request.method === "POST" && path === "/api/decide") {
    if (activeRequest)
      return json(response, 429, {
        error: "A decision is already running. Please wait.",
      });
    if (!request.headers["content-type"]?.startsWith("application/json"))
      return json(response, 415, { error: "Send JSON." });
    activeRequest = true;
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096)
          return json(response, 413, { error: "Request too large." });
      }
      let state;
      try {
        state = validateState(JSON.parse(body));
      } catch {
        return json(response, 400, { error: "Invalid battle state." });
      }
      try {
        const decision = await chooseJevAction(state);
        return json(response, 200, {
          ...decision,
          request: buildJevRequest(state),
        });
      } catch (error) {
        return json(response, 502, { error: error.message });
      }
    } finally {
      activeRequest = false;
    }
  }
  if (request.method !== "GET" || !files[path])
    return json(response, 404, { error: "Not found." });
  const [filename, type] = files[path];
  try {
    const content = await readFile(
      new URL(`./public/${filename}`, import.meta.url),
    );
    response.writeHead(200, {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    json(response, 500, { error: "Unable to load the page." });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, "127.0.0.1", () =>
    console.log(`Jev Arena → http://localhost:${port}`),
  );
  server.on("error", (error) => {
    console.error(
      `Server could not start (${error.code}). ${error.code === "EADDRINUSE" ? "Try a different PORT in .env." : "Check permission to bind a local port."}`,
    );
    process.exitCode = 1;
  });
}
