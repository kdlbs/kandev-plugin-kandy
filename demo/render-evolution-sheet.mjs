#!/usr/bin/env node
/**
 * Evolution-poster generator. Pure rendering — no kandev instance.
 *
 * 1. Runs the real plugin binary's `genlevels` subcommand (same Go functions
 *    that serve the webhook) with FIXED salts, so DNA/names are faithful.
 * 2. Builds a self-contained HTML harness that loads the real ui/bundle.js
 *    (window.registerKandevPlugin stub captures its exposed __render
 *    helpers) and renders each level's creature inside its biome scene via
 *    a tiny DOM hyperscript in place of host.jsx.
 * 3. Screenshots with the Playwright chromium installed under the monorepo.
 *
 * Modes:
 *   node demo/render-evolution-sheet.mjs                 # Lv 1..40 sheet + Lv40 hero (v3 names)
 *   node demo/render-evolution-sheet.mjs --hero-level N  # single hero cell
 *   node demo/render-evolution-sheet.mjs --compare       # 4 lineages x levels 1/10/20/30/40
 * Env: KANDEV_WEB_DIR — apps/web dir of a kandev checkout (for playwright)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WEB_DIR =
  process.env.KANDEV_WEB_DIR ??
  "/home/jcfs/.kandev/tasks/kandev-plugin-ideas_z84/kandev/apps/web";
const OUT_DIR = "/tmp/kandev-gotchi-demo/screenshots";

const SALT = 20260728; // fixed demo lineage — note in any report/README
const COMPARE_SALTS = [20260728, 424242, 90210, 777001]; // comparison rows

const heroArg = process.argv.indexOf("--hero-level");
const HERO_LEVEL = heroArg >= 0 ? Number.parseInt(process.argv[heroArg + 1], 10) : null;
const COMPARE = process.argv.includes("--compare");
const FIRST_MONTH = process.argv.includes("--first-month");

// Measured production pace: ~2,860 XP/active day, 18 active days / 30
// calendar days. The strip shows the level reached after day 1..30.
const XP_PER_ACTIVE_DAY = 2860;
const ACTIVE_DAYS_RATIO = 18 / 30;
const FIRST_MONTH_DAYS = [1, 3, 7, 14, 21, 30];
function xpAtDay(day) {
  return Math.round(XP_PER_ACTIVE_DAY * Math.max(1, Math.round(day * ACTIVE_DAYS_RATIO)));
}

const bin = path.join(REPO, "bin", "kandev-plugin-gotchi");
if (!fs.existsSync(bin)) {
  console.error(`missing ${bin} — run \`make build\` first`);
  process.exit(1);
}

function genLevels(salt, levels) {
  return JSON.parse(
    execFileSync(bin, ["genlevels", "-salt", String(salt), "-levels", levels.join(",")]).toString(),
  );
}

function genLevelsForXPs(salt, xps) {
  return JSON.parse(
    execFileSync(bin, ["genlevels", "-salt", String(salt), "-xps", xps.join(",")]).toString(),
  );
}

let LEVELS = [];
let ROWS = null; // compare mode: [{salt, infos}]
let DAY_LABELS = null; // first-month mode: per-cell "Day N" labels
if (COMPARE) {
  const cols = [1, 10, 20, 30, 40];
  ROWS = COMPARE_SALTS.map((salt) => ({ salt, infos: genLevels(salt, cols) }));
} else if (FIRST_MONTH) {
  LEVELS = genLevelsForXPs(SALT, FIRST_MONTH_DAYS.map(xpAtDay));
  DAY_LABELS = FIRST_MONTH_DAYS.map((d) => "Day " + d);
} else if (HERO_LEVEL != null) {
  if (!Number.isInteger(HERO_LEVEL) || HERO_LEVEL < 1) {
    console.error("--hero-level must be a positive integer");
    process.exit(1);
  }
  LEVELS = genLevels(SALT, [HERO_LEVEL]);
} else {
  // v0.4 band is 1..100: every level through 10, then every 5.
  const all = [];
  for (let l = 1; l <= 10; l++) all.push(l);
  for (let l = 15; l <= 100; l += 5) all.push(l);
  LEVELS = genLevels(SALT, all);
}

// --- Self-contained harness page ---
const bundleSrc = fs.readFileSync(path.join(REPO, "ui", "bundle.js"), "utf8");

const harnessScript = `
var LEVELS = ${JSON.stringify(LEVELS)};
var ROWS = ${JSON.stringify(ROWS)};
var DAY_LABELS = ${JSON.stringify(DAY_LABELS)};
var R = window.__plugins["kandev-plugin-gotchi"].__render;

var SVG_TAGS = { svg: 1, g: 1, circle: 1, ellipse: 1, path: 1, rect: 1, line: 1, polygon: 1, text: 1 };
function appendKids(el, kids) {
  kids.forEach(function (kid) {
    if (kid == null) return;
    if (Array.isArray(kid)) return appendKids(el, kid);
    if (typeof kid === "string" || typeof kid === "number") {
      el.appendChild(document.createTextNode(String(kid)));
      return;
    }
    el.appendChild(kid);
  });
}
// Minimal hyperscript standing in for host.jsx: builds real DOM nodes from
// the same (tag, props, ...children) calls the bundle makes.
function domH(tag, props) {
  var el = SVG_TAGS[tag]
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || k === "key") return;
      if (k === "className") return el.setAttribute("class", String(v));
      if (k === "style" && typeof v === "object") {
        Object.keys(v).forEach(function (s) {
          el.style[s] = String(v[s]);
        });
        return;
      }
      if (k === "viewBox" || k === "preserveAspectRatio") return el.setAttribute(k, String(v));
      el.setAttribute(k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }), String(v));
    });
  }
  appendKids(el, Array.prototype.slice.call(arguments, 2));
  return el;
}
R.setJsx(domH);

function makeCell(info, sceneW, sceneH, creatureSize, hero) {
  var scene = R.sceneFor(info.biome, info.level, info.lineage_seed >>> 0);
  var sceneSvg = domH(
    "svg",
    {
      viewBox: "0 0 240 120",
      preserveAspectRatio: "xMidYMax slice",
      width: sceneW,
      height: sceneH,
      style: { position: "absolute", left: "0", top: "0" },
    },
    scene.props,
  );
  var creatureWrap = domH(
    "div",
    { className: "creature" },
    R.creatureSvg(domH, info, creatureSize),
  );
  var sceneDiv = domH(
    "div",
    { className: "scene", style: { background: scene.bg, height: sceneH + "px" } },
    sceneSvg,
    creatureWrap,
  );
  var label = domH(
    "div",
    { className: "label" + (hero ? " hero-label" : "") },
    domH("span", { className: "lv" }, (info.dayLabel ? info.dayLabel + " — " : "") + "Lv " + info.level),
    domH("span", { className: "name" }, info.stage_name),
  );
  return domH(
    "div",
    { className: "cell", style: { width: sceneW + "px" } },
    sceneDiv,
    label,
  );
}

if (ROWS) {
  var cmp = document.getElementById("grid");
  ROWS.forEach(function (row) {
    var species = row.infos[row.infos.length - 1].stage_name.split(" ").pop();
    var rowEl = domH("div", { className: "cmp-row" });
    rowEl.appendChild(
      domH(
        "div",
        { className: "cmp-head" },
        domH("div", { className: "cmp-species" }, species),
        domH("div", { className: "cmp-salt" }, "seed " + row.salt),
      ),
    );
    row.infos.forEach(function (info) {
      rowEl.appendChild(makeCell(info, 150, 96, 72, false));
    });
    cmp.appendChild(rowEl);
  });
} else {
  var grid = document.getElementById("grid");
  LEVELS.forEach(function (info, i) {
    if (DAY_LABELS) info.dayLabel = DAY_LABELS[i];
    grid.appendChild(makeCell(info, 176, 108, 84, false));
  });
  var last = LEVELS[LEVELS.length - 1];
  document.getElementById("hero").appendChild(makeCell(last, 480, 250, 200, true));
}
document.title = "kandev gotchi evolution sheet";
`;

const title = COMPARE
  ? "Kandev Gotchi — four lineages, growing up"
  : FIRST_MONTH
    ? "Kandev Gotchi — your first month, at your real pace"
    : `Kandev Gotchi — evolution, Lv ${LEVELS[0] ? LEVELS[0].level : 1} → ${LEVELS.length ? LEVELS[LEVELS.length - 1].level : 100}`;
const subtitle = COMPARE
  ? "Different seeds are different beings; each one grows coherently. Rendered by the shipped plugin code."
  : FIRST_MONTH
    ? `Measured pace: ~2,860 XP per active day, 18 active days / 30. Salt ${SALT}, rendered by the shipped plugin code.`
    : `One lineage (salt ${SALT}), the same being at every level — it only ever grows. Rendered by the shipped plugin code.`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: #fafafa; --card: #ffffff; --border: #e4e4e7; --fg: #18181b; --fg-dim: #71717a;
  }
  body.dark {
    --bg: #131316; --card: #1c1c21; --border: #2e2e35; --fg: #f4f4f5; --fg-dim: #a1a1aa;
  }
  * { animation: none !important; margin: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  #sheet { display: inline-block; padding: 20px 24px 24px; background: var(--bg); }
  header { padding: 2px 4px 14px; }
  header h1 { font-size: 20px; font-weight: 700; }
  header p { font-size: 11px; color: var(--fg-dim); margin-top: 2px; }
  #grid { display: ${COMPARE ? "flex" : "grid"}; ${COMPARE ? "flex-direction: column; gap: 14px;" : "grid-template-columns: repeat(6, max-content); gap: 14px;"} }
  .cmp-row { display: flex; gap: 12px; align-items: stretch; }
  .cmp-head { width: 92px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .cmp-species { font-size: 15px; font-weight: 700; }
  .cmp-salt { font-size: 10px; color: var(--fg-dim); }
  .cell { border-radius: 10px; overflow: hidden; border: 1px solid var(--border);
    background: var(--card); }
  .scene { position: relative; overflow: hidden; }
  .creature { position: absolute; left: 50%; bottom: 2px; transform: translateX(-50%); }
  .label { display: flex; flex-direction: column; gap: 1px; padding: 7px 10px 8px; }
  .label .lv { font-size: 10px; font-weight: 700; color: var(--fg-dim);
    text-transform: uppercase; letter-spacing: 0.05em; }
  .label .name { font-size: 12px; font-weight: 600; }
  .hero-label { padding: 12px 16px 14px; }
  .hero-label .lv { font-size: 13px; }
  .hero-label .name { font-size: 19px; }
  #hero-wrap { display: inline-block; padding: 24px; background: var(--bg); }
</style>
</head>
<body>
<div id="sheet">
  <header>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </header>
  <div id="grid"></div>
</div>
<div id="hero-wrap"><div id="hero"></div></div>
<script>
  window.__plugins = {};
  window.registerKandevPlugin = function (id, obj) { window.__plugins[id] = obj; };
</script>
<script>${bundleSrc}</script>
<script>${harnessScript}</script>
</body>
</html>`;

// --- Screenshot with the monorepo's Playwright chromium ---
const require2 = createRequire(path.join(WEB_DIR, "package.json"));
const { chromium } = require2("@playwright/test");

fs.mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = path.join(OUT_DIR, "..", "evolution-sheet.html");
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } });
  await page.goto("file://" + htmlPath);
  await page.waitForTimeout(300);

  if (COMPARE) {
    await page.locator("#sheet").screenshot({
      path: path.join(OUT_DIR, "lineages-comparison-v4.png"),
    });
  } else if (FIRST_MONTH) {
    await page.locator("#sheet").screenshot({
      path: path.join(OUT_DIR, "first-month-v4.png"),
    });
  } else if (HERO_LEVEL != null) {
    await page.locator("#hero-wrap").screenshot({
      path: path.join(OUT_DIR, `evolution-hero-lv${HERO_LEVEL}.png`),
    });
  } else {
    await page.locator("#sheet").screenshot({
      path: path.join(OUT_DIR, "evolution-sheet-v4-1-100.png"),
    });
    await page.locator("#hero-wrap").screenshot({
      path: path.join(OUT_DIR, "evolution-hero-lv100-v4.png"),
    });
  }
  console.log("wrote evolution renders to " + OUT_DIR);
} finally {
  await browser.close();
}
