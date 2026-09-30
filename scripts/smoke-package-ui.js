#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const packageFile = process.argv[2];
if (!packageFile) {
  process.stderr.write("usage: node scripts/smoke-package-ui.js PACKAGE_FILE [CHROME]\n");
  process.exit(2);
}

const chromePath = process.argv[3] || process.env.CHROME_BIN || "google-chrome";
const fixturePath = path.join(__dirname, "ui-smoke.html");
const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "kandy-ui-smoke-"));
const extractedDir = path.join(temporaryRoot, "package");
fs.mkdirSync(extractedDir);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function createCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed to open")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    const eventListeners = listeners.get(message.method) || [];
    for (const listener of eventListeners) {
      if (!listener.sessionId || listener.sessionId === message.sessionId) listener.resolve(message.params);
    }
  });

  return {
    async open() {
      await opened;
    },
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const request = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return request;
    },
    waitFor(method, sessionId, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const entry = { sessionId, resolve, reject };
        const entries = listeners.get(method) || [];
        entries.push(entry);
        listeners.set(method, entries);
        const timer = setTimeout(() => {
          const index = entries.indexOf(entry);
          if (index >= 0) entries.splice(index, 1);
          reject(new Error(`Timed out waiting for Chrome DevTools event ${method}`));
        }, timeoutMs);
        entry.resolve = (value) => {
          clearTimeout(timer);
          const index = entries.indexOf(entry);
          if (index >= 0) entries.splice(index, 1);
          resolve(value);
        };
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function smokeScenario(mode, mobile, index) {
  const profileDir = path.join(temporaryRoot, `chrome-profile-${index}`);
  fs.mkdirSync(profileDir);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "about:blank",
  ];
  const chrome = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    chromeStderr = (chromeStderr + chunk).slice(-4000);
  });
  let cdp;

  try {
    const activePortFile = path.join(profileDir, "DevToolsActivePort");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(activePortFile) && Date.now() < deadline) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited during startup: ${chromeStderr}`);
      await sleep(50);
    }
    assert.ok(fs.existsSync(activePortFile), `Chrome DevTools port starts: ${chromeStderr}`);

    const [port] = fs.readFileSync(activePortFile, "utf8").trim().split("\n");
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    cdp = createCdp(version.webSocketDebuggerUrl);
    await cdp.open();

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const width = mobile ? 390 : 1280;
    const height = mobile ? 844 : 900;
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    }, sessionId);
    await cdp.send("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false }, sessionId);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    }, sessionId);

    const smokePage = path.join(temporaryRoot, `ui-smoke-${index}.html`);
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const bundleUrl = pathToFileURL(path.join(extractedDir, "ui", "bundle.js")).href;
    const localFixture = fixture.replace('<script src="/ui/bundle.js"></script>', `<script src="${bundleUrl}"></script>`);
    assert.notEqual(localFixture, fixture, "fixture bundle URL is replaced with the extracted package asset");
    fs.writeFileSync(smokePage, localFixture);

    const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url: pathToFileURL(smokePage).href + `?mode=${mode}` }, sessionId);
    await loaded;
    const ready = await evaluate(cdp, sessionId, "document.body.dataset.smokeReady");
    assert.equal(ready, "true", `fixture initializes packaged UI: ${await evaluate(cdp, sessionId, "document.body.dataset.smokeError || ''")}`);

    if (mobile) {
      await evaluate(cdp, sessionId, "window.smoke.button.focus()");
      const point = await evaluate(cdp, sessionId, "(() => { const r = window.smoke.button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      }, sessionId);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
    } else {
      const point = await evaluate(cdp, sessionId, "(() => { const r = window.smoke.button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, sessionId);
      await evaluate(cdp, sessionId, "window.smoke.button.focus()");
      const keyboardOpens = [];
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }, sessionId);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
      keyboardOpens.push(await evaluate(cdp, sessionId, "window.smoke.counters.opens"));
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, sessionId);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, sessionId);
      keyboardOpens.push(await evaluate(cdp, sessionId, "window.smoke.counters.opens"));
      await evaluate(cdp, sessionId, `window.smoke.keyboardOpens = ${JSON.stringify(keyboardOpens)}`);
    }

    return await evaluate(cdp, sessionId, "({ initial: window.smoke.initialMetrics, after: window.smoke.metrics(), mobile: window.smoke.mobile, nativeButton: window.smoke.nativeButton, keyboardOpens: window.smoke.keyboardOpens, keyEvents: window.smoke.keyEvents })");
  } finally {
    if (cdp) cdp.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(2000)]);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
  }
}

async function main() {
  const archive = path.resolve(packageFile);
  run("tar", ["-xzf", archive, "-C", extractedDir]);
  assert.ok(fs.existsSync(path.join(extractedDir, "ui", "bundle.js")), "package contains ui/bundle.js");
  const checks = [];
  let index = 0;
  for (const mode of ["action", "legacy"]) {
    for (const mobile of [false, true]) {
      const result = await smokeScenario(mode, mobile, index++);
      const initial = result.initial;
      const after = result.after;
      const expectedWidth = mobile ? 44 : 28;
      const expectedArt = mode === "action" ? 16 : 22;

      assert.equal(result.nativeButton, true, `${mode} path renders a native button`);
      assert.equal(result.mobile, mobile);
      assert.equal(initial.id, "kandev-kandy-widget");
      assert.match(initial.label, /^Kandy: level 12 Drowsy Sporeling, gloomy$/);
      assert.equal(initial.outerWidth, expectedWidth, `${mode} ${mobile ? "phone" : "desktop"} width`);
      assert.equal(initial.outerHeight, expectedWidth, `${mode} ${mobile ? "phone" : "desktop"} height`);
      assert.equal(initial.glyphWidth, mode === "action" ? 16 : expectedArt);
      assert.equal(initial.glyphHeight, mode === "action" ? 16 : expectedArt);
      assert.equal(initial.artWidth, expectedArt);
      assert.equal(initial.artHeight, expectedArt);
      assert.equal(initial.pointerCoarse, mobile, `${mode} pointer media query matches desktop/phone mode`);
      assert.deepEqual(initial.registeredSlots, ["chat-top-bar", "chat-top-bar"]);
      assert.equal(initial.registrationCountBeforeDisable, 1);
      assert.equal(initial.registrationCountAfterReenable, 2);
      assert.equal(initial.styleRemoved, true);
      assert.equal(initial.styleRestored, true);
      assert.ok(initial.wsHandlerCount > 0);
      assert.equal(initial.reducedMotion, true);
      assert.equal(initial.artAnimation, "none");

      if (mobile) {
        assert.equal(after.opens, 1, `${mode} touch path opens the Kandy dialog`);
        assert.ok(after.loads >= 1 && after.loads <= 2, `${mode} focus/touch loads Kandy on phone`);
      } else {
        assert.equal(after.opens, 2, `${mode} Enter and Space activation open the Kandy dialog`);
        assert.deepEqual(result.keyboardOpens, [1, 2], `${mode} Enter and Space each activate the button`);
        assert.deepEqual(result.keyEvents, ["down:Enter", "up:Enter", "down: ", "up: "]);
        assert.equal(after.loads, 2, `${mode} hover and focus both load Kandy`);
      }
      assert.equal(after.activeId, "kandev-kandy-widget");
      assert.equal(after.previewVisible, true);
      assert.equal(after.dialogVisible, true);

      checks.push({
        hostPath: mode === "action" ? "host Action" : "older-host fallback",
        layout: mobile ? "phone/touch" : "desktop/keyboard",
        target: `${initial.outerWidth}x${initial.outerHeight}px`,
        creature: `${initial.artWidth}x${initial.artHeight}px`,
        coarsePointer: initial.pointerCoarse,
        reducedMotion: initial.artAnimation,
        loads: after.loads,
        opens: after.opens,
      });
    }
  }

  process.stdout.write(
    JSON.stringify({ package: path.basename(archive), browser: chromePath, checks }, null, 2) + "\n",
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
