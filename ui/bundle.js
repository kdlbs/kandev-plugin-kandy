// Kandev Gotchi — chat-top-bar plugin. A tiny creature that lives in the
// session top bar and evolves forever from work happening in this kandev
// instance. All growth logic is server-side; this bundle only renders what
// GET webhooks/gotchi returns: { level, tier, stage_name, progress_pct,
// appearance_seed, flavor, alive_since }.
//
// The creature and its scene are composed procedurally and *deterministically*
// from appearance_seed/tier/level (seeded PRNG, no Math.random at render
// time), so the same level always looks the same and never flickers.

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

function hsl(h, s, l) {
  return "hsl(" + (((h % 360) + 360) % 360) + ", " + s + "%, " + l + "%)";
}

// ---------------------------------------------------------------------------
// Tier palettes — a new color family every visual era, hue-jittered by seed.
// Past the handcrafted list, hues keep rotating so late tiers stay novel.
// ---------------------------------------------------------------------------

var TIER_HUES = [100, 155, 195, 250, 25, 300, 170, 265];

function tierHue(tier, rand) {
  var base =
    tier < TIER_HUES.length ? TIER_HUES[tier] : (TIER_HUES[7] + (tier - 7) * 47) % 360;
  return base + rand(-18, 18);
}

// ---------------------------------------------------------------------------
// Procedural creature. viewBox 0 0 100 100; parts accumulate with level,
// palettes shift with tier, offsets/counts jitter with the seed.
// ---------------------------------------------------------------------------

function eggSvg(h, rand) {
  var spots = [];
  var n = 3;
  for (var i = 0; i < n; i++) {
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

function spikes(h, rand, level, cx, cy, bodyRx, bodyRy, stroke) {
  var count = Math.min(2 + Math.floor(level / 3), 14);
  var out = [];
  for (var i = 0; i < count; i++) {
    var angle = -Math.PI * (0.18 + (0.64 * i) / Math.max(count - 1, 1));
    var len = rand(5, 9) + Math.min(level * 0.2, 6);
    var bx = cx + Math.cos(angle) * bodyRx * 0.98;
    var by = cy + Math.sin(angle) * bodyRy * 0.98;
    var tx = cx + Math.cos(angle) * (bodyRx + len);
    var ty = cy + Math.sin(angle) * (bodyRy + len);
    out.push(
      h("path", {
        key: "spike" + i,
        d: "M" + bx + " " + by + " L" + tx + " " + ty,
        stroke: stroke,
        strokeWidth: 3.2,
        strokeLinecap: "round",
      }),
    );
  }
  return out;
}

function orbitDots(h, rand, level, hue) {
  var count = Math.min(2 + Math.floor(level / 8), 8);
  var out = [];
  for (var i = 0; i < count; i++) {
    var angle = rand(0, Math.PI * 2);
    out.push(
      h("circle", {
        key: "orbit" + i,
        cx: 50 + Math.cos(angle) * rand(34, 44),
        cy: 52 + Math.sin(angle) * rand(26, 34),
        r: rand(1.2, 2.6),
        fill: hsl(hue + 40, 80, 75),
        opacity: 0.85,
      }),
    );
  }
  return out;
}

// creatureParts builds the SVG children for a creature at (level, tier, seed).
function creatureParts(h, data) {
  var level = data.level;
  var tier = data.tier;
  var rand = makeRand(data.appearance_seed >>> 0, 7);
  if (level <= 1) return eggSvg(h, rand);

  var hue = tierHue(tier, rand);
  var body = hsl(hue, 62, 60);
  var bodyDark = hsl(hue, 52, 36);
  var belly = hsl(hue, 55, 76);

  var cx = 50;
  var cy = 58;
  var bodyRx = 20 + Math.min(level * 0.7, 12) + rand(0, 4);
  var bodyRy = bodyRx * (0.82 + rand(0, 0.28));
  var parts = [];

  // Behind-body parts first.
  if (tier >= 4) {
    parts.push(
      h("ellipse", {
        key: "wingL",
        cx: cx - bodyRx - 4,
        cy: cy - 6,
        rx: 10 + rand(0, 4),
        ry: 5 + rand(0, 2),
        fill: hsl(hue + 30, 70, 72),
        opacity: 0.85,
        transform: "rotate(" + rand(-40, -20) + " " + (cx - bodyRx - 4) + " " + (cy - 6) + ")",
      }),
      h("ellipse", {
        key: "wingR",
        cx: cx + bodyRx + 4,
        cy: cy - 6,
        rx: 10 + rand(0, 4),
        ry: 5 + rand(0, 2),
        fill: hsl(hue + 30, 70, 72),
        opacity: 0.85,
        transform: "rotate(" + rand(20, 40) + " " + (cx + bodyRx + 4) + " " + (cy - 6) + ")",
      }),
    );
  }
  if (tier >= 3) {
    parts.push(
      h("path", {
        key: "tail",
        d:
          "M" + (cx + bodyRx - 2) + " " + (cy + 8) +
          " Q" + (cx + bodyRx + 14) + " " + (cy + rand(0, 10)) +
          " " + (cx + bodyRx + 9) + " " + (cy - 10),
        stroke: bodyDark,
        strokeWidth: 4,
        strokeLinecap: "round",
        fill: "none",
      }),
    );
  }
  if (level >= 4) {
    parts = parts.concat(spikes(h, rand, level, cx, cy, bodyRx, bodyRy, bodyDark));
  }
  if (tier >= 1) {
    var earDx = bodyRx * 0.55;
    for (var e = 0; e < 2; e++) {
      var ex = cx + (e === 0 ? -earDx : earDx);
      var etop = cy - bodyRy - rand(7, 12);
      parts.push(
        h("path", {
          key: "ear" + e,
          d: "M" + ex + " " + (cy - bodyRy + 4) + " L" + ex + " " + etop,
          stroke: bodyDark,
          strokeWidth: 2.6,
          strokeLinecap: "round",
        }),
        h("circle", { key: "eartip" + e, cx: ex, cy: etop, r: 2.6, fill: hsl(hue + 20, 75, 68) }),
      );
    }
  }

  // Body + belly.
  parts.push(
    h("ellipse", {
      key: "body",
      cx: cx,
      cy: cy,
      rx: bodyRx,
      ry: bodyRy,
      fill: body,
      stroke: bodyDark,
      strokeWidth: 2.4,
    }),
  );
  if (tier >= 2) {
    parts.push(
      h("ellipse", {
        key: "belly",
        cx: cx,
        cy: cy + bodyRy * 0.35,
        rx: bodyRx * 0.55,
        ry: bodyRy * 0.42,
        fill: belly,
        opacity: 0.9,
      }),
    );
  }
  if (tier >= 2) {
    parts.push(
      h("ellipse", { key: "footL", cx: cx - bodyRx * 0.5, cy: cy + bodyRy - 1, rx: 5, ry: 3, fill: bodyDark }),
      h("ellipse", { key: "footR", cx: cx + bodyRx * 0.5, cy: cy + bodyRy - 1, rx: 5, ry: 3, fill: bodyDark }),
    );
  }

  // Face.
  var eyeDx = 8 + rand(0, 3);
  var eyeR = 4.2 + rand(0, 1.6);
  var eyeCy = cy - bodyRy * 0.25;
  for (var i = 0; i < 2; i++) {
    var ecx = cx + (i === 0 ? -eyeDx : eyeDx);
    parts.push(
      h("circle", { key: "eyeW" + i, cx: ecx, cy: eyeCy, r: eyeR, fill: "#ffffff" }),
      h("circle", {
        key: "eyeP" + i,
        cx: ecx + rand(-0.8, 0.8),
        cy: eyeCy,
        r: eyeR * 0.45,
        fill: "#26232e",
        className: "kandev-gotchi-blink",
        style: { transformBox: "fill-box", transformOrigin: "center" },
      }),
    );
  }
  if (level >= 3) {
    var mw = 4 + Math.min(level, 10) * 0.5;
    parts.push(
      h("path", {
        key: "mouth",
        d:
          "M" + (cx - mw) + " " + (cy + bodyRy * 0.18) +
          " Q" + cx + " " + (cy + bodyRy * 0.18 + rand(3, 6)) +
          " " + (cx + mw) + " " + (cy + bodyRy * 0.18),
        stroke: bodyDark,
        strokeWidth: 2,
        strokeLinecap: "round",
        fill: "none",
      }),
    );
  }
  if (level >= 5) {
    parts.push(
      h("circle", { key: "blushL", cx: cx - eyeDx - 5, cy: eyeCy + 7, r: 3, fill: "#ff8fa3", opacity: 0.5 }),
      h("circle", { key: "blushR", cx: cx + eyeDx + 5, cy: eyeCy + 7, r: 3, fill: "#ff8fa3", opacity: 0.5 }),
    );
  }

  // Regalia at high tiers.
  if (tier >= 5) {
    var crownY = cy - bodyRy - 6;
    parts.push(
      h("path", {
        key: "crown",
        d:
          "M" + (cx - 8) + " " + crownY + " L" + (cx - 8) + " " + (crownY - 6) +
          " L" + (cx - 3) + " " + (crownY - 2) + " L" + cx + " " + (crownY - 8) +
          " L" + (cx + 3) + " " + (crownY - 2) + " L" + (cx + 8) + " " + (crownY - 6) +
          " L" + (cx + 8) + " " + crownY + " Z",
        fill: "#ffd166",
        stroke: "#c9971f",
        strokeWidth: 1.2,
      }),
    );
  }
  if (tier >= 6) {
    parts.push(
      h("ellipse", {
        key: "halo",
        cx: cx,
        cy: cy - bodyRy - 14,
        rx: 12,
        ry: 3.5,
        fill: "none",
        stroke: hsl(hue + 60, 90, 78),
        strokeWidth: 2,
        opacity: 0.9,
      }),
    );
  }
  if (tier >= 7) {
    parts = parts.concat(orbitDots(h, rand, level, hue));
  }
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
// Scene backgrounds — a new environment per tier: meadow, forest, lake,
// mountain, city dusk, neon night, aurora, deep space; beyond that, seeded
// hue-shifted cosmos with ever more stars.
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
    out.push(
      h("rect", { key: "b" + b, x: x, y: 120 - ht, width: w, height: ht, fill: dark, opacity: 0.9 }),
    );
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

function sceneFor(tier, seed) {
  var rand = makeRand(seed >>> 0, 11);
  switch (tier) {
    case 0:
      return {
        bg: "linear-gradient(to bottom, #a5ddf2 0%, #d9f0b4 68%, #a9d97e 100%)",
        props: [h0("circle", { key: "sun", cx: 205, cy: 22, r: 13, fill: "#ffdf6b", opacity: 0.95 })].concat(
          grassBlades(rand),
        ),
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
        props: aurora(rand).concat(stars(h0, rand, 18)),
      };
    case 7:
      return {
        bg: "linear-gradient(to bottom, #100a2e 0%, #241457 60%, #0a0620 100%)",
        props: stars(h0, rand, 30).concat(planet(rand, 265)),
      };
    default: {
      var hue = (265 + (tier - 7) * 47 + Math.floor(rand(0, 40))) % 360;
      return {
        bg:
          "linear-gradient(to bottom, " + hsl(hue, 55, 14) + " 0%, " +
          hsl(hue + 35, 60, 24) + " 60%, " + hsl(hue, 60, 8) + " 100%)",
        props: stars(h0, rand, Math.min(30 + tier * 3, 80)).concat(planet(rand, hue + 60)),
      };
    }
  }
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
      h0("path", {
        key: "mtn" + i,
        d: "M" + x + " 120 L" + (x + w / 2) + " " + peak + " L" + (x + w) + " 120 Z",
        fill: "#41527a",
        opacity: 0.85,
      }),
      h0("path", {
        key: "cap" + i,
        d:
          "M" + (x + w / 2 - 9) + " " + (peak + 12) + " L" + (x + w / 2) + " " + peak +
          " L" + (x + w / 2 + 9) + " " + (peak + 12) + " Z",
        fill: "#eef2fb",
        opacity: 0.95,
      }),
    );
    x += w * 0.7;
    i++;
  }
  return out;
}

function aurora(rand) {
  var out = [];
  for (var i = 0; i < 3; i++) {
    var y = 14 + i * 14;
    out.push(
      h0("path", {
        key: "aur" + i,
        d:
          "M-10 " + (y + rand(0, 8)) + " Q 60 " + (y - rand(6, 16)) + " 120 " + (y + rand(0, 10)) +
          " T 250 " + (y - rand(0, 10)),
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
