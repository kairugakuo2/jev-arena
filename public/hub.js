const status = document.getElementById("gateway-status");

try {
  const response = await fetch("/api/status");
  const data = await response.json();
  status.classList.toggle("connected", data.configured);
  status.querySelector("span:last-child").textContent = data.configured
    ? "Shared Gateway key configured"
    : "Gateway key missing · offline projects still work";
} catch {
  status.querySelector("span:last-child").textContent =
    "Local server unavailable";
}
