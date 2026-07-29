/**
 * THROWAWAY verification spec for Shipling v0.6.0 (moods + celebrations).
 * - real work (archive) triggers the celebration classes on the chip live,
 * - four archives cross the new 500-XP level-2 threshold -> levelup pulse,
 * - debug_idle_hours (injected into the widget's own fetch via route
 *   rewrite) drives bored/sad/gloomy chip+card states,
 * - mobile dialog regression. DELETE ME after the run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-shipling";
const PACKAGE_PATH =
  "/home/jcfs/kandev-plugins/kandev-plugin-shipling/kandev-plugin-shipling-0.6.0.tar.gz";
const SHOT_DIR = "/tmp/kandev-shipling-demo/screenshots";

async function installShipling(baseUrl: string) {
  const form = new FormData();
  form.append("package", new Blob([fs.readFileSync(PACKAGE_PATH)]), path.basename(PACKAGE_PATH));
  const res = await fetch(`${baseUrl}/api/plugins/install`, { method: "POST", body: form });
  if (!res.ok && res.status !== 409) {
    throw new Error(`install failed: ${res.status} ${await res.text()}`);
  }
  await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: { debug: true } }),
  });
  await expect
    .poll(async () => (await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/shipling`)).status, {
      timeout: 30_000,
    })
    .toBe(200);
}

async function makeTask(
  apiClient: { createTask: Function },
  seedData: { workspaceId: string; workflowId: string; startStepId: string },
  title: string,
): Promise<string> {
  const task = await (apiClient.createTask as any)(seedData.workspaceId, title, {
    workflow_id: seedData.workflowId,
    workflow_step_id: seedData.startStepId,
  });
  return task.id as string;
}

test.describe("Shipling v0.6 — moods + celebrations (desktop)", () => {
  test("celebrations fire live; idle moods render", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installShipling(backend.baseUrl);

    const taskIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      taskIds.push(await makeTask(apiClient, seedData, `Shipling mood task ${i}`));
    }
    const pageTask = await makeTask(apiClient, seedData, "Shipling mood viewer");
    await testPage.goto(`/t/${pageTask}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();

    const widget = testPage.locator("#kandev-shipling-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    expect(await widget.getAttribute("aria-label")).toMatch(/level 1 Egg, (elated|happy|content)/);
    await testPage.mouse.move(5, 500);

    // --- Gain celebration: one archive (+150 < 500 threshold => no level
    // change) must flash the chip's celebrate class live. ---
    await fetch(`${backend.baseUrl}/api/v1/tasks/${taskIds[0]}/archive`, { method: "POST" });
    const celebrating = testPage.locator("#kandev-shipling-widget.kandev-shipling-celebrate");
    await celebrating.waitFor({ state: "visible", timeout: 15_000 });
    await testPage
      .locator('[data-testid="task-topbar"]')
      .screenshot({ path: `${SHOT_DIR}/shipling-celebration-frame.png` });
    console.log("gain celebration class observed");
    await expect(celebrating).toBeHidden({ timeout: 5_000 });

    // --- Level-up celebration: three more archives cross 500 XP =>
    // level 2 => the bigger golden pulse class + updated aria-label. ---
    await fetch(`${backend.baseUrl}/api/v1/tasks/${taskIds[1]}/archive`, { method: "POST" });
    await fetch(`${backend.baseUrl}/api/v1/tasks/${taskIds[2]}/archive`, { method: "POST" });
    await testPage.waitForTimeout(4_000); // let those settle (still level 1: 450 XP)
    await fetch(`${backend.baseUrl}/api/v1/tasks/${taskIds[3]}/archive`, { method: "POST" });
    const levelup = testPage.locator("#kandev-shipling-widget.kandev-shipling-levelup");
    await levelup.waitFor({ state: "visible", timeout: 15_000 });
    await testPage
      .locator('[data-testid="task-topbar"]')
      .screenshot({ path: `${SHOT_DIR}/shipling-levelup-frame.png` });
    console.log("levelup celebration class observed");
    await expect
      .poll(async () => (await widget.getAttribute("aria-label")) ?? "")
      .toContain("level 2");

    // --- Idle moods via debug_idle_hours injected into the widget's own
    // fetch (route rewrite), then hover to refetch + show the card. ---
    const moods: Array<{ hours: number; mood: string }> = [
      { hours: 60, mood: "bored" },
      { hours: 120, mood: "sad" },
      { hours: 200, mood: "gloomy" },
    ];
    for (const m of moods) {
      await testPage.route("**/webhooks/shipling*", (route) => {
        const url = new URL(route.request().url());
        url.searchParams.set("debug_idle_hours", String(m.hours));
        void route.continue({ url: url.toString() });
      });
      await testPage.mouse.move(5, 500);
      await testPage.waitForTimeout(300);
      await widget.hover(); // triggers refetch (with override) + tooltip
      await expect
        .poll(async () => (await widget.getAttribute("aria-label")) ?? "", { timeout: 10_000 })
        .toContain(m.mood);
      const card = testPage
        .locator('[data-slot="tooltip-content"]')
        .filter({ hasText: "to next evolution" })
        .first();
      await expect(card.getByText("to next evolution").first()).toBeVisible({ timeout: 10_000 });
      await testPage.waitForTimeout(400);
      await card.screenshot({ path: `${SHOT_DIR}/shipling-mood-${m.mood}-card.png` });
      await testPage
        .locator('[data-testid="task-topbar"]')
        .screenshot({ path: `${SHOT_DIR}/shipling-mood-${m.mood}-chip.png` });
      await testPage.unroute("**/webhooks/shipling*");
    }
  });
});

test.describe("Shipling v0.6 — mobile regression", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap still opens the dialog", async ({ testPage, apiClient, seedData, backend }) => {
    test.setTimeout(120_000);
    await installShipling(backend.baseUrl);
    const taskId = await makeTask(apiClient, seedData, "Shipling mobile v6");
    await testPage.goto(`/t/${taskId}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();

    const widget = testPage.locator("#kandev-shipling-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await widget.tap();
    const dialog = testPage.locator("#kandev-shipling-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("to next evolution")).toBeVisible();
  });
});
