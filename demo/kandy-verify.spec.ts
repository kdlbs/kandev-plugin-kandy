/**
 * THROWAWAY verification spec for kandev-plugin-kandy v0.5.0.
 * Desktop: hover tooltip still works; click opens the card dialog;
 * Escape / outside-click close it. Mobile viewport: does the chat-top-bar
 * slot render in the phone layout at all, and does tap open the dialog?
 * DELETE ME after the run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-kandy";
const PACKAGE_PATH =
  "/home/jcfs/kandev-plugins/kandev-plugin-kandy/kandev-plugin-kandy-0.5.0.tar.gz";
const SHOT_DIR = "/tmp/kandev-kandy-demo/screenshots";

async function installKandy(baseUrl: string) {
  const form = new FormData();
  form.append("package", new Blob([fs.readFileSync(PACKAGE_PATH)]), path.basename(PACKAGE_PATH));
  const res = await fetch(`${baseUrl}/api/plugins/install`, { method: "POST", body: form });
  // 409 = already installed by the sibling test in this worker — fine.
  if (!res.ok && res.status !== 409) {
    throw new Error(`install failed: ${res.status} ${await res.text()}`);
  }
  // Enable debug and jump to a mid level so the card looks lively.
  await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: { debug: true } }),
  });
  await expect
    .poll(async () => (await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy`)).status, {
      timeout: 30_000,
    })
    .toBe(200);
  const state = await (
    await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy?debug_grant=60000`)
  ).json();
  return state as { level: number };
}

async function openTaskPage(
  testPage: Page,
  apiClient: { createTask: Function },
  seedData: { workspaceId: string; workflowId: string; startStepId: string },
  title: string,
) {
  const task = await (apiClient.createTask as any)(seedData.workspaceId, title, {
    workflow_id: seedData.workflowId,
    workflow_step_id: seedData.startStepId,
  });
  await testPage.goto(`/t/${task.id}`);
  const session = new SessionPage(testPage);
  await session.waitForLoad();
}

function dialog(page: Page): Locator {
  return page.locator("#kandev-kandy-dialog");
}

test.describe("Kandy — desktop", () => {
  test("hover tooltip + click dialog", async ({ testPage, apiClient, seedData, backend }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installKandy(backend.baseUrl);
    await openTaskPage(testPage, apiClient, seedData, "Kandy desktop verify");

    const widget = testPage.locator("#kandev-kandy-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });

    // Hover quick-peek still works.
    await widget.hover();
    const tooltipCard = testPage
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "to next evolution" })
      .first();
    await expect(tooltipCard.getByText("to next evolution").first()).toBeVisible({
      timeout: 10_000,
    });
    await tooltipCard.screenshot({ path: `${SHOT_DIR}/kandy-desktop-tooltip.png` });
    await testPage.mouse.move(4, 400);
    await expect(tooltipCard).toBeHidden({ timeout: 5_000 });

    // Click opens the dialog with the same card.
    await widget.click();
    await expect(dialog(testPage)).toBeVisible({ timeout: 10_000 });
    await expect(dialog(testPage).getByText("to next evolution")).toBeVisible();
    await testPage.waitForTimeout(500); // fade-in settle
    await dialog(testPage).screenshot({ path: `${SHOT_DIR}/kandy-desktop-dialog.png` });

    // Escape closes.
    await testPage.keyboard.press("Escape");
    await expect(dialog(testPage)).toBeHidden({ timeout: 5_000 });

    // Outside click closes too.
    await widget.click();
    await expect(dialog(testPage)).toBeVisible();
    await testPage.mouse.click(10, 500);
    await expect(dialog(testPage)).toBeHidden({ timeout: 5_000 });
  });
});

test.describe("Kandy — mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("top-bar slot renders on phone layout; tap opens dialog", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installKandy(backend.baseUrl);
    await openTaskPage(testPage, apiClient, seedData, "Kandy mobile verify");

    // KEY FINDING CHECK: does the phone layout render the chat-top-bar
    // plugin slot at all?
    const widget = testPage.locator("#kandev-kandy-widget");
    const mobileActions = testPage.locator('[data-testid="mobile-topbar-actions"]');
    await expect(mobileActions).toBeVisible({ timeout: 15_000 });
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await mobileActions.screenshot({ path: `${SHOT_DIR}/kandy-mobile-topbar.png` });
    // Context shot of the whole phone top area.
    await testPage.screenshot({
      path: `${SHOT_DIR}/kandy-mobile-topbar-context.png`,
      clip: { x: 0, y: 0, width: 390, height: 120 },
    });

    // Tap opens the dialog.
    await widget.tap();
    await expect(dialog(testPage)).toBeVisible({ timeout: 10_000 });
    await expect(dialog(testPage).getByText("to next evolution")).toBeVisible();
    await testPage.waitForTimeout(500);
    await testPage.screenshot({ path: `${SHOT_DIR}/kandy-mobile-dialog.png` });
  });
});
