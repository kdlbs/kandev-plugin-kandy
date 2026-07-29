// Shipling — chat-top-bar plugin. A tiny creature that lives in the
// session top bar and evolves forever from work happening in this kandev
// instance. All growth logic is server-side; this bundle only renders what
// GET webhooks/shipling returns: { level, stage, archetype, family, biome,
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

var PLUGIN_ID = "kandev-plugin-shipling";
var STYLE_ID = "kandev-shipling-style";
var REFRESH_MS = 60000;

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
function lineageColors(family, level, sty) {
  var hue = FAMILY_HUES[((family % 12) + 12) % 12] + sty.hueJitter;
  var sat = Math.min(18 + level * 1.15, 74);
  var light = 70 - Math.min(level, 50) * 0.25;
  return {
    hue: hue,
    body: hsl(hue, sat, light * 0.86),
    dark: hsl(hue, Math.max(sat - 10, 12), 34),
    light: hsl(hue, sat, Math.min(light + 14, 86)),
    accent: hsl(hue + 150, Math.min(sat + 10, 84), 62),
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

function eyeAt(h, rand, cx, cy, r, style, key) {
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
      className: "kandev-shipling-blink",
      style: { transformBox: "fill-box", transformOrigin: "center" },
    }),
  );
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

function faceParts(h, lineage, C, head, g, sty) {
  var rand = makeRand(lineage, 30);
  var out = [];
  var style = g.stage <= 1 ? "dot" : sty.eyeStyle;
  var eyeR = (style === "wide" ? 4.8 : 3.9) * Math.min(head.r / 10, 1.4);
  var count = head.alien && g.stage >= 2 ? sty.alienEyes : 2;
  if (count === 2) {
    var dx = head.r * 0.5;
    out = out.concat(eyeAt(h, rand, head.cx - dx, head.cy, eyeR, style, "eyeL"));
    out = out.concat(eyeAt(h, rand, head.cx + dx, head.cy, eyeR, style, "eyeR"));
  } else {
    for (var i = 0; i < count; i++) {
      var t = i / (count - 1) - 0.5;
      out = out.concat(
        eyeAt(h, rand, head.cx + t * head.r * 1.3, head.cy - Math.abs(t) * 3 - (i % 2) * 2, eyeR * (0.7 + rand(0, 0.4)), style, "eye" + i),
      );
    }
  }

  if (g.mouth) {
    var mouthY = head.cy + head.r * 0.55;
    var mw = head.r * 0.55;
    var mouth = sty.mouthStyle;
    if (mouth === "smile") {
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
  if (g.blush) {
    out.push(
      h("circle", { key: "blushL", cx: head.cx - head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
      h("circle", { key: "blushR", cx: head.cx + head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
    );
  }
  if (g.tufts) {
    out.push(
      h("path", { key: "tuftL", d: "M" + (head.cx - head.r) + " " + (head.cy - head.r * 0.6) + " l-4 -3 l1.5 4.5 Z", fill: C.light, stroke: C.dark, strokeWidth: 0.8 }),
      h("path", { key: "tuftR", d: "M" + (head.cx + head.r) + " " + (head.cy - head.r * 0.6) + " l4 -3 l-1.5 4.5 Z", fill: C.light, stroke: C.dark, strokeWidth: 0.8 }),
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

function hornParts(h, lineage, C, top, g, sty) {
  if (g.horns <= 0) return [];
  var rand = makeRand(lineage, 32);
  var s = 0.7 + g.horns * 0.3; // horns grow at each unlock
  var out = [];
  var x = top.x;
  var y = top.y;
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

function tailPartsFor(h, C, g, sty) {
  if (g.tail <= 0) return [];
  var s = 0.6 + g.tail * 0.35; // tail grows at each unlock
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
          { key: "balloon", className: "kandev-shipling-bob" },
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
        { key: "pet", className: "kandev-shipling-bob" },
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
        { key: "pal", className: "kandev-shipling-bob" },
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
function creatureParts(h, data, portrait) {
  var level = data.level;
  if (level <= 1) return eggSvg(h, makeRand((data.lineage_seed || 1) >>> 0, 7));

  var lineage = (data.lineage_seed || 1) >>> 0;
  var g = growthForLevel(level);
  var sty = lineageStyle(lineage);
  var C = lineageColors(data.family || 0, level, sty);
  var arch = (((data.archetype || 0) % BODY_BUILDERS.length) + BODY_BUILDERS.length) % BODY_BUILDERS.length;

  // Lineage-stable geometry: the SAME rand stream at every level, so the
  // body only changes through stage scale/detail, never reshuffles.
  var body = BODY_BUILDERS[arch](h, makeRand(lineage, 6), C, g);

  var inner = [];
  inner = inner.concat(wingParts(h, C, body.top, g));
  inner = inner.concat(body.parts);
  inner = inner.concat(markingParts(h, lineage, C, body.mark, g, sty));
  inner = inner.concat(faceParts(h, lineage, C, body.head, g, sty));
  inner = inner.concat(hornParts(h, lineage, C, body.top, g, sty));
  if (body.grounded) inner = inner.concat(tailPartsFor(h, C, g, sty));
  inner = inner.concat(prestigeInBody(h, C, body.top, g));

  var s = portrait ? 1 : STAGE_SCALE[g.stage];
  var scaled = h(
    "g",
    { key: "being", transform: "translate(" + 50 * (1 - s) + " " + 88 * (1 - s) + ") scale(" + s + ")" },
    inner,
  );

  var parts = [];
  if (!portrait) parts = parts.concat(effectParts(h, lineage, C, g, level));
  parts.push(scaled);
  if (!portrait) parts = parts.concat(groundParts(h, C, g, sty));
  return parts;
}

// isStatic renders a motionless portrait (top-bar icon): no bob wrapper, the
// kandev-shipling-static class kills descendant blink/wiggle animations, and the
// viewBox crops tight to the full-grown body (creatureParts portrait mode) so
// the icon fills its chip at every growth stage — all the life stays in the
// hover card.
function creatureSvg(h, data, size, extraClass, isStatic) {
  var cls = (extraClass || "") + (isStatic ? " kandev-shipling-static" : "");
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
    h("g", { className: isStatic ? "" : "kandev-shipling-bob" }, creatureParts(h, data, !!isStatic)),
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
var BIOME_BGS = [
  [
    "linear-gradient(to bottom, #d9d5c9 0%, #c4bfae 68%, #a8a28c 100%)",
    "linear-gradient(to bottom, #c8e4ee 0%, #d9edbb 68%, #b3d494 100%)",
    "linear-gradient(to bottom, #a5ddf2 0%, #b7e39a 62%, #7fbf6a 100%)",
    "linear-gradient(to bottom, #7cc9a0 0%, #2f8f5e 60%, #14532d 100%)",
    "linear-gradient(to bottom, #0e2b38 0%, #14532d 60%, #052e16 100%)",
    "linear-gradient(to bottom, #1a0f3d 0%, #0f4f3a 55%, #020d08 100%)",
  ],
  [
    "linear-gradient(to bottom, #d8d3c4 0%, #c2baa6 68%, #a89f88 100%)",
    "linear-gradient(to bottom, #cfe8ee 0%, #a5d3e2 62%, #7fb6cc 100%)",
    "linear-gradient(to bottom, #a8d8ea 0%, #5ca8d8 55%, #2f6f9f 100%)",
    "linear-gradient(to bottom, #4fa3c7 0%, #23648f 60%, #123c5c 100%)",
    "linear-gradient(to bottom, #0b2c4a 0%, #0e4a6e 60%, #04121f 100%)",
    "linear-gradient(to bottom, #150a3d 0%, #0e4a6e 55%, #02060f 100%)",
  ],
  [
    "linear-gradient(to bottom, #d6d2ca 0%, #b9b4ab 68%, #8f8a80 100%)",
    "linear-gradient(to bottom, #d3dce8 0%, #a8b6cc 62%, #7c8aa8 100%)",
    "linear-gradient(to bottom, #cdd7e8 0%, #8fa3c4 60%, #5c6f96 100%)",
    "linear-gradient(to bottom, #b8c8ea 0%, #6d83b8 60%, #3a4c7c 100%)",
    "linear-gradient(to bottom, #0a1a33 0%, #16305e 60%, #050d1f 100%)",
    "linear-gradient(to bottom, #1b0a3d 0%, #1c3a72 55%, #03040c 100%)",
  ],
  [
    "linear-gradient(to bottom, #d8cfc4 0%, #bfae9c 68%, #98826c 100%)",
    "linear-gradient(to bottom, #ffe4b0 0%, #f6c67e 62%, #e0aa5c 100%)",
    "linear-gradient(to bottom, #f0b878 0%, #cc7a4a 60%, #8a4a2e 100%)",
    "linear-gradient(to bottom, #3a1414 0%, #6e2b1c 60%, #251010 100%)",
    "linear-gradient(to bottom, #1c0f2e 0%, #4a1c3f 60%, #12060f 100%)",
    "linear-gradient(to bottom, #0f0a3d 0%, #571f4a 55%, #070310 100%)",
  ],
];

function biomeProps(biome, phase, rand, level) {
  var density = Math.min(level, 40);
  switch (biome) {
    case 1: // aquatic: dry shore -> pond -> lake -> coral -> bioluminescent
      if (phase === 0) return rocks(rand, 3, "#9a917c").concat([h0("ellipse", { key: "puddle", cx: 120, cy: 114, rx: 40, ry: 5, fill: "#a5c8d3", opacity: 0.7 })]);
      if (phase === 1) return waves(rand, 2).concat([h0("circle", { key: "sun", cx: 205, cy: 22, r: 11, fill: "#fff1b8", opacity: 0.9 })]);
      if (phase === 2) return waves(rand, 4 + Math.floor(density / 10));
      if (phase === 3) return waves(rand, 3).concat(coral(rand, 4 + Math.floor(density / 8)), bubbles(rand, 5));
      return bubbles(rand, 8 + Math.floor(density / 4)).concat(coral(rand, 5), stars(rand, Math.min(6 + Math.max(level - 40, 0), 40), "#9be7ff"));
    case 2: // alpine: rocky flat -> foothills -> peaks -> crystal -> celestial
      if (phase === 0) return rocks(rand, 5, "#8f8a80");
      if (phase === 1) return hills(rand, 3, "#8fa0bc");
      if (phase === 2) return mountains(rand, 4, "#41527a", true);
      if (phase === 3) return mountains(rand, 4, "#3a4c7c", true).concat(flowerDots(rand, 4));
      return mountains(rand, 3, "#101d3d", true).concat(auroraRibbons(rand, 3), stars(rand, Math.min(14 + Math.max(level - 40, 0), 50)));
    case 3: // ember: ash -> dunes -> canyon -> volcano -> starfire
      if (phase === 0) return rocks(rand, 5, "#7d6b56").concat(grassBlades(rand, 3, "#8a7a5f"));
      if (phase === 1) return dunes(rand).concat([h0("circle", { key: "dsun", cx: 200, cy: 22, r: 12, fill: "#fff1b8", opacity: 0.95 })]);
      if (phase === 2) return mesas(rand, 4).concat([h0("circle", { key: "csun", cx: 205, cy: 20, r: 11, fill: "#ffddaa", opacity: 0.9 })]);
      if (phase === 3) return volcanoProps(rand, 4 + Math.floor(density / 10));
      return volcanoProps(rand, 6).concat(stars(rand, Math.min(12 + Math.max(level - 40, 0), 50)));
    default: // 0 verdant: barren field -> meadow -> woods -> lush -> enchanted
      if (phase === 0) return rocks(rand, 4, "#9a917c").concat(grassBlades(rand, 4, "#8a8a6a"));
      if (phase === 1) return grassBlades(rand, 8 + Math.floor(density / 2), "#4c8a3f").concat([h0("circle", { key: "sun", cx: 205, cy: 22, r: 13, fill: "#ffdf6b", opacity: 0.95 })]);
      if (phase === 2) return grassBlades(rand, 10, "#4c8a3f").concat(treeProps(rand, 3 + Math.floor(density / 8), "#2c6e46"), flowerDots(rand, 3));
      if (phase === 3) return treeProps(rand, 6 + Math.floor(density / 6), "#1d4d31").concat(flowerDots(rand, 6), grassBlades(rand, 8, "#2f6e3f"));
      return treeProps(rand, 6, "#0c3a24").concat(fireflies(rand, 8 + Math.floor(density / 5)), stars(rand, Math.min(8 + Math.max(level - 40, 0), 40)));
  }
}

// sceneFor(biome, level, lineageSeed) — the lineage's habitat at this
// maturity. Layout re-rolls only at phase boundaries.
function sceneFor(biome, level, seed) {
  var phase = scenePhase(level);
  var b = ((biome % BIOME_BGS.length) + BIOME_BGS.length) % BIOME_BGS.length;
  var rand = makeRand((seed ^ (phase * 0x9e3779b9)) >>> 0, 11);
  // Phase 5 ("transcendent", 80+) is the celestial scene drifting further
  // out: same biome props with a golden star field layered on top.
  var props = biomeProps(b, Math.min(phase, 4), rand, level);
  if (phase === 5) {
    props = props.concat(stars(rand, Math.min(10 + (level - 79), 40), "#ffe9a3"));
  }
  return {
    bg: BIOME_BGS[b][phase],
    props: props,
  };
}

// ---------------------------------------------------------------------------
// Animations — injected once; disabled under prefers-reduced-motion.
// ---------------------------------------------------------------------------

var SHIPLING_CSS =
  "@keyframes kandev-shipling-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}" +
  "@keyframes kandev-shipling-blink{0%,90%,100%{transform:scaleY(1)}93%,96%{transform:scaleY(0.08)}}" +
  "@keyframes kandev-shipling-wiggle{0%,86%,100%{transform:rotate(0deg)}90%{transform:rotate(-4deg)}94%{transform:rotate(4deg)}}" +
  ".kandev-shipling-bob{animation:kandev-shipling-bob 2.8s ease-in-out infinite}" +
  ".kandev-shipling-blink{animation:kandev-shipling-blink 4.6s ease-in-out infinite}" +
  ".kandev-shipling-wiggle{animation:kandev-shipling-wiggle 7s ease-in-out infinite;transform-origin:50% 70%}" +
  ".kandev-shipling-static,.kandev-shipling-static *{animation:none!important}" +
  "@media (prefers-reduced-motion: reduce){.kandev-shipling-bob,.kandev-shipling-blink,.kandev-shipling-wiggle{animation:none}}";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  var el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = SHIPLING_CSS;
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
  flavor: "The egg is warm. Keep working.",
};

function shiplingCard(h, data) {
  var scene = sceneFor(data.biome || 0, data.level, (data.lineage_seed || 1) >>> 0);
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
          className: "kandev-shipling-wiggle",
          style: {
            position: "absolute",
            left: "50%",
            bottom: "2px",
            transform: "translateX(-50%)",
          },
        },
        creatureSvg(h, data, 92),
      ),
    ),
    h(
      "div",
      { style: { padding: "10px 12px 11px", display: "flex", flexDirection: "column", gap: "6px" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: "8px" } },
        h("span", { style: { fontSize: "13px", fontWeight: 600 } }, data.stage_name),
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
            },
          },
          "Lv " + data.level,
        ),
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
          { style: { fontSize: "10px", opacity: 0.65, fontVariantNumeric: "tabular-nums" } },
          Math.floor(data.progress_pct) + "% to next evolution",
        ),
      ),
      h("div", { style: { fontSize: "11px", opacity: 0.7, fontStyle: "italic" } }, data.flavor),
    ),
  );
}

function makeShiplingWidget(host) {
  var React = host.React;
  var h = host.jsx;
  var ui = host.ui;
  var Tooltip = ui.Tooltip;
  var TooltipTrigger = ui.TooltipTrigger;
  var TooltipContent = ui.TooltipContent;
  var Dialog = ui.Dialog;
  var DialogContent = ui.DialogContent;
  var DialogTitle = ui.DialogTitle;

  return function ShiplingWidget() {
    var stateHook = React.useState(null);
    var data = stateHook[0];
    var setData = stateHook[1];
    var openHook = React.useState(false);
    var dialogOpen = openHook[0];
    var setDialogOpen = openHook[1];
    var mountedRef = React.useRef(true);

    function load() {
      host.api
        .fetch("webhooks/shipling")
        .then(function (r) {
          return r.json();
        })
        .then(function (body) {
          if (mountedRef.current && body && typeof body.level === "number") setData(body);
        })
        .catch(function () {
          /* keep the last known creature */
        });
    }

    React.useEffect(function () {
      mountedRef.current = true;
      load();
      var interval = setInterval(load, REFRESH_MS);
      return function () {
        mountedRef.current = false;
        clearInterval(interval);
      };
    }, []);

    var shown = data || EGG_PLACEHOLDER;

    // The chip is a real button: hover/focus gives the desktop quick-peek
    // tooltip, tap/click opens the same card as a dialog (touch devices
    // have no hover, so the dialog is the mobile path).
    var trigger = h(
      "button",
      {
        id: "kandev-shipling-widget",
        type: "button",
        className:
          "h-7 w-7 flex items-center justify-center cursor-pointer rounded-md border border-border/60 bg-muted/30 hover:bg-muted/60",
        "aria-label": "Shipling: level " + shown.level + " " + shown.stage_name,
        onMouseEnter: load,
        onFocus: load,
        onClick: function () {
          load();
          setDialogOpen(true);
        },
      },
      creatureSvg(h, shown, 22, "", true),
    );

    return h(
      React.Fragment,
      null,
      h(
        Tooltip,
        null,
        h(TooltipTrigger, { asChild: true }, trigger),
        h(
          TooltipContent,
          { side: "bottom", align: "end", className: "p-0 overflow-hidden" },
          shiplingCard(h, shown),
        ),
      ),
      h(
        Dialog,
        { open: dialogOpen, onOpenChange: setDialogOpen },
        h(
          DialogContent,
          {
            id: "kandev-shipling-dialog",
            className: "w-auto max-w-[280px] p-0 gap-0 overflow-hidden rounded-xl",
            showCloseButton: false,
          },
          h(DialogTitle, { className: "sr-only" }, "Shipling"),
          shiplingCard(h, shown),
        ),
      ),
    );
  };
}

window.registerKandevPlugin(PLUGIN_ID, {
  initialize: function (registry, host) {
    h0 = host.jsx;
    injectStyles();
    registry.registerComponent("chat-top-bar", makeShiplingWidget(host));
  },
  destroy: function () {
    removeStyles();
  },
  // Pure, deterministic render helpers exposed for offline tooling (the
  // evolution posters in demo/). Harmless in production: kandev's plugin
  // loader only reads initialize/destroy.
  __render: {
    creatureSvg: creatureSvg,
    creatureParts: creatureParts,
    sceneFor: sceneFor,
    growthForLevel: growthForLevel,
    setJsx: function (jsx) {
      h0 = jsx;
    },
  },
});
