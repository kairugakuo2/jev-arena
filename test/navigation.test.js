import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { staticFiles, decisionPaths } from "../server.js";

test("Jev Lab routes the dashboard and Arena as separate pages", async () => {
  assert.deepEqual(staticFiles["/"], ["index.html", "text/html"]);
  assert.deepEqual(staticFiles["/arena"], ["arena.html", "text/html"]);
  assert.deepEqual(staticFiles["/arena/"], ["arena.html", "text/html"]);
  assert.deepEqual(staticFiles["/arena/styles.css"], [
    "arena/styles.css",
    "text/css",
  ]);
  assert.deepEqual(staticFiles["/arena/app.js"], [
    "arena/app.js",
    "text/javascript",
  ]);
  assert.equal(staticFiles["/app.js"], undefined);

  const dashboard = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const arena = await readFile(
    new URL("../public/arena.html", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /Jev Lab/);
  assert.match(dashboard, /href="\/arena"/);
  assert.match(arena, /AI Gladiator/);
  assert.match(arena, /href="\/"[^>]*aria-label="Back to Jev Lab"/);
});

test("Arena has a project-specific API route while the old path remains compatible", () => {
  assert.ok(decisionPaths.has("/api/arena/decide"));
  assert.ok(decisionPaths.has("/api/decide"));
});
