/**
 * THROWAWAY demo spec for kandev-plugin-gotchi verification + screenshots.
 * Boots the standard isolated e2e backend (own port/tmpdir/SQLite), installs
 * the locally built tarball, proves real events feed XP, then uses the
 * debug_grant knob to jump the gotchi through evolution stages. DELETE ME.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/test-base";
import { SessionPage } from "../pages/session-page";

const PLUGIN_ID = "kandev-plugin-gotchi";
const PACKAGE_PATH = "/home/jcfs/kandev-plugins/kandev-plugin-gotchi/kandev-plugin-gotchi-0.4.0.tar.gz";
const SHOT_DIR = "/tmp/kandev-gotchi-demo/screenshots";

type GotchiState = {
  level: number;
  tier: number;
  stage_name: string;
  progress_pct: number;
  appearance_seed: number;
  flavor: string;
};

async function fetchGotchi(baseUrl: string, query = ""): Promise<GotchiState> {
  const res = await fetch(`${baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/gotchi${query}`);
  expect(res.ok).toBeTruthy();
  return (await res.json()) as GotchiState;
}

async function openCard(page: Page, widget: Locator, level: number): Promise<Locator> {
  // Close any open tooltip first, then hover (hover also re-fetches state).
  await page.mouse.move(4, 4);
  await page.waitForTimeout(400);
  await widget.hover();
  const card = page
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: "to next evolution" })
    .first();
  await expect(card.getByText(`Lv ${level}`, { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  return card;
}

test("gotchi evolves in an isolated instance (demo screenshots)", async ({
  testPage,
  apiClient,
  seedData,
  backend,
}) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // --- Install the tarball (multipart, same endpoint as the upload UI) ---
  const form = new FormData();
  form.append(
    "package",
    new Blob([fs.readFileSync(PACKAGE_PATH)]),
    path.basename(PACKAGE_PATH),
  );
  const install = await fetch(`${backend.baseUrl}/api/plugins/install`, {
    method: "POST",
    body: form,
  });
  expect(install.ok, await install.clone().text()).toBeTruthy();

  // --- Create a task and feed the mock agent so real events flow ---
  const task = await apiClient.createTaskWithAgent(
    seedData.workspaceId,
    "Feed the gotchi",
    seedData.agentProfileId,
    {
      workflow_id: seedData.workflowId,
      workflow_step_id: seedData.startStepId,
      repository_ids: [seedData.repositoryId],
    },
  );
  await testPage.goto(`/t/${task.id}`);
  const session = new SessionPage(testPage);
  await session.waitForLoad();
  await session.waitForChatIdle();
  await session.sendMessage("Hello little gotchi, grow strong");
  await session.waitForChatIdle();

  // OnEvent must have awarded XP for the real message/turn events.
  await expect
    .poll(async () => (await fetchGotchi(backend.baseUrl)).progress_pct, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const earned = await fetchGotchi(backend.baseUrl);

  // --- Top-bar widget + low-level card (light) ---
  const widget = testPage.locator("#kandev-gotchi-widget");
  await expect(widget).toBeVisible({ timeout: 15_000 });
  await testPage
    .locator('[data-testid="task-topbar"]')
    .screenshot({ path: `${SHOT_DIR}/01-topbar-low-level-light.png` });

  let card = await openCard(testPage, widget, earned.level);
  await card.screenshot({ path: `${SHOT_DIR}/02-card-low-level-light.png` });

  // Dark mode for the same stage (no reload — just flip the class).
  await testPage.evaluate(() => document.documentElement.classList.add("dark"));
  await testPage.waitForTimeout(300);
  await card.screenshot({ path: `${SHOT_DIR}/03-card-low-level-dark.png` });
  await testPage
    .locator('[data-testid="task-topbar"]')
    .screenshot({ path: `${SHOT_DIR}/04-topbar-low-level-dark.png` });
  await testPage.evaluate(() => document.documentElement.classList.remove("dark"));

  // --- debug_grant is rejected while debug config is off ---
  const forbidden = await fetch(
    `${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/gotchi?debug_grant=1000`,
  );
  expect(forbidden.status).toBe(403);

  // --- Enable debug and jump through evolution stages ---
  const patch = await apiClient.rawRequest("PATCH", `/api/plugins/${PLUGIN_ID}`, {
    config: { debug: true },
  });
  expect(patch.ok, await patch.clone().text()).toBeTruthy();
  // Config update restarts the plugin process; wait until it serves again.
  await expect
    .poll(
      async () =>
        (await fetch(`${backend.baseUrl}/api/plugins/${PLUGIN_ID}/webhooks/gotchi`)).status,
      { timeout: 30_000 },
    )
    .toBe(200);

  const stages: Array<{ grant: number; label: string; dark?: boolean }> = [
    { grant: 4_000, label: "mid" }, // ~level 6, tier 1 (forest)
    { grant: 100_000, label: "high" }, // ~level 12, tier 2 (lake)
    { grant: 20_000_000, label: "epic", dark: true }, // ~level 21, tier 4 (city dusk)
    { grant: 980_000_000, label: "cosmic" }, // pushes into tier 5+ scenery
    { grant: 1_000_000_000, label: "beyond" }, // deeper still
    { grant: 1_000_000_000, label: "aurora1" },
    { grant: 1_000_000_000, label: "aurora", dark: true }, // tier 6 (aurora)
  ];
  let shot = 5;
  for (const stage of stages) {
    const state = await fetchGotchi(backend.baseUrl, `?debug_grant=${stage.grant}`);
    expect(state.level).toBeGreaterThan(earned.level);
    card = await openCard(testPage, widget, state.level);
    const prefix = `${String(shot).padStart(2, "0")}-card-lv${state.level}-${stage.label}`;
    await card.screenshot({ path: `${SHOT_DIR}/${prefix}-light.png` });
    if (stage.dark) {
      await testPage.evaluate(() => document.documentElement.classList.add("dark"));
      await testPage.waitForTimeout(300);
      await card.screenshot({ path: `${SHOT_DIR}/${prefix}-dark.png` });
      await testPage.evaluate(() => document.documentElement.classList.remove("dark"));
    }
    // eslint-disable-next-line no-console
    console.log(`stage ${stage.label}: level=${state.level} biome=${state.biome} stage=${state.stage} name="${state.stage_name}" progress=${state.progress_pct}%`);
    shot++;
  }

  // --- Full page with the final evolved gotchi card open ---
  const finalState = await fetchGotchi(backend.baseUrl);
  card = await openCard(testPage, widget, finalState.level);
  await testPage.waitForTimeout(800); // let the tooltip fade-in settle
  await testPage.screenshot({ path: `${SHOT_DIR}/99-full-page-light.png`, fullPage: false });
});
