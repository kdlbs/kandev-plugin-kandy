// Kandy — chat-top-bar plugin. A tiny creature that lives in the
// session top bar and evolves forever from work happening in this kandev
// instance. All growth logic is server-side; this bundle only renders what
// GET webhooks/kandy returns: { level, stage, archetype, family, biome,
// lineage_seed, appearance_seed, stage_name, progress_pct, flavor }.
//
// v0.3.0 — DNA vs growth:
//   WHO the creature is comes from its lineage (archetype silhouette,
//   palette family, biome, and lineage_seed style picks) and never changes.
//   Levels only make the SAME creature more grown and more awesome:
//   strictly additive parts (growthForLevel mirrors the backend's unlock
//   ladder), metamorphosis milestones at 2/8/18/30 that mature proportions,
//   colors that ramp from dull/desaturated to vivid, and a habitat that
//   matures within one biome (barren -> lively -> lush -> celestial).
//   Deterministic: no Math.random at render time; a level always renders
//   identically, and Lv N+1 is always "Lv N plus something new".
//
// v0.4.0 — interaction visuals: petting drops a treat the kandy catches
//   and munches (or sadly ignores while distrusting); bonking is a bucket
//   of cold water — pour, splash, and a brief soaked shiver.
//
// v0.5.0 — day/night + sleep: sceneFor/kandyCard take an explicit
//   timeOfDay hour float (default: a fixed mid-day, so offline tooling and
//   old callers render byte-identically); dawn/dusk/night arrive as
//   composable sky washes over the existing biome scenes, with the sun
//   swapped for a glowing moon + extra stars at night. Each kandy sleeps
//   on a lineage-seeded schedule (bedtime 21:30-23:30, wake 06:30-08:00):
//   eyes closed, a floating zzz bubble, idle bob stopped — the chip
//   portrait sleeps too. Pets while asleep get a half-woken grumpy squint
//   (one subdued heart); the water bucket is the rude awakening it already
//   looks like. Pure presentation: the server is untouched.

var PLUGIN_ID = "kandev-plugin-kandy";
var STYLE_ID = "kandev-kandy-style";
// Backstop poll. The live path is the WS bridge below — these actions mirror
// the bus events the backend awards XP for, so the creature updates as work
// happens instead of on the next poll (or a page reload).
var REFRESH_MS = 60000;
var WS_ACTIONS = [
  "session.turn.completed",
  "session.message.added",
  "session.state_changed",
];
// The plugin backend awards XP when its own event delivery lands, which races
// the WS notification to the browser. Debounce so a burst of events costs one
// refetch, and so the refetch happens after the award has settled.
var WS_DEBOUNCE_MS = 1500;

// The widget re-reads the local clock on this tick so dusk (and bedtime)
// arrive on their own, without needing a refetch or a page interaction.
var TIME_TICK_MS = 60000;

function localHour() {
  var d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

// Mounted widgets subscribe here; the WS handlers ping them.
var refreshListeners = [];
var refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer !== null) return;
  refreshTimer = setTimeout(function () {
    refreshTimer = null;
    refreshListeners.slice().forEach(function (fn) {
      fn();
    });
  }, WS_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — consumed in a fixed order per render.
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRand(seed, stream) {
  var next = mulberry32((seed ^ (stream * 0x9e3779b9)) >>> 0);
  return function (min, max) {
    return min + next() * (max - min);
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand(0, arr.length))];
}

function hsl(h, s, l) {
  return "hsl(" + (((h % 360) + 360) % 360) + ", " + s + "%, " + l + "%)";
}

var FAMILY_HUES = [130, 280, 45, 210, 5, 175, 320, 90, 250, 25, 190, 340];

// ---------------------------------------------------------------------------
// Day/night cycle + seeded sleep schedule (v0.5.0) — pure presentation.
// timeOfDay is an hour float 0-24 from the browser's local clock, threaded
// explicitly through sceneFor/kandyCard. Anywhere it isn't supplied it
// defaults to a fixed mid-day value, so offline tooling (the evolution
// posters, old harnesses) keeps producing today's exact renders.
// ---------------------------------------------------------------------------

var TIME_OF_DAY_DEFAULT = 13; // fixed mid-day: "day" phase, zero overlays

function dayPhaseFor(timeOfDay) {
  var t =
    typeof timeOfDay === "number" && isFinite(timeOfDay) ? timeOfDay : TIME_OF_DAY_DEFAULT;
  t = ((t % 24) + 24) % 24;
  if (t >= 6 && t < 8) return "dawn";
  if (t >= 8 && t < 18) return "day";
  if (t >= 18 && t < 20) return "dusk";
  return "night";
}

// Every kandy has its own bedtime and wake time seeded from the lineage —
// a DNA quirk fixed for the install's lifetime: bedtime lands in
// 21:30-23:30, wake in 06:30-08:00 (rand stream 21 is reserved for the
// sleep schedule).
function sleepScheduleFor(seed) {
  var r = makeRand(seed, 21);
  return { bedtime: 21.5 + r(0, 2), wake: 6.5 + r(0, 1.5) };
}

function isAsleep(seed, timeOfDay) {
  if (typeof timeOfDay !== "number" || !isFinite(timeOfDay)) return false;
  var s = sleepScheduleFor(seed);
  var t = ((timeOfDay % 24) + 24) % 24;
  return t >= s.bedtime || t < s.wake;
}

// currentDayPhase is set by sceneFor around building props so the shared
// sun helpers can swap themselves out at night without every biome knowing
// about the clock. Default "day" keeps every legacy call byte-identical.
var currentDayPhase = "day";

// ---------------------------------------------------------------------------
// Growth ladder — mirrors the backend's growthUnlocks/growthFlags exactly.
// Every level 2..40 adds or upgrades exactly one element.
// ---------------------------------------------------------------------------

function countUnlocked(levels, level) {
  var n = 0;
  for (var i = 0; i < levels.length; i++) if (level >= levels[i]) n++;
  return n;
}

function growthForLevel(level) {
  return {
    stage:
      level <= 1 ? 0 : level < 12 ? 1 : level < 30 ? 2 : level < 55 ? 3 : level < 80 ? 4 : 5,
    markings: countUnlocked([4, 9, 17, 23, 27, 34, 43, 53, 62, 72, 83, 93], level),
    sparkles: countUnlocked([40, 47, 52, 59, 67, 75, 81, 88, 95, 98], level),
    tail: countUnlocked([6, 20, 35, 57], level),
    horns: countUnlocked([8, 26, 42, 66], level),
    wings: countUnlocked([45, 54, 63, 86], level),
    aura: countUnlocked([60, 69, 77], level),
    companions: countUnlocked([28, 49, 74], level),
    crown: countUnlocked([25, 82], level),
    orbitStars: countUnlocked([64, 79, 90], level),
    mouth: level >= 3,
    blush: level >= 5,
    tufts: level >= 7,
    held: level >= 15,
    flag: level >= 22,
    glow: level >= 32,
    gem: level >= 38,
    halo: level >= 50,
    rays: level >= 70,
    starDiadem: level >= 85,
    lightPillars: level >= 91,
    constellation: level >= 97,
    burst: level >= 100,
  };
}

var STAGE_SCALE = [1, 0.55, 0.68, 0.8, 0.9, 1.0];

// temperFor — the care system's (v0.3.0) render conditioning. The band and
// scarred flags come from the server (never a raw score); sign selects the
// kind-vs-wary variant styling at metamorphosis stages. Render-time only:
// DNA, growth and unlock tables are untouched, and a redeemed kandy
// visibly softens because the sign is read at render time.
function temperFor(data) {
  var band = data.temperament_band || "neutral";
  var neg = band === "wary" || band === "fearful";
  return {
    band: band,
    sign: band === "beloved" || band === "content" ? 1 : neg ? -1 : 0,
    strong: band === "fearful",
    beloved: band === "beloved",
    scarred: !!data.scarred,
  };
}

var TEMPER_NEUTRAL = { band: "neutral", sign: 0, strong: false, beloved: false, scarred: false };

// lineageStyle — the per-install identity picks, fixed for a lifetime.
function lineageStyle(seed) {
  var r = makeRand(seed, 5);
  return {
    hueJitter: r(-8, 8),
    eyeStyle: pick(r, ["round", "wide", "sleepy"]),
    alienEyes: Math.floor(r(3, 5.99)),
    mouthStyle: pick(r, ["smile", "open", "fang", "wavy"]),
    hornStyle: pick(r, ["nubs", "curved", "antlers", "uni", "antenna"]),
    tailStyle: pick(r, ["curl", "spike", "fluff"]),
    markingStyle: pick(r, ["spots", "stripes", "patches"]),
    heldKind: pick(r, ["tool", "balloon"]),
  };
}

// Colors ramp dull -> vivid with level; the hue (family) never changes.
// A wary/fearful temperament desaturates the accent tints slightly.
function lineageColors(family, level, sty, temper) {
  var hue = FAMILY_HUES[((family % 12) + 12) % 12] + sty.hueJitter;
  var sat = Math.min(24 + level * 1.15, 74);
  var light = 70 - Math.min(level, 50) * 0.25;
  var accSat = Math.min(sat + 10, 84);
  if (temper && temper.sign < 0) accSat = Math.max(accSat - (temper.strong ? 30 : 15), 10);
  return {
    hue: hue,
    body: hsl(hue, sat, light * 0.86),
    dark: hsl(hue, Math.max(sat - 10, 12), 34),
    light: hsl(hue, sat, Math.min(light + 14, 86)),
    accent: hsl(hue + 150, accSat, 62),
  };
}

// ---------------------------------------------------------------------------
// Egg (level 1) — deliberately plain: a nothing-special beige egg.
// ---------------------------------------------------------------------------

function eggSvg(h, rand) {
  var spots = [];
  for (var i = 0; i < 2; i++) {
    spots.push(
      h("circle", {
        key: "spot" + i,
        cx: rand(40, 60),
        cy: rand(50, 70),
        r: rand(2, 3.5),
        fill: "#cfc8b8",
        opacity: 0.8,
      }),
    );
  }
  return [
    h("ellipse", {
      key: "shell",
      cx: 50,
      cy: 62,
      rx: 17,
      ry: 22,
      fill: "#e8e2d2",
      stroke: "#c9c0aa",
      strokeWidth: 1.8,
    }),
  ].concat(spots);
}

// ---------------------------------------------------------------------------
// Body archetypes — ONE per lineage, drawn from lineage-stable geometry so
// only maturity (scale/detail), never identity, changes between levels.
// Each returns { parts, head, top, mark, grounded } in viewBox 0 0 100 100.
// ---------------------------------------------------------------------------

function feetNubs(h, C, cx, dx, y) {
  return [
    h("ellipse", { key: "footL", cx: cx - dx, cy: y, rx: 5, ry: 3, fill: C.dark }),
    h("ellipse", { key: "footR", cx: cx + dx, cy: y, rx: 5, ry: 3, fill: C.dark }),
  ];
}

function bodyBlob(h, rand, C, g) {
  var rx = 21 + rand(0, 5);
  var ry = rx * (0.85 + rand(0, 0.25));
  var cy = 86 - ry;
  var parts = [
    h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 }),
  ];
  if (g.stage >= 2) {
    parts.push(h("ellipse", { key: "belly", cx: 50, cy: cy + ry * 0.35, rx: rx * 0.55, ry: ry * 0.4, fill: C.light, opacity: 0.9 }));
    parts.push(feetNubs(h, C, 50, rx * 0.5, 87));
  }
  return {
    parts: parts,
    head: { cx: 50, cy: cy - ry * 0.2, r: rx * 0.8 },
    top: { x: 50, y: cy - ry },
    mark: { cx: 50, cy: cy + ry * 0.25, rx: rx * 0.7, ry: ry * 0.5 },
    grounded: true,
  };
}

function bodyLanky(h, rand, C, g) {
  var w = 22 + rand(0, 6);
  var top = 28 + rand(0, 6);
  var parts = [];
  if (g.stage >= 2) {
    parts.push(
      h("line", { key: "legL", x1: 44, y1: 80, x2: 41, y2: 88, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
      h("line", { key: "legR", x1: 56, y1: 80, x2: 59, y2: 88, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
    );
  }
  parts.push(h("rect", { key: "body", x: 50 - w / 2, y: top, width: w, height: 82 - top, rx: w / 2, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 }));
  if (g.stage >= 2) {
    parts.push(h("ellipse", { key: "belly", cx: 50, cy: 68, rx: w * 0.3, ry: 8, fill: C.light, opacity: 0.9 }));
    parts.push(
      h("line", { key: "armL", x1: 50 - w / 2, y1: 58, x2: 50 - w / 2 - 9, y2: 66, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
      h("line", { key: "armR", x1: 50 + w / 2, y1: 58, x2: 50 + w / 2 + 9, y2: 66, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
    );
  }
  return {
    parts: parts,
    head: { cx: 50, cy: top + 13, r: w * 0.55 },
    top: { x: 50, y: top },
    mark: { cx: 50, cy: 62, rx: w * 0.38, ry: 12 },
    grounded: true,
  };
}

function bodySquat(h, rand, C, g) {
  var rx = 29 + rand(0, 5);
  var ry = 14 + rand(0, 4);
  var cy = 87 - ry;
  var parts = [
    h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 }),
  ];
  if (g.stage >= 2) {
    parts.push(h("ellipse", { key: "belly", cx: 50, cy: cy + ry * 0.4, rx: rx * 0.6, ry: ry * 0.35, fill: C.light, opacity: 0.9 }));
    parts.push(feetNubs(h, C, 50, rx * 0.6, 88));
  }
  return {
    parts: parts,
    head: { cx: 50, cy: cy - ry * 0.15, r: ry * 1.1 },
    top: { x: 50, y: cy - ry },
    mark: { cx: 50, cy: cy + ry * 0.2, rx: rx * 0.7, ry: ry * 0.55 },
    grounded: true,
  };
}

function bodySerpent(h, rand, C, g) {
  var headCx = 60 + rand(0, 6);
  var headCy = 38 + rand(0, 6);
  var coil =
    "M22 86 Q34 " + (78 + rand(-4, 4)) + " 46 82 Q64 86 66 70 Q68 56 " + headCx + " " + (headCy + 10);
  var parts = [
    h("path", { key: "coilD", d: coil, stroke: C.dark, strokeWidth: g.stage >= 3 ? 15 : 13, strokeLinecap: "round", fill: "none" }),
    h("path", { key: "coil", d: coil, stroke: C.body, strokeWidth: g.stage >= 3 ? 11 : 9.5, strokeLinecap: "round", fill: "none" }),
    h("circle", { key: "headD", cx: headCx, cy: headCy, r: 12.6, fill: C.dark }),
    h("circle", { key: "head", cx: headCx, cy: headCy, r: 11, fill: C.body }),
  ];
  if (g.stage >= 2) {
    parts.push(
      h("path", { key: "tailTip", d: "M22 86 L14 " + (80 + rand(0, 6)) + " L24 78 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1.5 }),
    );
  }
  return {
    parts: parts,
    head: { cx: headCx, cy: headCy, r: 11 },
    top: { x: headCx, y: headCy - 11 },
    mark: { cx: 50, cy: 76, rx: 20, ry: 8 },
    grounded: false,
  };
}

function bodyMushroom(h, rand, C, g) {
  var capW = 30 + rand(0, 6);
  var capY = 52 + rand(0, 4);
  var parts = [
    h("rect", { key: "stem", x: 41, y: capY, width: 18, height: 88 - capY, rx: 8, fill: C.light, stroke: C.dark, strokeWidth: 2 }),
    h("path", {
      key: "cap",
      d: "M" + (50 - capW) + " " + capY + " Q50 " + (capY - 34) + " " + (50 + capW) + " " + capY + " Z",
      fill: C.body,
      stroke: C.dark,
      strokeWidth: g.stage >= 3 ? 2.6 : 2,
    }),
  ];
  return {
    parts: parts,
    head: { cx: 50, cy: capY + 14, r: 9 },
    top: { x: 50, y: capY - 26 },
    mark: { cx: 50, cy: capY - 13, rx: capW * 0.62, ry: 9 },
    grounded: true,
  };
}

function bodyGhost(h, rand, C, g) {
  var top = 34 + rand(0, 5);
  var parts = [
    h("path", {
      key: "body",
      d:
        "M30 82 C30 " + top + " 70 " + top + " 70 82 " +
        "Q65 76 60 82 Q55 88 50 82 Q45 76 40 82 Q35 88 30 82 Z",
      fill: C.body,
      stroke: C.dark,
      strokeWidth: g.stage >= 3 ? 2.4 : 1.9,
      opacity: 0.95,
    }),
  ];
  if (g.stage >= 2) {
    parts.push(
      h("circle", { key: "drift1", cx: 26 + rand(0, 4), cy: 60 + rand(0, 10), r: 2, fill: C.light, opacity: 0.8 }),
      h("circle", { key: "drift2", cx: 74 - rand(0, 4), cy: 52 + rand(0, 10), r: 1.6, fill: C.light, opacity: 0.8 }),
    );
  }
  return {
    parts: parts,
    head: { cx: 50, cy: top + 16, r: 13 },
    top: { x: 50, y: top + 1 },
    mark: { cx: 50, cy: 66, rx: 15, ry: 10 },
    grounded: false,
  };
}

function bodyCrystal(h, rand, C, g) {
  var cx = 50;
  var cy = 62;
  var pts = [];
  var n = 7;
  var topPt = null;
  for (var i = 0; i < n; i++) {
    var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n + rand(-0.12, 0.12);
    var rr = 24 + rand(0, 7);
    var px = cx + Math.cos(ang) * rr;
    var py = cy + Math.sin(ang) * rr * 0.95;
    if (i === 0) topPt = { x: px, y: py };
    pts.push(px.toFixed(1) + "," + py.toFixed(1));
  }
  var parts = [h("polygon", { key: "gem", points: pts.join(" "), fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 })];
  if (g.stage >= 2) {
    parts.push(
      h("path", { key: "facet1", d: "M" + cx + " " + cy + " L" + pts[1].replace(",", " "), stroke: C.light, strokeWidth: 1.4, opacity: 0.7 }),
      h("path", { key: "facet2", d: "M" + cx + " " + cy + " L" + pts[4].replace(",", " "), stroke: C.light, strokeWidth: 1.4, opacity: 0.7 }),
    );
  }
  if (g.stage >= 3) {
    parts.push(h("circle", { key: "glint", cx: cx - 9, cy: cy - 12, r: 2, fill: "#ffffff", opacity: 0.9 }));
  }
  return {
    parts: parts,
    head: { cx: cx, cy: cy - 4, r: 12 },
    top: { x: topPt.x, y: topPt.y },
    mark: { cx: cx, cy: cy + 10, rx: 14, ry: 8 },
    grounded: true,
  };
}

function bodyMech(h, rand, C, g) {
  var w = 30 + rand(0, 6);
  var top = 42 + rand(0, 4);
  var parts = [];
  if (g.stage >= 2) {
    parts.push(
      h("rect", { key: "treadL", x: 50 - w / 2 - 3, y: 80, width: 12, height: 8, rx: 4, fill: C.dark }),
      h("rect", { key: "treadR", x: 50 + w / 2 - 9, y: 80, width: 12, height: 8, rx: 4, fill: C.dark }),
    );
  }
  parts.push(h("rect", { key: "body", x: 50 - w / 2, y: top, width: w, height: 82 - top, rx: 5, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 }));
  if (g.stage >= 2) {
    parts.push(h("rect", { key: "panel", x: 50 - w * 0.28, y: 66, width: w * 0.56, height: 10, rx: 2, fill: C.light, opacity: 0.9 }));
    parts.push(
      h("rect", { key: "armL", x: 50 - w / 2 - 7, y: top + 10, width: 6, height: 16, rx: 3, fill: C.dark }),
      h("rect", { key: "armR", x: 50 + w / 2 + 1, y: top + 10, width: 6, height: 16, rx: 3, fill: C.dark }),
    );
  }
  if (g.stage >= 3) {
    for (var i = 0; i < 4; i++) {
      parts.push(
        h("circle", {
          key: "rivet" + i,
          cx: 50 - w / 2 + 4 + (i % 2) * (w - 8),
          cy: top + 4 + Math.floor(i / 2) * (78 - top - 8),
          r: 1.4,
          fill: C.dark,
        }),
      );
    }
  }
  return {
    parts: parts,
    head: { cx: 50, cy: top + 13, r: w * 0.42 },
    top: { x: 50, y: top },
    mark: { cx: 50, cy: 60, rx: w * 0.4, ry: 8 },
    grounded: true,
  };
}

function bodyAlien(h, rand, C, g) {
  var rx = 19 + rand(0, 4);
  var ry = 24 + rand(0, 4);
  var cy = 60;
  var parts = [];
  if (g.stage >= 2) {
    for (var i = 0; i < 3; i++) {
      var tx = 50 - rx * 0.6 + i * rx * 0.6;
      parts.push(
        h("path", {
          key: "tent" + i,
          d: "M" + tx + " " + (cy + ry - 4) + " Q" + (tx + rand(-5, 5)) + " " + (cy + ry + 8) + " " + (tx + rand(-3, 3)) + " 88",
          stroke: C.dark,
          strokeWidth: 3.4,
          strokeLinecap: "round",
          fill: "none",
        }),
      );
    }
  }
  parts.push(h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.6 : 2 }));
  if (g.stage >= 3) {
    parts.push(h("ellipse", { key: "sheen", cx: 44, cy: cy - 10, rx: 5, ry: 8, fill: C.light, opacity: 0.6 }));
  }
  return {
    parts: parts,
    head: { cx: 50, cy: cy - ry * 0.25, r: rx * 0.85, alien: true },
    top: { x: 50, y: cy - ry },
    mark: { cx: 50, cy: cy + ry * 0.45, rx: rx * 0.65, ry: ry * 0.3 },
    grounded: false,
  };
}

function bodySprite(h, rand, C, g) {
  var cy = 50 + rand(0, 4);
  var parts = [
    h("ellipse", { key: "body", cx: 50, cy: cy, rx: 12, ry: 14, fill: C.body, stroke: C.dark, strokeWidth: g.stage >= 3 ? 2.4 : 1.9 }),
  ];
  if (g.stage >= 2) {
    parts.push(
      h("circle", { key: "dangleL", cx: 46, cy: cy + 17, r: 1.8, fill: C.dark }),
      h("circle", { key: "dangleR", cx: 54, cy: cy + 17, r: 1.8, fill: C.dark }),
    );
  }
  return {
    parts: parts,
    head: { cx: 50, cy: cy - 3, r: 10 },
    top: { x: 50, y: cy - 14 },
    mark: { cx: 50, cy: cy + 6, rx: 8, ry: 6 },
    grounded: false,
  };
}

var BODY_BUILDERS = [
  bodyBlob, // 0 Blip
  bodyLanky, // 1 Willow
  bodySquat, // 2 Chonk
  bodySerpent, // 3 Noodle
  bodyMushroom, // 4 Sporeling
  bodyGhost, // 5 Wisp
  bodyCrystal, // 6 Shardling
  bodyMech, // 7 Cogling
  bodyAlien, // 8 Gazer
  bodySprite, // 9 Flitter
];

// ---------------------------------------------------------------------------
// Additive parts — style fixed by the lineage, presence/size by growth.
// Placement seeds are lineage-stable per element index, so marking #1 stays
// put when marking #2 appears.
// ---------------------------------------------------------------------------

function eyeAt(h, rand, cx, cy, r, style, key, temper) {
  var out = [];
  if (style !== "dot") {
    out.push(h("circle", { key: key + "w", cx: cx, cy: cy, r: r, fill: "#ffffff" }));
  }
  out.push(
    h("circle", {
      key: key + "p",
      cx: cx + rand(-0.6, 0.6),
      cy: cy,
      r: style === "dot" ? r * 0.55 : r * 0.45,
      fill: "#26232e",
      className: "kandev-kandy-blink",
      style: { transformBox: "fill-box", transformOrigin: "center" },
    }),
  );
  if (temper && temper.beloved) {
    // Beloved: brighter eye highlights — a little extra sparkle.
    out.push(
      h("circle", {
        key: key + "gl",
        cx: cx - r * 0.22,
        cy: cy - r * 0.26,
        r: Math.max(r * 0.22, 0.7),
        fill: "#ffffff",
        opacity: 0.95,
      }),
    );
  }
  if (temper && temper.sign < 0 && style !== "sleepy") {
    // Wary/fearful: guarded, flattened eyes — a straight upper lid.
    var lidY = cy - r * (temper.strong ? 0.15 : 0.4);
    out.push(
      h("line", {
        key: key + "guard",
        x1: cx - r,
        y1: lidY,
        x2: cx + r,
        y2: lidY,
        stroke: "#26232e",
        strokeWidth: 1.4,
      }),
    );
  }
  if (style === "sleepy") {
    out.push(
      h("path", {
        key: key + "lid",
        d: "M" + (cx - r) + " " + (cy - r * 0.4) + " Q" + cx + " " + (cy - r * 1.1) + " " + (cx + r) + " " + (cy - r * 0.4),
        stroke: "#26232e",
        strokeWidth: 1.6,
        fill: "none",
      }),
    );
  }
  return out;
}

// sleepFaceParts — the asleep face: eyes as soft closed lids (no whites,
// no pupils — so there is no blink animation to suppress), a tiny relaxed
// mouth, the usual blush. Replaces the whole awake face while sleeping.
function sleepFaceParts(h, C, head, g, sty) {
  var out = [];
  var eyeR = (sty.eyeStyle === "wide" ? 4.8 : 3.9) * Math.min(head.r / 10, 1.4);
  function closedLid(cx, key) {
    return h("path", {
      key: key,
      d:
        "M" + (cx - eyeR) + " " + head.cy + " Q" + cx + " " + (head.cy + eyeR * 0.9) + " " + (cx + eyeR) + " " + head.cy,
      stroke: "#26232e",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      fill: "none",
    });
  }
  var count = head.alien && g.stage >= 2 ? sty.alienEyes : 2;
  if (count === 2) {
    var dx = head.r * 0.5;
    out.push(closedLid(head.cx - dx, "slpL"), closedLid(head.cx + dx, "slpR"));
  } else {
    for (var i = 0; i < count; i++) {
      var t = i / (count - 1) - 0.5;
      out.push(closedLid(head.cx + t * head.r * 1.3, "slp" + i));
    }
  }
  if (g.mouth) {
    out.push(
      h("ellipse", {
        key: "mouth",
        cx: head.cx,
        cy: head.cy + head.r * 0.55,
        rx: 1.7,
        ry: 1.1,
        fill: C.dark,
        opacity: 0.85,
      }),
    );
  }
  if (g.blush) {
    out.push(
      h("circle", { key: "blushL", cx: head.cx - head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
      h("circle", { key: "blushR", cx: head.cx + head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
    );
  }
  return out;
}

function faceParts(h, lineage, C, head, g, sty, mood, temper, sleep) {
  if (sleep === "asleep") return sleepFaceParts(h, C, head, g, sty);
  var rand = makeRand(lineage, 30);
  var out = [];
  // Mood + temperament overlays are render-time only: they restyle the
  // face, they never touch DNA or growth. bored = half-lowered lids;
  // sad/gloomy = lids + frown + a single teardrop; wary/fearful =
  // guarded eyes + default frown + drooped tufts; beloved = rosier
  // cheeks + brighter highlights.
  temper = temper || TEMPER_NEUTRAL;
  var droopy = mood === "sad" || mood === "gloomy";
  var style = g.stage <= 1 ? "dot" : sty.eyeStyle;
  if (mood === "bored" || droopy) style = "sleepy";
  var eyeR =
    (style === "wide" ? 4.8 : 3.9) *
    Math.min(head.r / 10, 1.4) *
    (mood === "bored" || droopy ? 0.85 : 1) *
    (temper.sign < 0 ? (temper.strong ? 0.8 : 0.9) : 1);
  var count = head.alien && g.stage >= 2 ? sty.alienEyes : 2;
  var eyeSpots = [];
  if (count === 2) {
    var dx = head.r * 0.5;
    eyeSpots.push({ cx: head.cx - dx, cy: head.cy, r: eyeR, key: "eyeL" });
    eyeSpots.push({ cx: head.cx + dx, cy: head.cy, r: eyeR, key: "eyeR" });
    out = out.concat(eyeAt(h, rand, eyeSpots[0].cx, head.cy, eyeR, style, "eyeL", temper));
    out = out.concat(eyeAt(h, rand, eyeSpots[1].cx, head.cy, eyeR, style, "eyeR", temper));
  } else {
    for (var i = 0; i < count; i++) {
      var t = i / (count - 1) - 0.5;
      var spot = {
        cx: head.cx + t * head.r * 1.3,
        cy: head.cy - Math.abs(t) * 3 - (i % 2) * 2,
        r: eyeR * (0.7 + rand(0, 0.4)),
        key: "eye" + i,
      };
      eyeSpots.push(spot);
      out = out.concat(eyeAt(h, rand, spot.cx, spot.cy, spot.r, style, spot.key, temper));
    }
  }

  if (sleep === "grumpy") {
    // Half-woken grumpy squint: a heavy body-colored upper lid sags over
    // each eye, its dark edge drooping across most of the pupil.
    eyeSpots.forEach(function (sp) {
      out.push(
        h("path", {
          key: sp.key + "gdome",
          d:
            "M" + (sp.cx - sp.r) + " " + (sp.cy + sp.r * 0.05) + " Q" + sp.cx + " " + (sp.cy - sp.r * 1.4) + " " + (sp.cx + sp.r) + " " + (sp.cy + sp.r * 0.05) + " Z",
          fill: C.body,
        }),
        h("path", {
          key: sp.key + "gedge",
          d:
            "M" + (sp.cx - sp.r) + " " + (sp.cy + sp.r * 0.05) + " Q" + sp.cx + " " + (sp.cy + sp.r * 0.4) + " " + (sp.cx + sp.r) + " " + (sp.cy + sp.r * 0.05),
          stroke: "#26232e",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          fill: "none",
        }),
      );
    });
  }

  if (droopy) {
    out.push(
      h("ellipse", {
        key: "tear",
        cx: head.cx - head.r * 0.5 - 1,
        cy: head.cy + eyeR + 4,
        rx: 1.3,
        ry: 2,
        fill: "#7fd7ff",
        opacity: 0.9,
      }),
    );
  }

  if (g.mouth) {
    var mouthY = head.cy + head.r * 0.55;
    var mw = head.r * 0.55;
    // Wary/fearful default to a slight frown even in an okay mood; so does
    // a kandy grumpily half-woken from its sleep.
    var mouth = droopy || temper.sign < 0 || sleep === "grumpy" ? "frown" : sty.mouthStyle;
    if (mouth === "frown") {
      out.push(
        h("path", {
          key: "mouth",
          d: "M" + (head.cx - mw) + " " + (mouthY + 2) + " Q" + head.cx + " " + (mouthY - 3.5) + " " + (head.cx + mw) + " " + (mouthY + 2),
          stroke: C.dark,
          strokeWidth: 2,
          strokeLinecap: "round",
          fill: "none",
        }),
      );
    } else if (mouth === "smile") {
      out.push(h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + mouthY + " Q" + head.cx + " " + (mouthY + 5) + " " + (head.cx + mw) + " " + mouthY, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }));
    } else if (mouth === "open") {
      out.push(h("ellipse", { key: "mouth", cx: head.cx, cy: mouthY + 1, rx: mw * 0.6, ry: 3, fill: C.dark }));
    } else if (mouth === "fang") {
      out.push(
        h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + mouthY + " Q" + head.cx + " " + (mouthY + 5) + " " + (head.cx + mw) + " " + mouthY, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
        h("path", { key: "fang", d: "M" + (head.cx + mw * 0.4) + " " + (mouthY + 1.5) + " l2.4 4 l2.4 -4.6 Z", fill: "#ffffff", stroke: C.dark, strokeWidth: 0.6 }),
      );
    } else {
      out.push(h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + (mouthY + 1) + " q" + mw / 3 + " 3 " + (mw * 2) / 3 + " 0 q" + mw / 3 + " -3 " + (mw * 2) / 3 + " 0", stroke: C.dark, strokeWidth: 1.8, strokeLinecap: "round", fill: "none" }));
    }
  }
  if (g.blush || temper.beloved) {
    // Beloved kandys get rosier, bigger cheeks — even before the blush
    // growth unlock.
    var blushR = temper.beloved ? 3.1 : 2.4;
    var blushO = temper.beloved ? 0.72 : 0.5;
    var blushFill = temper.beloved ? "#ff7f9c" : "#ff8fa3";
    out.push(
      h("circle", { key: "blushL", cx: head.cx - head.r * 0.85, cy: head.cy + head.r * 0.35, r: blushR, fill: blushFill, opacity: blushO }),
      h("circle", { key: "blushR", cx: head.cx + head.r * 0.85, cy: head.cy + head.r * 0.35, r: blushR, fill: blushFill, opacity: blushO }),
    );
  }
  if (g.tufts) {
    // Droopy ears when sad/gloomy — or when the kandy is wary/fearful.
    var tuftDown = droopy || temper.sign < 0;
    var tuftDy = tuftDown ? 3 : -3;
    out.push(
      h("path", { key: "tuftL", d: "M" + (head.cx - head.r) + " " + (head.cy - head.r * 0.6) + " l-4 " + tuftDy + " l1.5 " + (tuftDown ? -4.5 : 4.5) + " Z", fill: C.light, stroke: C.dark, strokeWidth: 0.8 }),
      h("path", { key: "tuftR", d: "M" + (head.cx + head.r) + " " + (head.cy - head.r * 0.6) + " l4 " + tuftDy + " l-1.5 " + (tuftDown ? -4.5 : 4.5) + " Z", fill: C.light, stroke: C.dark, strokeWidth: 0.8 }),
    );
  }
  return out;
}

function markingParts(h, lineage, C, region, g, sty) {
  var out = [];
  for (var i = 0; i < g.markings; i++) {
    var r = makeRand(lineage, 40 + i);
    var mx = region.cx + r(-region.rx, region.rx) * 0.8;
    var my = region.cy + r(-region.ry, region.ry) * 0.8;
    if (sty.markingStyle === "spots") {
      out.push(h("circle", { key: "mark" + i, cx: mx, cy: my, r: r(1.8, 3.2), fill: C.dark, opacity: 0.5 }));
    } else if (sty.markingStyle === "stripes") {
      out.push(
        h("path", {
          key: "mark" + i,
          d: "M" + (mx - 4) + " " + my + " Q" + mx + " " + (my + r(-3, 3)) + " " + (mx + 4) + " " + my,
          stroke: C.dark,
          strokeWidth: 1.8,
          strokeLinecap: "round",
          fill: "none",
          opacity: 0.55,
        }),
      );
    } else {
      out.push(h("ellipse", { key: "mark" + i, cx: mx, cy: my, rx: r(2.5, 4.5), ry: r(1.8, 3), fill: C.light, opacity: 0.8 }));
    }
  }
  return out;
}

function hornParts(h, lineage, C, top, g, sty, mood, temper) {
  if (g.horns <= 0) return [];
  temper = temper || TEMPER_NEUTRAL;
  var rand = makeRand(lineage, 32);
  // Horns grow at each unlock; a beloved kandy carries them perkier.
  var s = (0.7 + g.horns * 0.3) * (temper.beloved ? 1.18 : 1);
  var droopy = mood === "sad" || mood === "gloomy" || temper.sign < 0;
  var out = [];
  var x = top.x;
  var y = top.y;
  if (sty.hornStyle === "antenna" && droopy) {
    // The antenna wilts when the kandy is sad.
    var wiltX = x + 7;
    out.push(
      h("path", { key: "antline", d: "M" + x + " " + (y + 1) + " Q" + (x + 3) + " " + (y - 8 * s) + " " + wiltX + " " + (y - 3), stroke: C.dark, strokeWidth: 2, fill: "none" }),
      h("circle", { key: "antball", cx: wiltX + 1, cy: y - 1.5, r: 2 + s * 0.8, fill: C.accent }),
    );
    return out;
  }
  if (sty.hornStyle === "nubs") {
    out.push(
      h("circle", { key: "nubL", cx: x - 7, cy: y - 2 * s, r: 2 + s, fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
      h("circle", { key: "nubR", cx: x + 7, cy: y - 2 * s, r: 2 + s, fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
    );
  } else if (sty.hornStyle === "curved") {
    out.push(
      h("path", { key: "hornL", d: "M" + (x - 8) + " " + (y + 2) + " Q" + (x - 8 - 7 * s) + " " + (y - 10 * s) + " " + (x - 9) + " " + (y - 13 * s), stroke: C.dark, strokeWidth: 3.4, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "hornR", d: "M" + (x + 8) + " " + (y + 2) + " Q" + (x + 8 + 7 * s) + " " + (y - 10 * s) + " " + (x + 9) + " " + (y - 13 * s), stroke: C.dark, strokeWidth: 3.4, strokeLinecap: "round", fill: "none" }),
    );
  } else if (sty.hornStyle === "antlers") {
    out.push(
      h("path", { key: "antL", d: "M" + (x - 7) + " " + (y + 1) + " l-3 " + -9 * s + " m3 " + 4 * s + " l-6 " + -3 * s + " m3 -1 l-1 " + -6 * s, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "antR", d: "M" + (x + 7) + " " + (y + 1) + " l3 " + -9 * s + " m-3 " + 4 * s + " l6 " + -3 * s + " m-3 -1 l1 " + -6 * s, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
    );
  } else if (sty.hornStyle === "uni") {
    out.push(h("path", { key: "uni", d: "M" + (x - 3) + " " + (y + 1) + " L" + x + " " + (y - 11 * s) + " L" + (x + 3) + " " + (y + 1) + " Z", fill: C.accent, stroke: C.dark, strokeWidth: 1.2 }));
  } else {
    var tip = x + rand(-4, 4);
    out.push(
      h("line", { key: "antline", x1: x, y1: y + 1, x2: tip, y2: y - 11 * s, stroke: C.dark, strokeWidth: 2 }),
      h("circle", { key: "antball", cx: tip, cy: y - 12 * s, r: 2 + s * 0.8, fill: C.accent }),
    );
  }
  return out;
}

function tailPartsFor(h, C, g, sty, temper) {
  if (g.tail <= 0) return [];
  // Tail grows at each unlock; beloved kandys hold it perkier.
  var s = (0.6 + g.tail * 0.35) * (temper && temper.beloved ? 1.15 : 1);
  if (sty.tailStyle === "curl") {
    return [
      h("path", {
        key: "tail",
        d: "M74 78 Q" + (74 + 12 * s) + " " + (78 - 6 * s) + " " + (74 + 10 * s) + " " + (78 - 16 * s) + " Q" + (74 + 8 * s) + " " + (78 - 23 * s) + " " + (74 + 2 * s) + " " + (78 - 20 * s),
        stroke: C.dark,
        strokeWidth: 3.4,
        strokeLinecap: "round",
        fill: "none",
      }),
    ];
  }
  if (sty.tailStyle === "spike") {
    return [h("path", { key: "tail", d: "M73 78 L" + (73 + 15 * s) + " " + (78 - 8 * s) + " L78 82 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1.4 })];
  }
  return [
    h("circle", { key: "tail1", cx: 79, cy: 74, r: 3.4 + 1.6 * s, fill: C.light, stroke: C.dark, strokeWidth: 1.2 }),
    h("circle", { key: "tail2", cx: 79 + 6 * s, cy: 74 - 4 * s, r: 2.2 + 1.2 * s, fill: C.light, stroke: C.dark, strokeWidth: 1 }),
  ];
}

// temperVariant — the metamorphosis conditioning: at maturity stages
// (levels 12/30/55/80) the stage-styled details pick a "kind" (softer,
// rounder) or "wary" (sharper, scruffier) variant from the CURRENT
// temperament sign at render time. Redemption visibly softens the
// creature; neglect roughens it. Sits above the body, under markings/face.
function temperVariant(h, lineage, C, body, g, temper) {
  if (g.stage < 2 || temper.sign === 0) return [];
  var out = [];
  if (temper.sign < 0) {
    // Wary variant: scruffy spikes along the crown.
    var rs = makeRand(lineage, 78);
    var n = temper.strong ? 4 : 3;
    for (var i = 0; i < n; i++) {
      var px = body.top.x - 8 + (i * 16) / (n - 1) + rs(-1.5, 1.5);
      var py = body.top.y + 2 + rs(0, 1.5);
      out.push(
        h("path", {
          key: "scruff" + i,
          d: "M" + (px - 2.2) + " " + py + " L" + px + " " + (py - 4.6 - rs(0, 2)) + " L" + (px + 2.2) + " " + py + " Z",
          fill: C.dark,
          opacity: 0.8,
        }),
      );
    }
  } else {
    // Kind variant: a soft, rounder warm sheen around the head.
    out.push(
      h("ellipse", {
        key: "kindsheen",
        cx: body.head.cx,
        cy: body.head.cy - body.head.r * 0.3,
        rx: body.head.r * 1.5,
        ry: body.head.r * 1.1,
        fill: C.light,
        opacity: 0.16,
      }),
      h("ellipse", {
        key: "kindsheen2",
        cx: body.head.cx - body.head.r * 0.4,
        cy: body.head.cy - body.head.r * 0.6,
        rx: body.head.r * 0.5,
        ry: body.head.r * 0.28,
        fill: "#ffffff",
        opacity: 0.28,
      }),
    );
  }
  return out;
}

// temperScar — one small permanent mark, placed deterministically from the
// lineage seed, shown forever regardless of the current band.
function temperScar(h, lineage, C, body, temper) {
  if (!temper.scarred) return [];
  var r = makeRand(lineage, 77);
  var sx = body.mark.cx + r(-0.5, 0.5) * body.mark.rx;
  var sy = body.mark.cy + r(-0.5, 0.5) * body.mark.ry;
  var rot = (r(-0.5, 0.5) * 44).toFixed(1);
  return [
    h(
      "g",
      { key: "scar", transform: "rotate(" + rot + " " + sx + " " + sy + ")", opacity: 0.85 },
      h("line", { key: "scarline", x1: sx - 3.4, y1: sy, x2: sx + 3.4, y2: sy, stroke: C.dark, strokeWidth: 1.3, strokeLinecap: "round" }),
      h("line", { key: "scart1", x1: sx - 1.8, y1: sy - 1.6, x2: sx - 1.8, y2: sy + 1.6, stroke: C.dark, strokeWidth: 1 }),
      h("line", { key: "scart2", x1: sx, y1: sy - 1.6, x2: sx, y2: sy + 1.6, stroke: C.dark, strokeWidth: 1 }),
      h("line", { key: "scart3", x1: sx + 1.8, y1: sy - 1.6, x2: sx + 1.8, y2: sy + 1.6, stroke: C.dark, strokeWidth: 1 }),
    ),
  ];
}

function wingParts(h, C, top, g) {
  if (g.wings <= 0) return [];
  var s = 0.6 + g.wings * 0.4; // wings grow
  var y = top.y + 16;
  return [
    h("ellipse", { key: "wingL", cx: 30, cy: y, rx: 12 * s, ry: 5 * s, fill: C.accent, opacity: 0.75, transform: "rotate(-32 30 " + y + ")" }),
    h("ellipse", { key: "wingR", cx: 70, cy: y, rx: 12 * s, ry: 5 * s, fill: C.accent, opacity: 0.75, transform: "rotate(32 70 " + y + ")" }),
  ];
}

function prestigeInBody(h, C, top, g) {
  var out = [];
  if (g.gem) {
    out.push(h("path", { key: "chestgem", d: "M50 68 l3.2 4 L50 76 l-3.2 -4 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1 }));
  }
  if (g.crown >= 1) {
    var cs = g.crown >= 2 ? 1.45 : 1;
    var y = top.y - 4;
    out.push(
      h("path", {
        key: "crown",
        d:
          "M" + (top.x - 7 * cs) + " " + y + " L" + (top.x - 7 * cs) + " " + (y - 5 * cs) +
          " L" + (top.x - 2.5 * cs) + " " + (y - 1.5 * cs) + " L" + top.x + " " + (y - 7 * cs) +
          " L" + (top.x + 2.5 * cs) + " " + (y - 1.5 * cs) + " L" + (top.x + 7 * cs) + " " + (y - 5 * cs) +
          " L" + (top.x + 7 * cs) + " " + y + " Z",
        fill: "#ffd166",
        stroke: "#c9971f",
        strokeWidth: 1.1,
      }),
    );
    if (g.crown >= 2) {
      out.push(
        h("circle", { key: "jewel1", cx: top.x, cy: y - 2.4, r: 1.5, fill: "#e6544f" }),
        h("circle", { key: "jewel2", cx: top.x - 4.6, cy: y - 1.6, r: 1.1, fill: "#3f7dd6" }),
        h("circle", { key: "jewel3", cx: top.x + 4.6, cy: y - 1.6, r: 1.1, fill: "#3f9c5f" }),
      );
    }
  }
  if (g.halo) {
    out.push(h("ellipse", { key: "halo", cx: top.x, cy: top.y - (g.crown >= 2 ? 19 : 15), rx: 11, ry: 3.2, fill: "none", stroke: "#ffe9a3", strokeWidth: 2, opacity: 0.95 }));
  }
  if (g.starDiadem) {
    // Endgame prestige: an arc of floating stars above the halo.
    var dy = top.y - (g.crown >= 2 ? 27 : 23);
    for (var dIdx = 0; dIdx < 5; dIdx++) {
      var dAng = Math.PI * (0.2 + (0.6 * dIdx) / 4);
      out.push(
        sparkleShape(h, "diadem" + dIdx, top.x - Math.cos(dAng) * 14, dy - Math.sin(dAng) * 6, dIdx === 2 ? 2.6 : 1.8, "#ffffff", 0.95),
      );
    }
  }
  return out;
}

function sparkleShape(h, key, x, y, r, fill, opacity) {
  return h("path", {
    key: key,
    d:
      "M" + x + " " + (y - r) + " L" + (x + r * 0.3) + " " + (y - r * 0.3) +
      " L" + (x + r) + " " + y + " L" + (x + r * 0.3) + " " + (y + r * 0.3) +
      " L" + x + " " + (y + r) + " L" + (x - r * 0.3) + " " + (y + r * 0.3) +
      " L" + (x - r) + " " + y + " L" + (x - r * 0.3) + " " + (y - r * 0.3) + " Z",
    fill: fill,
    opacity: opacity,
  });
}

function effectParts(h, lineage, C, g, level) {
  var out = [];
  if (g.glow) {
    out.push(
      h("ellipse", { key: "glow1", cx: 50, cy: 60, rx: 34 + Math.min(level, 60) * 0.15, ry: 30, fill: C.accent, opacity: 0.1 }),
      h("ellipse", { key: "glow2", cx: 50, cy: 60, rx: 26, ry: 23, fill: C.light, opacity: 0.14 }),
    );
  }
  for (var a = 0; a < g.aura; a++) {
    out.push(
      h("circle", { key: "aura" + a, cx: 50, cy: 58, r: 40 + a * 6, fill: "none", stroke: a === 0 ? C.accent : "#ffd166", strokeWidth: 1.6, opacity: 0.45, strokeDasharray: "5 7" }),
    );
  }
  if (g.rays) {
    for (var i = 0; i < 8; i++) {
      var ang = (i * Math.PI) / 4 + 0.2;
      out.push(
        h("line", {
          key: "ray" + i,
          x1: 50 + Math.cos(ang) * 40,
          y1: 58 + Math.sin(ang) * 36,
          x2: 50 + Math.cos(ang) * (g.burst ? 52 : 47),
          y2: 58 + Math.sin(ang) * (g.burst ? 48 : 43),
          stroke: "#ffd166",
          strokeWidth: 2,
          strokeLinecap: "round",
          opacity: 0.7,
        }),
      );
    }
  }
  var sparkleCount = g.sparkles * 3 + (g.burst ? 6 : 0);
  for (var sIdx = 0; sIdx < sparkleCount; sIdx++) {
    var r = makeRand(lineage, 60 + sIdx);
    var ang2 = r(0, Math.PI * 2);
    var dist = r(28, 46);
    out.push(
      sparkleShape(h, "sp" + sIdx, 50 + Math.cos(ang2) * dist, 56 + Math.sin(ang2) * dist * 0.8, r(1.6, 3.2), sIdx % 3 === 0 ? "#ffffff" : C.accent, r(0.55, 0.95)),
    );
  }
  if (g.orbitStars > 0) {
    var orbitCount = 2 + g.orbitStars; // ring grows: 3, 4, 5 stars
    for (var oIdx = 0; oIdx < orbitCount; oIdx++) {
      var oAng = (oIdx * 2 * Math.PI) / orbitCount + 0.6;
      out.push(sparkleShape(h, "orbit" + oIdx, 50 + Math.cos(oAng) * 43, 58 + Math.sin(oAng) * 38, 2.6, "#ffe9a3", 0.9));
    }
  }
  if (g.lightPillars) {
    // Endgame prestige: vertical light pillars rising behind the being.
    for (var pIdx = 0; pIdx < 3; pIdx++) {
      out.push(
        h("rect", {
          key: "pillar" + pIdx,
          x: 28 + pIdx * 20,
          y: 4,
          width: 5,
          height: 84,
          rx: 2.5,
          fill: "#ffe9a3",
          opacity: pIdx === 1 ? 0.16 : 0.1,
        }),
      );
    }
  }
  if (g.constellation) {
    // Endgame prestige: a personal constellation, linked stars overhead.
    var cPts = [];
    for (var cIdx = 0; cIdx < 5; cIdx++) {
      var cr = makeRand(lineage, 90 + cIdx);
      cPts.push([16 + cIdx * 16 + cr(-4, 4), 8 + cr(0, 14)]);
    }
    var lineD = "M" + cPts.map(function (pt) { return pt[0] + " " + pt[1]; }).join(" L");
    out.push(h("path", { key: "constline", d: lineD, stroke: "#ffe9a3", strokeWidth: 0.8, fill: "none", opacity: 0.55 }));
    for (var cj = 0; cj < cPts.length; cj++) {
      out.push(sparkleShape(h, "conststar" + cj, cPts[cj][0], cPts[cj][1], 1.8, "#ffffff", 0.9));
    }
  }
  return out;
}

function groundParts(h, C, g, sty) {
  var out = [];
  if (g.held) {
    if (sty.heldKind === "tool") {
      out.push(
        h(
          "g",
          { key: "tool", transform: "rotate(-28 14 82)" },
          h("rect", { key: "toolh", x: 12.5, y: 72, width: 3, height: 14, rx: 1.5, fill: "#9aa0ae" }),
          h("circle", { key: "toolr", cx: 14, cy: 70, r: 4, fill: "none", stroke: "#9aa0ae", strokeWidth: 2.6 }),
        ),
      );
    } else {
      out.push(
        h(
          "g",
          { key: "balloon", className: "kandev-kandy-bob" },
          h("path", { key: "bstr", d: "M16 52 Q10 62 14 72", stroke: C.dark, strokeWidth: 1, fill: "none" }),
          h("ellipse", { key: "bball", cx: 16, cy: 45, rx: 6, ry: 7.5, fill: C.accent, stroke: C.dark, strokeWidth: 1.2 }),
        ),
      );
    }
  }
  if (g.flag) {
    out.push(
      h("line", { key: "pole", x1: 88, y1: 88, x2: 88, y2: 58, stroke: C.dark, strokeWidth: 1.8 }),
      h("path", { key: "flagp", d: "M88 58 L99 62 L88 66 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
    );
  }
  if (g.companions >= 1) {
    out.push(
      h(
        "g",
        { key: "pet", className: "kandev-kandy-bob" },
        h("circle", { key: "petb", cx: 12, cy: 82, r: 4.6, fill: C.accent, stroke: C.dark, strokeWidth: 1.4 }),
        h("circle", { key: "pete1", cx: 10.6, cy: 81, r: 0.9, fill: "#26232e" }),
        h("circle", { key: "pete2", cx: 13.6, cy: 81, r: 0.9, fill: "#26232e" }),
      ),
    );
  }
  if (g.companions >= 2) {
    out.push(
      h(
        "g",
        { key: "pal", className: "kandev-kandy-bob" },
        h("circle", { key: "palb", cx: 90, cy: 40, r: 3.2, fill: C.light, stroke: C.dark, strokeWidth: 1.1 }),
        h("circle", { key: "pale", cx: 90, cy: 39.4, r: 0.8, fill: "#26232e" }),
      ),
    );
  }
  return out;
}

// creatureParts — the same being at every level, growing steadily.
// portrait mode (top-bar icon): full-grown proportions regardless of stage,
// no ambient effects and no ground — just the being, framed tight.
// contactShadow — a soft two-layer ground shadow so the being (and its egg)
// visibly stands ON the scene instead of floating over it. Floaty archetypes
// get a smaller, fainter pool to read as hovering.
function contactShadow(h, grounded, cy) {
  return [
    h("ellipse", { key: "ctshadow", cx: 50, cy: cy, rx: grounded ? 17 : 12, ry: 2.6, fill: "#3f3626", opacity: grounded ? 0.16 : 0.1 }),
    h("ellipse", { key: "ctshadow2", cx: 50, cy: cy, rx: grounded ? 10 : 7, ry: 1.7, fill: "#3f3626", opacity: grounded ? 0.13 : 0.08 }),
  ];
}

function creatureParts(h, data, portrait) {
  var level = data.level;
  if (level <= 1) {
    var egg = eggSvg(h, makeRand((data.lineage_seed || 1) >>> 0, 7));
    return portrait ? egg : contactShadow(h, true, 85.5).concat(egg);
  }

  var lineage = (data.lineage_seed || 1) >>> 0;
  var g = growthForLevel(level);
  var sty = lineageStyle(lineage);
  var temper = temperFor(data);
  var C = lineageColors(data.family || 0, level, sty, temper);
  var arch = (((data.archetype || 0) % BODY_BUILDERS.length) + BODY_BUILDERS.length) % BODY_BUILDERS.length;

  // Lineage-stable geometry: the SAME rand stream at every level, so the
  // body only changes through stage scale/detail, never reshuffles.
  var body = BODY_BUILDERS[arch](h, makeRand(lineage, 6), C, g);

  // face_mood is a render-only override (celebrations): the expression goes
  // joyful while the badge keeps the server's mood.
  var mood = data.face_mood || data.mood || "content";
  // sleep_state is a render-only field the widget/card layer sets from the
  // seeded schedule + local clock: "asleep" (closed eyes, zzz) or "grumpy"
  // (half-woken squint). Never comes from the server.
  var sleep = data.sleep_state || null;
  var inner = [];
  if (!portrait) inner = inner.concat(contactShadow(h, body.grounded, 89));
  inner = inner.concat(wingParts(h, C, body.top, g));
  inner = inner.concat(body.parts);
  inner = inner.concat(temperVariant(h, lineage, C, body, g, temper));
  inner = inner.concat(markingParts(h, lineage, C, body.mark, g, sty));
  inner = inner.concat(temperScar(h, lineage, C, body, temper));
  inner = inner.concat(faceParts(h, lineage, C, body.head, g, sty, mood, temper, sleep));
  inner = inner.concat(hornParts(h, lineage, C, body.top, g, sty, mood, temper));
  if (body.grounded) inner = inner.concat(tailPartsFor(h, C, g, sty, temper));
  inner = inner.concat(prestigeInBody(h, C, body.top, g));
  if (mood === "gloomy") {
    // A tiny personal rain cloud — archetype-agnostic, above the head.
    inner.push(
      h(
        "g",
        { key: "raincloud", opacity: 0.92 },
        h("ellipse", { key: "c1", cx: body.top.x - 6, cy: body.top.y - 19, rx: 6, ry: 3.6, fill: "#9aa2ad" }),
        h("ellipse", { key: "c2", cx: body.top.x + 5, cy: body.top.y - 20, rx: 7, ry: 4.2, fill: "#8b94a1" }),
        h("ellipse", { key: "c3", cx: body.top.x, cy: body.top.y - 16.5, rx: 8.5, ry: 3.8, fill: "#a7aeb8" }),
      ),
    );
  }

  var s = portrait ? 1 : STAGE_SCALE[g.stage];
  var beingProps = {
    key: "being",
    transform: "translate(" + 50 * (1 - s) + " " + 88 * (1 - s) + ") scale(" + s + ")",
  };
  if (mood === "gloomy") {
    // Desaturate the creature only (scene and chrome stay full-color).
    beingProps.style = { filter: "saturate(0.6)" };
  }
  var scaled = h("g", beingProps, inner);

  var parts = [];
  if (!portrait) parts = parts.concat(effectParts(h, lineage, C, g, level));
  parts.push(scaled);
  if (!portrait) parts = parts.concat(groundParts(h, C, g, sty));
  if (!portrait && sleep === "asleep") {
    // The floating zzz bubble, anchored just beside the (stage-scaled)
    // crown. Unscaled coordinates so the zzz stays readable on hatchlings.
    var zx = 50 + (body.top.x - 50) * s + 11;
    var zy = 88 - (88 - body.top.y) * s - 2;
    parts.push(
      h(
        "g",
        { key: "zzz" },
        zzzText(h, "z1", zx, zy, 8, "kandev-kandy-zzz kandev-kandy-zzz-lead", "0ms"),
        zzzText(h, "z2", zx + 5, zy - 7, 6.2, "kandev-kandy-zzz", "900ms"),
        zzzText(h, "z3", zx + 9.5, zy - 13.5, 5, "kandev-kandy-zzz", "1800ms"),
      ),
    );
  }
  return parts;
}

// zzzText — one floating "z" of the sleep bubble. The animated class sits
// directly on a text element positioned by x/y attributes with no layout
// transform (the layering rule), so the float loop is safe. Reduced motion:
// animation:none leaves the lead z visible at its base opacity and the
// trailing ones hidden — a static single z.
function zzzText(h, key, x, y, size, cls, delay) {
  return h(
    "text",
    {
      key: key,
      x: x,
      y: y,
      fontSize: size,
      fontStyle: "italic",
      fontWeight: 700,
      fontFamily: "system-ui, sans-serif",
      // Pale fill + thin dark outline (painted under the fill) so the zzz
      // reads on both the night sky and a bright dawn scene.
      fill: "#e8eefc",
      stroke: "#3d4a66",
      strokeWidth: 0.5,
      paintOrder: "stroke",
      className: cls,
      style: { animationDelay: delay, transformBox: "fill-box", transformOrigin: "center" },
    },
    "z",
  );
}

// isStatic renders a motionless portrait (top-bar icon): no bob wrapper, the
// kandev-kandy-static class kills descendant blink/wiggle animations, and the
// viewBox crops tight to the full-grown body (creatureParts portrait mode) so
// the icon fills its chip at every growth stage — all the life stays in the
// hover card.
function creatureSvg(h, data, size, extraClass, isStatic) {
  var cls = (extraClass || "") + (isStatic ? " kandev-kandy-static" : "");
  // Mood sets the idle-bob tempo: elated bounces faster, bored slows down,
  // sad/gloomy nearly stop. face_mood (celebration override) wins so the
  // creature bounces joyfully while the badge stays server-truth.
  var mood = data.face_mood || data.mood || "content";
  var bobCls = "kandev-kandy-bob";
  if (mood === "elated") bobCls += " kandev-kandy-bob-fast";
  else if (mood === "bored") bobCls += " kandev-kandy-bob-slow";
  else if (mood === "sad" || mood === "gloomy") bobCls = "kandev-kandy-bobsad";
  // Asleep (or grumpily half-woken): the idle bob stops — it's lying still.
  if (data.sleep_state) bobCls = "";
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: isStatic ? "14 14 72 78" : "0 0 100 100",
      className: cls.trim(),
      "aria-hidden": "true",
      style: { overflow: isStatic ? "hidden" : "visible", flexShrink: 0 },
    },
    h("g", { className: isStatic ? "" : bobCls }, creatureParts(h, data, !!isStatic)),
  );
}

// ---------------------------------------------------------------------------
// Scenes — one biome per lineage, maturing with level:
// phase 0 barren (lv1-5), 1 sparse (6-17), 2 lively (18-34), 3 lush
// (35-55), 4 celestial (56-79), 5 transcendent (80+). Layout is stable
// within a phase; density grows with level; past Lv100 stars keep rising.
// ---------------------------------------------------------------------------

function scenePhase(level) {
  if (level <= 5) return 0;
  if (level <= 17) return 1;
  if (level <= 34) return 2;
  if (level <= 55) return 3;
  if (level <= 79) return 4;
  return 5;
}

// h0 is bound at initialize time so scene helpers can stay top-level.
var h0 = null;

function stars(rand, count, tint) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(
      h0("circle", { key: "star" + i, cx: rand(0, 240), cy: rand(0, 90), r: rand(0.4, 1.5), fill: tint || "#ffffff", opacity: rand(0.4, 1) }),
    );
  }
  return out;
}

function rocks(rand, count, fill) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(10, 230);
    out.push(h0("ellipse", { key: "rock" + i, cx: x, cy: rand(110, 118), rx: rand(4, 10), ry: rand(2, 4), fill: fill, opacity: 0.8 }));
  }
  return out;
}

function grassBlades(rand, count, stroke) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(4, 236);
    out.push(
      h0("path", {
        key: "grass" + i,
        d: "M" + x + " 120 Q" + (x + rand(-3, 3)) + " " + rand(104, 112) + " " + (x + rand(-1, 1)) + " " + rand(100, 108),
        stroke: stroke,
        strokeWidth: 1.6,
        fill: "none",
        opacity: 0.8,
      }),
    );
  }
  return out;
}

function treeProps(rand, count, fill) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(10, 230);
    var w = rand(10, 18);
    var ht = rand(22, 42);
    out.push(h0("path", { key: "tree" + i, d: "M" + x + " 120 L" + (x + w / 2) + " " + (120 - ht) + " L" + (x + w) + " 120 Z", fill: fill, opacity: rand(0.6, 0.95) }));
  }
  return out;
}

function flowerDots(rand, count) {
  var out = [];
  var colors = ["#ff8fa3", "#ffd166", "#c792ea"];
  for (var i = 0; i < count; i++) {
    out.push(h0("circle", { key: "flower" + i, cx: rand(8, 232), cy: rand(106, 118), r: rand(1.2, 2.2), fill: colors[i % 3], opacity: 0.95 }));
  }
  return out;
}

function fireflies(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(h0("circle", { key: "fly" + i, cx: rand(10, 230), cy: rand(20, 100), r: rand(1, 2), fill: "#ffe9a3", opacity: rand(0.5, 1) }));
  }
  return out;
}

function waves(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var y = 74 + i * (40 / Math.max(count, 1));
    out.push(
      h0("path", {
        key: "wave" + i,
        d: "M-5 " + y + " Q 30 " + (y - rand(2, 5)) + " 60 " + y + " T 125 " + y + " T 190 " + y + " T 255 " + y,
        stroke: "#dff2fb",
        strokeWidth: 1.4,
        fill: "none",
        opacity: 0.5,
      }),
    );
  }
  return out;
}

function bubbles(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(h0("circle", { key: "bub" + i, cx: rand(10, 230), cy: rand(8, 100), r: rand(1, 3.4), fill: "none", stroke: "#bfe7ff", strokeWidth: 1, opacity: rand(0.4, 0.9) }));
  }
  return out;
}

function coral(rand, count) {
  var out = [];
  var colors = ["#ff8f6b", "#ff5fd2", "#ffd166"];
  for (var i = 0; i < count; i++) {
    var x = rand(10, 230);
    out.push(
      h0("path", {
        key: "coral" + i,
        d: "M" + x + " 120 Q" + (x - 4) + " " + rand(102, 110) + " " + x + " " + rand(94, 102) + " M" + x + " 120 Q" + (x + 5) + " " + rand(104, 112) + " " + (x + 3) + " " + rand(98, 106),
        stroke: colors[i % 3],
        strokeWidth: 2.4,
        strokeLinecap: "round",
        fill: "none",
        opacity: 0.85,
      }),
    );
  }
  return out;
}

function hills(rand, count, fill) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(-20, 180);
    out.push(h0("path", { key: "hill" + i, d: "M" + x + " 120 Q" + (x + 45) + " " + rand(72, 92) + " " + (x + 90) + " 120 Z", fill: fill, opacity: 0.7 }));
  }
  return out;
}

function mountains(rand, count, fill, withCaps) {
  var out = [];
  var x = -10;
  var i = 0;
  while (x < 230 && i < count) {
    var w = rand(60, 110);
    var peak = rand(18, 42);
    out.push(h0("path", { key: "mtn" + i, d: "M" + x + " 120 L" + (x + w / 2) + " " + peak + " L" + (x + w) + " 120 Z", fill: fill, opacity: 0.85 }));
    if (withCaps) {
      out.push(
        h0("path", {
          key: "mcap" + i,
          d: "M" + (x + w / 2 - 9) + " " + (peak + 12) + " L" + (x + w / 2) + " " + peak + " L" + (x + w / 2 + 9) + " " + (peak + 12) + " Z",
          fill: "#eef2fb",
          opacity: 0.95,
        }),
      );
    }
    x += w * 0.7;
    i++;
  }
  return out;
}

function auroraRibbons(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var y = 14 + i * 14;
    out.push(
      h0("path", {
        key: "aur" + i,
        d: "M-10 " + (y + rand(0, 8)) + " Q 60 " + (y - rand(6, 16)) + " 120 " + (y + rand(0, 10)) + " T 250 " + (y - rand(0, 10)),
        stroke: i % 2 === 0 ? "#57f2b8" : "#7fd7ff",
        strokeWidth: rand(4, 8),
        strokeLinecap: "round",
        fill: "none",
        opacity: 0.35,
      }),
    );
  }
  return out;
}

// --- Early-scene furniture (phases 0-1) -----------------------------------
// Low levels used to render as a flat mud gradient with smudges. These
// helpers keep the scenes modest but pleasant: a soft dawn ground plane with
// a real horizon, a pale sun, and 2-4 tiny details with highlight + contact
// shadow so they read as objects. Still strictly less rich than phase 2+.

function earlyGround(rand, far, near, haze) {
  var j = rand(-2, 2);
  var farTop =
    "M-5 " + (95 + j) + " Q60 " + (91 + j) + " 120 " + (93.5 + j) + " T 245 " + (92.5 + j);
  return [
    h0("path", { key: "gfar", d: farTop + " L245 125 L-5 125 Z", fill: far }),
    h0("path", { key: "ghaze", d: farTop, stroke: haze, strokeWidth: 2.4, fill: "none", opacity: 0.7 }),
    h0("path", {
      key: "gnear",
      d: "M-5 " + (106 + j) + " Q80 " + (102 + j) + " 160 " + (104.5 + j) + " T 245 " + (103.5 + j) + " L245 125 L-5 125 Z",
      fill: near,
      opacity: 0.9,
    }),
  ];
}

// At night the sun simply isn't drawn — sceneFor layers the moon on top of
// the night wash instead, so it glows over the tint rather than under it.
function sunDisc(cx, cy, r, core, halo) {
  if (currentDayPhase === "night") return [];
  return [
    h0("circle", { key: "sunhalo", cx: cx, cy: cy, r: r * 2.1, fill: halo, opacity: 0.35 }),
    h0("circle", { key: "sundisc", cx: cx, cy: cy, r: r, fill: core, opacity: 0.95 }),
  ];
}

// moonDisc — the night sky's sun replacement: a soft-glow full moon with a
// few craters, drawn in the same top-right region the suns occupy.
function moonDisc(cx, cy, r) {
  return [
    h0("circle", { key: "moonhalo", cx: cx, cy: cy, r: r * 2.6, fill: "#cfe0ff", opacity: 0.1 }),
    h0("circle", { key: "moonhalo2", cx: cx, cy: cy, r: r * 1.9, fill: "#d8e4ff", opacity: 0.14 }),
    h0("circle", { key: "moonhalo3", cx: cx, cy: cy, r: r * 1.4, fill: "#e2ebff", opacity: 0.2 }),
    h0("circle", { key: "moondisc", cx: cx, cy: cy, r: r, fill: "#eef3fb", opacity: 0.98 }),
    h0("circle", { key: "crater1", cx: cx - r * 0.35, cy: cy - r * 0.18, r: r * 0.22, fill: "#c9d4e8", opacity: 0.9 }),
    h0("circle", { key: "crater2", cx: cx + r * 0.3, cy: cy + r * 0.3, r: r * 0.16, fill: "#cfd9ea", opacity: 0.85 }),
    h0("circle", { key: "crater3", cx: cx + r * 0.14, cy: cy - r * 0.44, r: r * 0.11, fill: "#d6dfee", opacity: 0.8 }),
  ];
}

function softStone(key, x, y, s, fill, hi) {
  return [
    h0("ellipse", { key: key + "sh", cx: x + s, cy: y + s * 2.2, rx: s * 4, ry: s * 1.1, fill: "#4a3f2f", opacity: 0.13 }),
    h0("ellipse", { key: key, cx: x, cy: y, rx: s * 3.4, ry: s * 2.4, fill: fill }),
    h0("ellipse", { key: key + "hi", cx: x - s, cy: y - s, rx: s * 1.5, ry: s * 0.8, fill: hi, opacity: 0.85 }),
  ];
}

function sprout(rand, key, x, y, leaf, hi, stem) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 1.4, rx: 4, ry: 1.1, fill: "#4a3f2f", opacity: 0.12 }),
    h0("path", {
      key: key + "st",
      d: "M" + x + " " + y + " Q" + (x + rand(-1.2, 1.2)) + " " + (y - 4) + " " + x + " " + (y - 6.5),
      stroke: stem,
      strokeWidth: 1.6,
      fill: "none",
      strokeLinecap: "round",
    }),
    h0("path", {
      key: key + "l1",
      d: "M" + x + " " + (y - 5.5) + " Q" + (x - 6.5) + " " + (y - 7.5) + " " + (x - 4.5) + " " + (y - 12) + " Q" + (x - 0.5) + " " + (y - 8.5) + " " + x + " " + (y - 5.5) + " Z",
      fill: leaf,
    }),
    h0("path", {
      key: key + "l2",
      d: "M" + x + " " + (y - 5.5) + " Q" + (x + 6.5) + " " + (y - 8.5) + " " + (x + 5) + " " + (y - 13) + " Q" + (x + 0.5) + " " + (y - 9) + " " + x + " " + (y - 5.5) + " Z",
      fill: hi,
    }),
  ];
}

function sandRipples(rand, stroke) {
  var xs = [30, 168, 96];
  var ys = [104, 101, 113];
  var out = [];
  for (var i = 0; i < 3; i++) {
    var x = xs[i] + rand(-8, 8);
    var y = ys[i] + rand(-1.5, 1.5);
    out.push(
      h0("path", {
        key: "rip" + i,
        d: "M" + x + " " + y + " Q" + (x + 11) + " " + (y - 2.4) + " " + (x + 22) + " " + y,
        stroke: stroke,
        strokeWidth: 1.4,
        fill: "none",
        opacity: 0.7,
        strokeLinecap: "round",
      }),
    );
  }
  return out;
}

function dawnPuddle(key, x, y) {
  return [
    h0("ellipse", { key: key + "rim", cx: x, cy: y, rx: 26, ry: 5.6, fill: "#cfe9f2", opacity: 0.9 }),
    h0("ellipse", { key: key, cx: x, cy: y, rx: 22, ry: 4.4, fill: "#a9d3e6" }),
    h0("path", {
      key: key + "gl",
      d: "M" + (x - 10) + " " + (y - 1) + " Q" + (x - 2) + " " + (y - 2.6) + " " + (x + 7) + " " + (y - 1.2),
      stroke: "#ffffff",
      strokeWidth: 1.1,
      fill: "none",
      opacity: 0.8,
    }),
  ];
}

function tinyShell(key, x, y) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 2, rx: 4.4, ry: 1.1, fill: "#4a3f2f", opacity: 0.12 }),
    h0("path", {
      key: key,
      d: "M" + (x - 3.6) + " " + (y + 1.5) + " Q" + x + " " + (y - 6.5) + " " + (x + 3.6) + " " + (y + 1.5) + " Z",
      fill: "#f6bcc8",
      stroke: "#d795a6",
      strokeWidth: 0.8,
    }),
    h0("path", {
      key: key + "r",
      d:
        "M" + x + " " + (y + 1.2) + " L" + x + " " + (y - 4.2) +
        " M" + (x - 2) + " " + (y + 1) + " L" + (x - 1.3) + " " + (y - 2.6) +
        " M" + (x + 2) + " " + (y + 1) + " L" + (x + 1.3) + " " + (y - 2.6),
      stroke: "#d795a6",
      strokeWidth: 0.7,
      opacity: 0.9,
    }),
  ];
}

function pondReeds(rand, key, x) {
  var out = [];
  for (var i = 0; i < 2; i++) {
    var rx = x + i * 5 + rand(-1.5, 1.5);
    var top = 88 - rand(10, 16) - i * 4;
    out.push(h0("line", { key: key + "s" + i, x1: rx, y1: 112, x2: rx, y2: top, stroke: "#5e8a52", strokeWidth: 1.6 }));
    out.push(h0("ellipse", { key: key + "h" + i, cx: rx, cy: top - 3, rx: 1.9, ry: 4.6, fill: "#8a6b46" }));
  }
  return out;
}

function lilypad(key, x, y) {
  return [
    h0("ellipse", { key: key, cx: x, cy: y, rx: 9, ry: 3, fill: "#6fae6a", opacity: 0.95 }),
    h0("path", { key: key + "n", d: "M" + x + " " + y + " L" + (x + 8) + " " + (y - 2.2), stroke: "#568c52", strokeWidth: 1.1 }),
    h0("ellipse", { key: key + "hi", cx: x - 2.5, cy: y - 1, rx: 3.4, ry: 1, fill: "#95c98e", opacity: 0.9 }),
  ];
}

function distantPeaks(rand, fill, cap) {
  var xs = [18, 92, 170];
  var out = [];
  for (var i = 0; i < 3; i++) {
    var x = xs[i] + rand(-10, 10);
    var w = rand(52, 78);
    var peak = rand(58, 74);
    out.push(h0("path", { key: "fpk" + i, d: "M" + x + " 97 L" + (x + w / 2) + " " + peak + " L" + (x + w) + " 97 Z", fill: fill, opacity: 0.75 }));
    out.push(
      h0("path", {
        key: "fcap" + i,
        d: "M" + (x + w / 2 - 6) + " " + (peak + 7) + " L" + (x + w / 2) + " " + peak + " L" + (x + w / 2 + 6) + " " + (peak + 7) + " Z",
        fill: cap,
        opacity: 0.9,
      }),
    );
  }
  return out;
}

function snowTuft(key, x, y) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 2.4, rx: 6, ry: 1.4, fill: "#5a6a86", opacity: 0.16 }),
    h0("circle", { key: key + "a", cx: x - 3, cy: y, r: 2.6, fill: "#ffffff", opacity: 0.95 }),
    h0("circle", { key: key + "b", cx: x + 2.4, cy: y + 0.4, r: 3.2, fill: "#f4f8ff", opacity: 0.95 }),
    h0("circle", { key: key + "c", cx: x - 0.4, cy: y - 2, r: 2.2, fill: "#ffffff", opacity: 0.9 }),
  ];
}

function emberSpark(key, x, y) {
  return [
    h0("circle", { key: key + "halo", cx: x, cy: y, r: 6.5, fill: "#ff9a4d", opacity: 0.26 }),
    h0("circle", { key: key, cx: x, cy: y, r: 2, fill: "#ff8a3d", opacity: 0.95 }),
    h0("circle", { key: key + "fl", cx: x + 2.6, cy: y - 4.4, r: 0.9, fill: "#ffc06e", opacity: 0.85 }),
  ];
}

function cactusPebble(key, x, y) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 4.4, rx: 4.6, ry: 1.2, fill: "#4a3f2f", opacity: 0.14 }),
    h0("ellipse", { key: key, cx: x, cy: y, rx: 3.4, ry: 5, fill: "#8fae6b" }),
    h0("path", {
      key: key + "hi",
      d: "M" + (x - 1.2) + " " + (y - 3.4) + " Q" + (x - 2.2) + " " + y + " " + (x - 1.2) + " " + (y + 3),
      stroke: "#b5cc8e",
      strokeWidth: 1,
      fill: "none",
      opacity: 0.9,
    }),
    h0("circle", { key: key + "fl", cx: x + 0.6, cy: y - 4.6, r: 1.1, fill: "#f6a6b8" }),
  ];
}

function dunes(rand) {
  return [
    h0("path", { key: "dune1", d: "M-10 120 Q60 " + rand(78, 92) + " 130 112 T 250 104 L250 130 L-10 130 Z", fill: "#e0b96a", opacity: 0.9 }),
    h0("path", { key: "dune2", d: "M-10 120 Q90 " + rand(96, 106) + " 250 118 L250 130 L-10 130 Z", fill: "#c99b4e", opacity: 0.9 }),
  ];
}

function mesas(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(0, 200);
    var w = rand(24, 50);
    var ht = rand(30, 60);
    out.push(h0("rect", { key: "mesa" + i, x: x, y: 120 - ht, width: w, height: ht, rx: 4, fill: "#a35a34", opacity: 0.8 }));
  }
  return out;
}

function volcanoProps(rand, embersCount) {
  var out = [
    h0("path", { key: "cone", d: "M40 120 L95 30 L150 120 Z", fill: "#4a2b2b", opacity: 0.95 }),
    h0("path", { key: "lava", d: "M88 36 Q95 30 102 36 L98 58 L92 58 Z", fill: "#ff7b42", opacity: 0.95 }),
    h0("circle", { key: "vglow", cx: 95, cy: 32, r: 10, fill: "#ffb25e", opacity: 0.5 }),
  ];
  for (var i = 0; i < embersCount; i++) {
    out.push(h0("circle", { key: "ember" + i, cx: rand(60, 200), cy: rand(6, 50), r: rand(1, 1.8), fill: i % 2 ? "#ffc06e" : "#ff9457", opacity: rand(0.6, 1) }));
  }
  return out;
}

// Per-biome gradients, phase 0 (barren/dull) -> 4 (celestial/epic).
// Phases 0-1 are layered: a soft edge vignette, a pale sun glow, then the
// pastel dawn sky — modest, but no longer mud.
var BIOME_BGS = [
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(122,92,60,0.18) 100%), radial-gradient(circle at 82% 17%, rgba(255,214,150,0.55) 0%, rgba(255,214,150,0) 40%), linear-gradient(to bottom, #fdeed8 0%, #f1ecc8 45%, #e2e5b4 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(60,100,60,0.14) 100%), radial-gradient(circle at 85% 18%, rgba(255,230,150,0.5) 0%, rgba(255,230,150,0) 38%), linear-gradient(to bottom, #cdeaf6 0%, #def1c2 62%, #b7dc9a 100%)",
    "linear-gradient(to bottom, #a5ddf2 0%, #b7e39a 62%, #7fbf6a 100%)",
    "linear-gradient(to bottom, #7cc9a0 0%, #2f8f5e 60%, #14532d 100%)",
    "linear-gradient(to bottom, #0e2b38 0%, #14532d 60%, #052e16 100%)",
    "linear-gradient(to bottom, #1a0f3d 0%, #0f4f3a 55%, #020d08 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(60,90,110,0.16) 100%), radial-gradient(circle at 82% 18%, rgba(255,238,190,0.5) 0%, rgba(255,238,190,0) 40%), linear-gradient(to bottom, #d9eef7 0%, #e9ecd8 48%, #ecd9ae 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(25,80,110,0.14) 100%), radial-gradient(circle at 85% 18%, rgba(255,240,190,0.5) 0%, rgba(255,240,190,0) 38%), linear-gradient(to bottom, #d8edf4 0%, #b6dcec 55%, #8fc6da 100%)",
    "linear-gradient(to bottom, #a8d8ea 0%, #5ca8d8 55%, #2f6f9f 100%)",
    "linear-gradient(to bottom, #4fa3c7 0%, #23648f 60%, #123c5c 100%)",
    "linear-gradient(to bottom, #0b2c4a 0%, #0e4a6e 60%, #04121f 100%)",
    "linear-gradient(to bottom, #150a3d 0%, #0e4a6e 55%, #02060f 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(60,70,100,0.17) 100%), radial-gradient(circle at 80% 16%, rgba(255,248,225,0.55) 0%, rgba(255,248,225,0) 40%), linear-gradient(to bottom, #ecebf7 0%, #e3e8f2 55%, #d9dfe8 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(50,70,110,0.15) 100%), radial-gradient(circle at 83% 15%, rgba(255,248,224,0.5) 0%, rgba(255,248,224,0) 38%), linear-gradient(to bottom, #e1e9f6 0%, #c8d5e9 60%, #a9bcd7 100%)",
    "linear-gradient(to bottom, #cdd7e8 0%, #8fa3c4 60%, #5c6f96 100%)",
    "linear-gradient(to bottom, #b8c8ea 0%, #6d83b8 60%, #3a4c7c 100%)",
    "linear-gradient(to bottom, #0a1a33 0%, #16305e 60%, #050d1f 100%)",
    "linear-gradient(to bottom, #1b0a3d 0%, #1c3a72 55%, #03040c 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(120,60,30,0.18) 100%), radial-gradient(circle at 82% 18%, rgba(255,180,110,0.55) 0%, rgba(255,180,110,0) 40%), linear-gradient(to bottom, #fce3c0 0%, #f8d5a5 55%, #efc691 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(140,80,30,0.16) 100%), radial-gradient(circle at 82% 17%, rgba(255,200,120,0.55) 0%, rgba(255,200,120,0) 38%), linear-gradient(to bottom, #ffe7ba 0%, #f9cf8b 60%, #e9b269 100%)",
    "linear-gradient(to bottom, #f0b878 0%, #cc7a4a 60%, #8a4a2e 100%)",
    "linear-gradient(to bottom, #3a1414 0%, #6e2b1c 60%, #251010 100%)",
    "linear-gradient(to bottom, #1c0f2e 0%, #4a1c3f 60%, #12060f 100%)",
    "linear-gradient(to bottom, #0f0a3d 0%, #571f4a 55%, #070310 100%)",
  ],
];

function biomeProps(biome, phase, rand, level) {
  var density = Math.min(level, 40);
  switch (biome) {
    case 1: // aquatic: dawn shore -> pond -> lake -> coral -> bioluminescent
      if (phase === 0)
        return earlyGround(rand, "#e6d3a4", "#d9c28e", "#fdf3d8").concat(
          sunDisc(196, 24, 8.5, "#fff1c4", "#ffe8ae"),
          sandRipples(rand, "#c4ad7c"),
          dawnPuddle("pud", 152, 110),
          tinyShell("shl", 52 + rand(-10, 10), 112),
        );
      if (phase === 1)
        return waves(rand, 2).concat(
          sunDisc(205, 22, 11, "#fff1b8", "#ffe9c9"),
          pondReeds(rand, "reed", 26 + rand(0, 8)),
          lilypad("lp", 188 + rand(-8, 8), 108),
        );
      if (phase === 2) return waves(rand, 4 + Math.floor(density / 10));
      if (phase === 3) return waves(rand, 3).concat(coral(rand, 4 + Math.floor(density / 8)), bubbles(rand, 5));
      return bubbles(rand, 8 + Math.floor(density / 4)).concat(coral(rand, 5), stars(rand, Math.min(6 + Math.max(level - 40, 0), 40), "#9be7ff"));
    case 2: // alpine: dawn tundra -> foothills -> peaks -> crystal -> celestial
      if (phase === 0)
        return distantPeaks(rand, "#c3cddf", "#f2f6fc").concat(
          earlyGround(rand, "#d3dae5", "#c5cedb", "#f6f8fc"),
          sunDisc(194, 22, 8, "#fff7e0", "#ffffff"),
          softStone("st0", 172 + rand(-8, 8), 110, 1.7, "#a9b4c6", "#d6dde9"),
          snowTuft("snw", 48 + rand(-10, 10), 112),
        );
      if (phase === 1)
        return distantPeaks(rand, "#b0bdd6", "#f2f6fc").concat(
          hills(rand, 3, "#93a8c9"),
          sunDisc(200, 20, 9, "#fff4d6", "#fffdf4"),
          snowTuft("snw", 56 + rand(-12, 12), 112),
        );
      if (phase === 2) return mountains(rand, 4, "#41527a", true);
      if (phase === 3) return mountains(rand, 4, "#3a4c7c", true).concat(flowerDots(rand, 4));
      return mountains(rand, 3, "#101d3d", true).concat(auroraRibbons(rand, 3), stars(rand, Math.min(14 + Math.max(level - 40, 0), 50)));
    case 3: // ember: warm dawn dunes -> dunes -> canyon -> volcano -> starfire
      if (phase === 0)
        return earlyGround(rand, "#e3bc83", "#d5aa6e", "#ffe9c2").concat(
          sunDisc(196, 24, 10, "#ffcf8e", "#ffb96e"),
          softStone("st0", 66 + rand(-16, 8), 111, 1.5, "#c69a66", "#e8c795"),
          cactusPebble("cac", 176 + rand(-10, 10), 108),
          emberSpark("emb", 44 + rand(-10, 10), 102),
        );
      if (phase === 1)
        return dunes(rand).concat(
          sunDisc(200, 22, 12, "#fff1b8", "#ffd98e"),
          cactusPebble("cac", 40 + rand(-10, 10), 106),
          emberSpark("emb", 188 + rand(-8, 8), 96),
        );
      if (phase === 2)
        return mesas(rand, 4).concat(
          currentDayPhase === "night"
            ? []
            : [h0("circle", { key: "csun", cx: 205, cy: 20, r: 11, fill: "#ffddaa", opacity: 0.9 })],
        );
      if (phase === 3) return volcanoProps(rand, 4 + Math.floor(density / 10));
      return volcanoProps(rand, 6).concat(stars(rand, Math.min(12 + Math.max(level - 40, 0), 50)));
    default: // 0 verdant: dawn field -> meadow -> woods -> lush -> enchanted
      if (phase === 0)
        return earlyGround(rand, "#d5d19c", "#c5c283", "#f7f2cd").concat(
          sunDisc(196, 22, 9, "#ffe9b8", "#ffdf9e"),
          softStone("st0", 52 + rand(-10, 8), 109, 1.6, "#bfae82", "#e0d4aa"),
          sprout(rand, "sp0", 178 + rand(-8, 8), 112, "#7fae62", "#a9c98a", "#6f9e55"),
          sprout(rand, "sp1", 30 + rand(-6, 6), 116, "#8ab26b", "#b0cc90", "#6f9e55"),
        );
      if (phase === 1)
        return hills(rand, 2, "#a3cf88").concat(
          sunDisc(205, 22, 12, "#ffdf6b", "#ffe9a3"),
          grassBlades(rand, 8 + Math.floor(density / 2), "#4c8a3f"),
          flowerDots(rand, 2),
          softStone("st0", 38 + rand(-8, 8), 112, 1.4, "#a8bd8a", "#ccdcb0"),
        );
      if (phase === 2) return grassBlades(rand, 10, "#4c8a3f").concat(treeProps(rand, 3 + Math.floor(density / 8), "#2c6e46"), flowerDots(rand, 3));
      if (phase === 3) return treeProps(rand, 6 + Math.floor(density / 6), "#1d4d31").concat(flowerDots(rand, 6), grassBlades(rand, 8, "#2f6e3f"));
      return treeProps(rand, 6, "#0c3a24").concat(fireflies(rand, 8 + Math.floor(density / 5)), stars(rand, Math.min(8 + Math.max(level - 40, 0), 40)));
  }
}

// skyOverlayFor — the composable day/night layer: a CSS gradient prepended
// onto the biome background plus an SVG wash rect laid over the props, so
// every biome and phase gets tinted without any biome rewrite. Celestial
// phases (4-5) are already dark/starry, so they only get a subtle shift.
function skyOverlayFor(dayPhase, phase) {
  if (dayPhase === "day") return null;
  var dim = phase >= 4;
  function wash(fill, opacity) {
    return h0("rect", { key: "skywash", x: -10, y: -10, width: 260, height: 140, fill: fill, opacity: opacity });
  }
  if (dayPhase === "dawn") {
    return {
      bg:
        "linear-gradient(to bottom, rgba(255,196,110," + (dim ? 0.08 : 0.3) + ") 0%, rgba(255,172,118," + (dim ? 0.03 : 0.1) + ") 55%, rgba(255,152,92," + (dim ? 0.05 : 0.16) + ") 100%)",
      wash: wash("#ffb75e", dim ? 0.05 : 0.13),
    };
  }
  if (dayPhase === "dusk") {
    return {
      bg:
        "linear-gradient(to bottom, rgba(255,122,70," + (dim ? 0.08 : 0.3) + ") 0%, rgba(226,92,150," + (dim ? 0.05 : 0.2) + ") 55%, rgba(122,62,142," + (dim ? 0.05 : 0.18) + ") 100%)",
      wash: wash("#ff8a6b", dim ? 0.06 : 0.15),
    };
  }
  return {
    bg: dim
      ? "linear-gradient(to bottom, rgba(10,16,50,0.22) 0%, rgba(6,10,34,0.2) 100%)"
      : "linear-gradient(to bottom, rgba(11,16,52,0.62) 0%, rgba(9,13,44,0.5) 55%, rgba(4,8,28,0.6) 100%)",
    wash: wash("#0b1238", dim ? 0.1 : 0.3),
  };
}

// sceneFor(biome, level, lineageSeed, timeOfDay) — the lineage's habitat at
// this maturity and hour. Layout re-rolls only at phase boundaries; the
// day/night layer composes on top and defaults to mid-day ("day": no
// overlay at all), so 3-arg callers keep today's exact renders.
function sceneFor(biome, level, seed, timeOfDay) {
  var phase = scenePhase(level);
  var b = ((biome % BIOME_BGS.length) + BIOME_BGS.length) % BIOME_BGS.length;
  var dayPhase = dayPhaseFor(timeOfDay);
  var rand = makeRand((seed ^ (phase * 0x9e3779b9)) >>> 0, 11);
  // Phase 5 ("transcendent", 80+) is the celestial scene drifting further
  // out: same biome props with a golden star field layered on top.
  currentDayPhase = dayPhase;
  var props = biomeProps(b, Math.min(phase, 4), rand, level);
  if (phase === 5) {
    props = props.concat(stars(rand, Math.min(10 + (level - 79), 40), "#ffe9a3"));
  }
  currentDayPhase = "day";
  var bg = BIOME_BGS[b][phase];
  var overlay = skyOverlayFor(dayPhase, phase);
  if (overlay) {
    bg = overlay.bg + ", " + bg;
    props = props.concat([overlay.wash]);
    if (dayPhase === "night" && phase < 4) {
      // Above the wash so they glow: extra stars (own rand stream, so the
      // base scene layout is untouched) and the moon where the sun was.
      var nrand = makeRand((seed ^ (phase * 0x9e3779b9)) >>> 0, 13);
      props = props.concat(stars(nrand, 14), moonDisc(203, 20, 8.5));
    }
  }
  return {
    bg: bg,
    props: props,
  };
}

// ---------------------------------------------------------------------------
// Animations — injected once; disabled under prefers-reduced-motion.
// ---------------------------------------------------------------------------

var KANDY_CSS =
  // The shared TooltipContent always renders a small rotated-square arrow
  // (a direct span child wrapping an svg). On our full-bleed scene card it
  // reads as a stray floating square — hide it. :has() keeps the OTHER
  // direct span (Radix's visually-hidden a11y clone) intact.
  ".kandev-kandy-tooltip > span:has(> svg){display:none!important}" +
  // Dialog card at L size (248px design x 1.45 = ~360px) — zoom keeps every
  // vector crisp and scales hit-targets consistently. Phones keep 1.0 so the
  // card fits the viewport.
  ".kandev-kandy-dialogzoom{zoom:1.45}" +
  "@media (max-width: 480px){.kandev-kandy-dialogzoom{zoom:1}}" +
  "@keyframes kandev-kandy-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}" +
  "@keyframes kandev-kandy-bobsad{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.7px)}}" +
  "@keyframes kandev-kandy-blink{0%,90%,100%{transform:scaleY(1)}93%,96%{transform:scaleY(0.08)}}" +
  "@keyframes kandev-kandy-wiggle{0%,86%,100%{transform:rotate(0deg)}90%{transform:rotate(-4deg)}94%{transform:rotate(4deg)}}" +
  "@keyframes kandev-kandy-hop{0%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}60%{transform:translateY(0)}80%{transform:translateY(-2px)}}" +
  "@keyframes kandev-kandy-flash{0%{opacity:0;transform:scale(0.4)}35%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(1.4)}}" +
  "@keyframes kandev-kandy-pulse{0%{box-shadow:0 0 0 0 rgba(255,209,102,0.9)}100%{box-shadow:0 0 0 9px rgba(255,209,102,0)}}" +
  // cardhop animates translateY ONLY. It must never carry a positional
  // translate: a transform animation REPLACES the element's base transform
  // for its duration, so any animated class has to live on a wrapper with
  // no layout transform (the outer positioning div owns translateX(-50%)).
  "@keyframes kandev-kandy-cardhop{0%,100%{transform:translateY(0)}18%{transform:translateY(-9px)}36%{transform:translateY(0)}52%{transform:translateY(-6px)}68%{transform:translateY(0)}84%{transform:translateY(-3px)}}" +
  "@keyframes kandev-kandy-burstpop{0%{opacity:0;transform:scale(0.3)}30%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(1.6) translateY(-9px)}}" +
  "@keyframes kandev-kandy-namehl{0%,100%{background:transparent}30%{background:rgba(255,209,102,0.5)}}" +
  "@keyframes kandev-kandy-heartfloat{0%{opacity:0;transform:translateY(4px) scale(0.6)}25%{opacity:1;transform:translateY(-6px) scale(1.05)}100%{opacity:0;transform:translateY(-26px) scale(1)}}" +
  // turnaway animates transform ONLY and lives on the same inner wrapper
  // as wiggle/cardhop — never on the outer positioning div (see the
  // layering rule at kandyCard).
  "@keyframes kandev-kandy-turnaway{0%,100%{transform:rotate(0)}20%,80%{transform:rotate(-9deg) translateX(-4px)}}" +
  // treatfall: gravity drop from above the head onto the contact point —
  // translateY(0) IS the catch pose (the treat is positioned on the
  // contact point), reached at 56% of 0.8s = ~450ms (TREAT_CATCH_MS syncs
  // the munch/crumbs/hearts to it) — then it's gobbled: shrink + fade.
  "@keyframes kandev-kandy-treatfall{0%{opacity:0;transform:translateY(-52px) rotate(-24deg);animation-timing-function:ease-in}10%{opacity:1;animation-timing-function:ease-in}56%{transform:translateY(0) rotate(6deg)}64%{opacity:1;transform:translateY(1px) rotate(6deg) scale(0.8)}100%{opacity:0;transform:translateY(2px) rotate(6deg) scale(0.15)}}" +
  // treatbounce (distrust): same fall, but nobody catches it — it hits at
  // 38% of 1.3s = ~495ms, bounces off the turned-away creature and rolls
  // aside, fading where it lies. The sad beat is the point.
  "@keyframes kandev-kandy-treatbounce{0%{opacity:0;transform:translate(0,-52px) rotate(-24deg);animation-timing-function:ease-in}8%{opacity:1;animation-timing-function:ease-in}38%{transform:translate(0,0) rotate(0deg);animation-timing-function:ease-out}56%{transform:translate(13px,-10px) rotate(62deg);animation-timing-function:ease-in}72%{transform:translate(21px,2px) rotate(104deg);animation-timing-function:ease-out}82%{transform:translate(25px,-2px) rotate(116deg);animation-timing-function:ease-in}90%{opacity:1;transform:translate(27px,2px) rotate(122deg)}100%{opacity:0;transform:translate(27px,2px) rotate(122deg)}}" +
  // munchhop: the happy catch — a quick squash, a hop, a settle. Transform
  // only, origin bottom-center (set on the class), delayed to the catch.
  "@keyframes kandev-kandy-munchhop{0%{transform:none}14%{transform:translateY(2px) scale(1.07,0.88)}38%{transform:translateY(-7px) scale(0.97,1.05)}58%{transform:translateY(0) scale(1.05,0.94)}76%{transform:translateY(-3px)}100%{transform:none}}" +
  // fleck: generic burst particle (treat crumbs, water splash) — out fast
  // to the peak (--kx/--ky), then a short gravity fall to (--fx/--fy).
  "@keyframes kandev-kandy-fleck{0%{opacity:0;transform:translate(0,0) scale(0.4);animation-timing-function:ease-out}12%{opacity:1}55%{opacity:1;transform:translate(var(--kx),var(--ky)) scale(1);animation-timing-function:ease-in}100%{opacity:0;transform:translate(var(--fx),var(--fy)) scale(0.85)}}" +
  // buckettip: swing in above the head, a small anticipation tilt, then
  // tip hard — rotate(-104deg) IS the pouring pose, reached at 28% of
  // 1.5s = ~420ms; the pour stream (delay 0.42s) starts exactly then.
  // Hold the pour, then right the empty bucket and whisk it away.
  "@keyframes kandev-kandy-buckettip{0%{opacity:0;transform:translateY(-14px) rotate(0deg)}10%{opacity:1;transform:translateY(0) rotate(-6deg)}19%{transform:rotate(-13deg)}28%{transform:rotate(-104deg)}72%{transform:rotate(-110deg)}86%{opacity:1;transform:rotate(-70deg) translateY(-3px)}100%{opacity:0;transform:rotate(-30deg) translateY(-12px)}}" +
  // pour: the water column grows from the lip to the head (~85ms after the
  // stream starts — POUR_HIT_MS syncs the splash/soak), holds, trails off.
  "@keyframes kandev-kandy-pour{0%{opacity:0;transform:scaleY(0)}9%{opacity:0.9;transform:scaleY(1)}72%{opacity:0.9;transform:scaleY(1)}100%{opacity:0;transform:scaleY(0.92) translateY(8px)}}" +
  "@keyframes kandev-kandy-splat{0%{opacity:0;transform:scale(0.2)}30%{opacity:0.85;transform:scale(1)}100%{opacity:0;transform:scale(1.6)}}" +
  "@keyframes kandev-kandy-drip{0%{opacity:0;transform:translateY(-2px)}22%{opacity:0.9}100%{opacity:0;transform:translateY(11px)}}" +
  // wettint: filter ONLY — a quick splash-white pop, then the soaked
  // state: darkened, slightly cold sheen that dries off. The 0% frame must
  // be filter:none: fill-mode both holds it through the sync delay.
  "@keyframes kandev-kandy-wettint{0%{filter:none}3%{filter:brightness(1.5) saturate(0.8)}10%{filter:brightness(0.8) saturate(1.15)}75%{filter:brightness(0.86) saturate(1.05)}100%{filter:none}}" +
  // shiver: transform ONLY — a decaying cold shudder while soaked.
  "@keyframes kandev-kandy-shiver{0%,100%{transform:translateX(0)}12%{transform:translateX(-1.7px) rotate(-1.2deg)}28%{transform:translateX(1.5px) rotate(1deg)}44%{transform:translateX(-1.2px)}60%{transform:translateX(1px)}76%{transform:translateX(-0.6px)}88%{transform:translateX(0.3px)}}" +
  "@keyframes kandev-kandy-dotsfade{0%{opacity:0;transform:translateY(2px)}25%{opacity:1}75%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}" +
  // zzz: a gentle looping rise-and-fade for the sleep bubble. Transform +
  // opacity only, on text elements positioned by x/y attributes (no layout
  // transform to clobber).
  "@keyframes kandev-kandy-zzz{0%,100%{opacity:0;transform:translateY(3px)}22%{opacity:0.9;transform:translateY(0)}60%{opacity:0.75;transform:translateY(-4px)}88%{opacity:0;transform:translateY(-7px)}}" +
  ".kandev-kandy-bob{animation:kandev-kandy-bob 2.8s ease-in-out infinite}" +
  ".kandev-kandy-bob-fast{animation-duration:1.6s}" +
  ".kandev-kandy-bob-slow{animation-duration:5.5s}" +
  ".kandev-kandy-bobsad{animation:kandev-kandy-bobsad 7s ease-in-out infinite}" +
  ".kandev-kandy-blink{animation:kandev-kandy-blink 4.6s ease-in-out infinite}" +
  ".kandev-kandy-wiggle{animation:kandev-kandy-wiggle 7s ease-in-out infinite;transform-origin:50% 70%}" +
  ".kandev-kandy-celebrate{animation:kandev-kandy-hop 0.8s ease}" +
  ".kandev-kandy-celebrate::after{content:\"\\2726\";position:absolute;top:-7px;right:-5px;font-size:11px;color:#ffd166;animation:kandev-kandy-flash 0.8s ease forwards;pointer-events:none}" +
  ".kandev-kandy-levelup{animation:kandev-kandy-hop 0.8s ease,kandev-kandy-pulse 1.4s ease}" +
  ".kandev-kandy-levelup::after{content:\"\\2726\";position:absolute;top:-8px;right:-6px;font-size:13px;color:#ffd166;animation:kandev-kandy-flash 1.2s ease forwards;pointer-events:none}" +
  ".kandev-kandy-cardhop{animation:kandev-kandy-cardhop 1.2s ease}" +
  ".kandev-kandy-burst{position:absolute;font-size:12px;color:#ffd166;animation:kandev-kandy-burstpop 1s ease forwards;pointer-events:none}" +
  ".kandev-kandy-namehl{animation:kandev-kandy-namehl 1.4s ease;border-radius:4px;padding:0 2px}" +
  // heartfloat: base opacity 0 + fill both — the hearts now start on a
  // delay (after the munch), so they must stay hidden until then.
  ".kandev-kandy-heartfloat{position:absolute;font-size:13px;color:#f43f5e;opacity:0;animation:kandev-kandy-heartfloat 1.4s ease both;pointer-events:none}" +
  // munch/soaked/turnaway must be declared AFTER wiggle: the animation
  // shorthand of the later single-class rule wins when both classes are
  // present. munch waits for the treat to land (delay = TREAT_CATCH_MS);
  // soaked waits for the water to hit (delay = POUR_HIT_MS); fill-mode
  // both holds the rest pose through the delay. All animate
  // transform/filter only — the layout transform stays on the outer
  // positioning div (see kandyCard).
  ".kandev-kandy-munch{animation:kandev-kandy-munchhop 0.7s ease 0.45s both;transform-origin:50% 100%}" +
  ".kandev-kandy-soaked{animation:kandev-kandy-wettint 1.9s ease 0.5s both,kandev-kandy-shiver 1.1s ease-in-out 0.9s both}" +
  ".kandev-kandy-turnaway{animation:kandev-kandy-turnaway 1.1s ease;transform-origin:50% 85%}" +
  // Overlay elements: base opacity 0 so nothing shows during their sync
  // delays — or at all under prefers-reduced-motion (animation:none
  // leaves the base state).
  ".kandev-kandy-treat{position:absolute;opacity:0;animation:kandev-kandy-treatfall 0.8s both;pointer-events:none}" +
  ".kandev-kandy-treat-ignored{position:absolute;opacity:0;animation:kandev-kandy-treatbounce 1.3s both;pointer-events:none}" +
  ".kandev-kandy-crumb{position:absolute;opacity:0;animation:kandev-kandy-fleck 0.55s ease-out both;pointer-events:none}" +
  ".kandev-kandy-bucket{position:absolute;opacity:0;animation:kandev-kandy-buckettip 1.5s ease both;pointer-events:none}" +
  ".kandev-kandy-pour{position:absolute;opacity:0;animation:kandev-kandy-pour 0.95s ease 0.42s both;transform-origin:50% 0;pointer-events:none}" +
  ".kandev-kandy-splat{position:absolute;opacity:0;animation:kandev-kandy-splat 0.5s ease 0.5s both;pointer-events:none}" +
  ".kandev-kandy-splashdrop{position:absolute;opacity:0;animation:kandev-kandy-fleck 0.6s ease-out both;pointer-events:none}" +
  ".kandev-kandy-drip{position:absolute;opacity:0;animation:kandev-kandy-drip 0.8s ease-in both;pointer-events:none}" +
  ".kandev-kandy-dots{position:absolute;font-size:15px;font-weight:700;opacity:0;letter-spacing:2px;animation:kandev-kandy-dotsfade 1.4s ease 0.35s both;pointer-events:none}" +
  // zzz base opacity 0 (they fade in through the loop); the lead z carries
  // a visible base opacity so reduced motion shows a static single z.
  ".kandev-kandy-zzz{opacity:0;animation:kandev-kandy-zzz 2.7s ease-in-out infinite}" +
  ".kandev-kandy-zzz-lead{opacity:0.85}" +
  ".kandev-kandy-control{transition-property:transform,background-color,box-shadow;transition-duration:150ms;transition-timing-function:ease-out}" +
  ".kandev-kandy-control:active:not(:disabled){transform:scale(0.96)}" +
  ".kandev-kandy-control:focus-visible{outline:2px solid var(--ring);outline-offset:2px}" +
  ".kandev-kandy-photo-entry-surface{transition-property:background-color,box-shadow;transition-duration:150ms;transition-timing-function:ease-out}" +
  ".kandev-kandy-photo-entry:hover .kandev-kandy-photo-entry-surface{background:color-mix(in oklch,var(--background) 94%,var(--foreground) 6%);box-shadow:0 0 0 1px color-mix(in oklch,var(--foreground) 10%,transparent),0 2px 6px rgba(0,0,0,0.10)}" +
  ".kandev-kandy-photo-panel:focus{outline:none}" +
  ".kandev-kandy-photo-panel:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}" +
  ".kandev-kandy-static,.kandev-kandy-static *{animation:none!important}" +
  "@media (prefers-reduced-motion: reduce){.kandev-kandy-bob,.kandev-kandy-bob-fast,.kandev-kandy-bob-slow,.kandev-kandy-bobsad,.kandev-kandy-blink,.kandev-kandy-wiggle,.kandev-kandy-celebrate,.kandev-kandy-celebrate::after,.kandev-kandy-levelup,.kandev-kandy-levelup::after,.kandev-kandy-cardhop,.kandev-kandy-burst,.kandev-kandy-namehl,.kandev-kandy-heartfloat,.kandev-kandy-munch,.kandev-kandy-soaked,.kandev-kandy-turnaway,.kandev-kandy-treat,.kandev-kandy-treat-ignored,.kandev-kandy-crumb,.kandev-kandy-bucket,.kandev-kandy-pour,.kandev-kandy-splat,.kandev-kandy-splashdrop,.kandev-kandy-drip,.kandev-kandy-dots,.kandev-kandy-zzz{animation:none}.kandev-kandy-control{transition:none}.kandev-kandy-photo-entry-surface{transition:none}.kandev-kandy-control:active:not(:disabled){transform:none}}";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  var el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = KANDY_CSS;
  document.head.appendChild(el);
}

function removeStyles() {
  var el = document.getElementById(STYLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// ---------------------------------------------------------------------------
// Hover card + top-bar widget.
// ---------------------------------------------------------------------------

var EGG_PLACEHOLDER = {
  level: 1,
  stage: 0,
  archetype: 0,
  family: 2,
  biome: 0,
  lineage_seed: 1,
  stage_name: "Egg",
  progress_pct: 0,
  appearance_seed: 1,
  mood: "content",
  award_seq: 0,
  flavor: "The egg is warm. Keep working.",
};

// ---------------------------------------------------------------------------
// Hearts mood meter + petting overlays.
// ---------------------------------------------------------------------------

var HEARTS_BY_MOOD = { elated: 5, happy: 5, content: 4, bored: 3, sad: 2, gloomy: 1 };
var HEART_PATH =
  "M5 8.8 C2.2 6.6 0.9 4.9 0.9 3.4 C0.9 2 2 1 3.3 1 C4 1 4.7 1.4 5 2 C5.3 1.4 6 1 6.7 1 C8 1 9.1 2 9.1 3.4 C9.1 4.9 7.8 6.6 5 8.8 Z";

// Bond meter — temperament as hearts (trust is what hearts are for): how
// the kandy has been TREATED, distinct from the mood badge (how fed it is).
var BOND_HEARTS_BY_BAND = { beloved: 5, content: 4, neutral: 3, wary: 2, fearful: 1 };

// bondHearts renders the trust meter: filled hearts by temperament band; a
// scarred kandy shows its last heart with a permanent crack, forever.
function bondHearts(h, band, scarred) {
  var filled = BOND_HEARTS_BY_BAND[band] || 3;
  var hearts = [];
  for (var i = 0; i < 5; i++) {
    var isCracked = scarred && i === 4;
    hearts.push(
      h(
        "svg",
        { key: "bond" + i, width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": "true" },
        h("path", {
          d: HEART_PATH,
          fill: i < filled ? "#f43f5e" : "none",
          stroke: "#f43f5e",
          strokeWidth: 0.9,
          opacity: i < filled ? 1 : 0.4,
        }),
        isCracked
          ? h("path", {
              // jagged crack down the middle of the last heart
              d: "M5 1.6 L4.2 3.4 L5.4 5 L4.4 6.8 L5.2 8.4",
              fill: "none",
              stroke: "#7f1d1d",
              strokeWidth: 0.8,
              strokeLinecap: "round",
            })
          : null,
      ),
    );
  }
  return h(
    "span",
    {
      role: "img",
      "aria-label": "bond: " + band + (scarred ? ", scarred" : ""),
      style: { display: "inline-flex", gap: "2px", alignItems: "center", flexShrink: 0 },
    },
    hearts,
  );
}

// Mood dot colors — warm when fed, cooling toward gray as it stagnates.
var MOOD_COLORS = {
  elated: "#f59e0b",
  happy: "#22c55e",
  content: "#38bdf8",
  bored: "#eab308",
  sad: "#60a5fa",
  gloomy: "#94a3b8",
};

// moodBadge — the mood indicator: a colored dot + the mood word (replaced
// the 5-hearts meter; the word says more than a heart count did).
function moodBadge(h, mood) {
  return h(
    "span",
    {
      role: "img",
      "aria-label": "mood: " + mood,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "10px",
        fontWeight: 600,
        padding: "1px 7px",
        borderRadius: "999px",
        background: "var(--muted)",
        textTransform: "capitalize",
        // flexShrink 0: sits in the header row next to a long stage name —
        // must never be squeezed into wrapping.
        flexShrink: 0,
        whiteSpace: "nowrap",
      },
    },
    h("span", {
      style: {
        width: "7px",
        height: "7px",
        borderRadius: "999px",
        background: MOOD_COLORS[mood] || MOOD_COLORS.content,
        display: "inline-block",
        flexShrink: 0,
      },
    }),
    mood,
  );
}

// ---------------------------------------------------------------------------
// Care overlays — the treat drop (pet) and the cold-water bucket (bonk).
// Both anchor every effect on bonkContactFor(data): the creature's true
// head/mouth point across stage scales and archetypes.
// ---------------------------------------------------------------------------

// TREAT_CATCH_MS: when the falling treat reaches the mouth — the treatfall
// keyframes put translateY(0) at 56% of 0.8s. The munch hop (CSS delay),
// crumbs, and hearts are all offset by this.
var TREAT_CATCH_MS = 450;

// POUR_HIT_MS: when the poured water reaches the head — the bucket tips at
// 420ms (28% of 1.5s) and the stream takes ~85ms to grow to the head. The
// splash, splat, soaked tint (CSS delay), and drips are offset by this.
var POUR_HIT_MS = 500;

// bonkContactFor — the effects' contact point in scene pixels, derived from
// the SAME values the renderer uses: the archetype builder's `top` anchor
// (the crown varies per archetype — a serpent's raised head, a sprite's
// hover height) and STAGE_SCALE scaling about the (50,88) anchor, so the
// treat and the water land on the head at every metamorphosis stage.
// Scene: 248x124 px; creature svg: 92px for viewBox 0 0 100 100, bottom-
// centered ~2px above the scene floor (plus the inline-svg baseline gap).
var BONK_SCENE = { w: 248, h: 124, svgPx: 92, bottomPx: 5 };

function bonkContactFor(data) {
  var vx = 50;
  var vy = 44; // egg: just under the shell's crown (cy 62 - ry 22 = 40)
  if (data && data.level > 1) {
    var lineage = (data.lineage_seed || 1) >>> 0;
    var g = growthForLevel(data.level);
    var sty = lineageStyle(lineage);
    var temper = temperFor(data);
    var C = lineageColors(data.family || 0, data.level, sty, temper);
    var arch =
      (((data.archetype || 0) % BODY_BUILDERS.length) + BODY_BUILDERS.length) % BODY_BUILDERS.length;
    // The builders only push h(...) results into arrays and never read
    // them back, so a no-op h recovers the geometry without rendering.
    var noop = function () {
      return null;
    };
    var body = BODY_BUILDERS[arch](noop, makeRand(lineage, 6), C, g);
    var s = STAGE_SCALE[g.stage];
    // Aim a touch below the crown so the hit reads "on the head", then
    // apply the renderer's scale-about-(50,88) transform.
    vx = 50 + (body.top.x - 50) * s;
    vy = 88 - (88 - (body.top.y + 3)) * s;
  }
  var k = BONK_SCENE.svgPx / 100;
  return {
    x: BONK_SCENE.w / 2 + (vx - 50) * k,
    y: BONK_SCENE.h - BONK_SCENE.bottomPx - (100 - vy) * k,
  };
}

// fleckSpan — one generic burst particle (treat crumb, water splash).
// d = [peakDx, peakDy, endDx, endDy, sizePx, tear?, color, extraDelayMs]:
// outward/upward burst to the peak, then a slight gravity fall (end below
// peak). Teardrops point back toward the contact point (opposite the
// travel direction): the sharp border-radius corner sits at -45deg, so
// rotate it onto the back-vector. Static transform lives on the INNER
// span — the animated outer span must carry no base transform.
function fleckSpan(h, key, cls, c, d, baseDelay) {
  var sz = d[4];
  var backDeg = (Math.atan2(-d[1], -d[0]) * 180) / Math.PI + 45;
  return h(
    "span",
    {
      key: key,
      className: cls,
      style: {
        left: c.x - sz / 2 + "px",
        top: c.y - sz / 2 + "px",
        width: sz + "px",
        height: sz + "px",
        animationDelay: baseDelay + d[7] + "ms",
        "--kx": d[0] + "px",
        "--ky": d[1] + "px",
        "--fx": d[2] + "px",
        "--fy": d[3] + "px",
      },
    },
    h("span", {
      style: {
        display: "block",
        width: "100%",
        height: "100%",
        background: d[6],
        borderRadius: d[5] ? "50% 0 50% 50%" : "50%",
        transform: d[5] ? "rotate(" + backDeg.toFixed(1) + "deg)" : "none",
      },
    }),
  );
}

// treatSvg — a cute ~10px berry: warm red-pink body, highlight, green leaf.
// Drawn centered on the contact point; the fall/bounce animation classes go
// on the svg itself (position via left/top only — no base transform).
function treatSvg(h, c, cls) {
  return h(
    "svg",
    {
      key: "treat",
      className: cls,
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      style: { left: c.x - 6 + "px", top: c.y - 6.5 + "px", overflow: "visible" },
      "aria-hidden": "true",
    },
    h("circle", { key: "tbody", cx: 6, cy: 7, r: 4.4, fill: "#e05c6e", stroke: "#a63446", strokeWidth: 1.1 }),
    h("circle", { key: "thi", cx: 4.5, cy: 5.7, r: 1.2, fill: "#ff9aa8", opacity: 0.95 }),
    h("path", { key: "tleaf", d: "M6 2.8 Q7.6 0.9 9.4 1.8 Q8 3.6 6 2.8 Z", fill: "#5fae53", stroke: "#4c8a3f", strokeWidth: 0.6 }),
  );
}

// Treat crumbs + a couple of sparkles at the catch moment.
var CRUMB_FLECKS = [
  [-10, -10, -13, -3, 2.5, 0, "#e8b04b", 0],
  [8, -12, 11, -5, 2, 0, "#c98a3e", 30],
  [-5, -15, -7, -8, 2, 0, "#f6d27e", 60],
  [12, -6, 15, 1, 2.5, 0, "#e8b04b", 20],
  [3, -9, 4, -2, 1.8, 0, "#ffffff", 80],
];

// 2-3 hearts, AFTER the munch — fewer than before, the treat is the star.
// [dx, dy, extraDelayMs] from the contact point.
var PET_HEART_SPOTS = [
  [-14, -22, 0],
  [10, -28, 150],
  [-2, -34, 300],
];

// petOverlay — the treat-drop reaction: a berry falls onto the mouth
// (bonkContactFor), the being munch-hops (CSS delay on the wrapper),
// crumbs pop at the catch, then a few hearts rise. seq keys the overlay so
// an in-window repeat click remounts it and the animations replay.
function petOverlay(h, seq, data) {
  var c = bonkContactFor(data);
  var kids = [treatSvg(h, c, "kandev-kandy-treat")];
  for (var i = 0; i < CRUMB_FLECKS.length; i++) {
    kids.push(fleckSpan(h, "crumb" + i, "kandev-kandy-crumb", c, CRUMB_FLECKS[i], TREAT_CATCH_MS));
  }
  PET_HEART_SPOTS.forEach(function (s, j) {
    kids.push(
      h(
        "span",
        {
          key: "petheart" + j,
          className: "kandev-kandy-heartfloat",
          style: {
            left: c.x + s[0] + "px",
            top: c.y + s[1] + "px",
            animationDelay: TREAT_CATCH_MS + 200 + s[2] + "ms",
          },
        },
        "♥",
      ),
    );
  });
  return h("div", { key: "petfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } }, kids);
}

// The bucket svg is drawn upright (rim up, handle over the top) and tips
// about its center. At the pouring pose (rotate(-104deg)) the rim's outer
// corner ends up at about (-6.4, +15.5) from the center, so BUCKET_OFF
// places the center so that tipped lip sits exactly on the pour stream's
// origin, straight above the contact point.
var BUCKET_OFF = { x: 7, y: -42 };

// Water splash at the pour's contact point: blues + one pale glint.
var SPLASH_FLECKS = [
  [-16, -12, -20, -2, 3, 1, "#7fd7ff", 0],
  [12, -16, 16, -6, 3, 1, "#38bdf8", 30],
  [-8, -20, -10, -10, 2.5, 1, "#bae6fd", 60],
  [20, -8, 25, 3, 2.5, 0, "#38bdf8", 40],
  [-24, -6, -29, 5, 2, 0, "#0ea5e9", 20],
  [5, -24, 6, -12, 3, 1, "#7fd7ff", 70],
  [26, -14, 32, -2, 2, 0, "#bae6fd", 90],
];

// Drips sliding off the soaked body: [halfWidthFrac, heightFrac,
// delayMs]. x spreads across the body width (scaled per stage), y sits
// between the head contact point and the scene floor.
var DRIP_SPOTS = [
  [-0.85, 0.45, 900],
  [-0.3, 0.75, 1250],
  [0.35, 0.55, 1450],
  [0.8, 0.8, 1650],
];

// bonkOverlay — the cold-water reaction: the bucket swings in, tips, pours
// a blue stream onto the head (bonkContactFor), the splash bursts at
// contact, and the being goes briefly soaked (wet tint + shiver via the
// CSS-delayed wrapper class) with drips falling off it.
function bonkOverlay(h, seq, data) {
  var c = bonkContactFor(data);
  var kids = [];
  kids.push(
    h(
      "svg",
      {
        key: "bucket",
        className: "kandev-kandy-bucket",
        width: 44,
        height: 44,
        viewBox: "0 0 44 44",
        style: {
          left: c.x + BUCKET_OFF.x - 22 + "px",
          top: c.y + BUCKET_OFF.y - 20 + "px",
          transformOrigin: "22px 20px",
          overflow: "visible",
        },
        "aria-hidden": "true",
      },
      h("path", { key: "bhandle", d: "M10 12 Q22 -1 34 12", stroke: "#5b7181", strokeWidth: 2, fill: "none" }),
      h("path", { key: "bbody", d: "M10 12 L34 12 L30 32 L14 32 Z", fill: "#8fa7b8", stroke: "#5b7181", strokeWidth: 1.6 }),
      h("ellipse", { key: "bwater", cx: 22, cy: 12.5, rx: 10.5, ry: 2.2, fill: "#7fd7ff" }),
      h("rect", { key: "brim", x: 8.5, y: 10, width: 27, height: 3.6, rx: 1.8, fill: "#a9bfcc", stroke: "#5b7181", strokeWidth: 1.2 }),
      h("line", { key: "bband", x1: 12.6, y1: 23, x2: 31.4, y2: 23, stroke: "#7d94a5", strokeWidth: 1.4 }),
    ),
  );
  // Pour stream: from the tipped lip (BUCKET_OFF math above puts it at
  // ~(c.x, c.y-26.5)) straight down onto the head. Grows from the top
  // (transform-origin 50% 0), delay synced to the tip pose.
  kids.push(
    h("span", {
      key: "pour",
      className: "kandev-kandy-pour",
      style: {
        left: c.x - 2.5 + "px",
        top: c.y - 26 + "px",
        width: "5px",
        height: "27px",
        borderRadius: "3px",
        background: "linear-gradient(180deg,#bae6fd,#38bdf8 55%,#0ea5e9)",
      },
    }),
  );
  // Splat: a low white flash where the water lands.
  kids.push(
    h("span", {
      key: "splat",
      className: "kandev-kandy-splat",
      style: {
        left: c.x - 9 + "px",
        top: c.y - 3 + "px",
        width: "18px",
        height: "6px",
        borderRadius: "50%",
        background: "#e0f2fe",
      },
    }),
  );
  for (var i = 0; i < SPLASH_FLECKS.length; i++) {
    kids.push(fleckSpan(h, "splash" + i, "kandev-kandy-splashdrop", c, SPLASH_FLECKS[i], POUR_HIT_MS));
  }
  // Drips: spread by the being's actual half-width at its stage scale so
  // hatchlings don't drip from thin air.
  var halfW = 15;
  if (data && data.level > 1) {
    halfW = 24 * STAGE_SCALE[growthForLevel(data.level).stage];
  }
  var floorY = BONK_SCENE.h - BONK_SCENE.bottomPx;
  DRIP_SPOTS.forEach(function (s, j) {
    var sz = 3;
    kids.push(
      h(
        "span",
        {
          key: "drip" + j,
          className: "kandev-kandy-drip",
          style: {
            left: c.x + s[0] * halfW * (BONK_SCENE.svgPx / 100) - sz / 2 + "px",
            top: c.y + (floorY - c.y) * s[1] + "px",
            width: sz + "px",
            height: sz + 1 + "px",
            animationDelay: s[2] + "ms",
          },
        },
        h("span", {
          style: {
            display: "block",
            width: "100%",
            height: "100%",
            background: "#38bdf8",
            borderRadius: "50% 0 50% 50%",
            // Tail up: the square corner (top-right) rotated to 12 o'clock.
            transform: "rotate(-45deg)",
          },
        }),
      ),
    );
  });
  return h("div", { key: "bonkfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } }, kids);
}

// distrustOverlay — the refused-pet reaction: the treat still falls, but
// the kandy turns away (wrapper class) and lets it bounce off, landing
// ignored. No munch, no crumbs, no hearts — just a "..." bubble.
function distrustOverlay(h, seq, data) {
  return h(
    "div",
    { key: "distrustfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    treatSvg(h, bonkContactFor(data), "kandev-kandy-treat-ignored"),
    h("span", { key: "dots", className: "kandev-kandy-dots", style: { left: "58%", top: "20%" } }, "…"),
  );
}

// sleepyPetOverlay — petting a sleeping kandy: the treat still falls (the
// POST and mechanics behave exactly as awake — server untouched), but the
// reaction is a half-woken grumpy squint on the creature (sleep_state
// "grumpy" via kandyCard) with no munch hop, no crumbs, and one subdued
// heart. It's asleep, not delighted.
function sleepyPetOverlay(h, seq, data) {
  var c = bonkContactFor(data);
  return h(
    "div",
    { key: "sleepyfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    treatSvg(h, c, "kandev-kandy-treat"),
    h(
      "span",
      {
        key: "sleepyheart",
        className: "kandev-kandy-heartfloat",
        style: {
          left: c.x - 4 + "px",
          top: c.y - 26 + "px",
          fontSize: "11px",
          animationDelay: TREAT_CATCH_MS + 250 + "ms",
        },
      },
      "♥",
    ),
  );
}

// burstSparkles renders the celebration particle burst over the scene.
var BURST_SPOTS = [
  [30, 30], [66, 18], [50, 55], [78, 45], [20, 60], [60, 72], [40, 12], [82, 68],
];

function burstSparkles(h, big) {
  var count = big ? 8 : 6;
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(
      h(
        "span",
        {
          key: "burst" + i,
          className: "kandev-kandy-burst",
          style: {
            left: BURST_SPOTS[i][0] + "%",
            top: BURST_SPOTS[i][1] + "%",
            animationDelay: (i % 4) * 90 + "ms",
          },
        },
        "✦",
      ),
    );
  }
  return h("div", { key: "burstwrap", style: { position: "absolute", inset: 0, pointerEvents: "none" } }, out);
}

// ---------------------------------------------------------------------------
// Photo Booth — a dedicated, static SVG artboard. Clipboard copy rasterizes
// this SVG only: no app DOM, task text, account data, upload, or external service.
// ---------------------------------------------------------------------------

var PHOTO_VIEWBOX = { width: 800, height: 1000 };
var PHOTO_EXPORT = { width: 1600, height: 2000, mimeType: "image/png" };
var PHOTO_HABITATS = ["Verdant", "Aquatic", "Alpine", "Ember"];
var PHOTO_MOODS = { elated: true, happy: true, content: true, bored: true, sad: true, gloomy: true };
var PHOTO_TEMPERAMENTS = { beloved: true, content: true, neutral: true, wary: true, fearful: true };

function photoInt(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? Math.floor(n) : fallback;
}

function photoLabel(value) {
  var s = String(value || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// photoModelFor is an explicit allowlist. The webhook response may grow over
// time, but portrait output can only see the presentation fields below. In
// particular, raw temperament, XP bookkeeping, flavor timestamps, and host
// data have no path into the shareable image.
function photoModelFor(data, timeOfDay) {
  data = data || EGG_PLACEHOLDER;
  var level = Math.max(photoInt(data.level, 1), 1);
  var archetype = photoInt(data.archetype, 0);
  var family = photoInt(data.family, 0);
  var biome = ((photoInt(data.biome, 0) % PHOTO_HABITATS.length) + PHOTO_HABITATS.length) % PHOTO_HABITATS.length;
  var lineageSeed = photoInt(data.lineage_seed, 1) >>> 0;
  if (!lineageSeed) lineageSeed = 1;
  var stageName = typeof data.stage_name === "string" ? data.stage_name.trim().slice(0, 80) : "";
  if (!stageName) stageName = "Kandy";
  var mood = PHOTO_MOODS[data.mood] ? data.mood : "content";
  var temperamentBand = PHOTO_TEMPERAMENTS[data.temperament_band]
    ? data.temperament_band
    : "neutral";
  var dayPhase = dayPhaseFor(timeOfDay);
  return {
    level: level,
    archetype: archetype,
    family: family,
    biome: biome,
    lineageSeed: lineageSeed,
    stageName: stageName,
    mood: mood,
    temperamentBand: temperamentBand,
    scarred: !!data.scarred,
    dayPhase: dayPhase,
    habitat: PHOTO_HABITATS[biome],
    sleepState: level > 1 && isAsleep(lineageSeed, timeOfDay) ? "asleep" : null,
  };
}

function photoExportPlan() {
  return { width: PHOTO_EXPORT.width, height: PHOTO_EXPORT.height, mimeType: PHOTO_EXPORT.mimeType };
}

// Fixed SVG colors make the exported file self-contained. Theme variables
// remain useful for the surrounding dialog, but never leak into the image or
// disappear when a standalone PNG is opened elsewhere.
function photoPaletteFor(theme) {
  if (theme === "dark") {
    return {
      background: "#090e1a",
      surface: "#151d2e",
      text: "#f8fafc",
      muted: "#b7c0d1",
      accent: "#f4c96f",
      chip: "#242f47",
      divider: "#344058",
      outline: "rgba(255,255,255,0.10)",
    };
  }
  return {
    background: "#eee6da",
    surface: "#fffdf9",
    text: "#28202d",
    muted: "#675f6d",
    accent: "#9a641c",
    chip: "#f2ece4",
    divider: "#ddd2c5",
    outline: "rgba(0,0,0,0.10)",
  };
}

function currentPhotoTheme() {
  if (
    typeof document !== "undefined" &&
    document.documentElement &&
    document.documentElement.classList &&
    document.documentElement.classList.contains("dark")
  ) {
    return "dark";
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function photoPhaseHour(dayPhase) {
  if (dayPhase === "dawn") return 7;
  if (dayPhase === "dusk") return 19;
  if (dayPhase === "night") return 1;
  return TIME_OF_DAY_DEFAULT;
}

function photoSceneStops(scene) {
  var colors = String((scene && scene.bg) || "").match(/#[0-9a-f]{6}/gi) || [];
  if (colors.length >= 3) return colors.slice(-3);
  return ["#b9dcea", "#9bc78d", "#659e65"];
}

function photoNameSize(stageName) {
  var n = stageName.length;
  if (n <= 16) return 50;
  if (n <= 22) return 44;
  if (n <= 30) return 38;
  return 34;
}

function photoHeart(h, key, x, filled, cracked, palette) {
  return h(
    "g",
    { key: key, transform: "translate(" + x + " 856) scale(3.2)" },
    h("path", {
      d: HEART_PATH,
      fill: filled ? "#f43f5e" : "none",
      stroke: filled ? "#e11d48" : palette.muted,
      strokeWidth: 0.9,
      opacity: filled ? 1 : 0.42,
    }),
    cracked
      ? h("path", {
          d: "M5 1.6 L4.2 3.4 L5.4 5 L4.4 6.8 L5.2 8.4",
          fill: "none",
          stroke: "#7f1d1d",
          strokeWidth: 0.8,
          strokeLinecap: "round",
        })
      : null,
  );
}

function photoPortraitSvg(h, model, theme, svgRef) {
  var palette = photoPaletteFor(theme);
  var renderData = {
    level: model.level,
    archetype: model.archetype,
    family: model.family,
    biome: model.biome,
    lineage_seed: model.lineageSeed,
    stage_name: model.stageName,
    mood: model.mood,
    temperament_band: model.temperamentBand,
    scarred: model.scarred,
  };
  if (model.sleepState) renderData.sleep_state = model.sleepState;
  var scene = sceneFor(model.biome, model.level, model.lineageSeed, photoPhaseHour(model.dayPhase));
  var stops = photoSceneStops(scene);
  var key = "kandy-photo-" + model.lineageSeed + "-" + model.level;
  var skyID = key + "-sky";
  var clipID = key + "-clip";
  var filled = BOND_HEARTS_BY_BAND[model.temperamentBand] || 3;
  var hearts = [];
  for (var i = 0; i < 5; i++) {
    hearts.push(photoHeart(h, "photo-heart-" + i, 82 + i * 46, i < filled, model.scarred && i === 4, palette));
  }
  var aria =
    "Photo Booth portrait of " +
    model.stageName +
    ", level " +
    model.level +
    ", mood " +
    model.mood +
    ", " +
    model.temperamentBand +
    " bond, " +
    model.habitat +
    " habitat at " +
    model.dayPhase;
  return h(
    "svg",
    {
      ref: svgRef,
      xmlns: "http://www.w3.org/2000/svg",
      width: PHOTO_VIEWBOX.width,
      height: PHOTO_VIEWBOX.height,
      viewBox: "0 0 800 1000",
      role: "img",
      "aria-label": aria,
      className: "kandev-kandy-static",
      style: {
        display: "block",
        width: "100%",
        height: "auto",
        background: palette.background,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
        WebkitFontSmoothing: "antialiased",
      },
    },
    h("title", { id: key + "-title" }, model.stageName + " — Kandy Photo Booth"),
    h(
      "desc",
      { id: key + "-desc" },
      "A local portrait showing current Kandy appearance, habitat, level, mood, and bond.",
    ),
    h(
      "defs",
      null,
      h(
        "linearGradient",
        { id: skyID, x1: "0", y1: "0", x2: "0", y2: "1" },
        h("stop", { offset: "0%", stopColor: stops[0] }),
        h("stop", { offset: "56%", stopColor: stops[1] }),
        h("stop", { offset: "100%", stopColor: stops[2] }),
      ),
      h("clipPath", { id: clipID }, h("rect", { x: 52, y: 52, width: 696, height: 516, rx: 28 })),
    ),
    h("rect", { width: 800, height: 1000, fill: palette.background }),
    h("rect", {
      x: 28,
      y: 28,
      width: 744,
      height: 944,
      rx: 52,
      fill: palette.surface,
      stroke: palette.outline,
      strokeWidth: 2,
    }),
    h(
      "g",
      { clipPath: "url(#" + clipID + ")" },
      h("rect", { x: 52, y: 52, width: 696, height: 516, fill: "url(#" + skyID + ")" }),
      h(
        "svg",
        {
          x: 52,
          y: 52,
          width: 696,
          height: 516,
          viewBox: "0 0 240 120",
          preserveAspectRatio: "xMidYMid slice",
          "aria-hidden": "true",
        },
        scene.props,
        h("g", { transform: "translate(70 14)" }, creatureParts(h, renderData, false)),
      ),
    ),
    h("rect", {
      x: 52,
      y: 52,
      width: 696,
      height: 516,
      rx: 28,
      fill: "none",
      stroke: palette.outline,
      strokeWidth: 2,
    }),
    h(
      "text",
      { x: 80, y: 620, fill: palette.accent, fontSize: 15, fontWeight: 750, letterSpacing: 3.2 },
      "KANDY PHOTO BOOTH",
    ),
    h(
      "text",
      {
        x: 80,
        y: 686,
        fill: palette.text,
        fontSize: photoNameSize(model.stageName),
        fontWeight: 760,
        letterSpacing: -1.2,
      },
      model.stageName,
    ),
    h("rect", { x: 620, y: 640, width: 98, height: 54, rx: 27, fill: palette.chip }),
    h(
      "text",
      {
        x: 669,
        y: 675,
        fill: palette.text,
        fontSize: 22,
        fontWeight: 700,
        textAnchor: "middle",
        style: { fontVariantNumeric: "tabular-nums" },
      },
      "Lv " + model.level,
    ),
    h("rect", { x: 80, y: 724, width: 176, height: 48, rx: 24, fill: palette.chip }),
    h("circle", { cx: 105, cy: 748, r: 7, fill: MOOD_COLORS[model.mood] || MOOD_COLORS.content }),
    h(
      "text",
      { x: 124, y: 756, fill: palette.text, fontSize: 20, fontWeight: 650 },
      photoLabel(model.mood),
    ),
    h("rect", { x: 274, y: 724, width: 310, height: 48, rx: 24, fill: palette.chip }),
    h(
      "text",
      { x: 298, y: 756, fill: palette.muted, fontSize: 19, fontWeight: 600 },
      model.habitat + " · " + photoLabel(model.dayPhase),
    ),
    h("line", { x1: 80, y1: 804, x2: 720, y2: 804, stroke: palette.divider, strokeWidth: 2 }),
    h("text", { x: 80, y: 842, fill: palette.muted, fontSize: 18, fontWeight: 650 }, "Bond"),
    h(
      "text",
      { x: 720, y: 842, fill: palette.muted, fontSize: 18, fontWeight: 650, textAnchor: "end" },
      photoLabel(model.temperamentBand) + (model.scarred ? " · Scarred" : ""),
    ),
    hearts,
    h(
      "text",
      { x: 80, y: 934, fill: palette.muted, fontSize: 15, fontWeight: 550, letterSpacing: 0.4 },
      "Raised in Kandev.",
    ),
  );
}

function stopPhotoControlEvent(event) {
  if (event && event.stopPropagation) event.stopPropagation();
}

function cameraIcon(h) {
  return h(
    "svg",
    {
      width: 17,
      height: 17,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      "data-icon": "camera",
    },
    h("path", {
      d: "M8.25 6.5 9.4 4.75h5.2l1.15 1.75H19A2.25 2.25 0 0 1 21.25 8.75v8A2.25 2.25 0 0 1 19 19H5a2.25 2.25 0 0 1-2.25-2.25v-8A2.25 2.25 0 0 1 5 6.5h3.25Z",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
    h("circle", {
      cx: 12,
      cy: 12.5,
      r: 3.35,
      stroke: "currentColor",
      strokeWidth: 1.6,
    }),
  );
}

function photoBoothButton(h, onOpen, buttonRef) {
  return h(
    "button",
    {
      type: "button",
      ref: buttonRef,
      "aria-label": "Open Kandy Photo Booth",
      title: "Photo Booth",
      className: "kandev-kandy-control kandev-kandy-photo-entry",
      onPointerDown: stopPhotoControlEvent,
      onContextMenu: stopPhotoControlEvent,
      onClick: function (event) {
        stopPhotoControlEvent(event);
        onOpen();
      },
      style: {
        width: "40px",
        height: "40px",
        minHeight: "40px",
        minWidth: "40px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "none",
        borderRadius: "10px",
        background: "transparent",
        color: "inherit",
        boxShadow: "none",
        cursor: "pointer",
      },
    },
    h(
      "span",
      {
        className: "kandev-kandy-photo-entry-surface",
        style: {
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          background: "color-mix(in oklch,var(--background) 86%,transparent)",
          boxShadow:
            "0 0 0 1px color-mix(in oklch,var(--foreground) 7%,transparent),0 1px 4px rgba(0,0,0,0.08)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        },
      },
      cameraIcon(h),
    ),
  );
}

function renderPhotoPng(svgNode, suppliedEnv) {
  return new Promise(function (resolve, reject) {
    if (!svgNode) {
      reject(new Error("Photo portrait is not ready."));
      return;
    }
    var env = suppliedEnv || {};
    var root = typeof window !== "undefined" ? window : {};
    var doc = env.document || (typeof document !== "undefined" ? document : null);
    var URLAPI = env.URL || root.URL;
    var BlobCtor = env.Blob || root.Blob;
    var ImageCtor = env.Image || root.Image;
    var Serializer = env.XMLSerializer || root.XMLSerializer;
    if (!doc || !URLAPI || !BlobCtor || !ImageCtor || !Serializer) {
      reject(new Error("PNG rendering is not available in this browser."));
      return;
    }

    var svgURL = null;
    try {
      var source = new Serializer().serializeToString(svgNode);
      if (source.indexOf("xmlns=") < 0) {
        source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      var svgBlob = new BlobCtor([source], { type: "image/svg+xml;charset=utf-8" });
      svgURL = URLAPI.createObjectURL(svgBlob);
      var image = new ImageCtor();
      image.decoding = "async";
      image.onerror = function () {
        if (svgURL) URLAPI.revokeObjectURL(svgURL);
        svgURL = null;
        reject(new Error("Photo portrait could not be rendered."));
      };
      image.onload = function () {
        if (svgURL) URLAPI.revokeObjectURL(svgURL);
        svgURL = null;
        try {
          var canvas = doc.createElement("canvas");
          canvas.width = PHOTO_EXPORT.width;
          canvas.height = PHOTO_EXPORT.height;
          var context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable.");
          context.drawImage(image, 0, 0, PHOTO_EXPORT.width, PHOTO_EXPORT.height);
          canvas.toBlob(function (pngBlob) {
            if (!pngBlob) {
              reject(new Error("PNG encoding failed."));
              return;
            }
            resolve(pngBlob);
          }, PHOTO_EXPORT.mimeType);
        } catch (error) {
          reject(error);
        }
      };
      image.src = svgURL;
    } catch (error) {
      if (svgURL) URLAPI.revokeObjectURL(svgURL);
      reject(error);
    }
  });
}

function copyPhotoBlob(pngBlob, suppliedEnv) {
  var env = suppliedEnv || {};
  var root = typeof window !== "undefined" ? window : {};
  var ClipboardItemCtor = env.ClipboardItem || root.ClipboardItem;
  var clipboard = env.clipboard || (root.navigator && root.navigator.clipboard);
  if (!ClipboardItemCtor || !clipboard || typeof clipboard.write !== "function") {
    var unsupported = new Error("Image copying is not available in this browser.");
    unsupported.name = "NotSupportedError";
    return Promise.reject(unsupported);
  }
  if (!pngBlob || pngBlob.type !== PHOTO_EXPORT.mimeType) {
    var invalid = new Error("A rendered PNG is required.");
    invalid.name = "NotSupportedError";
    return Promise.reject(invalid);
  }
  if (
    typeof ClipboardItemCtor.supports === "function" &&
    !ClipboardItemCtor.supports(PHOTO_EXPORT.mimeType)
  ) {
    var unsupportedType = new Error("This browser cannot copy PNG images.");
    unsupportedType.name = "NotSupportedError";
    return Promise.reject(unsupportedType);
  }

  var content = {};
  content[PHOTO_EXPORT.mimeType] = pngBlob;
  try {
    return Promise.resolve(clipboard.write([new ClipboardItemCtor(content)]));
  } catch (error) {
    return Promise.reject(error);
  }
}

function notSupportedPhotoCopy(message) {
  var error = new Error(message);
  error.name = "NotSupportedError";
  return error;
}

function disposePreparedPhoto(prepared, suppliedEnv) {
  if (!prepared || prepared.disposed) return;
  prepared.disposed = true;
  var env = suppliedEnv || {};
  var root = typeof window !== "undefined" ? window : {};
  var doc = env.document || (typeof document !== "undefined" ? document : null);
  var URLAPI = env.URL || root.URL;
  if (prepared.frame) {
    prepared.frame.onload = null;
    prepared.frame.onerror = null;
    var parent = prepared.frame.parentNode || (doc && doc.body);
    if (parent && typeof parent.removeChild === "function") {
      try {
        parent.removeChild(prepared.frame);
      } catch (error) {
        /* already removed */
      }
    }
  }
  if (prepared.url && URLAPI && typeof URLAPI.revokeObjectURL === "function") {
    URLAPI.revokeObjectURL(prepared.url);
  }
}

function preparePhotoCopy(pngBlob, suppliedEnv) {
  var env = suppliedEnv || {};
  var root = typeof window !== "undefined" ? window : {};
  var secure =
    Object.prototype.hasOwnProperty.call(env, "isSecureContext") === true
      ? env.isSecureContext
      : root.isSecureContext;
  var ClipboardItemCtor = env.ClipboardItem || root.ClipboardItem;
  var clipboard = env.clipboard || (root.navigator && root.navigator.clipboard);
  if (
    secure !== false &&
    ClipboardItemCtor &&
    clipboard &&
    typeof clipboard.write === "function"
  ) {
    return Promise.resolve({ method: "clipboard", pngBlob: pngBlob, disposed: false });
  }

  var doc = env.document || (typeof document !== "undefined" ? document : null);
  var URLAPI = env.URL || root.URL;
  if (
    !pngBlob ||
    pngBlob.type !== PHOTO_EXPORT.mimeType ||
    !doc ||
    !doc.body ||
    typeof doc.createElement !== "function" ||
    !URLAPI ||
    typeof URLAPI.createObjectURL !== "function"
  ) {
    return Promise.reject(notSupportedPhotoCopy("Image copying is not available on this page."));
  }

  return new Promise(function (resolve, reject) {
    var prepared = {
      method: "image-document",
      pngBlob: pngBlob,
      frame: null,
      url: null,
      disposed: false,
    };
    try {
      var frame = doc.createElement("iframe");
      prepared.frame = frame;
      prepared.url = URLAPI.createObjectURL(pngBlob);
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.style.position = "fixed";
      frame.style.left = "-10000px";
      frame.style.top = "0";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.border = "0";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";
      frame.onload = function () {
        if (
          !frame.contentDocument ||
          frame.contentDocument.contentType !== PHOTO_EXPORT.mimeType
        ) {
          disposePreparedPhoto(prepared, env);
          reject(notSupportedPhotoCopy("The PNG copy surface could not be prepared."));
          return;
        }
        resolve(prepared);
      };
      frame.onerror = function () {
        disposePreparedPhoto(prepared, env);
        reject(notSupportedPhotoCopy("The PNG copy surface could not be prepared."));
      };
      frame.src = prepared.url;
      doc.body.appendChild(frame);
    } catch (error) {
      disposePreparedPhoto(prepared, env);
      reject(error);
    }
  });
}

function copyPreparedPhoto(prepared, suppliedEnv) {
  if (!prepared || prepared.disposed) {
    return Promise.reject(notSupportedPhotoCopy("The prepared image is no longer available."));
  }
  if (prepared.method === "clipboard") {
    return copyPhotoBlob(prepared.pngBlob, suppliedEnv);
  }
  if (
    prepared.method !== "image-document" ||
    !prepared.frame ||
    !prepared.frame.contentWindow ||
    !prepared.frame.contentDocument ||
    prepared.frame.contentDocument.contentType !== PHOTO_EXPORT.mimeType ||
    typeof prepared.frame.contentDocument.execCommand !== "function"
  ) {
    return Promise.reject(notSupportedPhotoCopy("Image copying is not available in this browser."));
  }

  var env = suppliedEnv || {};
  var doc = env.document || (typeof document !== "undefined" ? document : null);
  var activeElement = doc && doc.activeElement;
  try {
    prepared.frame.contentWindow.focus();
    if (!prepared.frame.contentDocument.execCommand("copy")) {
      throw notSupportedPhotoCopy("The browser refused to copy the image.");
    }
  } catch (error) {
    return Promise.reject(error);
  } finally {
    if (activeElement && typeof activeElement.focus === "function") {
      try {
        activeElement.focus({ preventScroll: true });
      } catch (error) {
        activeElement.focus();
      }
    }
  }
  return Promise.resolve();
}

function photoCopyFailureStatus(error) {
  if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "blocked";
  }
  if (error && error.name === "NotSupportedError") return "unsupported";
  return "error";
}

function copyIcon(h) {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
    h("rect", {
      x: 8,
      y: 8,
      width: 11,
      height: 11,
      rx: 2.5,
      stroke: "currentColor",
      strokeWidth: 1.8,
    }),
    h("path", {
      d: "M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
    }),
  );
}

function backIcon(h) {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
    h("path", {
      d: "M15 5 8 12l7 7",
      stroke: "currentColor",
      strokeWidth: 1.9,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function photoDialogButton(h, label, icon, onPress, primary, disabled, accessibleLabel, busy) {
  return h(
    "button",
    {
      type: "button",
      "aria-label": accessibleLabel || label,
      "aria-busy": busy ? "true" : undefined,
      disabled: !!disabled,
      className: "kandev-kandy-control",
      onPointerDown: stopPhotoControlEvent,
      onContextMenu: stopPhotoControlEvent,
      onClick: function (event) {
        stopPhotoControlEvent(event);
        if (!disabled) onPress();
      },
      style: {
        minHeight: "40px",
        flex: primary ? "1 1 auto" : "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: primary ? "0 14px 0 16px" : "0 12px 0 10px",
        border: "none",
        borderRadius: "10px",
        background: primary ? "var(--primary)" : "var(--muted)",
        color: primary ? "var(--primary-foreground)" : "inherit",
        boxShadow: primary
          ? "0 1px 2px rgba(0,0,0,0.12),0 0 0 1px color-mix(in oklch,var(--primary) 78%,black)"
          : "0 0 0 1px color-mix(in oklch,var(--foreground) 8%,transparent)",
        cursor: disabled || busy ? "wait" : "pointer",
        opacity: disabled ? 0.72 : 1,
        fontSize: "12px",
        fontWeight: 650,
      },
    },
    icon,
    label,
  );
}

function photoBoothPanel(h, DialogTitle, model, theme, svgRef, panelRef, status, onBack, onCopy) {
  var palette = photoPaletteFor(theme);
  var statusText = "Copies a PNG to your clipboard. Nothing is uploaded.";
  if (status === "preparing") statusText = "Preparing a crisp image…";
  else if (status === "copying") statusText = "Copying image…";
  else if (status === "copied") statusText = "Copied to clipboard.";
  else if (status === "blocked")
    statusText = "Clipboard access was blocked. Allow it in site settings, then try again.";
  else if (status === "unsupported") statusText = "This browser cannot copy PNG images.";
  else if (status === "render-error")
    statusText = "Could not prepare the image. Reopen Photo Booth and try again.";
  else if (status === "error") statusText = "Could not copy the image. Try again.";
  var copyDisabled = status === "preparing" || status === "render-error";
  var copyBusy = status === "preparing" || status === "copying";
  var failed =
    status === "blocked" ||
    status === "unsupported" ||
    status === "render-error" ||
    status === "error";
  return h(
    "div",
    {
      ref: panelRef,
      tabIndex: -1,
      role: "region",
      "aria-label": "Kandy Photo Booth",
      className: "kandev-kandy-photo-panel",
      style: {
        width: "min(388px, calc(100vw - 32px))",
        padding: "16px",
        WebkitFontSmoothing: "antialiased",
      },
    },
    h(
      "div",
      { style: { padding: "2px 2px 12px" } },
      h(
        DialogTitle,
        { style: { fontSize: "16px", fontWeight: 700, lineHeight: 1.25, textWrap: "balance" } },
        "Kandy Photo Booth",
      ),
      h(
        "p",
        {
          style: {
            margin: "4px 0 0",
            fontSize: "11px",
            lineHeight: 1.45,
            opacity: 0.65,
            textWrap: "pretty",
          },
        },
        "A private snapshot of this Kandy — rendered here, never uploaded.",
      ),
    ),
    h(
      "div",
      {
        style: {
          borderRadius: "16px",
          overflow: "hidden",
          background: palette.background,
          boxShadow:
            "0 0 0 1px " + palette.outline + ",0 1px 2px -1px rgba(0,0,0,0.08),0 8px 24px rgba(0,0,0,0.08)",
        },
      },
      photoPortraitSvg(h, model, theme, svgRef),
    ),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px", paddingTop: "14px" } },
      photoDialogButton(h, "Back to Kandy", backIcon(h), onBack, false, false),
      photoDialogButton(
        h,
        status === "preparing"
          ? "Preparing image"
          : status === "copying"
            ? "Copying image"
            : "Copy image",
        copyIcon(h),
        onCopy,
        true,
        copyDisabled,
        "Copy image to clipboard",
        copyBusy,
      ),
    ),
    h(
      "div",
      {
        role: "status",
        "aria-live": "polite",
        style: {
          minHeight: "17px",
          padding: "7px 2px 0",
          fontSize: "10px",
          lineHeight: 1.4,
          opacity: failed ? 0.9 : 0.55,
          color: failed ? "var(--destructive)" : "inherit",
          textWrap: "pretty",
        },
      },
      statusText,
    ),
  );
}

// celebration: null, or {kind: "gain"|"levelup"} — joyful hops + sparkles;
// levelup also highlights the (new) stage name.
// care (dialog only): null, or {fx, onPet, hint, bonkFx, distrustFx,
// onBonk, onPointerDown} — a plain click/tap on the creature pets it
// (a treat drops, it munch-hops, crumbs + a few hearts); a desktop
// right-click bonks it with a bucket of cold water (pour + splash +
// soaked shiver); a pet during distrust turns it away and the treat
// bounces off ignored ("..."). fx/bonkFx/distrustFx are nonces so repeats
// replay their overlay. Petting and bonking NEVER feed or drain XP.
//
// Layering rule (the v0.7.0 jump-to-center bug): a CSS transform animation
// REPLACES the element's base transform for its whole duration, so the
// always-on wiggle (rotate keyframes) was dropping the centering
// translateX(-50%) and cardhop was momentarily restoring it — the creature
// snapped horizontally on every pet/celebration. The outer div now owns the
// layout transform and carries NO animated class; the inner element (a real
// pet button in the dialog, a plain div in the tooltip) carries the
// animated classes and NO base transform. munch/soaked/turnaway follow the
// same rule: animation classes on the inner wrapper only.
function kandyCard(h, data, celebration, care, timeOfDay) {
  // Sleep is computed here from the seeded schedule + the passed clock so
  // every card (tooltip and dialog) agrees. The bucket wakes it (the
  // existing drench choreography IS the rude awakening); a pet only
  // half-wakes it into the grumpy squint.
  var sleepState = null;
  if (data.level > 1 && isAsleep((data.lineage_seed || 1) >>> 0, timeOfDay)) {
    if (care && care.bonkFx) sleepState = null;
    else if (care && care.sleepyFx) sleepState = "grumpy";
    else sleepState = "asleep";
  }
  var shownData = sleepState ? Object.assign({}, data, { sleep_state: sleepState }) : data;
  var scene = sceneFor(data.biome || 0, data.level, (data.lineage_seed || 1) >>> 0, timeOfDay);
  var animCls = sleepState === "asleep" ? "" : "kandev-kandy-wiggle";
  if (care && care.bonkFx) animCls += " kandev-kandy-soaked";
  else if (care && care.distrustFx) animCls += " kandev-kandy-turnaway";
  else if (care && care.fx) animCls += " kandev-kandy-munch";
  else if (celebration) animCls += " kandev-kandy-cardhop";
  animCls = animCls.trim();
  var creature = creatureSvg(h, shownData, 92);
  var inner;
  if (care && care.onPet) {
    inner = h(
      "button",
      {
        id: "kandev-kandy-pet-zone",
        type: "button",
        "aria-label": "Pet your kandy",
        className: animCls,
        onClick: care.onPet,
        // Right-click = bonk (cold water). contextmenu is desktop-only
        // by policy: the handler checks the last pointer type and ignores
        // touch long-presses (see triggerBonk). It never also fires pet —
        // onClick only responds to the primary button.
        onContextMenu: function (e) {
          if (e && e.preventDefault) e.preventDefault();
          if (care.onBonk) care.onBonk();
        },
        onPointerDown: care.onPointerDown,
        style: {
          display: "block",
          background: "transparent",
          border: "none",
          margin: 0,
          padding: "10px 14px 0",
          cursor: "pointer",
          color: "inherit",
          touchAction: "manipulation",
        },
      },
      creature,
    );
  } else {
    inner = h("div", { className: animCls }, creature);
  }
  var flavorLine = data.flavor;
  if (care && care.distrustFx) flavorLine = "It doesn't trust you right now.";
  else if (care && care.bonkFx) flavorLine = "Your kandy got drenched.";
  else if (care && care.sleepyFx) flavorLine = "Your kandy blinks at you sleepily.";
  else if (care && care.fx) flavorLine = "Your kandy munches happily.";
  else if (sleepState === "asleep") flavorLine = "Your kandy is fast asleep.";
  return h(
    "div",
    { style: { width: "248px" } },
    h(
      "div",
      {
        style: {
          position: "relative",
          height: "124px",
          background: scene.bg,
          overflow: "hidden",
        },
      },
      h(
        "svg",
        {
          width: "248",
          height: "124",
          viewBox: "0 0 240 120",
          preserveAspectRatio: "xMidYMax slice",
          style: { position: "absolute", inset: 0 },
          "aria-hidden": "true",
        },
        scene.props,
      ),
      h(
        "div",
        {
          style: {
            position: "absolute",
            left: "50%",
            bottom: "2px",
            transform: "translateX(-50%)",
          },
        },
        inner,
      ),
      celebration ? burstSparkles(h, celebration.kind === "levelup") : null,
      care && care.fx ? petOverlay(h, care.fx, data) : null,
      care && care.bonkFx ? bonkOverlay(h, care.bonkFx, data) : null,
      care && care.distrustFx ? distrustOverlay(h, care.distrustFx, data) : null,
      care && care.sleepyFx ? sleepyPetOverlay(h, care.sleepyFx, data) : null,
    ),
    h(
      "div",
      { style: { padding: "10px 12px 11px", display: "flex", flexDirection: "column", gap: "6px" } },
      // Header row: the name is the only child allowed to shrink/wrap — the
      // Lv pill and hearts are nowrap + shrink-0, so a long stage name
      // ("Drowsy Sporeling") wraps within its own box instead of crushing
      // the pill into a two-line circle.
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        h(
          "span",
          {
            className: celebration && celebration.kind === "levelup" ? "kandev-kandy-namehl" : "",
            style: { fontSize: "13px", fontWeight: 600, flex: "1 1 auto", minWidth: 0, lineHeight: 1.25 },
          },
          data.stage_name,
        ),
        h(
          "span",
          {
            style: {
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "999px",
              background: "var(--muted)",
              opacity: 0.9,
              whiteSpace: "nowrap",
              flexShrink: 0,
            },
          },
          "Lv " + data.level,
        ),
        moodBadge(h, data.mood || "content"),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "3px" } },
        h(
          "div",
          {
            style: {
              height: "6px",
              borderRadius: "999px",
              background: "color-mix(in oklch, var(--muted-foreground) 20%, transparent)",
              overflow: "hidden",
            },
          },
          h("div", {
            style: {
              width: Math.max(Math.min(data.progress_pct, 100), 0) + "%",
              height: "100%",
              borderRadius: "999px",
              background: "var(--primary)",
              transition: "width 0.5s ease",
            },
          }),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            },
          },
          h(
            "span",
            { style: { fontSize: "10px", opacity: 0.65, fontVariantNumeric: "tabular-nums" } },
            // progress_pct is completion WITHIN the current level — say so
            // plainly ("64% through level 12"), not "to next evolution",
            // which read as 64% remaining.
            Math.floor(data.progress_pct) + "% through level " + data.level,
          ),
          bondHearts(h, data.temperament_band || "neutral", !!data.scarred),
        ),
      ),
      h(
        "div",
        { style: { fontSize: "11px", opacity: 0.7, fontStyle: "italic" } },
        flavorLine,
      ),
      // The hint row is ALWAYS mounted in the dialog and hides via
      // visibility, never unmount: removing the row (petting can lift the
      // mood past the hint threshold mid-animation) would shrink the card
      // and the vertically-centered dialog would recenter — a layout jump
      // right in the middle of the pet reaction.
      care
        ? h(
            "div",
            {
              style: {
                fontSize: "10px",
                opacity: 0.45,
                visibility:
                  care.hint && !care.fx && !care.bonkFx && !care.distrustFx && !care.sleepyFx && !sleepState
                    ? "visible"
                    : "hidden",
              },
            },
            "psst — click your kandy",
          )
        : null,
    ),
  );
}

function makeKandyWidget(host) {
  var React = host.React;
  var h = host.jsx;
  var ui = host.ui;
  var Tooltip = ui.Tooltip;
  var TooltipTrigger = ui.TooltipTrigger;
  var TooltipContent = ui.TooltipContent;
  var Dialog = ui.Dialog;
  var DialogContent = ui.DialogContent;
  var DialogTitle = ui.DialogTitle;

  return function KandyWidget() {
    var stateHook = React.useState(null);
    var data = stateHook[0];
    var setData = stateHook[1];
    var openHook = React.useState(false);
    var dialogOpen = openHook[0];
    var setDialogOpen = openHook[1];
    var photoHook = React.useState(false);
    var photoOpen = photoHook[0];
    var setPhotoOpen = photoHook[1];
    var photoThemeHook = React.useState(function () {
      return currentPhotoTheme();
    });
    var photoTheme = photoThemeHook[0];
    var setPhotoTheme = photoThemeHook[1];
    var photoStatusHook = React.useState("idle");
    var photoStatus = photoStatusHook[0];
    var setPhotoStatus = photoStatusHook[1];
    // celebration: null | {kind: "gain"|"levelup"} — set when a refetch
    // shows award_seq/level increased, cleared after the animation window.
    var celebrationHook = React.useState(null);
    var celebration = celebrationHook[0];
    var setCelebration = celebrationHook[1];
    // petFx: 0 while idle, else a nonce (re-set on every click) that keys
    // the floating-hearts overlay so repeat clicks replay the animation.
    var petFxHook = React.useState(0);
    var petFx = petFxHook[0];
    var setPetFx = petFxHook[1];
    // bonkFx / distrustFx: same nonce pattern for the cold-water soaking
    // and the refused-pet turn-away reactions.
    var bonkFxHook = React.useState(0);
    var bonkFx = bonkFxHook[0];
    var setBonkFx = bonkFxHook[1];
    var distrustFxHook = React.useState(0);
    var distrustFx = distrustFxHook[0];
    var setDistrustFx = distrustFxHook[1];
    // sleepyFx: nonce for the half-woken grumpy reaction to petting a
    // sleeping kandy.
    var sleepyFxHook = React.useState(0);
    var sleepyFx = sleepyFxHook[0];
    var setSleepyFx = sleepyFxHook[1];
    // timeOfDay: local-clock hour float driving the day/night scene and
    // the seeded sleep schedule; re-read every TIME_TICK_MS.
    var timeHook = React.useState(localHour());
    var timeOfDay = timeHook[0];
    var setTimeOfDay = timeHook[1];
    var mountedRef = React.useRef(true);
    var prevRef = React.useRef(null);
    var photoSvgRef = React.useRef(null);
    var photoCopyRef = React.useRef(null);
    var photoPanelRef = React.useRef(null);
    var photoEntryRef = React.useRef(null);
    var returnToPhotoEntryRef = React.useRef(false);
    var celebrationTimerRef = React.useRef(null);
    var petTimerRef = React.useRef(null);
    var bonkTimerRef = React.useRef(null);
    var distrustTimerRef = React.useRef(null);
    var sleepyTimerRef = React.useRef(null);
    // lastPetPostRef/lastBonkPostRef rate-limit the POSTs to ~1 per 3s;
    // in-window clicks still get the local reaction.
    var lastPetPostRef = React.useRef(0);
    var lastBonkPostRef = React.useRef(0);
    // distrustUntilRef mirrors the server's 60s distrust window locally so
    // a post-bonk pet click gets the turn-away without even POSTing.
    var distrustUntilRef = React.useRef(0);
    // pointerTypeRef remembers the last pointer type: touch long-presses
    // fire contextmenu on some mobile browsers and must NOT bonk.
    var pointerTypeRef = React.useRef("mouse");

    function clearPreparedPhoto() {
      if (photoCopyRef.current) disposePreparedPhoto(photoCopyRef.current);
      photoCopyRef.current = null;
    }

    function celebrate(kind) {
      setCelebration({ kind: kind });
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = setTimeout(
        function () {
          if (mountedRef.current) setCelebration(null);
        },
        kind === "levelup" ? 2200 : 1400,
      );
    }

    function load() {
      host.api
        .fetch("webhooks/kandy")
        .then(function (r) {
          return r.json();
        })
        .then(function (body) {
          if (!mountedRef.current || !body || typeof body.level !== "number") return;
          var prev = prevRef.current;
          if (prev) {
            if (body.level > prev.level) celebrate("levelup");
            else if (
              typeof body.award_seq === "number" &&
              typeof prev.award_seq === "number" &&
              body.award_seq > prev.award_seq
            ) {
              celebrate("gain");
            }
          }
          prevRef.current = { level: body.level, award_seq: body.award_seq };
          setData(body);
        })
        .catch(function () {
          /* keep the last known creature */
        });
    }

    // showDistrust plays the turn-away/"..." reaction: no hearts, no pet
    // POST, and the card says "It doesn't trust you right now."
    function showDistrust() {
      setPetFx(0);
      setBonkFx(0);
      setSleepyFx(0);
      setDistrustFx(Date.now());
      if (distrustTimerRef.current) clearTimeout(distrustTimerRef.current);
      // 1900ms: the ignored treat finishes bouncing at ~1300ms and the
      // "..." fades out at ~1750ms.
      distrustTimerRef.current = setTimeout(function () {
        if (mountedRef.current) setDistrustFx(0);
      }, 1900);
    }

    // triggerPet (click/tap or Enter/Space on the pet button): local
    // reaction immediately, POST the pet stamp (which lifts the displayed
    // mood a tier, never XP) at most once per 3s. Extra clicks inside the
    // window replay the treat/munch locally without hitting the backend.
    // Inside the post-bonk distrust window the kandy refuses: turn-away
    // reaction, no POST, no effect.
    function triggerPet() {
      var nowMs = Date.now();
      if (nowMs < distrustUntilRef.current) {
        showDistrust();
        return;
      }
      setBonkFx(0);
      setDistrustFx(0);
      var shownNow = data || EGG_PLACEHOLDER;
      if (shownNow.level > 1 && isAsleep((shownNow.lineage_seed || 1) >>> 0, timeOfDay)) {
        // Asleep: the POST below is untouched (mechanics behave exactly as
        // awake) — only the reaction differs: a half-woken grumpy squint
        // and one subdued heart instead of the munch, then back to sleep.
        setPetFx(0);
        setSleepyFx(nowMs);
        if (sleepyTimerRef.current) clearTimeout(sleepyTimerRef.current);
        // 2600ms: treat lands at 450ms, the lone heart fades by ~2100ms,
        // then it drifts back to sleep.
        sleepyTimerRef.current = setTimeout(function () {
          if (mountedRef.current) setSleepyFx(0);
        }, 2600);
      } else {
        setSleepyFx(0);
        setPetFx(nowMs);
        if (petTimerRef.current) clearTimeout(petTimerRef.current);
        // 2200ms: treat catch at 450ms, munch through ~1150ms, the last
        // heart fades by ~2050ms.
        petTimerRef.current = setTimeout(function () {
          if (mountedRef.current) setPetFx(0);
        }, 2200);
      }
      if (nowMs - lastPetPostRef.current < 3000) return;
      lastPetPostRef.current = nowMs;
      host.api
        .fetch("webhooks/pet", { method: "POST" })
        .then(function (r) {
          return r.json();
        })
        .then(function (body) {
          if (mountedRef.current && body && typeof body.level === "number") {
            prevRef.current = { level: body.level, award_seq: body.award_seq };
            setData(body);
            if (body.refusing_pets) {
              // Bonked from elsewhere (another tab/client): mirror the
              // refusal locally and switch the reaction to the turn-away.
              distrustUntilRef.current = Date.now() + 60000;
              showDistrust();
            }
          }
        })
        .catch(function () {
          /* the local purr already played */
        });
    }

    // triggerBonk (desktop right-click on the creature): the bucket of
    // cold water — local pour/splash/soak immediately, POST the bonk at
    // most once per 3s, and open the local distrust window. Touch never
    // bonks — long-press contextmenu is ignored so accidental long-presses
    // can't traumatize mobile kandys. Bonking never drains XP: it darkens
    // the persistent temperament, which only conditions how the creature
    // is drawn.
    function triggerBonk() {
      if (pointerTypeRef.current === "touch") return;
      var nowMs = Date.now();
      setPetFx(0);
      setDistrustFx(0);
      setSleepyFx(0);
      setBonkFx(nowMs);
      if (bonkTimerRef.current) clearTimeout(bonkTimerRef.current);
      // 2600ms: water hits at 500ms, the soaked tint dries off at ~2400ms.
      bonkTimerRef.current = setTimeout(function () {
        if (mountedRef.current) setBonkFx(0);
      }, 2600);
      distrustUntilRef.current = nowMs + 60000;
      if (nowMs - lastBonkPostRef.current < 3000) return;
      lastBonkPostRef.current = nowMs;
      host.api
        .fetch("webhooks/bonk", { method: "POST" })
        .then(function (r) {
          return r.json();
        })
        .then(function (body) {
          if (mountedRef.current && body && typeof body.level === "number") {
            prevRef.current = { level: body.level, award_seq: body.award_seq };
            setData(body);
          }
        })
        .catch(function () {
          /* the local soaking already played */
        });
    }

    function openPhotoBooth() {
      returnToPhotoEntryRef.current = true;
      clearPreparedPhoto();
      setPhotoTheme(currentPhotoTheme());
      setPhotoStatus("preparing");
      setPhotoOpen(true);
      setDialogOpen(true);
    }

    function showKandyCard() {
      clearPreparedPhoto();
      setPhotoStatus("idle");
      setPhotoOpen(false);
    }

    function copyPhoto() {
      if (
        !photoCopyRef.current ||
        photoStatus === "preparing" ||
        photoStatus === "copying" ||
        photoStatus === "render-error"
      ) {
        return;
      }
      setPhotoStatus("copying");
      copyPreparedPhoto(photoCopyRef.current)
        .then(function () {
          if (mountedRef.current) setPhotoStatus("copied");
        })
        .catch(function (error) {
          if (mountedRef.current) setPhotoStatus(photoCopyFailureStatus(error));
        });
    }

    function changeDialogOpen(nextOpen) {
      setDialogOpen(nextOpen);
      if (!nextOpen) {
        returnToPhotoEntryRef.current = false;
        clearPreparedPhoto();
        setPhotoOpen(false);
        setPhotoStatus("idle");
      }
    }

    React.useEffect(function () {
      mountedRef.current = true;
      load();
      var interval = setInterval(load, REFRESH_MS);
      // Clock tick: dusk (and bedtime) arrive without a refetch.
      var timeTick = setInterval(function () {
        setTimeOfDay(localHour());
      }, TIME_TICK_MS);
      refreshListeners.push(load);
      return function () {
        mountedRef.current = false;
        clearInterval(interval);
        clearInterval(timeTick);
        if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
        if (petTimerRef.current) clearTimeout(petTimerRef.current);
        if (bonkTimerRef.current) clearTimeout(bonkTimerRef.current);
        if (distrustTimerRef.current) clearTimeout(distrustTimerRef.current);
        if (sleepyTimerRef.current) clearTimeout(sleepyTimerRef.current);
        clearPreparedPhoto();
        var i = refreshListeners.indexOf(load);
        if (i >= 0) refreshListeners.splice(i, 1);
      };
    }, []);

    React.useEffect(
      function () {
        if (photoOpen) {
          if (photoPanelRef.current && photoPanelRef.current.focus) photoPanelRef.current.focus();
          return;
        }
        if (returnToPhotoEntryRef.current) {
          returnToPhotoEntryRef.current = false;
          if (photoEntryRef.current && photoEntryRef.current.focus) photoEntryRef.current.focus();
        }
      },
      [photoOpen],
    );

    var shown = data || EGG_PLACEHOLDER;
    // While celebrating, the FACE is joyful regardless of prior mood — it
    // just got fed. face_mood only: the mood badge keeps showing the
    // server's truth, so the badge text never blinks Elated→Happy on every
    // award (which read as flip-flopping when a bonk mood-dent was active).
    if (celebration) shown = Object.assign({}, shown, { face_mood: "elated" });
    // The chip portrait sleeps too: closed eyes on the static icon while
    // the seeded schedule says it's bedtime (celebrations still play their
    // chip hop over it — no special-casing).
    var chipShown = shown;
    var chipAsleep = shown.level > 1 && isAsleep((shown.lineage_seed || 1) >>> 0, timeOfDay);
    if (chipAsleep) chipShown = Object.assign({}, shown, { sleep_state: "asleep" });

    // The chip is a real button: hover/focus gives the desktop quick-peek
    // tooltip, tap/click opens the same card as a dialog (touch devices
    // have no hover, so the dialog is the mobile path).
    var chipCelebrateCls = "";
    if (celebration) {
      chipCelebrateCls =
        celebration.kind === "levelup" ? " kandev-kandy-levelup" : " kandev-kandy-celebrate";
    }
    var trigger = h(
      "button",
      {
        id: "kandev-kandy-widget",
        type: "button",
        className:
          "relative h-7 w-7 flex items-center justify-center cursor-pointer rounded-md border border-border/60 bg-muted/30 hover:bg-muted/60" +
          chipCelebrateCls,
        "aria-label":
          "Kandy: level " +
          shown.level +
          " " +
          shown.stage_name +
          ", " +
          (shown.mood || "content") +
          (chipAsleep ? ", sleeping" : ""),
        onMouseEnter: load,
        onFocus: load,
        onClick: function () {
          load();
          returnToPhotoEntryRef.current = false;
          setPhotoOpen(false);
          setPhotoStatus("idle");
          setDialogOpen(true);
        },
      },
      creatureSvg(h, chipShown, 22, "", true),
    );

    // Shared interaction wiring for BOTH card surfaces (hover preview and
    // click dialog): treat on click, bucket on right-click, plus the fx
    // state each reaction animates through.
    var careProps = {
      fx: petFx,
      onPet: triggerPet,
      bonkFx: bonkFx,
      distrustFx: distrustFx,
      sleepyFx: sleepyFx,
      onBonk: triggerBonk,
      onPointerDown: function (e) {
        pointerTypeRef.current = (e && e.pointerType) || "mouse";
      },
      // Hint presence follows the underlying mood (not the celebration
      // override) so the row doesn't pop in/out mid-celebration.
      hint: HEARTS_BY_MOOD[(data || EGG_PLACEHOLDER).mood || "content"] <= 4,
    };
    var photoModel = photoModelFor(data || EGG_PLACEHOLDER, timeOfDay);
    var photoRenderKey = JSON.stringify([
      photoTheme,
      photoModel.stageName,
      photoModel.level,
      photoModel.mood,
      photoModel.temperamentBand,
      photoModel.scarred,
      photoModel.habitat,
      photoModel.dayPhase,
      photoModel.sleepState,
      photoModel.family,
      photoModel.archetype,
      photoModel.biome,
      photoModel.lineageSeed,
    ]);

    React.useEffect(
      function () {
        if (!photoOpen) return;
        var active = true;
        var preparedCopy = null;
        clearPreparedPhoto();
        setPhotoStatus("preparing");
        renderPhotoPng(photoSvgRef.current)
          .then(function (pngBlob) {
            if (!active || !mountedRef.current) return null;
            return preparePhotoCopy(pngBlob);
          })
          .then(function (prepared) {
            if (!prepared) return;
            preparedCopy = prepared;
            if (!active || !mountedRef.current) {
              disposePreparedPhoto(prepared);
              return;
            }
            photoCopyRef.current = prepared;
            setPhotoStatus("ready");
          })
          .catch(function () {
            if (!active || !mountedRef.current) return;
            setPhotoStatus("render-error");
          });
        return function () {
          active = false;
          if (preparedCopy) {
            if (photoCopyRef.current === preparedCopy) photoCopyRef.current = null;
            disposePreparedPhoto(preparedCopy);
          }
        };
      },
      [photoOpen, photoRenderKey],
    );

    return h(
      React.Fragment,
      null,
      h(
        Tooltip,
        // The app's TooltipProvider disables hoverable content globally
        // (tooltips are one-liners there). Our preview is a real card —
        // override per-root so moving the pointer from the chip INTO the
        // card keeps it open, and re-enable pointer events on the content
        // (the shared TooltipContent sets pointer-events-none).
        { disableHoverableContent: false },
        h(TooltipTrigger, { asChild: true }, trigger),
        h(
          TooltipContent,
          {
            side: "bottom",
            align: "end",
            // The shared TooltipContent defaults sideOffset to 0 and lets its
            // arrow visually bridge trigger and content; we hide the arrow
            // (stray square on a full-bleed card), so provide the breathing
            // room explicitly. Radix's safe polygon covers the gap, so
            // hovering from chip into card still works.
            sideOffset: 8,
            className: "p-0 overflow-hidden pointer-events-auto kandev-kandy-tooltip",
          },
          // Same care wiring as the dialog: the hover card is a first-class
          // surface — treat and bucket work here too. (Both cards are never
          // mounted at once: the dialog's overlay blocks chip hover.)
          kandyCard(h, shown, celebration, careProps, timeOfDay),
        ),
      ),
      h(
        Dialog,
        { open: dialogOpen, onOpenChange: changeDialogOpen },
        h(
          DialogContent,
          {
            id: "kandev-kandy-dialog",
            className: "w-auto p-0 gap-0 overflow-hidden rounded-2xl",
            style: { maxWidth: photoOpen ? "420px" : "280px" },
            showCloseButton: false,
          },
          photoOpen
            ? photoBoothPanel(
                h,
                DialogTitle,
                photoModel,
                photoTheme,
                photoSvgRef,
                photoPanelRef,
                photoStatus,
                showKandyCard,
                copyPhoto,
              )
            : h(
                React.Fragment,
                null,
                h(DialogTitle, { className: "sr-only" }, "Kandy"),
                h(
                  "div",
                  {
                    style: {
                      position: "relative",
                    },
                  },
                   kandyCard(h, shown, celebration, careProps, timeOfDay),
                   h(
                     "div",
                    {
                      style: {
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        zIndex: 3,
                      },
                    },
                    photoBoothButton(h, openPhotoBooth, photoEntryRef),
                   ),
                 ),
               ),
         ),
       ),
    );
  };
}

window.registerKandevPlugin(PLUGIN_ID, {
  initialize: function (registry, host) {
    h0 = host.jsx;
    injectStyles();
    registry.registerComponent("chat-top-bar", makeKandyWidget(host));
    // Live updates: refetch when work happens, instead of waiting for the
    // backstop poll (or a page reload).
    WS_ACTIONS.forEach(function (action) {
      registry.registerWsHandler(action, scheduleRefresh);
    });
  },
  destroy: function () {
    removeStyles();
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshListeners.length = 0;
  },
  // Pure, deterministic render helpers exposed for offline tooling (the
  // evolution posters in demo/). Harmless in production: kandev's plugin
  // loader only reads initialize/destroy.
  __render: {
    creatureSvg: creatureSvg,
    creatureParts: creatureParts,
    sceneFor: sceneFor,
    growthForLevel: growthForLevel,
    kandyCard: kandyCard,
    petOverlay: petOverlay,
    bonkOverlay: bonkOverlay,
    distrustOverlay: distrustOverlay,
    sleepyPetOverlay: sleepyPetOverlay,
    bonkContactFor: bonkContactFor,
    dayPhaseFor: dayPhaseFor,
    sleepScheduleFor: sleepScheduleFor,
    isAsleep: isAsleep,
    photoModelFor: photoModelFor,
    photoExportPlan: photoExportPlan,
    photoPaletteFor: photoPaletteFor,
    photoPortraitSvg: photoPortraitSvg,
    photoBoothButton: photoBoothButton,
    photoBoothPanel: photoBoothPanel,
    renderPhotoPng: renderPhotoPng,
    copyPhotoBlob: copyPhotoBlob,
    preparePhotoCopy: preparePhotoCopy,
    copyPreparedPhoto: copyPreparedPhoto,
    disposePreparedPhoto: disposePreparedPhoto,
    photoCopyFailureStatus: photoCopyFailureStatus,
    setJsx: function (jsx) {
      h0 = jsx;
    },
  },
});
