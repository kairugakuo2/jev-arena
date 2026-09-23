// Light/dark theme. Loaded as a classic script in <head> so the theme is set
// before first paint. Follows the system setting until the user picks one.
(() => {
  const KEY = "jev-theme";
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };
  const current = () => root.dataset.theme;
  function apply(theme) {
    root.dataset.theme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      const next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", `Switch to ${next} theme`);
      button.setAttribute("title", `Switch to ${next} theme`);
      button.setAttribute("aria-pressed", String(theme === "dark"));
    }
  }
  apply(saved() || (system.matches ? "dark" : "light"));
  system.addEventListener("change", (event) => {
    if (!saved()) apply(event.matches ? "dark" : "light");
  });
  document.addEventListener("DOMContentLoaded", () => {
    apply(current());
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.addEventListener("click", () => {
        const next = current() === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Private windows may block storage; the switch still works for this page.
        }
        apply(next);
      });
    }
  });
})();
