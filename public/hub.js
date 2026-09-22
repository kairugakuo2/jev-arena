const status = document.getElementById("gateway-status");

try {
  const response = await fetch("/api/status");
  const data = await response.json();
  status.classList.toggle("connected", data.configured);
  status.querySelector("span:last-child").textContent = data.configured
    ? "Gateway key configured"
    : "No Gateway key (rule-based Arena still works)";
} catch {
  status.querySelector("span:last-child").textContent =
    "Local server unavailable";
}
