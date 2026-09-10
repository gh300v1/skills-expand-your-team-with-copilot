const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..");
const staticDir = path.join(repoRoot, "src", "static");
const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
const script = fs.readFileSync(path.join(staticDir, "app.js"), "utf8");

async function waitFor(check, { timeout = 500 } = {}) {
  const start = Date.now();

  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error("Timed out waiting for app state");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function loadApp({ savedTheme = null, blockStorage = false } = {}) {
  const warnings = [];
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();

  virtualConsole.on("jsdomError", (error) => {
    jsdomErrors.push(error);
  });

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:8000/static/index.html",
    virtualConsole,
    beforeParse(window) {
      window.fetch = async (url) => ({
        ok: true,
        json: async () =>
          String(url).includes("/auth/check-session")
            ? { username: "teacher", display_name: "Teacher" }
            : {},
      });

      window.console.warn = (...args) => warnings.push(args.join(" "));

      if (blockStorage) {
        Object.defineProperty(window, "localStorage", {
          value: {
            getItem() {
              throw new Error("blocked read");
            },
            setItem() {
              throw new Error("blocked write");
            },
            removeItem() {
              throw new Error("blocked remove");
            },
          },
          configurable: true,
        });
      } else if (savedTheme) {
        window.localStorage.setItem("themePreference", savedTheme);
      }
    },
  });

  dom.window.eval(script);
  await waitFor(() => {
    const theme = dom.window.document.body.dataset.theme;
    return theme === "light" || theme === "dark";
  });

  return { dom, warnings, jsdomErrors };
}

test("restores dark mode from saved storage", async () => {
  const { dom, jsdomErrors } = await loadApp({ savedTheme: "dark" });

  try {
    const button = dom.window.document.getElementById("theme-toggle-button");

    assert.equal(dom.window.document.body.dataset.theme, "dark");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(
      dom.window.document.getElementById("theme-toggle-text").textContent,
      "Dark mode on"
    );
    assert.equal(button.getAttribute("aria-label"), "Turn dark mode off");
    assert.equal(button.title, "Turn dark mode off");
    assert.deepEqual(jsdomErrors, []);
  } finally {
    dom.window.close();
  }
});

test("toggles between light and dark mode and saves the preference", async () => {
  const { dom, jsdomErrors } = await loadApp();

  try {
    const { document, localStorage } = dom.window;
    const button = document.getElementById("theme-toggle-button");

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.body.dataset.theme, "dark");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(document.getElementById("theme-toggle-text").textContent, "Dark mode on");
    assert.equal(button.getAttribute("aria-label"), "Turn dark mode off");
    assert.equal(button.title, "Turn dark mode off");
    assert.equal(localStorage.getItem("themePreference"), "dark");

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.body.dataset.theme, "light");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(document.getElementById("theme-toggle-text").textContent, "Dark mode off");
    assert.equal(button.getAttribute("aria-label"), "Turn dark mode on");
    assert.equal(button.title, "Turn dark mode on");
    assert.equal(localStorage.getItem("themePreference"), "light");
    assert.deepEqual(jsdomErrors, []);
  } finally {
    dom.window.close();
  }
});

test("falls back gracefully when browser storage is unavailable", async () => {
  const { dom, warnings, jsdomErrors } = await loadApp({ blockStorage: true });

  try {
    const button = dom.window.document.getElementById("theme-toggle-button");

    assert.equal(dom.window.document.body.dataset.theme, "light");
    assert.equal(button.getAttribute("aria-label"), "Turn dark mode on");
    assert.equal(button.title, "Turn dark mode on");

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(dom.window.document.body.dataset.theme, "dark");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(dom.window.document.getElementById("theme-toggle-text").textContent, "Dark mode on");
    assert.equal(button.getAttribute("aria-label"), "Turn dark mode off");
    assert.equal(button.title, "Turn dark mode off");
    assert.deepEqual(warnings, [
      "themePreference could not be loaded: Error: blocked read",
      "currentUser could not be loaded: Error: blocked read",
      "themePreference could not be saved: Error: blocked write",
    ]);
    assert.deepEqual(jsdomErrors, []);
  } finally {
    dom.window.close();
  }
});
