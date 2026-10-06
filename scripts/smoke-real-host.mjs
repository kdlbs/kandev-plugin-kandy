#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PLUGIN_ID = "kandev-plugin-kandy";
const [hostRootArg, packageArg, hostVariant, portArg, artifactsArg] = process.argv.slice(2);
const releaseRuntimeBin = process.env.KANDEV_SMOKE_RUNTIME_BIN
  ? path.resolve(process.env.KANDEV_SMOKE_RUNTIME_BIN)
  : null;
const releaseMockAgentBin = releaseRuntimeBin
  ? path.join(path.dirname(releaseRuntimeBin), "mock-agent")
  : null;
const expectedHostRevision = process.env.KANDEV_SMOKE_HOST_REVISION || "";
const expectedHostVersion = process.env.KANDEV_SMOKE_EXPECT_VERSION || "";
const expectedHostTag = process.env.KANDEV_SMOKE_HOST_TAG || "";
const playwrightPackageJson = process.env.KANDEV_SMOKE_PLAYWRIGHT_PACKAGE_JSON || "";
if (!hostRootArg || !packageArg || !["action", "legacy"].includes(hostVariant) || !portArg) {
  throw new Error(
    "usage: node scripts/smoke-real-host.mjs <host-root|release-root> <kandy-package> <action|legacy> <port> [artifacts-dir]",
  );
}

const hostRoot = path.resolve(hostRootArg);
const hostRevision = releaseRuntimeBin
  ? expectedHostRevision
  : execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: hostRoot,
      encoding: "utf8",
    }).trim();
const packagePath = path.resolve(packageArg);
const port = Number(portArg);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, "port must be valid");
if (releaseRuntimeBin) {
  assert.ok(existsSync(releaseRuntimeBin), `released Kandev runtime does not exist: ${releaseRuntimeBin}`);
  assert.ok(
    existsSync(releaseMockAgentBin),
    "build mock-agent from the exact release source into the runtime bin directory before this smoke",
  );
  assert.match(expectedHostRevision, /^[0-9a-f]{40}$/, "set KANDEV_SMOKE_HOST_REVISION to the released source commit");
  assert.match(expectedHostVersion, /^v\d+\.\d+\.\d+/, "set KANDEV_SMOKE_EXPECT_VERSION to the /health version");
  assert.equal(expectedHostTag, expectedHostVersion, "set KANDEV_SMOKE_HOST_TAG to the matching release tag");
  assert.ok(existsSync(playwrightPackageJson), "set KANDEV_SMOKE_PLAYWRIGHT_PACKAGE_JSON to a package.json that resolves @playwright/test");
} else {
  assert.ok(existsSync(path.join(hostRoot, "apps/web/package.json")), "host checkout is missing apps/web");
  assert.ok(existsSync(path.join(hostRoot, "apps/backend/bin/kandev")), "build the host backend first");
  assert.ok(existsSync(path.join(hostRoot, "apps/web/dist/index.html")), "build the host web app first");
}
assert.ok(existsSync(packagePath), `plugin package does not exist: ${packagePath}`);

const outputDir = path.resolve(
  artifactsArg || path.join(process.cwd(), "real-host-smoke", hostVariant),
);
mkdirSync(outputDir, { recursive: true });
const tempDir = mkdtempSync(path.join(os.tmpdir(), `kandy-${hostVariant}-`));
const homeDir = path.join(tempDir, "home");
const repositoryDir = path.join(tempDir, "repos", "smoke-repo");
const serverLogPath = path.join(outputDir, "host.log");
mkdirSync(repositoryDir, { recursive: true });
mkdirSync(path.join(homeDir, "tmp"), { recursive: true });

const requireFromHost = createRequire(
  releaseRuntimeBin ? path.resolve(playwrightPackageJson) : path.join(hostRoot, "apps/web/package.json"),
);
const { chromium, expect } = requireFromHost("@playwright/test");
const baseUrl = `http://127.0.0.1:${port}`;
const serverLog = createWriteStream(serverLogPath, { flags: "w" });
let server;
let browser;
let hostVersion = null;

function runGit(args) {
  execFileSync("git", args, {
    cwd: repositoryDir,
    env: {
      HOME: homeDir,
      GIT_CONFIG_GLOBAL: path.join(homeDir, ".gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: process.env.PATH || "/usr/bin:/bin",
      GIT_AUTHOR_NAME: "Kandy Smoke",
      GIT_AUTHOR_EMAIL: "kandy-smoke@example.invalid",
      GIT_COMMITTER_NAME: "Kandy Smoke",
      GIT_COMMITTER_EMAIL: "kandy-smoke@example.invalid",
    },
    stdio: "ignore",
  });
}

async function api(method, route, body) {
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} returned ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function startHost() {
  const backendBin = releaseRuntimeBin || path.join(hostRoot, "apps/backend/bin/kandev");
  const agentctlPortBase = 30001 + (port % 30) * 1000;
  const env = {
    HOME: homeDir,
    XDG_CACHE_HOME: path.join(homeDir, ".cache"),
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    KANDEV_HOME_DIR: homeDir,
    KANDEV_DATABASE_PATH: path.join(homeDir, "kandev.db"),
    KANDEV_SERVER_HOST: "127.0.0.1",
    KANDEV_SERVER_PORT: String(port),
    ...(releaseRuntimeBin ? {} : { KANDEV_WEB_DIST_DIR: path.join(hostRoot, "apps/web/dist") }),
    KANDEV_E2E_MOCK: "true",
    KANDEV_E2E_SYSTEM_TEMP_ROOT: path.join(homeDir, "tmp"),
    KANDEV_DOCKER_ENABLED: "false",
    KANDEV_WORKTREE_ENABLED: "true",
    KANDEV_WORKTREE_BASEPATH: path.join(homeDir, "worktrees"),
    KANDEV_REPOCLONE_BASEPATH: path.join(homeDir, "repoclones"),
    KANDEV_LOG_LEVEL: "info",
    AGENTCTL_INSTANCE_PORT_BASE: String(agentctlPortBase),
    AGENTCTL_INSTANCE_PORT_MAX: String(agentctlPortBase + 199),
    GIT_AUTHOR_NAME: "Kandy Smoke",
    GIT_AUTHOR_EMAIL: "kandy-smoke@example.invalid",
    GIT_COMMITTER_NAME: "Kandy Smoke",
    GIT_COMMITTER_EMAIL: "kandy-smoke@example.invalid",
    GIT_CONFIG_GLOBAL: path.join(homeDir, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    TMPDIR: path.join(homeDir, "tmp"),
    PATH: [
      releaseRuntimeBin ? path.dirname(releaseRuntimeBin) : path.join(hostRoot, "apps/backend/bin"),
      process.env.PATH || "/usr/bin:/bin",
    ].join(path.delimiter),
  };
  server = spawn(
    backendBin,
    releaseRuntimeBin ? ["run", "--headless", "--port", String(port)] : ["__backend"],
    {
    cwd: hostRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);
  await expect
    .poll(async () => {
      if (server.exitCode !== null) throw new Error(`Kandev exited with ${server.exitCode}`);
      try {
        return (await fetch(`${baseUrl}/ready`)).status;
      } catch {
        return 0;
      }
    }, { timeout: 60_000, intervals: [250, 500, 1000] })
    .toBe(200);
  const health = await api("GET", "/health");
  assert.equal(health.status, "ok", "disposable host health is ready");
  hostVersion = health.version;
  if (expectedHostVersion) {
    assert.equal(hostVersion, expectedHostVersion, "the real host reports the expected release version");
  }
}

async function assertNoHorizontalOverflow(page, surface) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(
    metrics.documentWidth <= metrics.viewportWidth + 1 && metrics.bodyWidth <= metrics.viewportWidth + 1,
    `${surface} has horizontal overflow: ${JSON.stringify(metrics)}`,
  );
  return metrics;
}

async function stopHost() {
  if (!server || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(10_000),
  ]);
  if (server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // The process group exited between the check and signal.
    }
  }
}

async function seedTask() {
  runGit(["init", "-b", "main"]);
  writeFileSync(path.join(repositoryDir, "README.md"), "Disposable Kandy host smoke repository.\n");
  runGit(["add", "README.md"]);
  runGit(["commit", "-m", "seed smoke repository"]);

  const workspace = await api("POST", "/api/v1/workspaces", { name: "Kandy smoke workspace" });
  const workflow = await api("POST", "/api/v1/workflows", {
    workspace_id: workspace.id,
    name: "Kandy smoke workflow",
    workflow_template_id: "simple",
  });
  const stepResult = await api("GET", `/api/v1/workflows/${workflow.id}/workflow/steps`);
  const step = stepResult.steps
    .slice()
    .sort((left, right) => left.position - right.position)
    .find((item) => item.is_start_step) || stepResult.steps[0];
  assert.ok(step, "simple workflow has a start step");
  const agentResult = await api("GET", "/api/v1/agents");
  const profileId = agentResult.agents
    .filter((agent) => agent.id !== "dynamic")
    .flatMap((agent) => agent.profiles || [])
    .find((profile) => profile.id)?.id;
  assert.ok(profileId, "the disposable host exposes an E2E fake agent profile");

  const repository = await api("POST", `/api/v1/workspaces/${workspace.id}/repositories`, {
    name: "Kandy smoke repository",
    source_type: "local",
    local_path: repositoryDir,
    default_branch: "main",
  });
  const task = await api("POST", "/api/v1/tasks", {
    workspace_id: workspace.id,
    title: "Kandy action host smoke",
    description: "/e2e:simple-message",
    // The smoke intercepts Kandy's provider-facing data at the browser route.
    // The real task surface uses the host's local E2E mock-agent profile.
    start_agent: false,
    agent_profile_id: profileId,
    workflow_id: workflow.id,
    workflow_step_id: step.id,
    repositories: [{ repository_id: repository.id }],
  });
  assert.ok(task.id, "task API returned an id");
  return task;
}

async function installPlugin(page) {
  await page.goto(`${baseUrl}/settings/plugins`);
  await page.getByTestId("install-plugin-trigger").click();
  await expect(page.getByTestId("install-plugin-dialog")).toBeVisible();
  await page.getByTestId("install-plugin-tab-upload").click();
  await page.getByTestId("install-plugin-file-input").setInputFiles(packagePath);
  await page.getByTestId("install-plugin-upload-submit").click();
  const row = page.getByTestId(`plugin-row-${PLUGIN_ID}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("Active", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function actionLocator(page) {
  const action = page.locator("#kandev-kandy-widget:visible");
  await expect(action).toHaveCount(1, { timeout: 20_000 });
  return action;
}

async function inspectAction(page, expectedSurface) {
  const action = await actionLocator(page);
  const details = await action.evaluate((element) => {
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      tag: element.tagName.toLowerCase(),
      classes: element.className,
      surface: element.getAttribute("data-surface"),
      presentation: element.getAttribute("data-presentation"),
      accessibleName: element.getAttribute("aria-label"),
      action: rect(element),
      glyph: rect(element.querySelector('[data-slot="surface-action-icon"]')),
      art: rect(element.querySelector(".kandev-kandy-widget-art")),
      svg: rect(element.querySelector(".kandev-kandy-widget-art svg")),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  writeFileSync(path.join(outputDir, "action-geometry.json"), `${JSON.stringify(details, null, 2)}\n`);
  assert.match(details.accessibleName || "", /^Kandy: level \d+ /, "Kandy copy is accessible");
  assert.ok(!details.accessibleName.includes("topbarAction"), "translation key does not leak into accessible copy");
  assert.ok(details.svg && details.svg.width > 0 && details.svg.height > 0, "creature SVG is visible");

  if (expectedSurface === "action") {
    assert.equal(details.surface, "topbar", "host Action owns the topbar surface");
    assert.equal(details.presentation, "desktop");
    assert.ok(details.glyph, "the host supplies its glyph box");
    assert.ok(Math.abs(details.glyph.width - 16) < 0.6, "host glyph box is 16px wide");
    assert.ok(Math.abs(details.glyph.height - 16) < 0.6, "host glyph box is 16px tall");
    assert.ok(
      Math.abs(details.svg.width - details.glyph.width) < 0.6,
      `SVG fits the host glyph width: ${JSON.stringify(details)}`,
    );
    assert.ok(
      Math.abs(details.svg.height - details.glyph.height) < 0.6,
      `SVG fits the host glyph height: ${JSON.stringify(details)}`,
    );
    assert.ok(details.art.x >= details.glyph.x - 0.6 && details.art.y >= details.glyph.y - 0.6);
    assert.ok(details.art.x + details.art.width <= details.glyph.x + details.glyph.width + 0.6);
    assert.ok(details.art.y + details.art.height <= details.glyph.y + details.glyph.height + 0.6);
  } else {
    assert.equal(details.tag, "button", "minimum host uses the legacy native button");
    assert.match(details.classes, /kandev-kandy-widget-legacy/);
    assert.equal(details.glyph, null, "legacy host does not invent a host glyph box");
  }
  return { action, details };
}

let fakeKandy = {
  level: 12,
  stage: 2,
  archetype: 3,
  family: 4,
  biome: 2,
  lineage_seed: 1,
  appearance_seed: 1234,
  stage_name: "Drowsy Sporeling",
  progress_pct: 64.5,
  mood: "gloomy",
  temperament_band: "wary",
  scarred: true,
  flavor: "A disposable smoke-test creature.",
  award_seq: 8,
};

async function runDesktop(page, task) {
  let allowFakeData = false;
  let actualWebhookResponses = 0;
  let actualKandy = null;
  await page.route(`**/api/plugins/${PLUGIN_ID}/webhooks/kandy*`, async (route) => {
    if (allowFakeData) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeKandy) });
      return;
    }
    await route.continue();
  });
  page.on("response", async (response) => {
    if (
      response.url().includes(`/api/plugins/${PLUGIN_ID}/webhooks/kandy`) &&
      response.status() === 200
    ) {
      actualWebhookResponses += 1;
      actualKandy = await response.json().catch(() => null);
    }
  });

  await page.goto(`${baseUrl}/t/${task.id}`);
  const pointer = await page.evaluate(() => ({
    fine: window.matchMedia("(pointer: fine)").matches,
    coarse: window.matchMedia("(pointer: coarse)").matches,
  }));
  assert.equal(pointer.fine, true, "desktop browser exposes a fine pointer");
  const { action } = await inspectAction(page, hostVariant);
  const desktopOverflow = await assertNoHorizontalOverflow(page, "desktop task surface");
  await expect.poll(() => actualWebhookResponses, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => actualKandy, { timeout: 10_000 }).toBeTruthy();
  const expectedActualPrefix =
    `Kandy: level ${actualKandy.level} ${actualKandy.stage_name}, ` + (actualKandy.mood || "content");
  await expect(action).toHaveAccessibleName(new RegExp(`^${expectedActualPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  fakeKandy = {
    ...fakeKandy,
    level: Number(actualKandy.level || 1) + 1,
    award_seq: Number(actualKandy.award_seq || 0) + 1,
  };
  allowFakeData = true;
  await action.hover();
  await expect(page.locator(".kandev-kandy-tooltip")).toBeVisible({ timeout: 15_000 });
  await expect(action).toHaveAccessibleName(
    new RegExp(`^Kandy: level ${fakeKandy.level} Drowsy Sporeling, gloomy(?:, sleeping)?$`),
  );
  await expect(action.locator(".kandev-kandy-widget-art")).toHaveClass(/kandev-kandy-levelup/, {
    timeout: 15_000,
  });
  const preview = page.locator(".kandev-kandy-tooltip");
  await preview.screenshot({ path: path.join(outputDir, "desktop-hover-preview.png") });
  await page.screenshot({ path: path.join(outputDir, "desktop-celebration.png"), fullPage: true });
  const previewOverflow = await assertNoHorizontalOverflow(page, "desktop preview");

  await action.click();
  const dialog = page.locator("#kandev-kandy-dialog");
  await expect(dialog).toBeVisible();
  const dialogOverflow = await assertNoHorizontalOverflow(page, "desktop dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await action.focus();
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await action.focus();
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await action.hover();
  await expect(preview.locator(".kandev-kandy-wiggle").first()).toHaveCount(1);
  const animationName = await preview
    .locator(".kandev-kandy-wiggle")
    .first()
    .evaluate((element) => getComputedStyle(element).animationName);
  assert.equal(animationName, "none", "reduced motion disables creature animation");
  await page.screenshot({ path: path.join(outputDir, "desktop-reduced-motion.png"), fullPage: true });

  await page.goto(`${baseUrl}/settings/plugins`);
  const row = page.getByTestId(`plugin-row-${PLUGIN_ID}`);
  await expect(row.getByRole("button", { name: "Disable" })).toBeVisible();
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.goto(`${baseUrl}/t/${task.id}`);
  await expect(page.locator("#kandev-kandy-widget:visible")).toHaveCount(0);

  await page.goto(`${baseUrl}/settings/plugins`);
  const disabledRow = page.getByTestId(`plugin-row-${PLUGIN_ID}`);
  await disabledRow.getByRole("button", { name: "Enable" }).click();
  await expect(disabledRow.getByText("Active", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.goto(`${baseUrl}/t/${task.id}`);
  const reenabled = page.locator("#kandev-kandy-widget");
  await expect(reenabled).toHaveCount(1, { timeout: 20_000 });
  await expect(reenabled).toBeVisible();
  return {
    pointer,
    desktopOverflow,
    previewOverflow,
    dialogOverflow,
    localizedAccessibleName: await reenabled.getAttribute("aria-label"),
    actualWebhookResponses,
    reenabledCount: await reenabled.count(),
  };
}

async function runPhone(browser, task) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  let allowFakeData = false;
  await page.route(`**/api/plugins/${PLUGIN_ID}/webhooks/kandy*`, async (route) => {
    if (allowFakeData) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeKandy) });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`${baseUrl}/t/${task.id}`);
    const pointer = await page.evaluate(() => ({
      coarse: window.matchMedia("(pointer: coarse)").matches,
      fine: window.matchMedia("(pointer: fine)").matches,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    assert.equal(pointer.coarse, true, "phone context exposes a coarse pointer");
    assert.ok(pointer.maxTouchPoints > 0, "phone context exposes touch input");
    let section = null;
    let action;
    if (hostVariant === "action") {
      const menuTrigger = page.getByTestId("app-nav-trigger");
      await expect(menuTrigger).toBeVisible({ timeout: 20_000 });
      await menuTrigger.tap();
      section = page.getByTestId("mobile-plugin-nav-section");
      await expect(section).toBeVisible();
      action = section.locator("#kandev-kandy-widget");
    } else {
      // v0.83.0 has no mobile plugin-nav section. Its chat top-bar slot still
      // renders the legacy button, so exercise that real surface directly.
      action = page.locator("#kandev-kandy-widget:visible");
    }
    await expect(action).toHaveCount(1, { timeout: 20_000 });
    await expect(action).toBeVisible();
    await action.scrollIntoViewIfNeeded();
    const menuOverflow = await assertNoHorizontalOverflow(page, "phone plugin navigation");
    const details = await action.evaluate((element) => {
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      return {
        accessibleName: element.getAttribute("aria-label"),
        presentation: element.getAttribute("data-presentation"),
        surface: element.getAttribute("data-surface"),
        action: rect(element),
        art: rect(element.querySelector(".kandev-kandy-widget-art")),
        glyph: element.querySelector('[data-slot="surface-action-icon"]')
          ? rect(element.querySelector('[data-slot="surface-action-icon"]'))
          : null,
        svg: rect(element.querySelector("svg")),
        section: rect(element.closest('[data-testid="mobile-plugin-nav-section"]')),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    assert.match(details.accessibleName || "", /^Kandy: level \d+ /);
    assert.ok(details.action.width >= 44 && details.action.height >= 44, "phone target is at least 44px");
    assert.ok(details.action.x >= -0.5 && details.action.y >= -0.5);
    assert.ok(
      details.action.y + details.action.height <= details.viewport.height + 0.5,
      `phone action fits the visible viewport: ${JSON.stringify(details)}`,
    );
    assert.ok(details.action.x + details.action.width <= details.viewport.width + 0.5);
    assert.ok(details.svg.width === 22 || Math.abs(details.svg.width - 16) < 0.6);
    if (hostVariant === "action") {
      assert.equal(details.presentation, "mobile");
      assert.ok(details.section, "new-host Action is inside the mobile plugin section");
      assert.ok(details.glyph && Math.abs(details.glyph.width - 16) < 0.6);
      assert.ok(details.action.x >= details.section.x - 0.5);
      assert.ok(details.action.x + details.action.width <= details.section.x + details.section.width + 0.5);
      assert.ok(details.art.x >= details.glyph.x - 0.6 && details.art.y >= details.glyph.y - 0.6);
      assert.ok(details.art.x + details.art.width <= details.glyph.x + details.glyph.width + 0.6);
      assert.ok(details.art.y + details.art.height <= details.glyph.y + details.glyph.height + 0.6);
    } else {
      assert.equal(details.presentation, null, "old host uses the legacy top-bar slot");
      assert.match(await action.evaluate((element) => element.tagName.toLowerCase()), /^button$/);
      assert.ok(details.art.x >= details.action.x - 0.6 && details.art.y >= details.action.y - 0.6);
      assert.ok(details.art.x + details.art.width <= details.action.x + details.action.width + 0.6);
      assert.ok(details.art.y + details.art.height <= details.action.y + details.action.height + 0.6);
    }
    allowFakeData = true;
    await page.screenshot({ path: path.join(outputDir, "phone-action-viewport.png") });
    await page.screenshot({ path: path.join(outputDir, "phone-action-surface.png"), fullPage: true });
    await action.tap();
    await expect(page.locator("#kandev-kandy-dialog")).toBeVisible();
    await expect(action).toHaveAttribute("aria-label",
      new RegExp(`^Kandy: level ${fakeKandy.level} Drowsy Sporeling, gloomy(?:, sleeping)?$`),
    );
    const dialogOverflow = await assertNoHorizontalOverflow(page, "phone dialog");
    await page.screenshot({ path: path.join(outputDir, "phone-dialog.png"), fullPage: true });
    return {
      pointer,
      details,
      localizedAccessibleName: await action.getAttribute("aria-label"),
      menuOverflow,
      dialogOverflow,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  let task;
  try {
    await startHost();
    task = await seedTask();
    browser = await chromium.launch({
      headless: true,
      env: {
        HOME: homeDir,
        PATH: process.env.PATH || "/usr/bin:/bin",
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "",
        TMPDIR: path.join(homeDir, "tmp"),
        XDG_CACHE_HOME: path.join(homeDir, ".cache"),
        XDG_CONFIG_HOME: path.join(homeDir, ".config"),
      },
      ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    });
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "UTC",
      locale: "en-US",
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.clock.install({ time: new Date("2026-09-30T13:00:00Z") });
    await installPlugin(desktopPage);
    await desktopPage.goto(`${baseUrl}/t/${task.id}`);
    await expect(desktopPage.locator("#kandev-kandy-widget:visible")).toHaveCount(1, {
      timeout: 20_000,
    });
    const desktop = await runDesktop(desktopPage, task);
    const phone = await runPhone(browser, task);
    const result = {
      hostRoot,
      hostRevision,
      hostVersion,
      hostTag: releaseRuntimeBin ? expectedHostTag : null,
      hostSource: releaseRuntimeBin
        ? "official Kandev release runtime bundle with exact-release mock-agent test helper"
        : "source checkout build",
      hostExecutableSha256: releaseRuntimeBin
        ? createHash("sha256").update(readFileSync(releaseRuntimeBin)).digest("hex")
        : null,
      mockAgentHelperSha256: releaseMockAgentBin
        ? createHash("sha256").update(readFileSync(releaseMockAgentBin)).digest("hex")
        : null,
      package: packagePath,
      packageSha256: createHash("sha256").update(readFileSync(packagePath)).digest("hex"),
      variant: hostVariant,
      desktop,
      phone,
      screenshots: [
        "desktop-hover-preview.png",
        "desktop-celebration.png",
        "desktop-reduced-motion.png",
        "phone-action-viewport.png",
        "phone-action-surface.png",
        "phone-dialog.png",
      ],
    };
    writeFileSync(path.join(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    await desktopContext.close();
  } finally {
    if (browser) await browser.close();
    await stopHost();
    await new Promise((resolve) => serverLog.end(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
