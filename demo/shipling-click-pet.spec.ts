/**
 * REFERENCE copy of the v0.7.1 verification spec (click-to-pet + jump fix).
 * Ran 2026-07-29 from apps/web/e2e/tests/ in the kandev monorepo (isolated
 * e2e backend fixture); both tests passed, throwaway deleted after the run.
 * Numbers observed: rest cx 640.0 == dialog cx; pet window cx 640.0..640.0
 * (no horizontal jump), y only the intentional <=9px hop; 1 click -> 1 POST;
 * 5 rapid clicks -> 1 POST; celebration cx 640.0..640.0.
 * - a single click on the creature button pets it: floating hearts + exactly
 *   one POST /webhooks/pet, dialog stays open,
 * - the creature stays horizontally centered (no jump-to-center glitch)
 *   at rest AND during the whole pet animation window,
 * - 5 rapid clicks inside the 3s window produce exactly 1 POST (extra
 *   clicks replay the local hearts only),
 * - bored + pet lifts displayed mood to content (hearts 3 -> 4) on next
 *   refetch, no reload,
 * - petting never changes level/progress_pct/award_seq,
 * - regression: celebration from a real XP award fires without positional
 *   jump; chip tooltip + click-opens-dialog unchanged,
 * - mobile (390x844, touch): tap on the creature pets.
 * DELETE ME after the run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-shipling";
const PACKAGE_PATH =
  "/home/jcfs/kandev-plugins/kandev-plugin-shipling/kandev-plugin-shipling-0.7.1.tar.gz";
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
  await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/shipling?debug_grant=5000`);
}

async function forceIdleHours(page: Page, hours: number) {
  await page.unrouteAll();
  await page.route("**/webhooks/shipling*", (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("debug_idle_hours", String(hours));
    void route.continue({ url: url.toString() });
  });
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

/** Sample the pet zone's bounding box for `ms`, returning center-x and top-y ranges. */
async function sampleBox(page: Page, ms: number) {
  const zone = page.locator("#kandev-shipling-pet-zone");
  const cxs: number[] = [];
  const ys: number[] = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    const box = await zone.boundingBox();
    if (box) {
      cxs.push(box.x + box.width / 2);
      ys.push(box.y);
    }
    await page.waitForTimeout(60);
  }
  return {
    cxMin: Math.min(...cxs),
    cxMax: Math.max(...cxs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    samples: cxs.length,
  };
}

test.describe("Shipling v0.7.1 — click-to-pet (desktop)", () => {
  test("click pets, no jump, rate limit, mood lift, XP integrity", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await installShipling(backend.baseUrl);

    let petPosts = 0;
    testPage.on("request", (req) => {
      if (req.url().includes("/webhooks/pet") && req.method() === "POST") petPosts++;
    });

    const celebrationTaskId = await makeTask(apiClient, seedData, "Shipling celebration fodder");

    await forceIdleHours(testPage, 60); // base mood: bored
    const pageTask = await makeTask(apiClient, seedData, "Shipling click-pet verify");
    await testPage.goto(`/t/${pageTask}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();

    const widget = testPage.locator("#kandev-shipling-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });

    // XP integrity baseline (raw, no override).
    const before = await (
      await fetch(`${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/shipling`)
    ).json();

    // --- Regression: chip hover tooltip still works. ---
    await widget.hover();
    const tooltipCard = testPage
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "to next evolution" })
      .first();
    await expect(tooltipCard).toBeVisible({ timeout: 10_000 });
    await testPage.mouse.move(5, 500);
    await expect(tooltipCard).toBeHidden({ timeout: 5_000 });

    // --- Click opens the dialog; bored tier (3/5) + new hint line. ---
    await widget.click();
    const dialog = testPage.locator("#kandev-shipling-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('[aria-label="mood: bored, 3 of 5 hearts"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog.getByText("psst — click your shipling")).toBeVisible();
    const zone = testPage.locator("#kandev-shipling-pet-zone");
    await expect(zone).toBeVisible();
    expect(await zone.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await zone.getAttribute("aria-label")).toBe("Pet your shipling");
    await testPage.waitForTimeout(400);
    await dialog.screenshot({ path: `${SHOT_DIR}/shipling-v071-hint-line.png` });

    // --- Resting centering: creature centered in the card (pre-fix it sat
    // ~60px right of center because wiggle dropped translateX(-50%)). ---
    const dialogBox = (await dialog.boundingBox())!;
    const dialogCx = dialogBox.x + dialogBox.width / 2;
    const restBox = (await zone.boundingBox())!;
    const restCx = restBox.x + restBox.width / 2;
    const restY = restBox.y;
    console.log(`rest center-x=${restCx.toFixed(1)} dialog center-x=${dialogCx.toFixed(1)}`);
    expect(Math.abs(restCx - dialogCx)).toBeLessThanOrEqual(3);

    // --- Single click: hearts + exactly one POST + stable box. ---
    await zone.click();
    await expect(testPage.locator(".kandev-shipling-heartfloat").first()).toBeVisible({
      timeout: 3_000,
    });
    await testPage.waitForTimeout(250);
    await dialog.screenshot({ path: `${SHOT_DIR}/shipling-v071-mid-pet.png` });
    const range = await sampleBox(testPage, 1_300);
    console.log(
      `pet window box: cx ${range.cxMin.toFixed(1)}..${range.cxMax.toFixed(1)} ` +
        `y ${range.yMin.toFixed(1)}..${range.yMax.toFixed(1)} (${range.samples} samples, rest cx ${restCx.toFixed(1)} y ${restY.toFixed(1)})`,
    );
    // No horizontal jump; vertical motion only the intentional <=9px hop.
    expect(Math.abs(range.cxMin - restCx)).toBeLessThanOrEqual(2);
    expect(Math.abs(range.cxMax - restCx)).toBeLessThanOrEqual(2);
    expect(range.yMin).toBeGreaterThanOrEqual(restY - 12);
    expect(range.yMax).toBeLessThanOrEqual(restY + 2);
    await expect.poll(() => petPosts, { timeout: 5_000 }).toBe(1);
    await expect(dialog).toBeVisible(); // clicking the pet button never closes the dialog

    // --- 5 rapid clicks inside 3s: exactly 1 more POST, hearts replay. ---
    await testPage.waitForTimeout(3_200); // let the first window expire
    const postsBeforeBurst = petPosts;
    for (let i = 0; i < 5; i++) {
      await zone.click();
      await testPage.waitForTimeout(120);
    }
    await expect(testPage.locator(".kandev-shipling-heartfloat").first()).toBeVisible();
    await testPage.waitForTimeout(1_500);
    expect(petPosts - postsBeforeBurst).toBe(1);
    console.log(`5 rapid clicks -> ${petPosts - postsBeforeBurst} POST`);

    // --- Mood lift on next refetch, no reload: bored + fresh pet =>
    // content, 4 hearts, hungry-purr flavor. ---
    await testPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await widget.hover(); // refetch via override route + tooltip card
    await expect(
      tooltipCard.locator('[aria-label="mood: content, 4 of 5 hearts"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(tooltipCard.getByText("hungry for shipped work").first()).toBeVisible();
    await testPage.mouse.move(5, 500);

    // --- XP integrity: petting changed nothing hidden. ---
    const after = await (
      await fetch(`${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/shipling`)
    ).json();
    expect(after.level).toBe(before.level);
    expect(after.progress_pct).toBe(before.progress_pct);
    expect(after.award_seq).toBe(before.award_seq);

    // --- Regression: real XP award celebration, no positional jump in the
    // open dialog card. ---
    await widget.click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const restBox2 = (await zone.boundingBox())!;
    const restCx2 = restBox2.x + restBox2.width / 2;
    await fetch(`${backend.baseUrl}/api/v1/tasks/${celebrationTaskId}/archive`, {
      method: "POST",
    });
    const hopping = testPage.locator("#kandev-shipling-pet-zone.kandev-shipling-cardhop");
    await hopping.waitFor({ state: "visible", timeout: 20_000 });
    const celebRange = await sampleBox(testPage, 1_000);
    console.log(
      `celebration box: cx ${celebRange.cxMin.toFixed(1)}..${celebRange.cxMax.toFixed(1)} (rest ${restCx2.toFixed(1)})`,
    );
    expect(Math.abs(celebRange.cxMin - restCx2)).toBeLessThanOrEqual(2);
    expect(Math.abs(celebRange.cxMax - restCx2)).toBeLessThanOrEqual(2);
  });
});

test.describe("Shipling v0.7.1 — mobile tap-to-pet", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap on the creature pets in the dialog", async ({
    testPage,
    apiClient,
    seedData,
    backend,
  }) => {
    test.setTimeout(120_000);
    await installShipling(backend.baseUrl);
    let petPosts = 0;
    testPage.on("request", (req) => {
      if (req.url().includes("/webhooks/pet") && req.method() === "POST") petPosts++;
    });
    const taskId = await makeTask(apiClient, seedData, "Shipling mobile tap pet");
    await testPage.goto(`/t/${taskId}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();

    const widget = testPage.locator("#kandev-shipling-widget");
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await widget.tap();
    const dialog = testPage.locator("#kandev-shipling-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await testPage.locator("#kandev-shipling-pet-zone").tap();
    await expect(testPage.locator(".kandev-shipling-heartfloat").first()).toBeVisible({
      timeout: 3_000,
    });
    await expect.poll(() => petPosts, { timeout: 5_000 }).toBe(1);
    await expect(dialog).toBeVisible();
  });
});
