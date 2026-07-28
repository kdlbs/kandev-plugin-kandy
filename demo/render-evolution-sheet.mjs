#!/usr/bin/env node
/**
 * Evolution-sheet poster generator. Pure rendering — no kandev instance.
 *
 * 1. Runs the real plugin binary's `genlevels` subcommand (same Go functions
 *    that serve the webhook) with a FIXED salt, so seeds/names are faithful.
 * 2. Builds a self-contained HTML harness that loads the real ui/bundle.js
 *    (window.registerKandevPlugin stub captures its exposed __render
 *    helpers) and renders every level's creature inside its tier scene via
 *    a tiny DOM hyperscript in place of host.jsx.
 * 3. Screenshots the sheet (light + dark) and a Lv-max hero cell with the
 *    Playwright chromium already installed under the kandev monorepo.
 *
 * Usage:  make build && node demo/render-evolution-sheet.mjs
 * Env:    KANDEV_WEB_DIR — apps/web dir of a kandev checkout (for playwright)
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

// `--hero-level <n>` renders only a hero cell for that level
// (evolution-hero-lv<n>.png) instead of the full 1..100 sheet.
const heroArg = process.argv.indexOf("--hero-level");
const HERO_LEVEL = heroArg >= 0 ? Number.parseInt(process.argv[heroArg + 1], 10) : null;

const LEVELS = [];
if (HERO_LEVEL != null) {
  if (!Number.isInteger(HERO_LEVEL) || HERO_LEVEL < 1) {
    console.error("--hero-level must be a positive integer");
    process.exit(1);
  }
  LEVELS.push(HERO_LEVEL);
} else {
  LEVELS.push(1, 2, 3, 4, 5);
  for (let l = 10; l <= 100; l += 5) LEVELS.push(l);
}

// --- 1. Faithful level facts from the real Go functions ---
const bin = path.join(REPO, "bin", "kandev-plugin-gotchi");
if (!fs.existsSync(bin)) {
  console.error(`missing ${bin} — run \`make build\` first`);
  process.exit(1);
}
const levelsJson = execFileSync(bin, [
  "genlevels",
  "-salt",
  String(SALT),
  "-levels",
  LEVELS.join(","),
]).toString();

// --- 2. Self-contained harness page ---
const bundleSrc = fs.readFileSync(path.join(REPO, "ui", "bundle.js"), "utf8");

const harnessScript = `
var LEVELS = ${levelsJson};
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
  var scene = R.sceneFor(info.tier, info.appearance_seed >>> 0);
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
    domH("span", { className: "lv" }, "Lv " + info.level),
    domH("span", { className: "name" }, info.stage_name),
  );
  return domH(
    "div",
    { className: "cell", style: { width: sceneW + "px" } },
    sceneDiv,
    label,
  );
}

var grid = document.getElementById("grid");
LEVELS.forEach(function (info) {
  grid.appendChild(makeCell(info, 176, 108, 84, false));
});
var last = LEVELS[LEVELS.length - 1];
document.getElementById("hero").appendChild(makeCell(last, 480, 250, 200, true));
document.title = "kandev gotchi evolution sheet";
`;

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
  #grid { display: grid; grid-template-columns: repeat(6, max-content); gap: 14px; }
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
    <h1>Kandev Gotchi — evolution, Lv 1 → 100</h1>
    <p>One lineage (salt ${SALT}), rendered by the shipped plugin code. It keeps going.</p>
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

// --- 3. Screenshot with the monorepo's Playwright chromium ---
const require2 = createRequire(path.join(WEB_DIR, "package.json"));
const { chromium } = require2("@playwright/test");

fs.mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = path.join(OUT_DIR, "..", "evolution-sheet.html");
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
  await page.goto("file://" + htmlPath);
  await page.waitForTimeout(300);

  const heroLevel = LEVELS[LEVELS.length - 1];
  if (HERO_LEVEL == null) {
    await page.locator("#sheet").screenshot({
      path: path.join(OUT_DIR, "evolution-sheet-1-100.png"),
    });
  }
  await page.locator("#hero-wrap").screenshot({
    path: path.join(OUT_DIR, `evolution-hero-lv${heroLevel}.png`),
  });

  if (HERO_LEVEL == null) {
    await page.evaluate(() => document.body.classList.add("dark"));
    await page.waitForTimeout(200);
    await page.locator("#sheet").screenshot({
      path: path.join(OUT_DIR, "evolution-sheet-1-100-dark.png"),
    });
  }
  console.log("wrote evolution renders to " + OUT_DIR);
} finally {
  await browser.close();
}
