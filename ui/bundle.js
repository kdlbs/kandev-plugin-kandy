// Kandev Gotchi — chat-top-bar plugin. A tiny creature that lives in the
// session top bar and evolves forever from work happening in this kandev
// instance. All growth logic is server-side; this bundle only renders what
// GET webhooks/gotchi returns: { level, tier, archetype, stage_name,
// progress_pct, appearance_seed, flavor, alive_since }.
//
// v0.2.0: every level in the designed band (2..40) reads as a different
// creature — the backend walks 10 body archetypes so consecutive levels
// never share a silhouette, palettes jump families per level, parts swap
// (horns, eyes, mouths, tails, companions) instead of only accumulating,
// and scenes rotate every 2-3 levels through 14 environments. Everything is
// deterministic from (appearance_seed, level, tier, archetype): no
// Math.random at render time, stable within a level.

var PLUGIN_ID = "kandev-plugin-gotchi";
var STYLE_ID = "kandev-gotchi-style";
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

// ---------------------------------------------------------------------------
// Palette identity per level: adjacent levels JUMP families (green ->
// purple -> amber...), never rotate slightly. The rotating-index walk makes
// consecutive levels provably land on different families.
// ---------------------------------------------------------------------------

var FAMILY_HUES = [130, 280, 45, 210, 5, 175, 320, 90, 250, 25, 190, 340];

function familyHue(level, rand) {
  if (level <= 1) return 45;
  var i = level - 2;
  var idx = (i + Math.floor(i / FAMILY_HUES.length)) % FAMILY_HUES.length;
  return FAMILY_HUES[idx] + rand(-10, 10);
}

// ---------------------------------------------------------------------------
// Egg (level 1).
// ---------------------------------------------------------------------------

function eggSvg(h, rand) {
  var spots = [];
  for (var i = 0; i < 3; i++) {
    spots.push(
      h("circle", {
        key: "spot" + i,
        cx: rand(38, 62),
        cy: rand(48, 72),
        r: rand(2, 4.5),
        fill: "hsl(" + Math.round(rand(70, 170)) + ", 45%, 72%)",
        opacity: 0.8,
      }),
    );
  }
  return [
    h("ellipse", {
      key: "shell",
      cx: 50,
      cy: 58,
      rx: 21,
      ry: 27,
      fill: "#f6efdf",
      stroke: "#d8c9a8",
      strokeWidth: 2,
    }),
    h("path", {
      key: "shine",
      d: "M40 40 Q45 33 52 35",
      stroke: "#ffffff",
      strokeWidth: 3,
      strokeLinecap: "round",
      fill: "none",
      opacity: 0.7,
    }),
  ].concat(spots);
}

// ---------------------------------------------------------------------------
// Body archetypes. Each builder returns { parts, head: {cx, cy, r},
// top: {x, y}, grounded } in the 0 0 100 100 viewBox (ground at y≈88).
// All growth knobs are clamped; nothing scales unbounded with level.
// ---------------------------------------------------------------------------

function feetNubs(h, C, cx, dx, y) {
  return [
    h("ellipse", { key: "footL", cx: cx - dx, cy: y, rx: 5, ry: 3, fill: C.dark }),
    h("ellipse", { key: "footR", cx: cx + dx, cy: y, rx: 5, ry: 3, fill: C.dark }),
  ];
}

function bodyBlob(h, rand, C) {
  var rx = 21 + rand(0, 5);
  var ry = rx * (0.85 + rand(0, 0.25));
  var cy = 86 - ry;
  return {
    parts: [
      h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("ellipse", { key: "belly", cx: 50, cy: cy + ry * 0.35, rx: rx * 0.55, ry: ry * 0.4, fill: C.light, opacity: 0.9 }),
      feetNubs(h, C, 50, rx * 0.5, 87),
    ],
    head: { cx: 50, cy: cy - ry * 0.2, r: rx * 0.8 },
    top: { x: 50, y: cy - ry },
    grounded: true,
  };
}

function bodyLanky(h, rand, C) {
  var w = 22 + rand(0, 6);
  var top = 28 + rand(0, 6);
  return {
    parts: [
      h("line", { key: "legL", x1: 44, y1: 80, x2: 41, y2: 88, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
      h("line", { key: "legR", x1: 56, y1: 80, x2: 59, y2: 88, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
      h("rect", { key: "body", x: 50 - w / 2, y: top, width: w, height: 82 - top, rx: w / 2, fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("ellipse", { key: "belly", cx: 50, cy: 68, rx: w * 0.3, ry: 8, fill: C.light, opacity: 0.9 }),
      h("line", { key: "armL", x1: 50 - w / 2, y1: 58, x2: 50 - w / 2 - 9, y2: 66, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
      h("line", { key: "armR", x1: 50 + w / 2, y1: 58, x2: 50 + w / 2 + 9, y2: 66, stroke: C.dark, strokeWidth: 3, strokeLinecap: "round" }),
    ],
    head: { cx: 50, cy: top + 13, r: w * 0.55 },
    top: { x: 50, y: top },
    grounded: true,
  };
}

function bodySquat(h, rand, C) {
  var rx = 29 + rand(0, 5);
  var ry = 14 + rand(0, 4);
  var cy = 87 - ry;
  return {
    parts: [
      h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("ellipse", { key: "belly", cx: 50, cy: cy + ry * 0.4, rx: rx * 0.6, ry: ry * 0.35, fill: C.light, opacity: 0.9 }),
      feetNubs(h, C, 50, rx * 0.6, 88),
    ],
    head: { cx: 50, cy: cy - ry * 0.15, r: ry * 1.1 },
    top: { x: 50, y: cy - ry },
    grounded: true,
  };
}

function bodySerpent(h, rand, C) {
  var headCx = 60 + rand(0, 6);
  var headCy = 38 + rand(0, 6);
  var coil =
    "M22 86 Q34 " + (78 + rand(-4, 4)) + " 46 82 Q64 86 66 70 Q68 56 " + headCx + " " + (headCy + 10);
  return {
    parts: [
      h("path", { key: "coilD", d: coil, stroke: C.dark, strokeWidth: 15, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "coil", d: coil, stroke: C.body, strokeWidth: 11, strokeLinecap: "round", fill: "none" }),
      h("path", {
        key: "tailTip",
        d: "M22 86 L14 " + (80 + rand(0, 6)) + " L24 78 Z",
        fill: C.accent,
        stroke: C.dark,
        strokeWidth: 1.5,
      }),
      h("circle", { key: "headD", cx: headCx, cy: headCy, r: 12.6, fill: C.dark }),
      h("circle", { key: "head", cx: headCx, cy: headCy, r: 11, fill: C.body }),
    ],
    head: { cx: headCx, cy: headCy, r: 11 },
    top: { x: headCx, y: headCy - 11 },
    grounded: false,
  };
}

function bodyMushroom(h, rand, C) {
  var capW = 30 + rand(0, 6);
  var capY = 52 + rand(0, 4);
  var spots = [];
  for (var i = 0; i < 3; i++) {
    spots.push(
      h("circle", {
        key: "capspot" + i,
        cx: 50 + rand(-capW * 0.6, capW * 0.6),
        cy: capY - rand(6, 18),
        r: rand(2, 4),
        fill: C.light,
        opacity: 0.9,
      }),
    );
  }
  return {
    parts: [
      h("rect", { key: "stem", x: 41, y: capY, width: 18, height: 88 - capY, rx: 8, fill: C.light, stroke: C.dark, strokeWidth: 2 }),
      h("path", {
        key: "cap",
        d: "M" + (50 - capW) + " " + capY + " Q50 " + (capY - 34) + " " + (50 + capW) + " " + capY + " Z",
        fill: C.body,
        stroke: C.dark,
        strokeWidth: 2.4,
      }),
      spots,
    ],
    head: { cx: 50, cy: capY + 14, r: 9 },
    top: { x: 50, y: capY - 26 },
    grounded: true,
  };
}

function bodyGhost(h, rand, C) {
  var top = 34 + rand(0, 5);
  return {
    parts: [
      h("path", {
        key: "body",
        d:
          "M30 82 C30 " + top + " 70 " + top + " 70 82 " +
          "Q65 76 60 82 Q55 88 50 82 Q45 76 40 82 Q35 88 30 82 Z",
        fill: C.body,
        stroke: C.dark,
        strokeWidth: 2.2,
        opacity: 0.95,
      }),
      h("circle", { key: "drift1", cx: 26 + rand(0, 4), cy: 60 + rand(0, 10), r: 2, fill: C.light, opacity: 0.8 }),
      h("circle", { key: "drift2", cx: 74 - rand(0, 4), cy: 52 + rand(0, 10), r: 1.6, fill: C.light, opacity: 0.8 }),
    ],
    head: { cx: 50, cy: top + 16, r: 13 },
    top: { x: 50, y: top + 1 },
    grounded: false,
  };
}

function bodyCrystal(h, rand, C) {
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
  return {
    parts: [
      h("polygon", { key: "gem", points: pts.join(" "), fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("path", {
        key: "facet1",
        d: "M" + cx + " " + cy + " L" + pts[1].replace(",", " "),
        stroke: C.light,
        strokeWidth: 1.4,
        opacity: 0.7,
      }),
      h("path", {
        key: "facet2",
        d: "M" + cx + " " + cy + " L" + pts[4].replace(",", " "),
        stroke: C.light,
        strokeWidth: 1.4,
        opacity: 0.7,
      }),
      h("circle", { key: "glint", cx: cx - 9, cy: cy - 12, r: 2, fill: "#ffffff", opacity: 0.9 }),
    ],
    head: { cx: cx, cy: cy - 4, r: 12 },
    top: { x: topPt.x, y: topPt.y },
    grounded: true,
  };
}

function bodyMech(h, rand, C) {
  var w = 30 + rand(0, 6);
  var top = 42 + rand(0, 4);
  var rivets = [];
  for (var i = 0; i < 4; i++) {
    rivets.push(
      h("circle", {
        key: "rivet" + i,
        cx: 50 - w / 2 + 4 + (i % 2) * (w - 8),
        cy: top + 4 + Math.floor(i / 2) * (78 - top - 8),
        r: 1.4,
        fill: C.dark,
      }),
    );
  }
  return {
    parts: [
      h("rect", { key: "treadL", x: 50 - w / 2 - 3, y: 80, width: 12, height: 8, rx: 4, fill: C.dark }),
      h("rect", { key: "treadR", x: 50 + w / 2 - 9, y: 80, width: 12, height: 8, rx: 4, fill: C.dark }),
      h("rect", { key: "body", x: 50 - w / 2, y: top, width: w, height: 82 - top, rx: 5, fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("rect", { key: "panel", x: 50 - w * 0.28, y: 66, width: w * 0.56, height: 10, rx: 2, fill: C.light, opacity: 0.9 }),
      h("rect", { key: "armL", x: 50 - w / 2 - 7, y: top + 10, width: 6, height: 16, rx: 3, fill: C.dark }),
      h("rect", { key: "armR", x: 50 + w / 2 + 1, y: top + 10, width: 6, height: 16, rx: 3, fill: C.dark }),
      rivets,
    ],
    head: { cx: 50, cy: top + 13, r: w * 0.42 },
    top: { x: 50, y: top },
    grounded: true,
  };
}

function bodyAlien(h, rand, C) {
  var rx = 19 + rand(0, 4);
  var ry = 24 + rand(0, 4);
  var cy = 60;
  var tentacles = [];
  for (var i = 0; i < 3; i++) {
    var tx = 50 - rx * 0.6 + i * rx * 0.6;
    tentacles.push(
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
  return {
    parts: [
      tentacles,
      h("ellipse", { key: "body", cx: 50, cy: cy, rx: rx, ry: ry, fill: C.body, stroke: C.dark, strokeWidth: 2.4 }),
      h("ellipse", { key: "sheen", cx: 44, cy: cy - 10, rx: 5, ry: 8, fill: C.light, opacity: 0.6 }),
    ],
    head: { cx: 50, cy: cy - ry * 0.25, r: rx * 0.85, alien: true },
    top: { x: 50, y: cy - ry },
    grounded: false,
  };
}

function bodySprite(h, rand, C) {
  var cy = 50 + rand(0, 4);
  var wingR = 15 + rand(0, 5);
  return {
    parts: [
      h("ellipse", {
        key: "wingL",
        cx: 33,
        cy: cy - 4,
        rx: wingR,
        ry: wingR * 0.45,
        fill: C.accent,
        opacity: 0.75,
        transform: "rotate(-32 33 " + (cy - 4) + ")",
      }),
      h("ellipse", {
        key: "wingR2",
        cx: 67,
        cy: cy - 4,
        rx: wingR,
        ry: wingR * 0.45,
        fill: C.accent,
        opacity: 0.75,
        transform: "rotate(32 67 " + (cy - 4) + ")",
      }),
      h("ellipse", { key: "body", cx: 50, cy: cy, rx: 12, ry: 14, fill: C.body, stroke: C.dark, strokeWidth: 2.2 }),
      h("circle", { key: "dangleL", cx: 46, cy: cy + 17, r: 1.8, fill: C.dark }),
      h("circle", { key: "dangleR", cx: 54, cy: cy + 17, r: 1.8, fill: C.dark }),
      h("circle", { key: "spark1", cx: 50 + rand(-16, 16), cy: cy + 26, r: 1.4, fill: C.accent, opacity: 0.8 }),
      h("circle", { key: "spark2", cx: 50 + rand(-16, 16), cy: cy + 32, r: 1, fill: C.accent, opacity: 0.7 }),
    ],
    head: { cx: 50, cy: cy - 3, r: 10 },
    top: { x: 50, y: cy - 14 },
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
// Part swaps: faces, horns, tails, companions — picked per level, so each
// level gains a signature feature and loses another. Prestige parts (crown
// at 15, halo at 30, aura at 60) only accumulate at milestones.
// ---------------------------------------------------------------------------

function eyePair(h, rand, cx, cy, r, style, key) {
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
      className: "kandev-gotchi-blink",
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

function faceParts(h, rand, C, head) {
  var out = [];
  var style = pick(rand, ["round", "round", "wide", "sleepy", "dot"]);
  var eyeR = (style === "wide" ? 4.8 : 3.9) * Math.min(head.r / 10, 1.4);
  var count = head.alien ? Math.floor(rand(3, 5.99)) : 2;
  if (count === 2) {
    var dx = head.r * 0.5;
    out = out.concat(eyePair(h, rand, head.cx - dx, head.cy, eyeR, style, "eyeL"));
    out = out.concat(eyePair(h, rand, head.cx + dx, head.cy, eyeR, style, "eyeR"));
  } else {
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0 : i / (count - 1) - 0.5;
      var ex = head.cx + t * head.r * 1.3;
      var ey = head.cy - Math.abs(t) * 3 - (i % 2) * 2;
      out = out.concat(eyePair(h, rand, ex, ey, eyeR * (0.7 + rand(0, 0.4)), style, "eye" + i));
    }
  }

  var mouthY = head.cy + head.r * 0.55;
  var mouth = pick(rand, ["smile", "open", "fang", "flat", "wavy"]);
  var mw = head.r * 0.55;
  if (mouth === "smile") {
    out.push(h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + mouthY + " Q" + head.cx + " " + (mouthY + 5) + " " + (head.cx + mw) + " " + mouthY, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }));
  } else if (mouth === "open") {
    out.push(h("ellipse", { key: "mouth", cx: head.cx, cy: mouthY + 1, rx: mw * 0.6, ry: 3, fill: C.dark }));
  } else if (mouth === "fang") {
    out.push(
      h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + mouthY + " Q" + head.cx + " " + (mouthY + 5) + " " + (head.cx + mw) + " " + mouthY, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "fang", d: "M" + (head.cx + mw * 0.4) + " " + (mouthY + 1.5) + " l2.4 4 l2.4 -4.6 Z", fill: "#ffffff", stroke: C.dark, strokeWidth: 0.6 }),
    );
  } else if (mouth === "flat") {
    out.push(h("line", { key: "mouth", x1: head.cx - mw, y1: mouthY + 1, x2: head.cx + mw, y2: mouthY + 1, stroke: C.dark, strokeWidth: 2, strokeLinecap: "round" }));
  } else {
    out.push(h("path", { key: "mouth", d: "M" + (head.cx - mw) + " " + (mouthY + 1) + " q" + mw / 3 + " 3 " + (mw * 2) / 3 + " 0 q" + mw / 3 + " -3 " + (mw * 2) / 3 + " 0", stroke: C.dark, strokeWidth: 1.8, strokeLinecap: "round", fill: "none" }));
  }

  if (rand(0, 1) < 0.5) {
    out.push(
      h("circle", { key: "blushL", cx: head.cx - head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
      h("circle", { key: "blushR", cx: head.cx + head.r * 0.85, cy: head.cy + head.r * 0.35, r: 2.4, fill: "#ff8fa3", opacity: 0.5 }),
    );
  }
  return out;
}

function hornParts(h, rand, C, top) {
  var style = pick(rand, ["none", "nubs", "curved", "antlers", "uni", "antenna"]);
  var out = [];
  var x = top.x;
  var y = top.y;
  if (style === "nubs") {
    out.push(
      h("circle", { key: "nubL", cx: x - 7, cy: y - 2, r: 3, fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
      h("circle", { key: "nubR", cx: x + 7, cy: y - 2, r: 3, fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
    );
  } else if (style === "curved") {
    out.push(
      h("path", { key: "hornL", d: "M" + (x - 8) + " " + (y + 2) + " Q" + (x - 15) + " " + (y - 8) + " " + (x - 9) + " " + (y - 13), stroke: C.dark, strokeWidth: 3.4, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "hornR", d: "M" + (x + 8) + " " + (y + 2) + " Q" + (x + 15) + " " + (y - 8) + " " + (x + 9) + " " + (y - 13), stroke: C.dark, strokeWidth: 3.4, strokeLinecap: "round", fill: "none" }),
    );
  } else if (style === "antlers") {
    out.push(
      h("path", { key: "antL", d: "M" + (x - 7) + " " + (y + 1) + " l-3 -9 m3 4 l-6 -3 m3 -1 l-1 -6", stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
      h("path", { key: "antR", d: "M" + (x + 7) + " " + (y + 1) + " l3 -9 m-3 4 l6 -3 m-3 -1 l1 -6", stroke: C.dark, strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
    );
  } else if (style === "uni") {
    out.push(h("path", { key: "uni", d: "M" + (x - 3) + " " + (y + 1) + " L" + x + " " + (y - 11) + " L" + (x + 3) + " " + (y + 1) + " Z", fill: C.accent, stroke: C.dark, strokeWidth: 1.2 }));
  } else if (style === "antenna") {
    var tip = x + rand(-4, 4);
    out.push(
      h("line", { key: "antline", x1: x, y1: y + 1, x2: tip, y2: y - 11, stroke: C.dark, strokeWidth: 2 }),
      h("circle", { key: "antball", cx: tip, cy: y - 12, r: 2.6, fill: C.accent }),
    );
  }
  return out;
}

function tailParts(h, rand, C) {
  var style = pick(rand, ["none", "curl", "spike", "fluff"]);
  var out = [];
  if (style === "curl") {
    out.push(h("path", { key: "tail", d: "M74 76 Q86 72 84 62 Q82 55 76 58", stroke: C.dark, strokeWidth: 3.4, strokeLinecap: "round", fill: "none" }));
  } else if (style === "spike") {
    out.push(h("path", { key: "tail", d: "M73 78 L88 70 L78 82 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1.4 }));
  } else if (style === "fluff") {
    out.push(
      h("circle", { key: "tail1", cx: 79, cy: 74, r: 5, fill: C.light, stroke: C.dark, strokeWidth: 1.2 }),
      h("circle", { key: "tail2", cx: 85, cy: 70, r: 3.4, fill: C.light, stroke: C.dark, strokeWidth: 1 }),
    );
  }
  return out;
}

function companionParts(h, rand, C) {
  var kind = pick(rand, ["none", "pet", "flag", "tool", "balloon"]);
  var out = [];
  if (kind === "pet") {
    out.push(
      h(
        "g",
        { key: "pet", className: "kandev-gotchi-bob" },
        h("circle", { key: "petb", cx: 15, cy: 80, r: 5, fill: C.accent, stroke: C.dark, strokeWidth: 1.4 }),
        h("circle", { key: "pete1", cx: 13.4, cy: 79, r: 0.9, fill: "#26232e" }),
        h("circle", { key: "pete2", cx: 16.6, cy: 79, r: 0.9, fill: "#26232e" }),
      ),
    );
  } else if (kind === "flag") {
    out.push(
      h("line", { key: "pole", x1: 86, y1: 88, x2: 86, y2: 60, stroke: C.dark, strokeWidth: 1.8 }),
      h("path", { key: "flag", d: "M86 60 L98 64 L86 68 Z", fill: C.accent, stroke: C.dark, strokeWidth: 1 }),
    );
  } else if (kind === "tool") {
    out.push(
      h(
        "g",
        { key: "tool", transform: "rotate(-28 14 82)" },
        h("rect", { key: "toolh", x: 12.5, y: 72, width: 3, height: 14, rx: 1.5, fill: "#9aa0ae" }),
        h("circle", { key: "toolr", cx: 14, cy: 70, r: 4, fill: "none", stroke: "#9aa0ae", strokeWidth: 2.6 }),
      ),
    );
  } else if (kind === "balloon") {
    out.push(
      h(
        "g",
        { key: "balloon", className: "kandev-gotchi-bob" },
        h("path", { key: "bstr", d: "M84 52 Q78 62 82 70", stroke: C.dark, strokeWidth: 1, fill: "none" }),
        h("ellipse", { key: "bball", cx: 84, cy: 45, rx: 6, ry: 7.5, fill: C.accent, stroke: C.dark, strokeWidth: 1.2 }),
      ),
    );
  }
  return out;
}

function prestigeParts(h, C, level, top) {
  var out = [];
  if (level >= 15) {
    var y = top.y - 4;
    out.push(
      h("path", {
        key: "crown",
        d:
          "M" + (top.x - 7) + " " + y + " L" + (top.x - 7) + " " + (y - 5) +
          " L" + (top.x - 2.5) + " " + (y - 1.5) + " L" + top.x + " " + (y - 7) +
          " L" + (top.x + 2.5) + " " + (y - 1.5) + " L" + (top.x + 7) + " " + (y - 5) +
          " L" + (top.x + 7) + " " + y + " Z",
        fill: "#ffd166",
        stroke: "#c9971f",
        strokeWidth: 1.1,
      }),
    );
  }
  if (level >= 30) {
    out.push(
      h("ellipse", { key: "halo", cx: top.x, cy: top.y - 15, rx: 11, ry: 3.2, fill: "none", stroke: "#ffe9a3", strokeWidth: 2, opacity: 0.95 }),
    );
  }
  if (level >= 60) {
    out.push(
      h("circle", { key: "aura", cx: 50, cy: 60, r: 41, fill: "none", stroke: C.accent, strokeWidth: 1.6, opacity: 0.45, strokeDasharray: "5 7" }),
    );
  }
  return out;
}

// creatureParts builds the SVG children for a creature at (level, tier,
// archetype, seed). The backend guarantees adjacent levels use different
// archetypes; palette families jump per level by construction here.
function creatureParts(h, data) {
  var level = data.level;
  var seed = data.appearance_seed >>> 0;
  var rand = makeRand(seed, 7);
  if (level <= 1) return eggSvg(h, rand);

  var hue = familyHue(level, rand);
  var C = {
    body: hsl(hue, 62, 58),
    dark: hsl(hue, 50, 34),
    light: hsl(hue, 58, 78),
    accent: hsl(hue + 150, 72, 62),
  };
  var arch =
    typeof data.archetype === "number" && data.archetype >= 0
      ? data.archetype % BODY_BUILDERS.length
      : (level - 2) % BODY_BUILDERS.length;

  var body = BODY_BUILDERS[arch](h, rand, C);
  var parts = [].concat(body.parts);
  parts = parts.concat(faceParts(h, rand, C, body.head));
  parts = parts.concat(hornParts(h, rand, C, body.top));
  if (body.grounded) parts = parts.concat(tailParts(h, rand, C));
  parts = parts.concat(companionParts(h, rand, C));
  parts = parts.concat(prestigeParts(h, C, level, body.top));
  return parts;
}

function creatureSvg(h, data, size, extraClass) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 100 100",
      className: extraClass || "",
      "aria-hidden": "true",
      style: { overflow: "visible", flexShrink: 0 },
    },
    h("g", { className: "kandev-gotchi-bob" }, creatureParts(h, data)),
  );
}

// ---------------------------------------------------------------------------
// Scene backgrounds — 14 environments; band levels tour them in 2-3 level
// blocks (order shuffled per instance, chosen server-side via `tier`).
// Beyond the band: seeded cosmos with rotating hue and more stars, forever.
// ---------------------------------------------------------------------------

function stars(h, rand, count, tint) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(
      h("circle", {
        key: "star" + i,
        cx: rand(0, 240),
        cy: rand(0, 90),
        r: rand(0.4, 1.5),
        fill: tint || "#ffffff",
        opacity: rand(0.4, 1),
      }),
    );
  }
  return out;
}

function treeProps(h, rand, count, fill) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(10, 230);
    var w = rand(10, 18);
    var ht = rand(22, 42);
    out.push(
      h("path", {
        key: "tree" + i,
        d: "M" + x + " 120 L" + (x + w / 2) + " " + (120 - ht) + " L" + (x + w) + " 120 Z",
        fill: fill,
        opacity: rand(0.6, 0.95),
      }),
    );
  }
  return out;
}

function buildingProps(h, rand, dark, windowColor) {
  var out = [];
  var x = 4;
  var b = 0;
  while (x < 225) {
    var w = rand(18, 34);
    var ht = rand(30, 78);
    out.push(h("rect", { key: "b" + b, x: x, y: 120 - ht, width: w, height: ht, fill: dark, opacity: 0.9 }));
    var wins = Math.floor(rand(2, 6));
    for (var wi = 0; wi < wins; wi++) {
      out.push(
        h("rect", {
          key: "b" + b + "w" + wi,
          x: x + rand(2, w - 6),
          y: 120 - ht + rand(4, ht - 8),
          width: 3,
          height: 4,
          fill: windowColor,
          opacity: rand(0.5, 1),
        }),
      );
    }
    x += w + rand(4, 12);
    b++;
  }
  return out;
}

// h0 is bound at initialize time so scene helpers can stay top-level.
var h0 = null;

function grassBlades(rand) {
  var out = [];
  for (var i = 0; i < 14; i++) {
    var x = rand(4, 236);
    out.push(
      h0("path", {
        key: "grass" + i,
        d: "M" + x + " 120 Q" + (x + rand(-3, 3)) + " " + rand(104, 112) + " " + (x + rand(-1, 1)) + " " + rand(100, 108),
        stroke: "#4c8a3f",
        strokeWidth: 1.6,
        fill: "none",
        opacity: 0.8,
      }),
    );
  }
  return out;
}

function waves(rand) {
  var out = [];
  for (var i = 0; i < 5; i++) {
    var y = 78 + i * 9;
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

function mountains(rand) {
  var out = [];
  var x = -10;
  var i = 0;
  while (x < 230) {
    var w = rand(60, 110);
    var peak = rand(18, 42);
    out.push(
      h0("path", { key: "mtn" + i, d: "M" + x + " 120 L" + (x + w / 2) + " " + peak + " L" + (x + w) + " 120 Z", fill: "#41527a", opacity: 0.85 }),
      h0("path", {
        key: "cap" + i,
        d: "M" + (x + w / 2 - 9) + " " + (peak + 12) + " L" + (x + w / 2) + " " + peak + " L" + (x + w / 2 + 9) + " " + (peak + 12) + " Z",
        fill: "#eef2fb",
        opacity: 0.95,
      }),
    );
    x += w * 0.7;
    i++;
  }
  return out;
}

function auroraRibbons(rand) {
  var out = [];
  for (var i = 0; i < 3; i++) {
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

function planet(rand, hue) {
  var cx = rand(180, 215);
  var cy = rand(18, 34);
  return [
    h0("circle", { key: "planet", cx: cx, cy: cy, r: 11, fill: hsl(hue, 60, 62), opacity: 0.95 }),
    h0("ellipse", {
      key: "ring",
      cx: cx,
      cy: cy,
      rx: 18,
      ry: 5,
      fill: "none",
      stroke: hsl(hue + 30, 70, 78),
      strokeWidth: 1.6,
      opacity: 0.8,
      transform: "rotate(-18 " + cx + " " + cy + ")",
    }),
  ];
}

function stalactites(rand) {
  var out = [];
  var x = 8;
  var i = 0;
  while (x < 232) {
    var w = rand(8, 18);
    var len = rand(12, 34);
    out.push(h0("path", { key: "stal" + i, d: "M" + x + " 0 L" + (x + w / 2) + " " + len + " L" + (x + w) + " 0 Z", fill: "#2c2530", opacity: 0.9 }));
    x += w + rand(4, 14);
    i++;
  }
  for (var c = 0; c < 4; c++) {
    var cx = rand(15, 225);
    out.push(h0("path", { key: "cryst" + c, d: "M" + cx + " 120 L" + (cx + 4) + " " + rand(98, 108) + " L" + (cx + 8) + " 120 Z", fill: "#8ee3ff", opacity: 0.8 }));
  }
  return out;
}

function dunes(rand) {
  return [
    h0("path", { key: "dune1", d: "M-10 120 Q60 " + rand(78, 92) + " 130 112 T 250 104 L250 130 L-10 130 Z", fill: "#e0b96a", opacity: 0.9 }),
    h0("path", { key: "dune2", d: "M-10 120 Q90 " + rand(96, 106) + " 250 118 L250 130 L-10 130 Z", fill: "#c99b4e", opacity: 0.9 }),
    h0("circle", { key: "dsun", cx: rand(190, 215), cy: rand(16, 28), r: 12, fill: "#fff1b8", opacity: 0.95 }),
    h0("path", { key: "cactus", d: "M30 118 L30 96 M30 104 L22 104 L22 96 M30 108 L38 108 L38 100", stroke: "#3f7d44", strokeWidth: 4, strokeLinecap: "round", fill: "none" }),
  ];
}

function ruinsProps(rand) {
  var out = [];
  var x = 20;
  var i = 0;
  while (x < 220) {
    var htp = rand(30, 64);
    var broken = rand(0, 1) < 0.4;
    out.push(
      h0("rect", { key: "col" + i, x: x, y: 120 - htp, width: 12, height: htp, fill: "#cfc6b4", opacity: 0.95 }),
      h0("rect", { key: "colcap" + i, x: x - 3, y: 120 - htp - 5, width: 18, height: 5, rx: 1, fill: broken ? "#b3a893" : "#ded5c2" }),
    );
    if (broken) {
      out.push(h0("rect", { key: "rub" + i, x: x + rand(-8, 14), y: 114, width: 8, height: 6, rx: 1, fill: "#b3a893" }));
    }
    x += rand(34, 56);
    i++;
  }
  return out;
}

function volcanoProps(rand) {
  return [
    h0("path", { key: "cone", d: "M40 120 L95 30 L150 120 Z", fill: "#4a2b2b", opacity: 0.95 }),
    h0("path", { key: "lava", d: "M88 36 Q95 30 102 36 L98 58 L92 58 Z", fill: "#ff7b42", opacity: 0.95 }),
    h0("circle", { key: "glow", cx: 95, cy: 32, r: 10, fill: "#ffb25e", opacity: 0.5 }),
    h0("circle", { key: "ember1", cx: rand(70, 120), cy: rand(10, 30), r: 1.6, fill: "#ffc06e", opacity: 0.9 }),
    h0("circle", { key: "ember2", cx: rand(70, 130), cy: rand(6, 26), r: 1.2, fill: "#ff9457", opacity: 0.9 }),
    h0("circle", { key: "ember3", cx: rand(150, 220), cy: rand(20, 50), r: 1.4, fill: "#ffc06e", opacity: 0.7 }),
  ];
}

function workshopProps(rand) {
  return [
    h0("line", { key: "shelf1", x1: 12, y1: 34, x2: 90, y2: 34, stroke: "#8a6a48", strokeWidth: 4 }),
    h0("rect", { key: "jar1", x: 20, y: 22, width: 10, height: 12, rx: 2, fill: "#a3c9a8", opacity: 0.9 }),
    h0("rect", { key: "jar2", x: 38, y: 20, width: 8, height: 14, rx: 2, fill: "#c9a3a3", opacity: 0.9 }),
    h0("rect", { key: "book", x: 56, y: 24, width: 16, height: 10, rx: 1, fill: "#7d8ec9" }),
    h0("circle", { key: "gear", cx: 200, cy: 40, r: 16, fill: "none", stroke: "#8f8574", strokeWidth: 5, strokeDasharray: "6 4" }),
    h0("circle", { key: "gearhub", cx: 200, cy: 40, r: 5, fill: "#8f8574" }),
    h0("line", { key: "cord", x1: 140, y1: 0, x2: 140, y2: 22, stroke: "#6b6152", strokeWidth: 2 }),
    h0("circle", { key: "bulb", cx: 140, cy: 27, r: 6, fill: "#ffe9a3", opacity: 0.95 }),
  ];
}

function underwaterProps(rand) {
  var out = [];
  for (var i = 0; i < 8; i++) {
    out.push(h0("circle", { key: "bub" + i, cx: rand(10, 230), cy: rand(8, 80), r: rand(1, 3.4), fill: "none", stroke: "#bfe7ff", strokeWidth: 1, opacity: rand(0.4, 0.9) }));
  }
  for (var s = 0; s < 5; s++) {
    var x = rand(10, 230);
    out.push(
      h0("path", {
        key: "weed" + s,
        d: "M" + x + " 120 Q" + (x - 6) + " " + rand(96, 106) + " " + x + " " + rand(84, 94) + " Q" + (x + 6) + " " + rand(72, 82) + " " + x + " " + rand(64, 74),
        stroke: "#3f9c7a",
        strokeWidth: 3,
        strokeLinecap: "round",
        fill: "none",
        opacity: 0.85,
      }),
    );
  }
  return out;
}

function sceneFor(tier, seed) {
  var rand = makeRand(seed >>> 0, 11);
  switch (tier) {
    case 0:
      return {
        bg: "linear-gradient(to bottom, #a5ddf2 0%, #d9f0b4 68%, #a9d97e 100%)",
        props: [h0("circle", { key: "sun", cx: 205, cy: 22, r: 13, fill: "#ffdf6b", opacity: 0.95 })].concat(grassBlades(rand)),
      };
    case 1:
      return {
        bg: "linear-gradient(to bottom, #b7d9b0 0%, #57905d 65%, #2f5e3c 100%)",
        props: treeProps(h0, rand, 7, "#1d4d31"),
      };
    case 2:
      return {
        bg: "linear-gradient(to bottom, #a8d8ea 0%, #5ca8d8 55%, #2f6f9f 100%)",
        props: waves(rand),
      };
    case 3:
      return {
        bg: "linear-gradient(to bottom, #cdd7e8 0%, #8fa3c4 60%, #5c6f96 100%)",
        props: mountains(rand),
      };
    case 4:
      return {
        bg: "linear-gradient(to bottom, #f7b267 0%, #e2698f 60%, #6d4a7c 100%)",
        props: buildingProps(h0, rand, "#3d2c4f", "#ffd166"),
      };
    case 5:
      return {
        bg: "linear-gradient(to bottom, #1b1035 0%, #3b1f5e 60%, #17102b 100%)",
        props: buildingProps(h0, rand, "#0d0a1a", "#ff5fd2").concat(stars(h0, rand, 12, "#9be7ff")),
      };
    case 6:
      return {
        bg: "linear-gradient(to bottom, #05202b 0%, #0b3b45 60%, #062028 100%)",
        props: auroraRibbons(rand).concat(stars(h0, rand, 18)),
      };
    case 7:
      return {
        bg: "linear-gradient(to bottom, #100a2e 0%, #241457 60%, #0a0620 100%)",
        props: stars(h0, rand, 30).concat(planet(rand, 265)),
      };
    case 8:
      return {
        bg: "linear-gradient(to bottom, #241d26 0%, #3a3040 60%, #17131a 100%)",
        props: stalactites(rand),
      };
    case 9:
      return {
        bg: "linear-gradient(to bottom, #ffe4b0 0%, #f6c67e 60%, #e0aa5c 100%)",
        props: dunes(rand),
      };
    case 10:
      return {
        bg: "linear-gradient(to bottom, #cfe3e8 0%, #a8c3bd 60%, #7fa08f 100%)",
        props: ruinsProps(rand),
      };
    case 11:
      return {
        bg: "linear-gradient(to bottom, #3a1414 0%, #6e2b1c 60%, #251010 100%)",
        props: volcanoProps(rand),
      };
    case 12:
      return {
        bg: "linear-gradient(to bottom, #e8d9bd 0%, #cdb694 60%, #a98f6d 100%)",
        props: workshopProps(rand),
      };
    case 13:
      return {
        bg: "linear-gradient(to bottom, #1c4e6e 0%, #14618a 55%, #082c44 100%)",
        props: underwaterProps(rand),
      };
    default: {
      var hue = (265 + (tier - 13) * 47 + Math.floor(rand(0, 40))) % 360;
      return {
        bg:
          "linear-gradient(to bottom, " + hsl(hue, 55, 14) + " 0%, " +
          hsl(hue + 35, 60, 24) + " 60%, " + hsl(hue, 60, 8) + " 100%)",
        props: stars(h0, rand, Math.min(30 + tier * 2, 80)).concat(planet(rand, hue + 60)),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Animations — injected once; disabled under prefers-reduced-motion.
// ---------------------------------------------------------------------------

var GOTCHI_CSS =
  "@keyframes kandev-gotchi-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}" +
  "@keyframes kandev-gotchi-blink{0%,90%,100%{transform:scaleY(1)}93%,96%{transform:scaleY(0.08)}}" +
  "@keyframes kandev-gotchi-wiggle{0%,86%,100%{transform:rotate(0deg)}90%{transform:rotate(-4deg)}94%{transform:rotate(4deg)}}" +
  ".kandev-gotchi-bob{animation:kandev-gotchi-bob 2.8s ease-in-out infinite}" +
  ".kandev-gotchi-blink{animation:kandev-gotchi-blink 4.6s ease-in-out infinite}" +
  ".kandev-gotchi-wiggle{animation:kandev-gotchi-wiggle 7s ease-in-out infinite;transform-origin:50% 70%}" +
  "@media (prefers-reduced-motion: reduce){.kandev-gotchi-bob,.kandev-gotchi-blink,.kandev-gotchi-wiggle{animation:none}}";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  var el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = GOTCHI_CSS;
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
  tier: 0,
  archetype: -1,
  stage_name: "Egg",
  progress_pct: 0,
  appearance_seed: 1,
  flavor: "The egg is warm. Keep working.",
};

function gotchiCard(h, data) {
  var scene = sceneFor(data.tier, data.appearance_seed >>> 0);
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
          className: "kandev-gotchi-wiggle",
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

function makeGotchiWidget(host) {
  var React = host.React;
  var h = host.jsx;
  var ui = host.ui;
  var Tooltip = ui.Tooltip;
  var TooltipTrigger = ui.TooltipTrigger;
  var TooltipContent = ui.TooltipContent;

  return function GotchiWidget() {
    var stateHook = React.useState(null);
    var data = stateHook[0];
    var setData = stateHook[1];
    var mountedRef = React.useRef(true);

    function load() {
      host.api
        .fetch("webhooks/gotchi")
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

    return h(
      Tooltip,
      null,
      h(
        TooltipTrigger,
        { asChild: true },
        h(
          "div",
          {
            id: "kandev-gotchi-widget",
            className: "h-7 flex items-center px-1 cursor-default rounded hover:bg-muted/40",
            "aria-label": "Kandev Gotchi: level " + shown.level + " " + shown.stage_name,
            onMouseEnter: load,
            onFocus: load,
          },
          creatureSvg(h, shown, 24),
        ),
      ),
      h(
        TooltipContent,
        { side: "bottom", align: "end", className: "p-0 overflow-hidden" },
        gotchiCard(h, shown),
      ),
    );
  };
}

window.registerKandevPlugin(PLUGIN_ID, {
  initialize: function (registry, host) {
    h0 = host.jsx;
    injectStyles();
    registry.registerComponent("chat-top-bar", makeGotchiWidget(host));
  },
  destroy: function () {
    removeStyles();
  },
  // Pure, deterministic render helpers exposed for offline tooling (the
  // evolution-sheet poster in demo/). Harmless in production: kandev's
  // plugin loader only reads initialize/destroy.
  __render: {
    creatureSvg: creatureSvg,
    creatureParts: creatureParts,
    sceneFor: sceneFor,
    setJsx: function (jsx) {
      h0 = jsx;
    },
  },
});
