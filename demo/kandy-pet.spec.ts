/**
 * THROWAWAY verification spec for Kandy v0.7.0 (hearts + petting).
 * - hearts row reflects the mood tier (bored=3, gloomy=1),
 * - a rubbing stroke over the creature triggers the local reaction
 *   (floating hearts) and exactly one rate-limited POST /webhooks/pet,
 * - the pet lifts the displayed mood one tier (bored -> content) on the
 *   next refetch, with no reload,
 * - petting never changes level/progress/award_seq,
 * - "p" key pets too; mobile touch-drag pets in the dialog.
 * DELETE ME after the run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-kandy";
const PACKAGE_PATH =
  "/home/jcfs/kandev-plugins/kandev-plugin-kandy/kandev-plugin-kandy-0.7.0.tar.gz";
const SHOT_DIR = "/tmp/kandev-kandy-demo/screenshots";

async function installKandy(baseUrl: string) {
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
    .poll(async () => (await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy`)).status, {
      timeout: 30_000,
    })
    .toBe(200);
  await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy?debug_grant=5000`);
}

async function forceIdleHours(page: Page, hours: number) {
  await page.unrouteAll();
  await page.route("**/webhooks/kandy*", (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("debug_idle_hours", String(hours));
    void route.continue({ url: url.toString() });
  });
}

async function openTask(
  page: Page,
  apiClient: { createTask: Function },
  seedData: { workspaceId: string; workflowId: string; startStepId: string },
  title: string,
) {
  const task = await (apiClient.createTask as any)(seedData.workspaceId, title, {
    workflow_id: seedData.workflowId,
    workflow_step_id: seedData.startStepId,
  });
  await page.goto(`/t/${task.id}`);
  const session = new SessionPage(page);
  await session.waitForLoad();
}

/** One left-right rubbing pass over the pet zone via real mouse moves. */
async function strokeOnce(page: Page) {
  const zone = page.locator("#kandev-kandy-pet-zone");
  const box = await zone.boundingBox();
  if (!box) throw new Error("pet zone not visible");
  const cy = box.y + box.height / 2;
  const left = box.x + 8;
  const right = box.x + box.width - 8;
  for (const x of [left, right, left, right, left]) {
    await page.mouse.move(x, cy, { steps: 10 });
  }
}

test.describe("Kandy v0.7 — hearts + petting (desktop)", () => {
  test("hearts, stroke-to-pet, mood lift, XP integrity", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installKandy(backend.baseUrl);

    let petPosts = 0;
    testPage.on("request", (req) => {
      if (req.url().includes("/webhooks/pet") && req.method() === "POST") petPosts++;
    });

    await forceIdleHours(testPage, 60); // base mood: bored
    await openTask(testPage, apiClient, seedData, "Kandy petting verify");
    const widget = testPage.locator("#kandev-kandy-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });

    // XP integrity baseline (raw, no override).
    const before = await (
      await fetch(`${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy`)
    ).json();

    // Open the dialog; hearts row shows the bored tier (3/5).
    await widget.click();
    const dialog = testPage.locator("#kandev-kandy-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('[aria-label="mood: bored, 3 of 5 hearts"]')).toBeVisible({
      timeout: 10_000,
    });
    await testPage.waitForTimeout(400);
    await dialog.screenshot({ path: `${SHOT_DIR}/kandy-hearts-bored.png` });

    // --- Stroke to pet: local hearts + exactly one POST. ---
    await strokeOnce(testPage);
    await expect(testPage.locator(".kandev-kandy-heartfloat").first()).toBeVisible({
      timeout: 3_000,
    });
    await dialog.screenshot({ path: `${SHOT_DIR}/kandy-petting-frame.png` });
    await expect.poll(() => petPosts, { timeout: 5_000 }).toBe(1);

    // Mood lift arrives on the next refetch (route-rewritten GET keeps the
    // 60h base): bored + fresh pet => content, 4 hearts, hungry-purr line.
    // The dialog overlay blocks hovering the chip, so close it first.
    await testPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await widget.hover(); // refetch via override route + tooltip card
    const tooltipCard = testPage
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "to next evolution" })
      .first();
    await expect(tooltipCard.locator('[aria-label="mood: content, 4 of 5 hearts"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(tooltipCard.getByText("hungry for shipped work").first()).toBeVisible();
    await tooltipCard.screenshot({ path: `${SHOT_DIR}/kandy-hearts-lifted.png` });

    // Reopen the dialog for the rubbing/rate-limit tests.
    await testPage.mouse.move(5, 500);
    await widget.click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // --- Continuous rubbing for ~5s: the 3s rate limit caps POSTs. ---
    const postsBeforeRub = petPosts;
    const rubStart = Date.now();
    while (Date.now() - rubStart < 5_000) {
      await strokeOnce(testPage);
    }
    const rubPosts = petPosts - postsBeforeRub;
    console.log(`continuous rubbing ~5s produced ${rubPosts} pet POST(s)`);
    expect(rubPosts).toBeGreaterThanOrEqual(1);
    expect(rubPosts).toBeLessThanOrEqual(2);

    // --- Keyboard path: "p" pets after the rate-limit window. ---
    await testPage.waitForTimeout(3_200);
    const postsBeforeKey = petPosts;
    await testPage.keyboard.press("p");
    await expect.poll(() => petPosts, { timeout: 5_000 }).toBe(postsBeforeKey + 1);
    console.log("keyboard 'p' pet observed");

    // --- XP integrity: petting changed nothing hidden. ---
    const after = await (
      await fetch(`${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/kandy`)
    ).json();
    expect(after.level).toBe(before.level);
    expect(after.progress_pct).toBe(before.progress_pct);
    expect(after.award_seq).toBe(before.award_seq);

    // --- Hearts at gloomy (1/5) for the range shot. ---
    await testPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await testPage.waitForTimeout(61 * 0); // (pet lift applies to gloomy -> sad; use raw hours far out)
    await forceIdleHours(testPage, 20_000); // way past everything; pet was <60m ago -> gloomy lifted to sad
    await widget.click();
    await expect(dialog).toBeVisible();
    // Petted minutes ago, so gloomy shows as sad (2 hearts) — assert either
    // explicitly to document the lift, then screenshot.
    await expect(dialog.locator('[aria-label="mood: sad, 2 of 5 hearts"]')).toBeVisible({
      timeout: 10_000,
    });
    await testPage.waitForTimeout(400);
    await dialog.screenshot({ path: `${SHOT_DIR}/kandy-hearts-sad.png` });
  });
});

test.describe("Kandy v0.7 — mobile touch petting", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("touch-drag stroke pets in the dialog", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(120_000);
    await installKandy(backend.baseUrl);
    let petPosts = 0;
    testPage.on("request", (req) => {
      if (req.url().includes("/webhooks/pet") && req.method() === "POST") petPosts++;
    });
    await openTask(testPage, apiClient, seedData, "Kandy mobile petting");

    const widget = testPage.locator("#kandev-kandy-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await widget.tap();
    const dialog = testPage.locator("#kandev-kandy-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Synthesize a touch-drag rubbing gesture as pointer events (what a
    // finger drag dispatches with touch-action: none).
    await testPage.locator("#kandev-kandy-pet-zone").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const cy = box.y + box.height / 2;
      const xs: number[] = [];
      for (const [from, to] of [
        [8, box.width - 8],
        [box.width - 8, 8],
        [8, box.width - 8],
        [box.width - 8, 8],
        [8, box.width - 8],
      ] as Array<[number, number]>) {
        const step = (to - from) / 10;
        for (let i = 0; i <= 10; i++) xs.push(box.x + from + step * i);
      }
      for (const x of xs) {
        el.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "touch",
            clientX: x,
            clientY: cy,
            bubbles: true,
          }),
        );
      }
    });
    await expect(testPage.locator(".kandev-kandy-heartfloat").first()).toBeVisible({
      timeout: 3_000,
    });
    await expect.poll(() => petPosts, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  });
});
