// A random id this browser keeps, so demo rate limits are shared fairly
// between people on the same network. It identifies nothing about the user.
const KEY = "jev-visitor";

// getRandomValues works on plain-HTTP pages too, unlike crypto.randomUUID.
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let id = null;
try {
  id = localStorage.getItem(KEY);
  if (!/^[a-f0-9-]{16,64}$/i.test(id || "")) {
    id = randomId();
    localStorage.setItem(KEY, id);
  }
} catch {
  id = id && /^[a-f0-9-]{16,64}$/i.test(id) ? id : randomId();
}
export const visitorHeaders = { "X-Jev-Visitor": id };
