/**
 * THROWAWAY verification spec for Kandy v0.5.2 live updates.
 * Proves the widget updates from WS events with NO page reload:
 *  - real chat events trigger a spontaneous (debounced) webhook refetch,
 *  - archiving a task (+150 XP) levels the creature up live in the DOM,
 *  - the 1500ms debounce coalesces bursts (refetch count << event count),
 *  - hover tooltip / click dialog / mobile tap keep working.
 * DELETE ME after the run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-kandy";
const PACKAGE_PATH =
  "/home/jcfs/kandev-plugins/kandev-plugin-kandy/kandev-plugin-kandy-0.5.2.tar.gz";
const SHOT_DIR = "/tmp/kandev-kandy-demo/screenshots";

async function installKandy(baseUrl: string) {
  const form = new FormData();
  form.append("package", new Blob([fs.readFileSync(PACKAGE_PATH)]), path.basename(PACKAGE_PATH));
  const res = await fetch(`${baseUrl}/api/plugins/install`, { method: "POST", body: form });
  if (!res.ok && res.status !== 409) {
    throw new Error(`install failed: ${res.status} ${await res.text()}`);
  }
}

function trackWebhookFetches(page: Page): { times: number[] } {
  const tracker = { times: [] as number[] };
  page.on("request", (req) => {
    if (req.url().includes(`/webhooks/kandy`)) tracker.times.push(Date.now());
  });
  return tracker;
}

function countSince(tracker: { times: number[] }, since: number): number {
  return tracker.times.filter((t) => t >= since).length;
}

test.describe("Kandy — live updates (desktop)", () => {
  test("XP and creature update with NO reload", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installKandy(backend.baseUrl);

    // Task A: plain task we will archive later. Task B: agent-backed task
    // whose chat generates real turn/message events.
    const taskA = await apiClient.createTask(seedData.workspaceId, "Kandy archive target", {
      workflow_id: seedData.workflowId,
      workflow_step_id: seedData.startStepId,
    });
    const taskB = await apiClient.createTaskWithAgent(
      seedData.workspaceId,
      "Kandy live chat",
      seedData.agentProfileId,
      {
        workflow_id: seedData.workflowId,
        workflow_step_id: seedData.startStepId,
        repository_ids: [seedData.repositoryId],
      },
    );

    const tracker = trackWebhookFetches(testPage);
    await testPage.goto(`/t/${taskB.id}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();
    await session.waitForChatIdle();

    const widget = testPage.locator("#kandev-kandy-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    const initialLabel = await widget.getAttribute("aria-label");
    expect(initialLabel).toContain("level 1");
    await testPage
      .locator('[data-testid="task-topbar"]')
      .screenshot({ path: `${SHOT_DIR}/kandy-live-before.png` });

    // Keep the mouse far away so no hover/focus refetch can pollute the
    // spontaneous-refetch measurement.
    await testPage.mouse.move(5, 500);

    // --- 2. Real chat work triggers a spontaneous refetch (no reload,
    // no hover): the mock agent turn produces a burst of WS events. ---
    const chatStart = Date.now();
    await session.sendMessage("grow, little kandy");
    await session.waitForChatIdle();
    await expect
      .poll(() => countSince(tracker, chatStart), {
        timeout: 12_000,
        message: "WS events must trigger a spontaneous webhook refetch",
      })
      .toBeGreaterThanOrEqual(1);
    // Let the debounce window fully drain, then measure the burst count.
    await testPage.waitForTimeout(4_000);
    const chatRefetches = countSince(tracker, chatStart);
    console.log(`chat burst: ${chatRefetches} refetch(es) for the whole turn's WS events`);
    expect(chatRefetches).toBeLessThanOrEqual(4);

    // --- 3. Archive a task: +150 XP crosses the level-2 threshold (147)
    // and the aria-label must update live, still with NO reload. ---
    const archiveStart = Date.now();
    const archiveRes = await fetch(`${backend.baseUrl}/api/v1/tasks/${taskA.id}/archive`, {
      method: "POST",
    });
    expect(archiveRes.ok).toBeTruthy();
    await expect
      .poll(async () => (await widget.getAttribute("aria-label")) ?? "", {
        timeout: 10_000,
        message: "archive award must appear in the widget without a reload",
      })
      .toContain("level 2");
    const archiveRefetches = countSince(tracker, archiveStart);
    console.log(`archive: ${archiveRefetches} refetch(es)`);
    await testPage
      .locator('[data-testid="task-topbar"]')
      .screenshot({ path: `${SHOT_DIR}/kandy-live-after.png` });

    // --- 5. No regression: hover tooltip and click dialog still work. ---
    await widget.hover();
    const tooltipCard = testPage
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "to next evolution" })
      .first();
    await expect(tooltipCard.getByText("Lv 2", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await testPage.mouse.move(5, 500);
    await widget.click();
    const dialog = testPage.locator("#kandev-kandy-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("to next evolution")).toBeVisible();
    await testPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });
});

test.describe("Kandy — mobile regression", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap still opens the dialog", async ({ testPage, apiClient, seedData, backend }) => {
    test.setTimeout(120_000);
    await installKandy(backend.baseUrl);
    const task = await apiClient.createTask(seedData.workspaceId, "Kandy mobile regression", {
      workflow_id: seedData.workflowId,
      workflow_step_id: seedData.startStepId,
    });
    await testPage.goto(`/t/${task.id}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();

    const widget = testPage.locator("#kandev-kandy-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await widget.tap();
    const dialog = testPage.locator("#kandev-kandy-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("to next evolution")).toBeVisible();
  });
});
