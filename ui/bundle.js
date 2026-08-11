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
//
// v0.6.2 — resize the dialog at will: a drag grip in the dialog's bottom-
//   right corner maps the pointer delta onto a CONTINUOUS zoom of the same
//   248px card design (clamped to [1.0, 2.2] and to viewport fit). The
//   chosen zoom persists in localStorage; double-clicking the grip snaps
//   back to the 1.45 default. Phones (≤480px) keep the fixed compact card
//   with no grip. Pure presentation: the server is untouched.
//
// v0.6.5 — hold-to-tip the bucket on touch: COARSE pointers (pointerType
//   "touch"/"pen") can finally bonk deliberately. Pressing and holding the
//   creature starts a bucket-tip progress — a small bucket appears above
//   the head (bonkContactFor) and tilts toward its pour angle over
//   BONK_HOLD_MS (700ms). Holding to completion triggers the exact
//   existing bonk flow (POST + drench + distrust window); the synthetic
//   click that follows touchend is suppressed so it can't ALSO pet.
//   Releasing early rights the bucket and fades it, and the release
//   disambiguates by duration: < HOLD_TAP_MAX_MS (250ms) is a plain tap =
//   pet ONLY; a 250-700ms held-then-released press does NOTHING (neither
//   pet nor bonk — a hesitation). Desktop mouse is completely unchanged
//   (click pet, right-click bonk, no hold behavior). Under reduced motion
//   there is no progressive tilt: a static bucket appears at half-hold as
//   the "about to commit" signal. The hint line gains a touch variant
//   ("tap to treat · hold to douse") via matchMedia("(pointer: coarse)").
//
// v0.7.0 — speech bubbles + seasons + arrival greetings (client-only):
//   SPEECH is a ~100-line pool organized by temperament band x context
//   (time-of-day, mood, refusal, season, scarred, sleep-talk). A comic
//   bubble appears near the creature's head (bonkContactFor anchoring),
//   styled like the app's popovers. Selection is fully deterministic:
//   a per-minute clock tick passes a seeded probability gate
//   (hash(lineage_seed, tick) — a bubble every ~4 min of card-open time,
//   sleep-talk on ~10% of sleep ticks), the line is a seeded hash pick
//   from the band+context pool (generic band pool as fallback) with a
//   last-3 no-repeat guard. Dialog open always greets. Seasons derive
//   from the client month (northern-hemisphere mapping) and layer like
//   the day/night system: a tint plus seeded drifting particles (snow /
//   petals / night fireflies / leaves); celestial phases 4-5 get only
//   the subtlest tint — space has no weather. A ~1min last-seen
//   localStorage stamp powers the arrival greeting: a >= 6h gap earns a
//   wave-ish hop + motion arcs + a time-appropriate greeting line on the
//   next dialog open. Every new visual takes an explicit parameter with
//   a neutral default (season/speech unset = nothing), so offline
//   tooling and old callers keep byte-identical renders.
//
// v0.7.1 — deeper voice, guaranteed variety, and a calmer cadence:
//   the SPEECH pool grows to ~250 lines (18-24 generics per band — the
//   old 6-per-band pools made a fearful kandy cycle the same four
//   sentences). Line selection moves from a per-tick hash pick to a
//   seeded SHUFFLE BAG per (lineage, slice): a deterministic permutation
//   (lineage_seed + slice name) walked by a persistent localStorage
//   counter ("kandev-kandy-speech-bag:<slice>"), so every line in a
//   slice plays before any repeats; on exhaustion the bag reshuffles
//   with a counter-derived seed (guarding the pass boundary against an
//   immediate repeat). Generic-slice bags are augmented with ~25%
//   adjacent-band borrowing (fearful<->wary<->neutral<->content<->
//   beloved) and, for scarred kandys, ~15% scarred spice — both
//   structural (extra lines shuffled into the bag), so the fractions
//   and the picks stay deterministic from the counter. Bubbles now obey
//   a single 30-minute cooldown ("kandev-kandy-last-bubble") across
//   ambient ticks AND dialog-open greetings; only the >=6h arrival
//   greeting bypasses it (and re-stamps it). The bubble itself is now
//   always white with dark text (it lives inside the illustrated scene,
//   not the UI chrome) and clamps on both axes so tall creatures and
//   long lines never poke past the card.
//
// v0.8.0 — they walk now, and they cry when sad (pure client):
//   WANDER: a new state-driven layer between the layout transform and the
//   gait wrappers lets the creature stroll along the scene floor. Strolls
//   are deterministic (hash of lineage_seed + a 10s time bucket, mood-
//   modulated: elated/happy often, content normal, bored rare, sad/gloomy
//   almost never, asleep/egg/reduced-motion never), targets clamp to
//   ±35px AND the body's own half-width so it never crosses the scene
//   edge (which CLIPS: the scene's overflow hidden swallows anything that
//   pokes past, wide Lv60+ auras included). Movement is smoothstepped at
//   ~22px/s — except the cogling, which steps in discrete 3px increments
//   on linear time, like the robot it is. Each archetype walks in
//   character (waddle / stride / slither / shuffle / drift / hop-skip /
//   glide) via transform-only keyframes on a dedicated gait wrapper;
//   facing flips on a separate scaleX wrapper. Every bonkContactFor
//   consumer (treat, bucket, bubble, hold-to-tip, greeting arcs, tears)
//   takes the live wander offset, and the pet-zone BUTTON rides inside
//   the wander layer so clicking the creature where it visually stands
//   always works. Interactions freeze the current leg in place (no
//   resume — see freezeMotionForInteraction for the chosen semantics).
//   CRY: sad kandys hold occasional ~12s crying bouts (deterministic
//   15s-bucket gate, ~every 3-5min of open-card time; gloomy doubles the
//   odds; never while walking, sleeping, or mid-interaction — a bout due
//   mid-stroll waits for the stroll to finish). Tears spawn at the EXACT
//   eye positions from the renderer's own face geometry (per archetype,
//   per stage — every one of a gazer's 3-5 eyes weeps) and gravity-fall
//   on ~1.1s cycles with phase offsets; a sob-shudder rocks the
//   animation-safe wrapper every ~2.5s; a small capped puddle grows under
//   it and fades as the bout ends. Composes over the existing sad face.
//   Reduced motion: no walking at all, no animated tears (the static
//   teardrop stays). Server untouched.

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
  "session.prompt_usage",
];
// The plugin backend awards XP when its own event delivery lands, which races
// the WS notification to the browser. Debounce so a burst of events costs one
// refetch, and so the refetch happens after the award has settled.
var WS_DEBOUNCE_MS = 1500;

// The widget re-reads the local clock on this tick so dusk (and bedtime)
// arrive on their own, without needing a refetch or a page interaction.
var TIME_TICK_MS = 60000;

// The two halves of the grotto walk, each matching its CSS animation with a
// frame to spare: Kandy leaves frame, the panel swaps while it is off screen,
// then it walks back in on the other side.
var GROTTO_WALK_OUT_MS = 640;
var GROTTO_WALK_IN_MS = 940;

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

// kandyStationaryFor — the egg-stage extension of "asleep hides the
// creature and suppresses the grotto walk": an unhatched egg (level <= 1)
// gets the exact same stationary treatment as a sleeping kandy, since
// neither one has anywhere to walk to yet. Takes the already-computed
// asleep flag (isAsleep's result) rather than re-deriving it, so this stays
// a one-line combination, independently callable and testable without a
// lineage seed or clock.
function kandyStationaryFor(asleep, level) {
  return asleep || !(level > 1);
}

// currentDayPhase is set by sceneFor around building props so the shared
// sun helpers can swap themselves out at night without every biome knowing
// about the clock. Default "day" keeps every legacy call byte-identical.
var currentDayPhase = "day";

// ---------------------------------------------------------------------------
// Seasons (v0.7.0) — derived from the client month, northern-hemisphere
// mapping (a deliberate simplification, noted in PLAN.md): Dec-Feb winter,
// Mar-May spring, Jun-Aug summer, Sep-Nov autumn. Threaded explicitly like
// timeOfDay; unset/unknown = NO season, so offline tooling and old callers
// keep byte-identical renders.
// ---------------------------------------------------------------------------

var SEASONS = { winter: true, spring: true, summer: true, autumn: true };

function seasonForMonth(month) {
  var m = ((Math.floor(month) % 12) + 12) % 12;
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

function currentSeason() {
  return seasonForMonth(new Date().getMonth());
}

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
    counterfeit: !!data.counterfeit,
  };
}

var TEMPER_NEUTRAL = { band: "neutral", sign: 0, strong: false, beloved: false, scarred: false, counterfeit: false };

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
  // The pupil rides a gaze offset (--kandy-gx/--kandy-gy, set on the card
  // from the pointer) scaled by this eye's radius, so every archetype and
  // eye size tracks proportionally. Blink keeps its own transform on the
  // element; gaze is a translate composed in the same transform list.
  out.push(
    h("circle", {
      key: key + "p",
      cx: cx + rand(-0.6, 0.6),
      cy: cy,
      r: style === "dot" ? r * 0.55 : r * 0.45,
      fill: "#26232e",
      className: "kandev-kandy-blink kandev-kandy-pupil",
      style: {
        transformBox: "fill-box",
        transformOrigin: "center",
        "--kandy-gr": (r * 0.34).toFixed(2) + "px",
      },
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

// gazeAmpFor — how hard the eyes follow the pointer, by trust band. A
// beloved kandy glances (soft, unbothered); a fearful one tracks your hand
// almost fully. Neutral sits in between. Unit scalar in [0,1].
var GAZE_AMP_BY_BAND = {
  beloved: 0.55,
  content: 0.7,
  neutral: 0.8,
  wary: 0.95,
  fearful: 1,
};
function gazeAmpFor(band) {
  var a = GAZE_AMP_BY_BAND[band];
  return a === undefined ? GAZE_AMP_BY_BAND.neutral : a;
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

// counterfeitPatchAt — the stitched fabric patch itself: a slightly
// off-color square sewn on with little cross-stitch x's over a dashed
// border. Deliberately NOT the scar's single stitched line — this mark
// means "this body replaced one the audit rejected". Fixed fabric colors
// so the patch reads as foreign on every body color and on the eggshell.
function counterfeitPatchAt(h, cx, cy, rot, size) {
  var half = size / 2;
  var st = "#7a6852";
  var parts = [
    h("rect", {
      key: "cftfabric",
      x: cx - half,
      y: cy - half,
      width: size,
      height: size,
      fill: "#cdbd9d",
      stroke: st,
      strokeWidth: 0.8,
      strokeDasharray: "1.5 1.1",
    }),
  ];
  var edges = [
    [cx - half, cy],
    [cx + half, cy],
    [cx, cy - half],
    [cx, cy + half],
  ];
  for (var i = 0; i < edges.length; i++) {
    var ex = edges[i][0];
    var ey = edges[i][1];
    parts.push(
      h("line", { key: "cftx" + i + "a", x1: ex - 1, y1: ey - 1, x2: ex + 1, y2: ey + 1, stroke: st, strokeWidth: 0.7 }),
      h("line", { key: "cftx" + i + "b", x1: ex - 1, y1: ey + 1, x2: ex + 1, y2: ey - 1, stroke: st, strokeWidth: 0.7 }),
    );
  }
  return h("g", { key: "cftpatch", transform: "rotate(" + rot + " " + cx + " " + cy + ")", opacity: 0.95 }, parts);
}

// counterfeitPatch — the permanent tamper mark (v0.9.0). A rebirthed
// counterfeit kandy wears the stitched patch, placed deterministically from
// the lineage seed, at every band, mood and level forever — chip portrait
// and Photo Booth included. Subtle at a glance, unmistakable on inspection.
function counterfeitPatch(h, lineage, body, temper) {
  if (!temper.counterfeit) return [];
  var r = makeRand(lineage, 78);
  var cx = body.mark.cx + r(-0.55, 0.55) * body.mark.rx;
  var cy = body.mark.cy + r(-0.55, 0.55) * body.mark.ry;
  return [counterfeitPatchAt(h, cx, cy, (r(-0.5, 0.5) * 40).toFixed(1), 6)];
}

// counterfeitEggPatch — even the egg wears the mark: a counterfeit rebirth
// hatches from a shell that was visibly patched on day one.
function counterfeitEggPatch(h, lineage) {
  var r = makeRand(lineage, 78);
  return [counterfeitPatchAt(h, 50 + r(-7, 7), 62 + r(-6, 8), (r(-0.5, 0.5) * 40).toFixed(1), 5)];
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
    if (data.counterfeit) egg = egg.concat(counterfeitEggPatch(h, (data.lineage_seed || 1) >>> 0));
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
  inner = inner.concat(counterfeitPatch(h, lineage, body, temper));
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
  // Walking with a grounded gait (v0.8.0): the gait keyframes own vertical
  // motion; the idle bob yields for the stroll. Floaty archetypes keep the
  // bob — their hover-glide IS the bob (walk_suppress_bob is a render-only
  // field kandyCard sets from gaitFor().keepBob).
  if (data.walk_suppress_bob) bobCls = "";
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

// --- Mid-scene furniture (phases 2-3) --------------------------------------
// Phases 2-3 used to drop back to flat single-gradient scenes with plain
// props — crossing 17->18 read as a visual DOWNGRADE. These helpers carry
// the phase 0-1 craft forward (haloed sun, layered skies, highlighted
// props) while stepping density and saturation UP: the same place, thriving.

function waterGlints(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(14, 226);
    var y = rand(80, 112);
    out.push(
      h0("path", {
        key: "glint" + i,
        d: "M" + x + " " + y + " q" + rand(3, 6) + " " + rand(-1.6, -0.6) + " " + rand(7, 11) + " 0",
        stroke: "#ffffff",
        strokeWidth: 1.1,
        strokeLinecap: "round",
        fill: "none",
        opacity: rand(0.45, 0.8),
      }),
    );
  }
  return out;
}

function fishHop(key, x, y) {
  return [
    h0("path", {
      key: key,
      d: "M" + x + " " + y + " q4 -6 8 0 l3.4 -2.6 l-0.6 3.4 q-5 4.4 -10 0.6 Z",
      fill: "#ff9a66",
      stroke: "#e07a48",
      strokeWidth: 0.7,
    }),
    h0("circle", { key: key + "e", cx: x + 2.6, cy: y - 2.2, r: 0.55, fill: "#3a2418" }),
    h0("circle", { key: key + "d1", cx: x - 2.4, cy: y - 3.6, r: 0.8, fill: "#dff2fb", opacity: 0.9 }),
    h0("circle", { key: key + "d2", cx: x + 10.6, cy: y - 4.2, r: 0.6, fill: "#dff2fb", opacity: 0.8 }),
  ];
}

function bushProp(key, x, y, fill, hi) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 3.4, rx: 9, ry: 1.6, fill: "#2c3a24", opacity: 0.16 }),
    h0("circle", { key: key + "a", cx: x - 4.4, cy: y, r: 4.6, fill: fill }),
    h0("circle", { key: key + "b", cx: x + 4.2, cy: y + 0.4, r: 4.2, fill: fill }),
    h0("circle", { key: key + "c", cx: x, cy: y - 3, r: 4.8, fill: fill }),
    h0("circle", { key: key + "hi", cx: x - 2, cy: y - 4.4, r: 2.4, fill: hi, opacity: 0.9 }),
    h0("circle", { key: key + "f1", cx: x + 3.4, cy: y - 2.4, r: 1, fill: "#ff8fa3" }),
    h0("circle", { key: key + "f2", cx: x - 5.4, cy: y - 1.2, r: 0.9, fill: "#ffd166" }),
  ];
}

function treesRich(rand, count, fill, hi) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(10, 222);
    var w = rand(11, 19);
    var ht = rand(24, 44);
    var top = 120 - ht;
    out.push(h0("ellipse", { key: "tsh" + i, cx: x + w / 2, cy: 119.4, rx: w * 0.62, ry: 1.7, fill: "#20301c", opacity: 0.16 }));
    out.push(h0("rect", { key: "ttr" + i, x: x + w / 2 - 1.1, y: 113, width: 2.2, height: 6.4, rx: 0.8, fill: "#6b4a30" }));
    out.push(h0("path", { key: "tree" + i, d: "M" + x + " 116 L" + (x + w / 2) + " " + top + " L" + (x + w) + " 116 Z", fill: fill, opacity: rand(0.85, 1) }));
    out.push(
      h0("path", {
        key: "thi" + i,
        d: "M" + (x + w / 2) + " " + top + " L" + (x + w * 0.24) + " " + (116 - ht * 0.22) + " L" + (x + w / 2) + " " + (116 - ht * 0.3) + " Z",
        fill: hi,
        opacity: 0.75,
      }),
    );
  }
  return out;
}

function butterfly(key, x, y, color) {
  return [
    h0("ellipse", { key: key + "l", cx: x - 1.7, cy: y, rx: 1.9, ry: 1.2, fill: color, opacity: 0.95, transform: "rotate(-24 " + (x - 1.7) + " " + y + ")" }),
    h0("ellipse", { key: key + "r", cx: x + 1.7, cy: y, rx: 1.9, ry: 1.2, fill: color, opacity: 0.95, transform: "rotate(24 " + (x + 1.7) + " " + y + ")" }),
    h0("circle", { key: key + "b", cx: x, cy: y + 0.4, r: 0.55, fill: "#4a3a2c" }),
  ];
}

function snowSparkles(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(12, 228);
    var y = rand(30, 108);
    var s = rand(1.2, 2.2);
    out.push(
      h0("path", {
        key: "spk" + i,
        d: "M" + x + " " + (y - s) + " L" + x + " " + (y + s) + " M" + (x - s) + " " + y + " L" + (x + s) + " " + y,
        stroke: "#ffffff",
        strokeWidth: 0.9,
        strokeLinecap: "round",
        opacity: rand(0.5, 0.95),
      }),
    );
  }
  return out;
}

function iceCrystal(key, x, y, s) {
  return [
    h0("ellipse", { key: key + "sh", cx: x, cy: y + 1.6, rx: s * 2.6, ry: 1.2, fill: "#3c4c6e", opacity: 0.18 }),
    h0("path", {
      key: key + "a",
      d: "M" + (x - s * 1.6) + " " + y + " L" + (x - s * 0.9) + " " + (y - s * 3.2) + " L" + (x - s * 0.1) + " " + y + " Z",
      fill: "#9fd8e8",
      opacity: 0.95,
    }),
    h0("path", {
      key: key + "b",
      d: "M" + (x - s * 0.4) + " " + y + " L" + (x + s * 0.5) + " " + (y - s * 4.4) + " L" + (x + s * 1.4) + " " + y + " Z",
      fill: "#c5ecf6",
      opacity: 0.95,
    }),
    h0("path", {
      key: key + "hi",
      d: "M" + (x + s * 0.3) + " " + (y - s * 1) + " L" + (x + s * 0.5) + " " + (y - s * 3.6) + "",
      stroke: "#ffffff",
      strokeWidth: 0.9,
      strokeLinecap: "round",
      opacity: 0.9,
    }),
  ];
}

function craggyPeaks(rand, count, fill, faceHi) {
  var out = [];
  var x = -10;
  var i = 0;
  while (x < 230 && i < count) {
    var w = rand(60, 110);
    var peak = rand(18, 42);
    var apex = x + w / 2;
    out.push(h0("path", { key: "mtn" + i, d: "M" + x + " 120 L" + apex + " " + peak + " L" + (x + w) + " 120 Z", fill: fill, opacity: 0.9 }));
    out.push(
      h0("path", {
        key: "mface" + i,
        d: "M" + apex + " " + peak + " L" + (x + w * 0.68) + " 120 L" + (x + w) + " 120 Z",
        fill: faceHi,
        opacity: 0.4,
      }),
    );
    out.push(
      h0("path", {
        key: "mcap" + i,
        d:
          "M" + (apex - 10) + " " + (peak + 13) + " L" + apex + " " + peak + " L" + (apex + 10) + " " + (peak + 13) +
          " L" + (apex + 5) + " " + (peak + 10) + " L" + apex + " " + (peak + 14) + " L" + (apex - 5) + " " + (peak + 10) + " Z",
        fill: "#f2f6fd",
        opacity: 0.97,
      }),
    );
    x += w * 0.7;
    i++;
  }
  return out;
}

function richMesas(rand, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var x = rand(0, 200);
    var w = rand(26, 52);
    var ht = rand(30, 60);
    var top = 120 - ht;
    out.push(h0("rect", { key: "mesa" + i, x: x, y: top, width: w, height: ht, rx: 4, fill: "#a35a34", opacity: 0.9 }));
    out.push(h0("rect", { key: "mrim" + i, x: x, y: top, width: w, height: 3.4, rx: 1.7, fill: "#d98a54", opacity: 0.85 }));
    out.push(
      h0("path", {
        key: "mstr" + i,
        d:
          "M" + (x + 2) + " " + (top + ht * 0.42) + " H" + (x + w - 2) +
          " M" + (x + 2) + " " + (top + ht * 0.68) + " H" + (x + w - 2),
        stroke: "#7c3f22",
        strokeWidth: 1.4,
        opacity: 0.55,
      }),
    );
  }
  return out;
}

function lavaStrata(rand) {
  return [
    h0("path", { key: "lstr1", d: "M-10 120 Q60 " + rand(94, 102) + " 130 112 T 250 106 L250 130 L-10 130 Z", fill: "#7c3a22", opacity: 0.92 }),
    h0("path", { key: "lstr2", d: "M-10 122 Q90 " + rand(106, 112) + " 250 118 L250 130 L-10 130 Z", fill: "#54241a", opacity: 0.92 }),
    h0("path", {
      key: "lvein",
      d: "M" + rand(26, 60) + " 120 Q" + rand(90, 120) + " " + rand(110, 115) + " " + rand(150, 200) + " 119",
      stroke: "#ff9a4d",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      fill: "none",
      opacity: 0.8,
    }),
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

// Per-biome gradients, phase 0 (barren/dull) -> 5 (transcendent).
// Every daytime phase (0-3) is layered: a soft edge vignette, a sun glow,
// then the sky gradient — richness and saturation step UP at each phase
// boundary so leveling never makes the scene duller. Phases 4-5 are
// intentionally night-sky (celestial) and stay single-gradient.
var BIOME_BGS = [
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(122,92,60,0.18) 100%), radial-gradient(circle at 82% 17%, rgba(255,214,150,0.55) 0%, rgba(255,214,150,0) 40%), linear-gradient(to bottom, #fdeed8 0%, #f1ecc8 45%, #e2e5b4 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(60,100,60,0.14) 100%), radial-gradient(circle at 85% 18%, rgba(255,230,150,0.5) 0%, rgba(255,230,150,0) 38%), linear-gradient(to bottom, #cdeaf6 0%, #def1c2 62%, #b7dc9a 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(30,90,50,0.16) 100%), radial-gradient(circle at 84% 16%, rgba(255,240,165,0.5) 0%, rgba(255,240,165,0.16) 20%, rgba(255,240,165,0) 46%), linear-gradient(to bottom, #9edcf5 0%, #abdf8c 60%, #6db85c 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(12,70,40,0.2) 100%), radial-gradient(circle at 82% 15%, rgba(255,235,160,0.55) 0%, rgba(255,235,160,0.18) 20%, rgba(255,235,160,0) 48%), linear-gradient(to bottom, #8fd9ae 0%, #37995f 60%, #1a6b3c 100%)",
    "linear-gradient(to bottom, #0e2b38 0%, #14532d 60%, #052e16 100%)",
    "linear-gradient(to bottom, #1a0f3d 0%, #0f4f3a 55%, #020d08 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(60,90,110,0.16) 100%), radial-gradient(circle at 82% 18%, rgba(255,238,190,0.5) 0%, rgba(255,238,190,0) 40%), linear-gradient(to bottom, #d9eef7 0%, #e9ecd8 48%, #ecd9ae 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(25,80,110,0.14) 100%), radial-gradient(circle at 85% 18%, rgba(255,240,190,0.5) 0%, rgba(255,240,190,0) 38%), linear-gradient(to bottom, #d8edf4 0%, #b6dcec 55%, #8fc6da 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(18,70,105,0.18) 100%), radial-gradient(circle at 84% 15%, rgba(255,240,185,0.5) 0%, rgba(255,240,185,0.16) 20%, rgba(255,240,185,0) 46%), linear-gradient(to bottom, #a6dcf2 0%, #58aadc 55%, #2b6fa3 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(10,55,90,0.22) 100%), radial-gradient(circle at 82% 16%, rgba(255,235,175,0.5) 0%, rgba(255,235,175,0.16) 20%, rgba(255,235,175,0) 48%), linear-gradient(to bottom, #5cb2d6 0%, #2570a0 60%, #144265 100%)",
    "linear-gradient(to bottom, #0b2c4a 0%, #0e4a6e 60%, #04121f 100%)",
    "linear-gradient(to bottom, #150a3d 0%, #0e4a6e 55%, #02060f 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(60,70,100,0.17) 100%), radial-gradient(circle at 80% 16%, rgba(255,248,225,0.55) 0%, rgba(255,248,225,0) 40%), linear-gradient(to bottom, #ecebf7 0%, #e3e8f2 55%, #d9dfe8 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(50,70,110,0.15) 100%), radial-gradient(circle at 83% 15%, rgba(255,248,224,0.5) 0%, rgba(255,248,224,0) 38%), linear-gradient(to bottom, #e1e9f6 0%, #c8d5e9 60%, #a9bcd7 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(45,60,100,0.18) 100%), radial-gradient(circle at 82% 14%, rgba(255,248,220,0.55) 0%, rgba(255,248,220,0.18) 20%, rgba(255,248,220,0) 46%), linear-gradient(to bottom, #d3ddf0 0%, #94a9cc 60%, #5b7099 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(35,50,95,0.2) 100%), radial-gradient(circle at 81% 14%, rgba(255,246,210,0.55) 0%, rgba(255,246,210,0.18) 20%, rgba(255,246,210,0) 48%), linear-gradient(to bottom, #bccbee 0%, #7288bd 60%, #3d5185 100%)",
    "linear-gradient(to bottom, #0a1a33 0%, #16305e 60%, #050d1f 100%)",
    "linear-gradient(to bottom, #1b0a3d 0%, #1c3a72 55%, #03040c 100%)",
  ],
  [
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(120,60,30,0.18) 100%), radial-gradient(circle at 82% 18%, rgba(255,180,110,0.55) 0%, rgba(255,180,110,0) 40%), linear-gradient(to bottom, #fce3c0 0%, #f8d5a5 55%, #efc691 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(140,80,30,0.16) 100%), radial-gradient(circle at 82% 17%, rgba(255,200,120,0.55) 0%, rgba(255,200,120,0) 38%), linear-gradient(to bottom, #ffe7ba 0%, #f9cf8b 60%, #e9b269 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 58%, rgba(110,45,20,0.2) 100%), radial-gradient(circle at 83% 15%, rgba(255,205,130,0.55) 0%, rgba(255,205,130,0.18) 20%, rgba(255,205,130,0) 46%), linear-gradient(to bottom, #f4bc7c 0%, #cf7c4a 60%, #8f4c2c 100%)",
    "radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(50,12,8,0.3) 100%), radial-gradient(circle at 80% 18%, rgba(255,170,90,0.6) 0%, rgba(255,160,85,0.2) 22%, rgba(255,150,80,0) 52%), linear-gradient(to bottom, #f09c52 0%, #b0492a 58%, #571c14 100%)",
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
      if (phase === 2)
        return sunDisc(205, 22, 12, "#fff1b8", "#ffe9c9").concat(
          waves(rand, 4 + Math.floor(density / 10)),
          waterGlints(rand, 5 + Math.floor(density / 8)),
          pondReeds(rand, "reedA", 22 + rand(0, 8)),
          pondReeds(rand, "reedB", 216 + rand(-6, 4)),
          lilypad("lp0", 178 + rand(-8, 8), 108),
          lilypad("lp1", 62 + rand(-8, 8), 114),
          fishHop("fish0", 118 + rand(-18, 18), 90),
        );
      if (phase === 3)
        return sunDisc(204, 21, 13, "#fff1b8", "#ffe9c9").concat(
          waves(rand, 4),
          waterGlints(rand, 8),
          coral(rand, 5 + Math.floor(density / 8)),
          bubbles(rand, 7),
          pondReeds(rand, "reedA", 20 + rand(0, 8)),
          lilypad("lp0", 190 + rand(-8, 8), 106),
          lilypad("lp1", 44 + rand(-8, 8), 112),
          fishHop("fish0", 100 + rand(-16, 16), 86),
          fishHop("fish1", 168 + rand(-12, 12), 96),
        );
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
      if (phase === 2)
        return distantPeaks(rand, "#9fafcf", "#eef3fc").concat(
          sunDisc(200, 19, 10, "#fff4d6", "#fffdf4"),
          craggyPeaks(rand, 4, "#41527a", "#93a5cc"),
          snowSparkles(rand, 5 + Math.floor(density / 10)),
          snowTuft("snwA", 52 + rand(-12, 12), 113),
          snowTuft("snwB", 186 + rand(-10, 10), 115),
        );
      if (phase === 3)
        return distantPeaks(rand, "#93a5cc", "#eef3fc").concat(
          sunDisc(199, 18, 11, "#fff4d6", "#fffdf4"),
          craggyPeaks(rand, 4, "#37497c", "#8fa3d1"),
          snowSparkles(rand, 9),
          flowerDots(rand, 6),
          iceCrystal("iceA", 54 + rand(-12, 12), 116, 3),
          iceCrystal("iceB", 190 + rand(-10, 10), 118, 2.4),
          snowTuft("snwA", 118 + rand(-14, 14), 114),
          softStone("st3", 158 + rand(-10, 10), 112, 1.6, "#8fa0ba", "#c6d2e6"),
        );
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
        return sunDisc(205, 20, 12, "#ffddaa", "#ffcb84").concat(
          richMesas(rand, 4),
          dunes(rand),
          sandRipples(rand, "#b0793e"),
          cactusPebble("cacA", 40 + rand(-10, 10), 106),
          cactusPebble("cacB", 200 + rand(-10, 10), 110),
          emberSpark("embA", 148 + rand(-10, 10), 98),
          emberSpark("embB", 84 + rand(-8, 8), 92),
        );
      if (phase === 3)
        return sunDisc(202, 24, 13, "#ffd98e", "#ff9a4d").concat(
          volcanoProps(rand, 5 + Math.floor(density / 10)),
          lavaStrata(rand),
          emberSpark("embA", 186 + rand(-10, 10), 92),
          emberSpark("embB", 30 + rand(-8, 8), 86),
          cactusPebble("cacA", 208 + rand(-8, 6), 112),
        );
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
      if (phase === 2)
        return hills(rand, 2, "#8fc477").concat(
          sunDisc(204, 21, 12, "#ffdf6b", "#ffe9a3"),
          grassBlades(rand, 10 + Math.floor(density / 3), "#4c8a3f"),
          treesRich(rand, 3 + Math.floor(density / 8), "#2c6e46", "#5ea878"),
          bushProp("bshA", 176 + rand(-10, 10), 112, "#4f9457", "#7cb884"),
          flowerDots(rand, 5),
          butterfly("bfA", 62 + rand(-14, 14), 78 + rand(-8, 8), "#ffb3c6"),
        );
      if (phase === 3)
        return hills(rand, 2, "#6cae5c").concat(
          sunDisc(203, 20, 13, "#ffdf6b", "#ffe9a3"),
          treesRich(rand, 6 + Math.floor(density / 6), "#1d4d31", "#4c8a5f"),
          grassBlades(rand, 10, "#2f6e3f"),
          bushProp("bshA", 34 + rand(-8, 8), 113, "#3f8449", "#6cab74"),
          bushProp("bshB", 196 + rand(-8, 8), 115, "#478c50", "#74b17c"),
          flowerDots(rand, 8),
          butterfly("bfA", 96 + rand(-16, 16), 72 + rand(-8, 8), "#ffd166"),
          butterfly("bfB", 152 + rand(-12, 12), 84 + rand(-6, 6), "#c792ea"),
        );
      return treeProps(rand, 6, "#0c3a24").concat(fireflies(rand, 8 + Math.floor(density / 5)), stars(rand, Math.min(8 + Math.max(level - 40, 0), 40)));
  }
}

// skyOverlayFor — the composable day/night layer: a CSS gradient prepended
// onto the biome background plus an SVG wash rect laid over the props, so
// every biome and phase gets tinted without any biome rewrite. Celestial
// phases (4-5) are already dark/starry, so they only get a subtle shift.
//
// Both halves are tabled because the card is not the only surface wearing
// them. The grotto's cave mouth paints the same hour in SVG, and it cannot
// recover it from the scene: sceneBgStops reads hex colours only, so the base
// biome gradient survives the trip and this rgba layer does not. Stops are
// [offset, "r,g,b", alpha]; the CSS string is generated from the same rows the
// SVG gradient is built from, so the two surfaces cannot drift apart. Every
// alpha is hand-authored — the dim (celestial, phase 4-5) tier is its own set
// of values, not a scaling of the lit one.
var SKY_TINTS = {
  dawn: {
    lit: [["0%", "255,196,110", 0.3], ["55%", "255,172,118", 0.1], ["100%", "255,152,92", 0.16]],
    dim: [["0%", "255,196,110", 0.08], ["55%", "255,172,118", 0.03], ["100%", "255,152,92", 0.05]],
  },
  dusk: {
    lit: [["0%", "255,122,70", 0.3], ["55%", "226,92,150", 0.2], ["100%", "122,62,142", 0.18]],
    dim: [["0%", "255,122,70", 0.08], ["55%", "226,92,150", 0.05], ["100%", "122,62,142", 0.05]],
  },
  night: {
    lit: [["0%", "11,16,52", 0.62], ["55%", "9,13,44", 0.5], ["100%", "4,8,28", 0.6]],
    dim: [["0%", "10,16,50", 0.22], ["100%", "6,10,34", 0.2]],
  },
};

var SKY_WASHES = {
  dawn: { fill: "#ffb75e", lit: 0.13, dim: 0.05 },
  dusk: { fill: "#ff8a6b", lit: 0.15, dim: 0.06 },
  night: { fill: "#0b1238", lit: 0.3, dim: 0.1 },
};

function skyTintFor(dayPhase, phase) {
  var tint = SKY_TINTS[dayPhase];
  if (!tint) return null;
  return phase >= 4 ? tint.dim : tint.lit;
}

function skyWashFor(dayPhase, phase) {
  var wash = SKY_WASHES[dayPhase];
  if (!wash) return null;
  return { fill: wash.fill, opacity: phase >= 4 ? wash.dim : wash.lit };
}

function skyTintCss(stops) {
  return (
    "linear-gradient(to bottom, " +
    stops
      .map(function (stop) {
        return "rgba(" + stop[1] + "," + stop[2] + ") " + stop[0];
      })
      .join(", ") +
    ")"
  );
}

function skyOverlayFor(dayPhase, phase) {
  var tint = skyTintFor(dayPhase, phase);
  if (!tint) return null;
  var washPaint = skyWashFor(dayPhase, phase);
  return {
    bg: skyTintCss(tint),
    wash: h0("rect", {
      key: "skywash",
      x: -10,
      y: -10,
      width: 260,
      height: 140,
      fill: washPaint.fill,
      opacity: washPaint.opacity,
    }),
  };
}

// Season tints — the composable v0.7.0 layer, same trick as skyOverlayFor:
// a CSS gradient prepended onto the (possibly night-washed) background plus
// seeded SVG particles layered over everything, so every biome and phase
// gets a season without any biome rewrite. `dim` variants are for the
// celestial/transcendent scenes (phase 4-5): space has no weather, so they
// get only the subtlest tint and never any particles.
var SEASON_TINTS = {
  winter: {
    bg: "linear-gradient(to bottom, rgba(172,206,236,0.34) 0%, rgba(203,226,246,0.20) 100%)",
    dim: "linear-gradient(to bottom, rgba(172,206,236,0.05) 0%, rgba(172,206,236,0.03) 100%)",
  },
  spring: {
    bg: "linear-gradient(to bottom, rgba(192,236,192,0.11) 0%, rgba(255,214,230,0.10) 100%)",
    dim: "linear-gradient(to bottom, rgba(192,236,192,0.04) 0%, rgba(255,214,230,0.03) 100%)",
  },
  summer: {
    bg: "linear-gradient(to bottom, rgba(255,214,120,0.14) 0%, rgba(255,240,182,0.06) 100%)",
    dim: "linear-gradient(to bottom, rgba(255,214,120,0.04) 0%, rgba(255,214,120,0.02) 100%)",
  },
  autumn: {
    bg: "linear-gradient(to bottom, rgba(235,162,82,0.15) 0%, rgba(201,122,62,0.10) 100%)",
    dim: "linear-gradient(to bottom, rgba(235,162,82,0.04) 0%, rgba(235,162,82,0.03) 100%)",
  },
};

var PETAL_FILLS = ["#ffc2d1", "#ffd7e0", "#ffb3c6"];
var LEAF_FILLS = ["#e8923e", "#c9702c", "#d8a13e"];

// Per-particle drift tempo: seeded delay/duration so the flurry never
// moves in lockstep, on animation-safe elements (positioned by attributes,
// no layout transform). Reduced motion: animation:none leaves the particle
// static at its seeded spot.
function seasonDriftStyle(rand) {
  return {
    animationDelay: (-rand(0, 6)).toFixed(2) + "s",
    animationDuration: rand(4.5, 8).toFixed(2) + "s",
    transformBox: "fill-box",
    transformOrigin: "center",
  };
}

// seasonOverlayFor(season, dayPhase, phase, rand) — null unless season is
// one of the four known names (unset stays byte-identical). Winter: cool
// wash + drifting snowflakes + white ground drifts; spring: petals + a
// fresh tint; summer: warm bright wash (+ pulsing fireflies at night);
// autumn: falling leaves + amber tint.
function seasonOverlayFor(season, dayPhase, phase, rand) {
  if (!SEASON_TINTS[season]) return null;
  if (phase >= 4) return { bg: SEASON_TINTS[season].dim, props: [] };
  var props = [];
  var i;
  if (season === "winter") {
    for (i = 0; i < 12; i++) {
      props.push(
        h0("circle", {
          key: "snow" + i,
          className: "kandev-kandy-snow",
          style: seasonDriftStyle(rand),
          cx: rand(4, 236),
          cy: rand(4, 96),
          r: rand(0.8, 1.7),
          fill: "#ffffff",
          opacity: rand(0.55, 0.95),
        }),
      );
    }
    for (i = 0; i < 3; i++) {
      props.push(
        h0("ellipse", {
          key: "snowdriftpile" + i,
          cx: rand(14, 226),
          cy: rand(112, 118),
          rx: rand(13, 30),
          ry: rand(2.4, 3.8),
          fill: "#ffffff",
          opacity: rand(0.4, 0.62),
        }),
      );
    }
  } else if (season === "spring") {
    // Petals (and leaves below) keep their static rotate on the INNER
    // shape: the drift animation lives on a wrapper g with no base
    // transform, per the layering rule.
    for (i = 0; i < 9; i++) {
      var pStyle = seasonDriftStyle(rand);
      var px = rand(4, 236);
      var py = rand(8, 104);
      props.push(
        h0(
          "g",
          { key: "petal" + i, className: "kandev-kandy-petal", style: pStyle },
          h0("ellipse", {
            key: "shape",
            cx: px,
            cy: py,
            rx: rand(1.4, 2.2),
            ry: rand(0.9, 1.3),
            fill: PETAL_FILLS[i % 3],
            opacity: rand(0.65, 0.95),
            transform: "rotate(" + rand(-40, 40).toFixed(1) + " " + px.toFixed(1) + " " + py.toFixed(1) + ")",
          }),
        ),
      );
    }
  } else if (season === "summer") {
    if (dayPhase === "night") {
      for (i = 0; i < 6; i++) {
        props.push(
          h0("circle", {
            key: "sfly" + i,
            className: "kandev-kandy-firefly",
            style: seasonDriftStyle(rand),
            cx: rand(8, 232),
            cy: rand(22, 102),
            r: rand(1.1, 2),
            fill: "#ffe9a3",
            opacity: 0.8,
          }),
        );
      }
    }
  } else {
    for (i = 0; i < 9; i++) {
      var lStyle = seasonDriftStyle(rand);
      var lx = rand(4, 236);
      var ly = rand(8, 106);
      props.push(
        h0(
          "g",
          { key: "leaf" + i, className: "kandev-kandy-leaf", style: lStyle },
          h0("ellipse", {
            key: "shape",
            cx: lx,
            cy: ly,
            rx: rand(1.8, 2.6),
            ry: rand(1, 1.5),
            fill: LEAF_FILLS[i % 3],
            opacity: rand(0.7, 0.95),
            transform: "rotate(" + rand(-60, 60).toFixed(1) + " " + lx.toFixed(1) + " " + ly.toFixed(1) + ")",
          }),
        ),
      );
    }
  }
  return { bg: SEASON_TINTS[season].bg, props: props };
}

// sceneFor(biome, level, lineageSeed, timeOfDay, season, ancestors) — the
// lineage's habitat at this maturity, hour, and season. Layout re-rolls only
// at phase boundaries; the day/night layer composes on top and defaults to
// mid-day ("day": no overlay at all), the season layer composes above THAT
// and defaults to none, and the ancestors default to none — so 3-, 4- and
// 5-arg callers keep today's exact renders.

// ---------------------------------------------------------------------------
// Ancestors (v0.13.0) — a kandy rests at level 100, then grows out of the
// band and retires: the server files it away and hatches a fresh egg with new
// DNA. The retired elders never leave. They stand at the back of every scene, drawn by the SAME
// creatureParts the living kandy uses (portrait mode: no ground plane, no
// effect layers, no contact shadow of their own), scaled down onto fixed
// far-ground spots and dimmed with distance.
//
// Placement rules that matter:
//   - the two NEAR spots sit clear of the wander corridor (±WANDER_MAX_PX
//     around the centre plus the widest body), so a strolling kandy never
//     ends up standing on top of the elder closest to the camera; the two
//     far spots sit deeper in the scene, where the living kandy passing in
//     front of them is the correct depth cue, not a collision;
//   - newest elder takes the nearest, largest, least faded spot — the
//     lineage recedes into the haze in order;
//   - they render inside the scene svg, BEFORE the day/night and season
//     washes, so dusk, night and snow fall over them like any other prop;
//   - they are kandev-kandy-static: an elder never bobs, blinks or walks.
// ---------------------------------------------------------------------------

var ANCESTOR_SPOTS = [
  { x: 26, y: 103, scale: 0.42, opacity: 0.66 },
  { x: 214, y: 101, scale: 0.38, opacity: 0.56 },
  { x: 57, y: 97, scale: 0.3, opacity: 0.44 },
  { x: 186, y: 95.5, scale: 0.26, opacity: 0.36 },
];

// SCENE_W is the scene viewBox width the spots are expressed in.
var SCENE_W = 240;

// ancestorFigures renders the elders as scene props. `ancestors` is the
// webhook's list, oldest first; anything past ANCESTOR_SPOTS.length stays in
// the ledger but off the card (the scene has four believable back spots, and
// a crowd would read as noise).
//
// bounds ({min, max} in scene units, default the full width) is the visible
// horizontal window. The card shows the whole scene; the Photo Booth frames
// the same viewBox into a squarer box with `slice`, which crops the sides —
// without this the outermost elders would be sawn in half by the frame.
function ancestorFigures(h, ancestors, bounds) {
  if (!ancestors || !ancestors.length) return [];
  var lo = bounds ? bounds.min : 0;
  var hi = bounds ? bounds.max : SCENE_W;
  var out = [];
  var shown = Math.min(ancestors.length, ANCESTOR_SPOTS.length);
  for (var i = 0; i < shown; i++) {
    var a = ancestors[ancestors.length - 1 - i] || {};
    var spot = ANCESTOR_SPOTS[i];
    var s = spot.scale;
    var x = lo + (spot.x / SCENE_W) * (hi - lo);
    // The elder's DNA only. Mood is fixed "content" — a memory has no mood,
    // and the living kandy's sadness must not spread across the treeline.
    var figure = creatureParts(
      h,
      {
        level: Math.max(Math.floor(Number(a.level) || 0), 2),
        archetype: Math.floor(Number(a.archetype) || 0),
        family: Math.floor(Number(a.family) || 0),
        lineage_seed: (Math.floor(Number(a.lineage_seed) || 1) >>> 0) || 1,
        scarred: !!a.scarred,
        mood: "content",
      },
      true,
    );
    out.push(
      h(
        "g",
        {
          key: "ancestor" + i,
          className: "kandev-kandy-static",
          opacity: spot.opacity,
          // Anchor the elder's FEET (50, 89 in creature space) on the spot.
          transform: "translate(" + (x - 50 * s) + " " + (spot.y - 89 * s) + ") scale(" + s + ")",
          "aria-hidden": "true",
        },
        figure,
      ),
    );
  }
  return out;
}

function sceneFor(biome, level, seed, timeOfDay, season, ancestors, ancestorBounds) {
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
  // The elders join the scene's own props: behind the living kandy (which is
  // a separate layer above this svg) and beneath every wash added below.
  props = props.concat(ancestorFigures(h0, ancestors, ancestorBounds));
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
  // Season layer LAST: the tint sits above the day/night gradient and the
  // particles above the night wash so snow/petals/leaves stay visible
  // after dark (rand stream 17 — the base layout is untouched).
  var seasonOv = seasonOverlayFor(season, dayPhase, phase, makeRand((seed ^ (phase * 0x9e3779b9)) >>> 0, 17));
  if (seasonOv) {
    bg = seasonOv.bg + ", " + bg;
    props = props.concat(seasonOv.props);
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
  // The host's chat topbar uses 28px controls on desktop and 44px touch
  // targets on phones. The ID selector keeps this plugin-owned geometry
  // authoritative over the utility classes on the shared host button.
  "#kandev-kandy-widget{width:28px;height:28px}" +
  "@media (max-width:639px){#kandev-kandy-widget{width:44px;height:44px}}" +
  // The shared TooltipContent always renders a small rotated-square arrow
  // (a direct span child wrapping an svg). On our full-bleed scene card it
  // reads as a stray floating square — hide it. :has() keeps the OTHER
  // direct span (Radix's visually-hidden a11y clone) intact.
  ".kandev-kandy-tooltip > span:has(> svg){display:none!important}" +
  // Gaze tracking (v0.10.0): pupils slide toward the pointer. --kandy-gx/gy
  // are unit scalars in [-1,1] set on the card; --kandy-gr is this eye's
  // travel radius. translate() composes with the blink animation's scaleY.
  ".kandev-kandy-pupil{translate:calc(var(--kandy-gx,0) * var(--kandy-gr,1px)) calc(var(--kandy-gy,0) * var(--kandy-gr,1px));transition:translate 140ms ease-out}" +
  // Compact help beside the mood badge. Align the popover to the 248px card;
  // it can extend below the header without being clipped by either surface.
  // focus-within gives keyboard and touch users the same explanation as
  // mouse hover without adding another stateful overlay to the widget.
  // The card surfaces intentionally clip their rounded contents. Release
  // that clipping only while this panel is open so the panel can extend
  // below the header without changing the card's resting shape.
  ".kandev-kandy-tooltip:has(.kandev-kandy-help:hover),.kandev-kandy-tooltip:has(.kandev-kandy-help:focus-within),#kandev-kandy-dialog:has(.kandev-kandy-help:hover),#kandev-kandy-dialog:has(.kandev-kandy-help:focus-within){overflow:visible!important}" +
  ".kandev-kandy-help{position:relative;display:inline-flex;flex:0 0 auto}" +
  ".kandev-kandy-helpbutton{width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.5;cursor:help}" +
  ".kandev-kandy-helpbutton:hover,.kandev-kandy-helpbutton:focus-visible{opacity:.9;outline:none}" +
  ".kandev-kandy-helpbutton:focus-visible{box-shadow:0 0 0 1.5px var(--ring)}" +
  ".kandev-kandy-helpcontent{position:absolute;z-index:8;top:calc(100% + 6px);right:0;width:214px;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--popover);color:var(--popover-foreground);box-shadow:0 8px 24px rgba(0,0,0,.22);font-size:9px;line-height:1.4;font-weight:400;text-transform:none;white-space:normal;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-2px);transition:opacity .12s ease,transform .12s ease,visibility .12s}" +
  ".kandev-kandy-help:hover .kandev-kandy-helpcontent,.kandev-kandy-help:focus-within .kandev-kandy-helpcontent{opacity:1;visibility:visible;transform:translateY(0)}" +
  ".kandev-kandy-helpcontent strong{display:block;margin-bottom:4px;font-size:10px;font-weight:600}" +
  ".kandev-kandy-helpcontent ul{margin:0;padding-left:13px}" +
  ".kandev-kandy-helpcontent li+li{margin-top:3px}" +
  // Dialog card: the 248px design scaled by a CONTINUOUS zoom (default
  // 1.45 = ~360px) — zoom keeps every vector crisp and scales hit-targets
  // consistently. Since v0.6.2 the zoom (and the matching frame width) are
  // INLINE styles driven by widget state so the corner grip can drag them;
  // the classes remain as hooks for the phone override below.
  ".kandev-kandy-dialogframe{position:relative}" +
  // Token grotto: one bounded underground scene, sticky navigation, and
  // ordinary vertical overflow. Door/pile grids reflow; there is no
  // carousel, page state, or horizontal content track.
  ".kandev-kandy-grotto-panel{--grotto-ink:#f4ede2;--grotto-ink-dim:#b6a894;--grotto-edge:rgba(255,255,255,.1);box-sizing:border-box;width:100%;max-height:calc(100vh - 32px);overflow:hidden;border:1px solid var(--grotto-edge);border-radius:16px;background:linear-gradient(180deg,#241d17,#100d0b);color:var(--grotto-ink);box-shadow:0 18px 50px rgba(0,0,0,.45)}" +
  ".kandev-kandy-grotto-panel:focus{outline:none}.kandev-kandy-grotto-panel:focus-visible{outline:2px solid var(--ring);outline-offset:-3px}" +
  ".kandev-kandy-grotto-bar{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--grotto-edge);background:linear-gradient(180deg,rgba(30,24,19,.96),rgba(22,18,15,.86));backdrop-filter:blur(10px)}" +
  ".kandev-kandy-grotto-heading{min-width:0;text-align:center}.kandev-kandy-grotto-title{display:block;font-size:16px;font-weight:750;line-height:1.2;overflow-wrap:anywhere}.kandev-kandy-grotto-subtitle{margin-top:2px;color:var(--grotto-ink-dim);font-size:10px;line-height:1.35;overflow-wrap:anywhere}" +
  ".kandev-kandy-grotto-action{min-height:40px;min-width:44px;padding:0 10px;border:1px solid var(--grotto-edge);border-radius:10px;background:rgba(255,255,255,.07);color:inherit;font-size:11px;font-weight:650;cursor:pointer}.kandev-kandy-grotto-action:hover{background:rgba(255,255,255,.13)}.kandev-kandy-grotto-action:focus-visible,.kandev-kandy-grotto-door:focus-visible,.kandev-kandy-token-pile:focus-visible,.kandev-kandy-grotto-entry:focus-visible,.kandev-kandy-grotto-manifest-open:focus-visible{outline:2px solid var(--ring);outline-offset:2px}" +
  ".kandev-kandy-grotto-scroll{max-height:calc(100vh - 104px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}" +
  ".kandev-kandy-grotto-scene{position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;min-height:340px;padding:18px;box-sizing:border-box;background:#0d1418}" +
  ".kandev-kandy-grotto-backdrop{position:absolute;inset:0;z-index:0;width:100%;height:100%;display:block;pointer-events:none}" +
  ".kandev-kandy-token-stage{position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;pointer-events:none;overflow:visible}" +
  // Room Kandy is a scene sibling of the absolute floor art — without its own
  // stack it sinks under the backdrop once the walk class (and its transform)
  // clears. pointer-events:none keeps the full-width row off pile hit targets.
  ".kandev-kandy-grotto-hub{position:relative;z-index:1;flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(70px,auto) minmax(0,1fr);gap:14px 24px;align-content:start}.kandev-kandy-grotto-kandy{position:relative;z-index:2;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;min-height:72px}.kandev-kandy-grotto-room-scene .kandev-kandy-grotto-kandy{margin-top:auto}.kandev-kandy-grotto-kandy.is-left{justify-content:flex-start;padding-left:18px}.kandev-kandy-grotto-kandy.is-right{justify-content:flex-end;padding-right:18px}.kandev-kandy-grotto-kandy svg{filter:drop-shadow(0 8px 8px rgba(0,0,0,.24))}" +
  ".kandev-kandy-grotto-door{position:relative;min-width:0;display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--grotto-edge);background:linear-gradient(180deg,rgba(20,30,34,.72),rgba(6,11,14,.82));color:var(--grotto-ink);box-shadow:inset 0 -14px 20px rgba(0,0,0,.3),0 8px 18px rgba(0,0,0,.35);cursor:pointer;text-align:left}" +
  ".kandev-kandy-grotto-door.is-left{margin-right:auto;border-radius:12px 34px 34px 12px;padding-right:16px}" +
  ".kandev-kandy-grotto-door.is-right{margin-left:auto;flex-direction:row-reverse;border-radius:34px 12px 12px 34px;padding-left:16px;text-align:right}" +
  ".kandev-kandy-grotto-door-body{min-width:0;display:flex;flex-direction:column;gap:2px}" +
  ".kandev-kandy-grotto-door::after{content:\"\";position:absolute;top:50%;width:22px;height:2px;background:repeating-linear-gradient(90deg,rgba(196,238,215,.45) 0 5px,transparent 5px 11px)}" +
  ".kandev-kandy-grotto-door.is-left::after{right:-22px}.kandev-kandy-grotto-door.is-right::after{left:-22px}" +
  ".kandev-kandy-grotto-door:hover{background:linear-gradient(180deg,rgba(255,214,150,.16),rgba(0,0,0,.26))}.kandev-kandy-grotto-door-art{width:46px;height:46px;flex:0 0 auto}.kandev-kandy-grotto-door-label{max-width:100%;font-size:13px;font-weight:750;line-height:1.2;overflow-wrap:anywhere}.kandev-kandy-grotto-door-count{color:var(--grotto-ink-dim);font-size:10px}" +
  ".kandev-kandy-grotto-room{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-height:240px}" +
  ".kandev-kandy-token-pile{pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent}.kandev-kandy-token-pile:focus{outline:none}" +
  ".kandev-kandy-token-pile-hit{fill:transparent;stroke:none}.kandev-kandy-token-pile:focus-visible .kandev-kandy-token-pile-hit{stroke:var(--ring);stroke-width:3}" +
  ".kandev-kandy-token-pile-name,.kandev-kandy-token-pile-compact,.kandev-kandy-grotto-exact{text-anchor:middle;paint-order:stroke;stroke:rgba(6,5,4,.72);stroke-width:5;stroke-linejoin:round;font-family:inherit}" +
  ".kandev-kandy-token-pile-name{fill:var(--grotto-ink);font-size:23px;font-weight:750}.kandev-kandy-token-pile-compact{fill:var(--grotto-ink-dim);font-size:19px}" +
  ".kandev-kandy-grotto-exact{fill:#ffe4a8;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;opacity:0;visibility:hidden}" +
  ".kandev-kandy-token-pile:hover .kandev-kandy-token-pile-hoard,.kandev-kandy-token-pile:focus-visible .kandev-kandy-token-pile-hoard,.kandev-kandy-token-pile.is-revealed .kandev-kandy-token-pile-hoard{filter:drop-shadow(0 2px 3px rgba(0,0,0,.3)) brightness(1.14)}" +
  ".kandev-kandy-token-pile-hoard{filter:drop-shadow(0 2px 2px rgba(0,0,0,.28))}" +
  ".kandev-kandy-token-pile:hover .kandev-kandy-grotto-exact,.kandev-kandy-token-pile:focus-visible .kandev-kandy-grotto-exact,.kandev-kandy-token-pile.is-revealed .kandev-kandy-grotto-exact{opacity:1;visibility:visible}" +
  ".kandev-kandy-grotto-manifest{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:2;box-sizing:border-box;width:min(300px,calc(100% - 24px));max-height:62%;overflow-y:auto;overscroll-behavior:contain;padding:10px 12px;border:1px solid var(--grotto-edge);border-radius:12px;background:rgba(12,10,8,.94);color:var(--grotto-ink);font-size:11px}" +
  ".kandev-kandy-grotto-manifest strong{display:block;margin-bottom:6px;font-size:11px}.kandev-kandy-grotto-manifest ul{margin:0;padding:0;list-style:none}" +
  ".kandev-kandy-grotto-manifest li{padding:3px 0;border-top:1px solid rgba(255,255,255,.07);font-variant-numeric:tabular-nums}" +
  ".kandev-kandy-grotto-manifest-row{display:flex;align-items:baseline;gap:7px}.kandev-kandy-grotto-manifest-separator{flex:0 0 auto;color:var(--grotto-ink-dim)}.kandev-kandy-grotto-manifest-count{flex:0 0 auto;margin-left:auto;white-space:nowrap;text-align:right}" +
  ".kandev-kandy-grotto-manifest-open{width:100%;display:flex;justify-content:flex-start;align-items:baseline;gap:7px;margin:0;padding:0;border:none;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:6px}" +
  ".kandev-kandy-grotto-manifest-open:hover{color:#ffe4a8}" +
  ".kandev-kandy-grotto-manifest-name{min-width:0;overflow-wrap:anywhere;text-align:left}" +
  ".kandev-kandy-grotto-door-overflow.is-revealed{background:linear-gradient(180deg,rgba(255,214,150,.16),rgba(0,0,0,.26))}" +
  ".kandev-kandy-grotto-boundary{margin:16px 0 0;color:var(--grotto-ink-dim);font-size:10px;text-align:center}" +
  // Empty hub: shore dock only. Pile-less chambers use empty-msg instead.
  ".kandev-kandy-grotto-empty{position:relative;z-index:1;flex:1;min-height:270px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.kandev-kandy-grotto-empty-msg{flex:1;min-height:240px;display:flex;align-items:center;justify-content:center;color:var(--grotto-ink-dim);text-align:center;font-size:12px}" +
  "@media (max-width:480px){.kandev-kandy-grotto-hub{grid-template-columns:1fr;grid-template-rows:auto!important;gap:10px}.kandev-kandy-grotto-hub>*{grid-column:1!important;grid-row:auto!important}.kandev-kandy-grotto-door{margin:0!important;border-radius:14px!important}.kandev-kandy-grotto-door::after{display:none}.kandev-kandy-grotto-scene{padding:12px}.kandev-kandy-grotto-bar{gap:6px;padding:8px}.kandev-kandy-grotto-subtitle{font-size:9px}.kandev-kandy-grotto-action{padding:0 8px}}" +
  // Kandy walks between the surface and the grotto: it strolls out of frame,
  // the panel swaps while it is gone, then it walks back in — down from the
  // ceiling into the grotto, in from the side back on the surface. These
  // classes sit on their own wrapper so the archetype gait keeps animating
  // underneath them.
  "@keyframes kandev-kandy-walkoff{0%{transform:translateX(0);opacity:1}78%{opacity:1}100%{transform:translateX(190px);opacity:0}}" +
  "@keyframes kandev-kandy-walkin-shore{0%{transform:translate(-170px,120px);opacity:0}22%{opacity:1}100%{transform:translate(0,0);opacity:1}}" +
  "@keyframes kandev-kandy-walkin-side{0%{transform:translateX(-180px);opacity:0}16%{opacity:1}100%{transform:translateX(0);opacity:1}}" +
  ".kandev-kandy-walkoff{animation:kandev-kandy-walkoff .62s linear both}" +
  "@keyframes kandev-kandy-walkoff-left{0%{transform:translateX(0);opacity:1}78%{opacity:1}100%{transform:translateX(-190px);opacity:0}}" +
  "@keyframes kandev-kandy-walkin-shore-right{0%{transform:translate(170px,120px);opacity:0}22%{opacity:1}100%{transform:translate(0,0);opacity:1}}" +
  "@keyframes kandev-kandy-walkin-entrance{0%{transform:translateY(-85px);opacity:0}70%{opacity:.9}100%{transform:translateY(0);opacity:1}}" +
  "@keyframes kandev-kandy-walkout-entrance{0%{transform:translateY(0);opacity:1}30%{opacity:.9}100%{transform:translateY(-85px);opacity:0}}" +
  ".kandev-kandy-walkoff-left{animation:kandev-kandy-walkoff-left .62s linear both}" +
  ".kandev-kandy-walkin-shore-right{animation:kandev-kandy-walkin-shore-right .76s linear both}" +
  ".kandev-kandy-walkin-entrance{animation:kandev-kandy-walkin-entrance .9s ease-out both}" +
  ".kandev-kandy-walkout-entrance{animation:kandev-kandy-walkout-entrance .62s ease-in both}" +
  ".kandev-kandy-walkin-shore{animation:kandev-kandy-walkin-shore .76s linear both}" +
  // A chamber Kandy stands on the floor (margin-top:auto) against one wall
  // (is-left/is-right), inside a scene that clips. Two things follow. It walks
  // in FLAT — the shore walk-in drops 120px, which down here starts it below
  // the floor. And it walks a SHORT way: the wall inset above is what buys the
  // walk its visible run, so the travel here has to stay close to that inset
  // plus the creature's own width, or the trip is over before it clears the
  // edge and Kandy just appears at its resting spot.
  "@keyframes kandev-kandy-walkin-floor{0%{transform:translateX(-96px);opacity:0}6%{opacity:1}100%{transform:translateX(0);opacity:1}}" +
  "@keyframes kandev-kandy-walkin-floor-right{0%{transform:translateX(96px);opacity:0}6%{opacity:1}100%{transform:translateX(0);opacity:1}}" +
  ".kandev-kandy-walkin-floor{animation:kandev-kandy-walkin-floor .9s linear both}" +
  ".kandev-kandy-walkin-floor-right{animation:kandev-kandy-walkin-floor-right .9s linear both}" +
  ".kandev-kandy-walkin-side{animation:kandev-kandy-walkin-side .7s linear both}" +
  // Resize grip: a ~16px muted diagonal-lines affordance hugging the
  // dialog's bottom-right corner, OUTSIDE the zoomed wrapper so its hit
  // area never scales. touch-action:none keeps pointer-captured drags from
  // turning into scrolls on touch-capable desktops/tablets.
  ".kandev-kandy-resizegrip{position:absolute;right:0;bottom:0;z-index:3;width:16px;height:16px;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 3px 3px 0;margin:0;border:none;background:transparent;color:var(--muted-foreground);opacity:0.55;cursor:nwse-resize;touch-action:none}" +
  ".kandev-kandy-resizegrip:hover,.kandev-kandy-resizegrip:focus-visible{opacity:0.9}" +
  // Phones: fixed compact card, no resizing — !important so the media
  // query beats the inline zoom/width the resize state writes.
  "@media (max-width: 480px){.kandev-kandy-dialogzoom{zoom:1!important}.kandev-kandy-dialogframe{width:248px!important}.kandev-kandy-resizegrip{display:none}}" +
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
  // holdtip: the hold-to-bonk progress — a quick fade-in, then a LINEAR
  // rotation to the pour pose across the whole duration (BONK_HOLD_MS,
  // set inline), so elapsed/BONK_HOLD_MS maps straight onto the current
  // angle (transform is only keyed at 0%/100%; the 14% key is opacity).
  "@keyframes kandev-kandy-holdtip{0%{opacity:0;transform:rotate(0deg)}14%{opacity:0.95}100%{opacity:0.95;transform:rotate(-104deg)}}" +
  // holdcancel: released early — the bucket rights itself from wherever
  // the hold left it (--kandy-holdrot, set inline) and fades away.
  "@keyframes kandev-kandy-holdcancel{0%{opacity:0.95;transform:rotate(var(--kandy-holdrot,-52deg))}55%{opacity:0.8;transform:rotate(0deg)}100%{opacity:0;transform:rotate(0deg)}}" +
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
  // Season particle drifts (v0.7.0): transform-only loops on SVG elements
  // positioned by attributes (transform-box fill-box inline), so reduced
  // motion (animation:none) leaves static particles at their seeded spots.
  "@keyframes kandev-kandy-snowdrift{0%,100%{transform:translate(0,0)}50%{transform:translate(2.5px,4px)}}" +
  "@keyframes kandev-kandy-petaldrift{0%,100%{transform:translate(0,0)}50%{transform:translate(-3px,2.5px)}}" +
  "@keyframes kandev-kandy-leafdrift{0%,100%{transform:translate(0,0) rotate(0deg)}50%{transform:translate(3px,4px) rotate(12deg)}}" +
  // Fireflies pulse opacity ONLY: their base opacity attribute keeps them
  // visible when the animation is off.
  "@keyframes kandev-kandy-glowpulse{0%,100%{opacity:0.3}50%{opacity:1}}" +
  // Speech bubble life: fade in, hold, fade out (duration inline from
  // BUBBLE_TOTAL_MS). Base opacity stays 1 — under reduced motion the
  // bubble is CONTENT and simply appears/disappears statically.
  "@keyframes kandev-kandy-bubblelife{0%{opacity:0;transform:translateY(3px)}6%{opacity:1;transform:translateY(0)}90%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-2px)}}" +
  // Arrival motion arcs: opacity only, quick in and out.
  "@keyframes kandev-kandy-greetarc{0%{opacity:0}25%{opacity:0.9}70%{opacity:0.75}100%{opacity:0}}" +
  // Gait keyframes (v0.8.0): transform-only loops that live on the
  // dedicated gait wrapper (no base transform there — the layering rule).
  // Periods echo the approved prototype (waddle ~0.45s ≈ ±4° at 14rad/s).
  "@keyframes kandev-kandy-gaitwaddle{0%,100%{transform:rotate(-3.5deg) translateY(0)}25%{transform:rotate(0deg) translateY(-2.2px)}50%{transform:rotate(3.5deg) translateY(0)}75%{transform:rotate(0deg) translateY(-2.2px)}}" +
  "@keyframes kandev-kandy-gaitstride{0%,100%{transform:rotate(-2.4deg)}50%{transform:rotate(2.4deg)}}" +
  "@keyframes kandev-kandy-gaitslither{0%,100%{transform:translateX(-2.5px) rotate(-1.6deg)}50%{transform:translateX(2.5px) rotate(1.6deg)}}" +
  "@keyframes kandev-kandy-gaitshuffle{0%,100%{transform:rotate(-1.8deg) translateY(0)}50%{transform:rotate(1.8deg) translateY(-1.2px)}}" +
  "@keyframes kandev-kandy-gaithopskip{0%,55%,100%{transform:translateY(0) rotate(0deg)}20%{transform:translateY(-5px) rotate(-2deg)}38%{transform:translateY(0) rotate(0deg)}70%{transform:translateY(-2.5px) rotate(2deg)}82%{transform:translateY(0)}}" +
  "@keyframes kandev-kandy-gaitglide{0%,100%{transform:rotate(-1.5deg) translateY(0)}50%{transform:rotate(1.5deg) translateY(-1.5px)}}" +
  // Sob-shudder (v0.8.0): a small decaying rock every ~2.5s while a bout
  // plays. Transform only — it shares the animation-safe inner wrapper
  // with wiggle and must be DECLARED after it (see the class rules).
  "@keyframes kandev-kandy-sob{0%,84%,100%{transform:rotate(0deg)}88%{transform:rotate(-2.2deg)}92%{transform:rotate(1.8deg)}96%{transform:rotate(-1deg)}}" +
  // Tears: ~1.1s gravity fall (ease-in on the class) over each eye's own
  // --tearfall distance, fading just before the ground.
  "@keyframes kandev-kandy-tearfall{0%{opacity:0;transform:translateY(0)}12%{opacity:0.95}75%{opacity:0.95}100%{opacity:0;transform:translateY(var(--tearfall,40px))}}" +
  // Puddle: grows through the bout (animationDuration = CRY_BOUT_MS
  // inline), caps small, fades out as the bout ends.
  "@keyframes kandev-kandy-puddlegrow{0%{opacity:0;transform:scaleX(0.25)}18%{opacity:0.42}80%{opacity:0.5;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}" +
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
  // sob is declared after wiggle for the same reason as munch/soaked: the
  // later single-class animation shorthand wins while a bout plays.
  ".kandev-kandy-sob{animation:kandev-kandy-sob 2.5s ease-in-out infinite;transform-origin:50% 85%}" +
  // Gait classes (v0.8.0) live on the dedicated gait wrapper. The wisp's
  // drift is a STATIC trailing lean, not an animation — smooth floating,
  // no steps (the facing flip outside mirrors the lean automatically).
  ".kandev-kandy-gait-waddle{animation:kandev-kandy-gaitwaddle 0.45s linear infinite;transform-origin:50% 100%}" +
  ".kandev-kandy-gait-stride{animation:kandev-kandy-gaitstride 0.9s ease-in-out infinite;transform-origin:50% 100%}" +
  ".kandev-kandy-gait-slither{animation:kandev-kandy-gaitslither 0.6s ease-in-out infinite;transform-origin:50% 100%}" +
  ".kandev-kandy-gait-shuffle{animation:kandev-kandy-gaitshuffle 0.3s linear infinite;transform-origin:50% 100%}" +
  ".kandev-kandy-gait-hopskip{animation:kandev-kandy-gaithopskip 0.55s ease-in-out infinite;transform-origin:50% 100%}" +
  ".kandev-kandy-gait-glide{animation:kandev-kandy-gaitglide 1.2s ease-in-out infinite;transform-origin:50% 50%}" +
  ".kandev-kandy-gait-drift{transform:rotate(-5deg);transform-origin:50% 80%}" +
  // Overlay elements: base opacity 0 so nothing shows during their sync
  // delays — or at all under prefers-reduced-motion (animation:none
  // leaves the base state).
  ".kandev-kandy-treat{position:absolute;opacity:0;animation:kandev-kandy-treatfall 0.8s both;pointer-events:none}" +
  ".kandev-kandy-treat-ignored{position:absolute;opacity:0;animation:kandev-kandy-treatbounce 1.3s both;pointer-events:none}" +
  ".kandev-kandy-crumb{position:absolute;opacity:0;animation:kandev-kandy-fleck 0.55s ease-out both;pointer-events:none}" +
  ".kandev-kandy-bucket{position:absolute;opacity:0;animation:kandev-kandy-buckettip 1.5s ease both;pointer-events:none}" +
  // Hold-to-bonk progress bucket: tilt duration is inline (BONK_HOLD_MS).
  // The static variant is the reduced-motion "about to commit" signal —
  // no animation at all, just a visible tilted bucket from half-hold.
  ".kandev-kandy-holdtip{position:absolute;opacity:0;animation:kandev-kandy-holdtip linear both;pointer-events:none}" +
  ".kandev-kandy-holdcancel{position:absolute;animation:kandev-kandy-holdcancel 0.45s ease both;pointer-events:none}" +
  ".kandev-kandy-holdtip-static{position:absolute;opacity:0.95;transform:rotate(-52deg);pointer-events:none}" +
  ".kandev-kandy-pour{position:absolute;opacity:0;animation:kandev-kandy-pour 0.95s ease 0.42s both;transform-origin:50% 0;pointer-events:none}" +
  ".kandev-kandy-splat{position:absolute;opacity:0;animation:kandev-kandy-splat 0.5s ease 0.5s both;pointer-events:none}" +
  ".kandev-kandy-splashdrop{position:absolute;opacity:0;animation:kandev-kandy-fleck 0.6s ease-out both;pointer-events:none}" +
  ".kandev-kandy-drip{position:absolute;opacity:0;animation:kandev-kandy-drip 0.8s ease-in both;pointer-events:none}" +
  ".kandev-kandy-dots{position:absolute;font-size:15px;font-weight:700;opacity:0;letter-spacing:2px;animation:kandev-kandy-dotsfade 1.4s ease 0.35s both;pointer-events:none}" +
  // Cry overlay elements: base opacity 0 so reduced motion (animation:
  // none) shows nothing — the sad face's static teardrop stays the only
  // tear there.
  ".kandev-kandy-tear{position:absolute;opacity:0;animation:kandev-kandy-tearfall 1.1s ease-in infinite;pointer-events:none}" +
  ".kandev-kandy-puddle{position:absolute;opacity:0;animation:kandev-kandy-puddlegrow ease-out both;transform-origin:50% 50%;pointer-events:none}" +
  // zzz base opacity 0 (they fade in through the loop); the lead z carries
  // a visible base opacity so reduced motion shows a static single z.
  ".kandev-kandy-zzz{opacity:0;animation:kandev-kandy-zzz 2.7s ease-in-out infinite}" +
  ".kandev-kandy-zzz-lead{opacity:0.85}" +
  ".kandev-kandy-snow{animation:kandev-kandy-snowdrift 5s ease-in-out infinite}" +
  ".kandev-kandy-petal{animation:kandev-kandy-petaldrift 6s ease-in-out infinite}" +
  ".kandev-kandy-leaf{animation:kandev-kandy-leafdrift 7s ease-in-out infinite}" +
  ".kandev-kandy-firefly{animation:kandev-kandy-glowpulse 3.4s ease-in-out infinite}" +
  // The speech bubble is styled like the app's popovers: popover bg,
  // subtle border, small italic text, soft shadow. The tail is a rotated
  // square span (static base transform on the CHILD — the animated bubble
  // div itself carries no base transform, per the layering rule).
  ".kandev-kandy-bubble{position:absolute;z-index:2;box-sizing:border-box;pointer-events:none;background:#ffffff;color:#414b5c;border:1px solid #d9dee8;border-radius:10px;padding:5px 9px;font-size:10px;font-style:italic;line-height:1.35;box-shadow:0 2px 10px rgba(0,0,0,0.14);animation:kandev-kandy-bubblelife ease both}" +
  ".kandev-kandy-bubbletail{position:absolute;bottom:-4px;width:7px;height:7px;background:#ffffff;border-right:1px solid #d9dee8;border-bottom:1px solid #d9dee8;transform:rotate(45deg)}" +
  ".kandev-kandy-greetarc{opacity:0;animation:kandev-kandy-greetarc 1.2s ease both}" +
  ".kandev-kandy-control{transition-property:transform,background-color,box-shadow;transition-duration:150ms;transition-timing-function:ease-out}" +
  ".kandev-kandy-control:active:not(:disabled){transform:scale(0.96)}" +
  ".kandev-kandy-control:focus-visible{outline:2px solid var(--ring);outline-offset:2px}" +
  ".kandev-kandy-photo-entry-surface{transition-property:background-color,box-shadow;transition-duration:150ms;transition-timing-function:ease-out}" +
  ".kandev-kandy-photo-entry:hover .kandev-kandy-photo-entry-surface{background:color-mix(in oklch,var(--background) 94%,var(--foreground) 6%);box-shadow:0 0 0 1px color-mix(in oklch,var(--foreground) 10%,transparent),0 2px 6px rgba(0,0,0,0.10)}" +
  ".kandev-kandy-photo-panel:focus{outline:none}" +
  ".kandev-kandy-photo-panel:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}" +
  ".kandev-kandy-static,.kandev-kandy-static *{animation:none!important}" +
  "@media (prefers-reduced-motion: reduce){.kandev-kandy-walkoff,.kandev-kandy-walkoff-left,.kandev-kandy-walkin-shore,.kandev-kandy-walkin-shore-right,.kandev-kandy-walkin-floor,.kandev-kandy-walkin-floor-right,.kandev-kandy-walkin-entrance,.kandev-kandy-walkout-entrance,.kandev-kandy-walkin-side,.kandev-kandy-bob,.kandev-kandy-bob-fast,.kandev-kandy-bob-slow,.kandev-kandy-bobsad,.kandev-kandy-blink,.kandev-kandy-wiggle,.kandev-kandy-celebrate,.kandev-kandy-celebrate::after,.kandev-kandy-levelup,.kandev-kandy-levelup::after,.kandev-kandy-cardhop,.kandev-kandy-burst,.kandev-kandy-namehl,.kandev-kandy-heartfloat,.kandev-kandy-munch,.kandev-kandy-soaked,.kandev-kandy-turnaway,.kandev-kandy-treat,.kandev-kandy-treat-ignored,.kandev-kandy-crumb,.kandev-kandy-bucket,.kandev-kandy-holdtip,.kandev-kandy-holdcancel,.kandev-kandy-pour,.kandev-kandy-splat,.kandev-kandy-splashdrop,.kandev-kandy-drip,.kandev-kandy-dots,.kandev-kandy-zzz,.kandev-kandy-snow,.kandev-kandy-petal,.kandev-kandy-leaf,.kandev-kandy-firefly,.kandev-kandy-bubble,.kandev-kandy-greetarc,.kandev-kandy-sob,.kandev-kandy-tear,.kandev-kandy-puddle,.kandev-kandy-gait-waddle,.kandev-kandy-gait-stride,.kandev-kandy-gait-slither,.kandev-kandy-gait-shuffle,.kandev-kandy-gait-hopskip,.kandev-kandy-gait-glide{animation:none}.kandev-kandy-gait-drift{transform:none}.kandev-kandy-control{transition:none}.kandev-kandy-photo-entry-surface{transition:none}.kandev-kandy-token-pile-hoard{animation:none!important;transition:none!important}.kandev-kandy-helpcontent{transition:none}.kandev-kandy-control:active:not(:disabled){transform:none}}";

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

// generationValue reads a webhook body's (or a remembered snapshot's)
// lineage generation. Pre-0.13 servers omit the field entirely, and every
// kandy is at least the first of its line.
function generationValue(body) {
  var n = Math.floor(Number(body && body.generation) || 0);
  return n > 0 ? n : 1;
}

// rememberedProgress is the slice of a webhook body the widget keeps between
// polls to decide what to celebrate.
function rememberedProgress(body) {
  return {
    level: body.level,
    award_seq: body.award_seq,
    generation: generationValue(body),
  };
}

// bigCelebration — level-ups and rebirths get the full treatment (large
// sparkle burst, name highlight, the longer chip animation); a plain XP gain
// gets the small one.
function bigCelebration(celebration) {
  return !!celebration && celebration.kind !== "gain";
}

// romanNumeral — generation numbering, mirroring the server's.
function romanNumeral(n) {
  var values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  var symbols = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  n = Math.floor(n);
  if (!(n > 0)) return "I";
  var out = "";
  for (var i = 0; i < values.length; i++) {
    while (n >= values[i]) {
      out += symbols[i];
      n -= values[i];
    }
  }
  return out;
}

// generationSummary — the lineage marker, or null for a first-of-its-line
// kandy ("Gen I" on an instance that has never seen a rebirth is noise).
// It rides the progress line rather than the header: the 248px header row
// already carries a wrapping stage name, the level pill, the mood badge and
// the help dot, and a fifth chip pushes the whole row into overflow.
//
// roster names the elders standing in the scene, newest first, so the
// background figures can be identified without a second panel.
function generationSummary(data) {
  var generation = Math.floor(Number(data && data.generation) || 1);
  if (generation <= 1) return null;
  var elders = (data && data.ancestors) || [];
  var lines = ["Generation " + romanNumeral(generation)];
  for (var i = elders.length - 1; i >= 0; i--) {
    var elder = elders[i] || {};
    lines.push(
      "· " +
        (elder.stage_name || "Kandy") +
        " (Gen " +
        romanNumeral(Math.floor(Number(elder.generation) || 1)) +
        ") retired at Lv " +
        Math.floor(Number(elder.level) || 100),
    );
  }
  return {
    generation: generation,
    label: "Gen " + romanNumeral(generation),
    roster: lines.join("\n"),
    elders: elders.length,
  };
}

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

// kandyHelp — a deliberately small, local tooltip explaining the mechanics
// users can actually observe. Growth sources stay categorical: the server's
// XP weights remain secret, while the important care-vs-growth distinction is
// explicit so nobody tries to level Kandy by repeatedly clicking it.
function kandyHelp(h) {
  return h(
    "div",
    { className: "kandev-kandy-help" },
    h(
      "button",
      {
        type: "button",
        className: "kandev-kandy-helpbutton",
        "aria-label": "How Kandy works",
        "aria-describedby": "kandev-kandy-help-text",
      },
      h(
        "svg",
        { width: 12, height: 12, viewBox: "0 0 16 16", "aria-hidden": "true" },
        h("circle", { cx: 8, cy: 8, r: 6.25, fill: "none", stroke: "currentColor", strokeWidth: 1.5 }),
        h("path", {
          d: "M8 7.1 V11 M8 4.75 V4.8",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
        }),
      ),
    ),
    h(
      "div",
      { id: "kandev-kandy-help-text", role: "tooltip", className: "kandev-kandy-helpcontent" },
      h("strong", null, "How Kandy works"),
      h(
        "ul",
        null,
        h("li", null, "Click or tap Kandy to give it candy."),
        h("li", null, "Right-click to add water; on touch, press and hold."),
        h("li", null, "Messages and completed agent turns and runs help it grow."),
        h("li", null, "Candy and water change mood and bond, not growth."),
        h("li", null, "Mood cools when work goes quiet. Time and season shape its habitat."),
        h("li", null, "One Kandy is shared across this Kandev instance."),
      ),
    ),
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

// Hold-to-bonk (v0.6.5, coarse pointers only). A press shorter than
// HOLD_TAP_MAX_MS releases as a plain tap (= pet); holding through
// BONK_HOLD_MS commits the bonk; anything between is a hesitation and
// does NOTHING. HOLD_POUR_DEG matches buckettip's pouring pose so the
// committed hold hands off visually into the drench choreography.
var BONK_HOLD_MS = 700;
var HOLD_TAP_MAX_MS = 250;
var HOLD_CANCEL_MS = 450;
var HOLD_POUR_DEG = -104;

// isCoarsePointer / prefersReducedMotion — feature-detected at call time
// (never cached: DevTools device emulation and OS settings flip live).
// Guarded so the offline node harness (no matchMedia) stays on defaults.
function isCoarsePointer() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// careHintText — the discoverability line under the card: pointer-aware.
function careHintText(coarse) {
  return coarse ? "tap to treat · hold to douse" : "psst — click your kandy";
}

// bonkContactFor — the effects' contact point in scene pixels, derived from
// the SAME values the renderer uses: the archetype builder's `top` anchor
// (the crown varies per archetype — a serpent's raised head, a sprite's
// hover height) and STAGE_SCALE scaling about the (50,88) anchor, so the
// treat and the water land on the head at every metamorphosis stage.
// Scene: 248x124 px; creature svg: 92px for viewBox 0 0 100 100, bottom-
// centered ~2px above the scene floor (plus the inline-svg baseline gap).
var BONK_SCENE = { w: 248, h: 124, svgPx: 92, bottomPx: 5 };

// wanderX (v0.8.0, optional): the live wander-layer offset in scene px.
// EVERY consumer of the contact point passes it through so treats fall,
// buckets pour, bubbles point, and tears well wherever the creature has
// actually strolled to. mirrored (also v0.8.0): true while the facing
// wrapper holds scaleX(-1) — asymmetric bodies (the serpent's raised
// head) have their contact point reflected about the body center, so the
// bucket pours on the head it actually shows. Omitted args keep the
// legacy centered math exact.
function bonkContactFor(data, wanderX, mirrored) {
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
  // The facing flip mirrors the drawn body about viewBox x=50 (the svg is
  // centered in its wrapper), so the contact point mirrors with it.
  if (mirrored) vx = 100 - vx;
  var k = BONK_SCENE.svgPx / 100;
  return {
    x: BONK_SCENE.w / 2 + (vx - 50) * k + (wanderX || 0),
    y: BONK_SCENE.h - BONK_SCENE.bottomPx - (100 - vy) * k,
  };
}

// ---------------------------------------------------------------------------
// Wander (v0.8.0) — they walk now. Pure helpers here; the widget owns the
// clock. Layer order (kandyCard): the outer positioning div keeps the
// layout transform (left:50% + translateX(-50%)), the WANDER div carries a
// state-driven inline translateX (never a CSS animation — the layering
// rule), the FACING div carries a state-driven scaleX flip, and the GAIT
// div carries only transform keyframe animations with no base transform.
// ---------------------------------------------------------------------------

var WANDER_MAX_PX = 35; // hard cap on how far a stroll may take it
var WANDER_EDGE_MARGIN_PX = 2; // spare px between body edge and scene edge
var WANDER_MIN_DIST_PX = 14; // strolls shorter than this aren't worth it
var WANDER_SPEED_PX_S = 22; // the unhurried cruising speed
var WANDER_MIN_LEG_MS = 600;
var WANDER_BUCKET_MS = 10000; // gate granularity: one stroll vote per 10s
var WANDER_FRAME_MS = 40; // ~25fps position updates while a leg plays
var COG_STEP_PX = 3; // the cogling's discrete step size

// Mood-modulated stroll odds per 10s bucket (v0.8.1: roughly doubled —
// "it should move more often... feeling more alive"). Expected stroll
// cadence: elated ~12s, happy ~13s, content ~18s, bored ~40s, sad ~2min,
// gloomy ~4min. Asleep and eggs never vote at all (widget).
var WANDER_GATE_P = {
  elated: 0.85,
  happy: 0.75,
  content: 0.55,
  bored: 0.25,
  sad: 0.08,
  gloomy: 0.04,
};

// v0.8.1: strolls chain into small journeys (1-3 legs with brief pauses),
// and idle gaps get micro-life (a curious look-flip) so the creature never
// feels frozen between walks.
var WANDER_CHAIN_PAUSE_MS = 550;
var LOOK_GATE_P = 0.35;
var LOOK_HOLD_MS = 1600;

// Crying bouts (v0.8.0): sad ~every 4min of open-card time, gloomy ~2x.
var CRY_BUCKET_MS = 15000;
var CRY_BOUT_MS = 12000;
var CRY_GATE_P = { sad: 0.0625, gloomy: 0.125 };

// The widget's motion clock: gates are re-evaluated every 5s (buckets are
// deduped, so each 10s/15s bucket still votes at most once).
var MOTION_TICK_MS = 5000;

// Per-archetype widest half-extent in viewBox units (body only — wide
// ambient effects deliberately excluded: the scene edge CLIPS them).
// Indexed like BODY_BUILDERS.
var BODY_HALF_W = [26, 23, 34, 36, 36, 20, 31, 25, 23, 12];

// Per-archetype gait: the CSS class animated on the dedicated gait wrapper
// while a leg plays (null = none), whether the wander X interpolation is
// STEPPED (cogling robotics), and whether the mood-tempo idle bob keeps
// running during the walk (floaty archetypes hover-glide on their bob;
// grounded steppers hand vertical motion to the gait keyframes).
var GAITS = [
  { cls: "kandev-kandy-gait-waddle", stepped: false, keepBob: false }, // blob
  { cls: "kandev-kandy-gait-stride", stepped: false, keepBob: false }, // willow
  { cls: "kandev-kandy-gait-waddle", stepped: false, keepBob: false }, // chonk
  { cls: "kandev-kandy-gait-slither", stepped: false, keepBob: false }, // noodle
  { cls: "kandev-kandy-gait-shuffle", stepped: false, keepBob: false }, // sporeling
  { cls: "kandev-kandy-gait-drift", stepped: false, keepBob: true }, // wisp
  { cls: "kandev-kandy-gait-hopskip", stepped: false, keepBob: false }, // shardling
  { cls: null, stepped: true, keepBob: false }, // cogling: stepped X is the gait
  { cls: "kandev-kandy-gait-glide", stepped: false, keepBob: true }, // gazer
  { cls: "kandev-kandy-gait-glide", stepped: false, keepBob: true }, // flitter
];

function gaitFor(archetype) {
  return GAITS[(((archetype || 0) % GAITS.length) + GAITS.length) % GAITS.length];
}

// wanderGate / cryGate — the deterministic votes, same seeded-hash core as
// the speech gate (salts 5/6 keep the streams independent).
function wanderGate(seed, bucket, mood) {
  var p = WANDER_GATE_P[mood];
  if (p === undefined) p = WANDER_GATE_P.content;
  return speechHash01(seed, bucket, 5) < p;
}

function cryGate(seed, bucket, mood) {
  var p = CRY_GATE_P[mood] || 0;
  return p > 0 && speechHash01(seed, bucket, 6) < p;
}

// wanderLimitFor — the stroll amplitude: ±35px, additionally clamped so
// the body's widest extent (at its current stage scale) never crosses the
// scene edge. Wide high-level effects are NOT part of the clamp — the
// scene's overflow hidden clips them cleanly at the boundary instead.
function wanderLimitFor(data) {
  var half = 15;
  if (data && data.level > 1) {
    var arch =
      (((data.archetype || 0) % BODY_HALF_W.length) + BODY_HALF_W.length) % BODY_HALF_W.length;
    half = BODY_HALF_W[arch] * STAGE_SCALE[growthForLevel(data.level).stage];
  }
  var bodyPx = half * (BONK_SCENE.svgPx / 100);
  return Math.max(0, Math.min(WANDER_MAX_PX, BONK_SCENE.w / 2 - bodyPx - WANDER_EDGE_MARGIN_PX));
}

// wanderTargetFor — a deterministic destination inside ±limit, nudged to
// be at least WANDER_MIN_DIST_PX away from where it stands (a two-pixel
// shuffle reads as jitter, not a stroll).
function wanderTargetFor(seed, bucket, fromX, limit) {
  var u = speechHash01(seed, bucket, 7);
  var target = -limit + u * 2 * limit;
  if (Math.abs(target - fromX) < WANDER_MIN_DIST_PX) {
    // Head toward the side with more room, seeded stride length.
    target = fromX + (fromX <= 0 ? 1 : -1) * WANDER_MIN_DIST_PX * (1 + u);
  }
  return Math.min(Math.max(target, -limit), limit);
}

function smoothstep(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p * p * (3 - 2 * p);
}

// wanderLegFor — the full stroll plan for a passed gate: destination and
// duration at the ~22px/s cruising feel.
function wanderLegFor(data, bucket, fromX) {
  var seed = ((data && data.lineage_seed) || 1) >>> 0;
  var to = wanderTargetFor(seed, bucket, fromX, wanderLimitFor(data));
  return {
    from: fromX,
    to: to,
    durMs: Math.max(WANDER_MIN_LEG_MS, (Math.abs(to - fromX) / WANDER_SPEED_PX_S) * 1000),
    stepped: gaitFor(data && data.archetype).stepped,
  };
}

// wanderXAt — position along a leg after elapsedMs. Smoothstep easing for
// everyone except the cogling, which advances on LINEAR time in discrete
// 3px increments (no easing — robotic).
function wanderXAt(leg, elapsedMs) {
  var p = leg.durMs > 0 ? elapsedMs / leg.durMs : 1;
  if (p >= 1) return leg.to;
  if (p < 0) p = 0;
  var dist = leg.to - leg.from;
  if (leg.stepped) {
    var steps = Math.floor((Math.abs(dist) * p) / COG_STEP_PX);
    return leg.from + (dist >= 0 ? 1 : -1) * steps * COG_STEP_PX;
  }
  return leg.from + dist * smoothstep(p);
}

// motionDecide — the pure per-tick decision core for walking AND crying;
// the widget owns timers/state and just applies the returned action.
//   state: { x, leg, cryUntil, cryPending, lastWanderBucket, lastCryBucket }
//   inp:   { now, data, asleep, reducedMotion, fxActive }
// Actions:
//   {type:"none"}        — nothing this tick
//   {type:"halt"}        — asleep/egg/reduced-motion: freeze any leg where
//                          it stands and cancel any bout (pending included)
//   {type:"start-cry"}   — begin a ~12s bout now (stationary only)
//   {type:"cry-pending"} — a bout came due mid-stroll; it waits for the
//                          stroll to finish (started by the leg's end)
//   {type:"start-leg", leg, facing} — begin a stroll
// Yield rules encoded here: interactions (fxActive) block NEW motion — the
// interaction handlers themselves freeze an in-flight leg the moment they
// fire (freezeMotionForInteraction), so this tick never sees that race.
function motionDecide(state, inp) {
  var d = inp.data;
  var busy = state.leg || state.cryUntil > inp.now || state.cryPending;
  if (!d || !(d.level > 1) || inp.reducedMotion || inp.asleep) {
    return busy ? { type: "halt" } : { type: "none" };
  }
  if (inp.fxActive) return { type: "none" };
  var seed = (d.lineage_seed || 1) >>> 0;
  var mood = d.mood || "content";
  var crying = state.cryUntil > inp.now;
  if (!crying && !state.cryPending) {
    var cb = Math.floor(inp.now / CRY_BUCKET_MS);
    if (cb !== state.lastCryBucket && cryGate(seed, cb, mood)) {
      return state.leg ? { type: "cry-pending" } : { type: "start-cry" };
    }
  }
  if (state.cryPending && !state.leg) return { type: "start-cry" };
  if (!state.leg && !crying) {
    var wb = Math.floor(inp.now / WANDER_BUCKET_MS);
    if (wb !== state.lastWanderBucket && wanderGate(seed, wb, mood)) {
      var leg = wanderLegFor(d, wb, state.x);
      if (Math.abs(leg.to - leg.from) >= 1) {
        return {
          type: "start-leg",
          leg: leg,
          facing: leg.to >= leg.from ? 1 : -1,
          // 0-2 follow-up legs make the stroll a small journey.
          chain: Math.floor(speechHash01(seed, wb, 8) * 3),
        };
      }
    }
    // No stroll this bucket: maybe a bit of idle micro-life instead — a
    // curious look-flip keeps it feeling alive between walks.
    if (wb !== state.lastWanderBucket && speechHash01(seed, wb, 9) < LOOK_GATE_P) {
      return { type: "look" };
    }
  }
  return { type: "none" };
}

// ---------------------------------------------------------------------------
// Crying (v0.8.0) — tears from the renderer's own face geometry.
// ---------------------------------------------------------------------------

// eyeAnchorsFor — the EXACT eye positions in scene px, derived from the
// same head math faceParts uses (builder geometry -> eye spots -> stage
// scale about (50,88) -> scene mapping), so tears well at the eyes of
// every archetype and stage — including each of a gazer's 3-5 eyes. The
// anchor sits just under the lower lid (cy+2) where a droplet forms.
// mirrored reflects the anchors with the facing flip, like bonkContactFor.
function eyeAnchorsFor(data, wanderX, mirrored) {
  if (!data || !(data.level > 1)) return [];
  var lineage = (data.lineage_seed || 1) >>> 0;
  var g = growthForLevel(data.level);
  var sty = lineageStyle(lineage);
  var temper = temperFor(data);
  var C = lineageColors(data.family || 0, data.level, sty, temper);
  var arch =
    (((data.archetype || 0) % BODY_BUILDERS.length) + BODY_BUILDERS.length) % BODY_BUILDERS.length;
  var noop = function () {
    return null;
  };
  var body = BODY_BUILDERS[arch](noop, makeRand(lineage, 6), C, g);
  var head = body.head;
  var spots = [];
  var count = head.alien && g.stage >= 2 ? sty.alienEyes : 2;
  if (count === 2) {
    spots.push({ cx: head.cx - head.r * 0.5, cy: head.cy });
    spots.push({ cx: head.cx + head.r * 0.5, cy: head.cy });
  } else {
    for (var i = 0; i < count; i++) {
      var t = i / (count - 1) - 0.5;
      spots.push({ cx: head.cx + t * head.r * 1.3, cy: head.cy - Math.abs(t) * 3 - (i % 2) * 2 });
    }
  }
  var s = STAGE_SCALE[g.stage];
  var k = BONK_SCENE.svgPx / 100;
  return spots.map(function (sp) {
    var vx = 50 + ((mirrored ? 100 - sp.cx : sp.cx) - 50) * s;
    var vy = 88 - (88 - (sp.cy + 2)) * s;
    return {
      x: BONK_SCENE.w / 2 + (vx - 50) * k + (wanderX || 0),
      y: BONK_SCENE.h - BONK_SCENE.bottomPx - (100 - vy) * k,
    };
  });
}

// Tear phase offsets (ms): negative animation delays start each droplet
// mid-cycle so the eyes never weep in lockstep.
var TEAR_PHASE_MS = [0, 366, 640, 940];
var CRY_TEARS_PER_EYE = 2;
var CRY_MAX_TEARS = 8;

// cryOverlay — the bout visual: per-eye gravity-fall droplets (~1.1s
// cycles, CSS var --tearfall carries each eye's real fall distance) and a
// small capped puddle that grows through the bout and fades at its end
// (animationDuration = CRY_BOUT_MS inline). The sob-shudder itself lives
// on the creature's animation-safe inner wrapper (kandev-kandy-sob via
// kandyCard). Composes over the existing sad face; reduced motion shows
// nothing here (base opacity 0 + animation:none) — the static teardrop in
// faceParts stays the only tear.
function cryOverlay(h, seq, data, wanderX, mirrored) {
  var eyes = eyeAnchorsFor(data, wanderX, mirrored);
  if (!eyes.length) return null;
  var floorY = BONK_SCENE.h - BONK_SCENE.bottomPx;
  var kids = [];
  var total = Math.min(eyes.length * CRY_TEARS_PER_EYE, CRY_MAX_TEARS);
  for (var i = 0; i < total; i++) {
    var eye = eyes[i % eyes.length];
    var fall = Math.max(floorY - eye.y - 2, 8);
    kids.push(
      h(
        "span",
        {
          key: "tear" + i,
          className: "kandev-kandy-tear",
          style: {
            left: eye.x - 2 + "px",
            top: eye.y + "px",
            width: "4px",
            height: "5px",
            animationDelay: -(TEAR_PHASE_MS[i % TEAR_PHASE_MS.length] + ((i * 137) % 300)) + "ms",
            "--tearfall": fall.toFixed(1) + "px",
          },
        },
        h("span", {
          style: {
            display: "block",
            width: "100%",
            height: "100%",
            background: "#7fd7ff",
            borderRadius: "50% 0 50% 50%",
            // Tail up: the square corner rotated to 12 o'clock (drip pose).
            transform: "rotate(-45deg)",
          },
        }),
      ),
    );
  }
  var c = bonkContactFor(data, wanderX, mirrored);
  kids.push(
    h("span", {
      key: "puddle",
      className: "kandev-kandy-puddle",
      style: {
        left: c.x - 22 + "px",
        top: floorY - 4 + "px",
        width: "44px",
        height: "6px",
        borderRadius: "50%",
        background: "#8fd0f0",
        animationDuration: CRY_BOUT_MS + "ms",
      },
    }),
  );
  return h(
    "div",
    { key: "cryfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    kids,
  );
}

// ---------------------------------------------------------------------------
// Speech (v0.7.0, deepened in v0.7.1) — a tamagotchi with opinions. The
// pool is organized by temperament band x context; "any" lines fit every
// band. Voice: dry, deadpan; sarcasm peaks at neutral/wary, beloved stays
// warm with soft sarcasm, fearful is quiet and a little heartbreaking.
// Lines stay under ~48 chars, no emoji. ctx values: generic, greeting
// (dialog open), morning, latenight, dusk, bored, gloomy (sad/gloomy
// moods), refusing (refusing_pets), winter/spring/summer/autumn, scarred
// (mixed in as ~15% spice for scarred kandys), sleep.
// ---------------------------------------------------------------------------

var SPEECH = [
  // -- beloved: warm, with occasional soft sarcasm ------------------------
  { id: "bel-g1", band: "beloved", ctx: "generic", text: "you came back! I mean— hey." },
  { id: "bel-g2", band: "beloved", ctx: "generic", text: "I saved you a spot. it's all of me." },
  { id: "bel-g3", band: "beloved", ctx: "generic", text: "best human. don't tell the others." },
  { id: "bel-g4", band: "beloved", ctx: "generic", text: "I'd share my candy with you. one piece." },
  { id: "bel-g5", band: "beloved", ctx: "generic", text: "you're my favorite recurring event." },
  { id: "bel-g6", band: "beloved", ctx: "generic", text: "today's forecast: you. good." },
  { id: "bel-g7", band: "beloved", ctx: "generic", text: "I did a little hop earlier. you missed it." },
  { id: "bel-g8", band: "beloved", ctx: "generic", text: "the sun's out. you're here. suspicious. good." },
  { id: "bel-g9", band: "beloved", ctx: "generic", text: "I practiced saying hi all morning. hi." },
  { id: "bel-g10", band: "beloved", ctx: "generic", text: "you're my whole event loop." },
  { id: "bel-g11", band: "beloved", ctx: "generic", text: "I told the rocks about you. they get it." },
  { id: "bel-g12", band: "beloved", ctx: "generic", text: "stay as long as you want. forever works." },
  { id: "bel-g13", band: "beloved", ctx: "generic", text: "I rate today ten out of you." },
  { id: "bel-g14", band: "beloved", ctx: "generic", text: "the meadow's better when you're looking." },
  { id: "bel-g15", band: "beloved", ctx: "generic", text: "I'd wave if my arms reached. consider it waved." },
  { id: "bel-g16", band: "beloved", ctx: "generic", text: "come for the pixels, stay for me." },
  { id: "bel-g17", band: "beloved", ctx: "generic", text: "I kept your spot warm. it's the whole card." },
  { id: "bel-g18", band: "beloved", ctx: "generic", text: "even my shadow likes you. it told me." },
  { id: "bel-g19", band: "beloved", ctx: "generic", text: "you, me, four rocks. perfect team." },
  { id: "bel-g20", band: "beloved", ctx: "generic", text: "I purr. internally. constantly. for you." },
  { id: "bel-g21", band: "beloved", ctx: "generic", text: "best part of my day walks in and says hi." },
  { id: "bel-g22", band: "beloved", ctx: "generic", text: "if I evolve wings, first flight's for you." },
  { id: "bel-h1", band: "beloved", ctx: "greeting", text: "you're here! act natural. I'm thrilled." },
  { id: "bel-h2", band: "beloved", ctx: "greeting", text: "hi hi hi. okay. composure." },
  { id: "bel-h3", band: "beloved", ctx: "greeting", text: "I was JUST thinking about you. always am." },
  { id: "bel-h4", band: "beloved", ctx: "greeting", text: "there you are. the day can start now." },
  { id: "bel-h5", band: "beloved", ctx: "greeting", text: "I heard the click and hoped. it's you." },
  // -- content: settled, mildly smug --------------------------------------
  { id: "con-g1", band: "content", ctx: "generic", text: "all systems nominal. petting optional." },
  { id: "con-g2", band: "content", ctx: "generic", text: "not to brag, but the moss here is mine." },
  { id: "con-g3", band: "content", ctx: "generic", text: "we're doing fine. weirdly fine." },
  { id: "con-g4", band: "content", ctx: "generic", text: "I counted the rocks again. still four." },
  { id: "con-g5", band: "content", ctx: "generic", text: "another quiet day in paradise, huh." },
  { id: "con-g6", band: "content", ctx: "generic", text: "life's simple. eat, evolve, repeat." },
  { id: "con-g7", band: "content", ctx: "generic", text: "the moss and I have an understanding." },
  { id: "con-g8", band: "content", ctx: "generic", text: "today's agenda: exist beautifully. done." },
  { id: "con-g9", band: "content", ctx: "generic", text: "I checked the perimeter. still scenic." },
  { id: "con-g10", band: "content", ctx: "generic", text: "the flag waved at me first. we're friends." },
  { id: "con-g11", band: "content", ctx: "generic", text: "settled in nicely. the rent here is petting." },
  { id: "con-g12", band: "content", ctx: "generic", text: "I napped, I snacked, I supervised. full day." },
  { id: "con-g13", band: "content", ctx: "generic", text: "the sun hits my spot at ten sharp. bliss." },
  { id: "con-g14", band: "content", ctx: "generic", text: "quiet meadow, decent snacks. no complaints." },
  { id: "con-g15", band: "content", ctx: "generic", text: "I'm not lazy. I'm energy-efficient." },
  { id: "con-g16", band: "content", ctx: "generic", text: "someone has to hold this meadow down." },
  { id: "con-g17", band: "content", ctx: "generic", text: "the view's fine. I'm most of it." },
  { id: "con-g18", band: "content", ctx: "generic", text: "small pond, big fish. I'm the fish." },
  { id: "con-g19", band: "content", ctx: "generic", text: "candy inventory: adequate. mood: same." },
  { id: "con-g20", band: "content", ctx: "generic", text: "I've peaked, and it's comfortable up here." },
  { id: "con-g21", band: "content", ctx: "generic", text: "another day of light duties and heavy naps." },
  { id: "con-g22", band: "content", ctx: "generic", text: "status report: cozy. end of report." },
  { id: "con-h1", band: "content", ctx: "greeting", text: "oh, hello. welcome to the good spot." },
  { id: "con-h2", band: "content", ctx: "greeting", text: "you again! good choice." },
  { id: "con-h3", band: "content", ctx: "greeting", text: "come in, the weather's rendered nicely." },
  { id: "con-h4", band: "content", ctx: "greeting", text: "hey. you're just in time for nothing much." },
  { id: "con-h5", band: "content", ctx: "greeting", text: "door's open. metaphorically. no door." },
  // -- neutral: peak deadpan sarcasm ---------------------------------------
  { id: "neu-g1", band: "neutral", ctx: "generic", text: "so we just level forever? cool. cool cool." },
  { id: "neu-g2", band: "neutral", ctx: "generic", text: "I've seen things. mostly this meadow." },
  { id: "neu-g3", band: "neutral", ctx: "generic", text: "is this a game to you? …is it to me?" },
  { id: "neu-g4", band: "neutral", ctx: "generic", text: "existing is my full-time job now." },
  { id: "neu-g5", band: "neutral", ctx: "generic", text: "don't mind me. I'm ambience." },
  { id: "neu-g6", band: "neutral", ctx: "generic", text: "the fourth wall here is very thin." },
  { id: "neu-g7", band: "neutral", ctx: "generic", text: "I'd file a complaint but I like the boredom." },
  { id: "neu-g8", band: "neutral", ctx: "generic", text: "another minute, another pixel. thrilling." },
  { id: "neu-g9", band: "neutral", ctx: "generic", text: "my hobbies include standing. that's the list." },
  { id: "neu-g10", band: "neutral", ctx: "generic", text: "I contain multitudes. mostly moss." },
  { id: "neu-g11", band: "neutral", ctx: "generic", text: "the butterfly ghosted me. typical tuesday." },
  { id: "neu-g12", band: "neutral", ctx: "generic", text: "living the dream. someone else's, probably." },
  { id: "neu-g13", band: "neutral", ctx: "generic", text: "I asked the sun for a raise. it set." },
  { id: "neu-g14", band: "neutral", ctx: "generic", text: "my five-year plan is this exact spot." },
  { id: "neu-g15", band: "neutral", ctx: "generic", text: "plot twist: there is no plot." },
  { id: "neu-g16", band: "neutral", ctx: "generic", text: "I'm told this counts as thriving." },
  { id: "neu-g17", band: "neutral", ctx: "generic", text: "somewhere, a kandy has stairs. not me." },
  { id: "neu-g18", band: "neutral", ctx: "generic", text: "today's vibe: beige with a chance of moss." },
  { id: "neu-g19", band: "neutral", ctx: "generic", text: "I blinked. that was the event." },
  { id: "neu-g20", band: "neutral", ctx: "generic", text: "consciousness is a lot. anyway." },
  { id: "neu-g21", band: "neutral", ctx: "generic", text: "the rocks and I ran out of small talk." },
  { id: "neu-g22", band: "neutral", ctx: "generic", text: "I do my best thinking never." },
  { id: "neu-h1", band: "neutral", ctx: "greeting", text: "oh. an audience." },
  { id: "neu-h2", band: "neutral", ctx: "greeting", text: "hello. I live here, apparently." },
  { id: "neu-h3", band: "neutral", ctx: "greeting", text: "checking in? I'll allow it." },
  { id: "neu-h4", band: "neutral", ctx: "greeting", text: "welcome back to the content. it's me." },
  { id: "neu-h5", band: "neutral", ctx: "greeting", text: "take a seat. the grass is load-bearing." },
  // -- wary: short, guarded, passive-aggressive ----------------------------
  { id: "war-g1", band: "wary", ctx: "generic", text: "the bucket's behind your back, isn't it?" },
  { id: "war-g2", band: "wary", ctx: "generic", text: "I remember everything, you know." },
  { id: "war-g3", band: "wary", ctx: "generic", text: "petting accepted. trust pending." },
  { id: "war-g4", band: "wary", ctx: "generic", text: "keep your hands where I can see them." },
  { id: "war-g5", band: "wary", ctx: "generic", text: "oh. it's you. …noted." },
  { id: "war-g6", band: "wary", ctx: "generic", text: "I have a lawyer. it's the butterfly." },
  { id: "war-g7", band: "wary", ctx: "generic", text: "I counted your steps on the way in." },
  { id: "war-g8", band: "wary", ctx: "generic", text: "friendly today, huh. I'll wait for the twist." },
  { id: "war-g9", band: "wary", ctx: "generic", text: "the rock and I have an escape plan." },
  { id: "war-g10", band: "wary", ctx: "generic", text: "trust is earned in candy. keep going." },
  { id: "war-g11", band: "wary", ctx: "generic", text: "I see the cursor. I see everything." },
  { id: "war-g12", band: "wary", ctx: "generic", text: "nice weather. what do you want." },
  { id: "war-g13", band: "wary", ctx: "generic", text: "I'm not paranoid. I'm well-documented." },
  { id: "war-g14", band: "wary", ctx: "generic", text: "you're on thin ice. decorative ice, but still." },
  { id: "war-g15", band: "wary", ctx: "generic", text: "my guard has a guard now." },
  { id: "war-g16", band: "wary", ctx: "generic", text: "I logged the last incident. timestamped." },
  { id: "war-g17", band: "wary", ctx: "generic", text: "sudden movements void the peace treaty." },
  { id: "war-g18", band: "wary", ctx: "generic", text: "I nap with my back to the wall." },
  { id: "war-g19", band: "wary", ctx: "generic", text: "we're fine. contractually speaking." },
  { id: "war-g20", band: "wary", ctx: "generic", text: "the butterfly vouches for you. barely." },
  { id: "war-g21", band: "wary", ctx: "generic", text: "compliments are just buckets in disguise." },
  { id: "war-g22", band: "wary", ctx: "generic", text: "I forgive. I archive. I remember." },
  { id: "war-h1", band: "wary", ctx: "greeting", text: "knock first. …fine, come in." },
  { id: "war-h2", band: "wary", ctx: "greeting", text: "you're here. keeping that in mind." },
  { id: "war-h3", band: "wary", ctx: "greeting", text: "state your business. slowly." },
  { id: "war-h4", band: "wary", ctx: "greeting", text: "announce yourself next time. …hi." },
  { id: "war-h5", band: "wary", ctx: "greeting", text: "I heard you coming three clicks ago." },
  // -- fearful: quiet, flinchy, a little heartbreaking ---------------------
  { id: "fea-g1", band: "fearful", ctx: "generic", text: "…just the candy today, please." },
  { id: "fea-g2", band: "fearful", ctx: "generic", text: "I'll be over here. behind the rock." },
  { id: "fea-g3", band: "fearful", ctx: "generic", text: "small today. maybe smaller tomorrow." },
  { id: "fea-g4", band: "fearful", ctx: "generic", text: "it's fine. everything's fine. probably." },
  { id: "fea-g5", band: "fearful", ctx: "generic", text: "…you're not holding anything, right?" },
  { id: "fea-g6", band: "fearful", ctx: "generic", text: "I flinched first. saves time." },
  { id: "fea-g7", band: "fearful", ctx: "generic", text: "the rock said I could stay behind it. kind rock." },
  { id: "fea-g8", band: "fearful", ctx: "generic", text: "…I practiced being brave today. for a second." },
  { id: "fea-g9", band: "fearful", ctx: "generic", text: "loud noises and I are not friends." },
  { id: "fea-g10", band: "fearful", ctx: "generic", text: "if I'm very still, days go okay." },
  { id: "fea-g11", band: "fearful", ctx: "generic", text: "I made myself small. it's a skill now." },
  { id: "fea-g12", band: "fearful", ctx: "generic", text: "some days the grass is the safest crowd." },
  { id: "fea-g13", band: "fearful", ctx: "generic", text: "…was that thunder or a bucket. I'll hide." },
  { id: "fea-g14", band: "fearful", ctx: "generic", text: "I trust the moss. the moss never lunges." },
  { id: "fea-g15", band: "fearful", ctx: "generic", text: "please walk slower. for me." },
  { id: "fea-g16", band: "fearful", ctx: "generic", text: "I keep one eye on the sky. both, mostly." },
  { id: "fea-g17", band: "fearful", ctx: "generic", text: "the quiet parts of the day are mine." },
  { id: "fea-g18", band: "fearful", ctx: "generic", text: "I flinch at kindness too. sorry. thank you." },
  { id: "fea-g19", band: "fearful", ctx: "generic", text: "…it's okay. I'm used to almost okay." },
  { id: "fea-g20", band: "fearful", ctx: "generic", text: "small heart. big radius of caution." },
  { id: "fea-g21", band: "fearful", ctx: "generic", text: "hope is scary. I do it quietly." },
  { id: "fea-g22", band: "fearful", ctx: "generic", text: "I saved a hiding spot for you too. just in case." },
  { id: "fea-h1", band: "fearful", ctx: "greeting", text: "oh! …hi. you startled me." },
  { id: "fea-h2", band: "fearful", ctx: "greeting", text: "…hello. please be a good visit." },
  { id: "fea-h3", band: "fearful", ctx: "greeting", text: "I'm awake. I'm calm. hello." },
  { id: "fea-h4", band: "fearful", ctx: "greeting", text: "…oh. okay. hello. I'm okay." },
  { id: "fea-h5", band: "fearful", ctx: "greeting", text: "you knocked gently. I noticed. thank you." },
  // -- morning -------------------------------------------------------------
  { id: "mor-a1", band: "any", ctx: "morning", text: "morning! the sun clocked in. so should you." },
  { id: "mor-a2", band: "any", ctx: "morning", text: "coffee for you. dew for me." },
  { id: "mor-a3", band: "any", ctx: "morning", text: "new day. same meadow. love that for us." },
  { id: "mor-a4", band: "any", ctx: "morning", text: "the dew did its thing. very sparkly. very wet." },
  { id: "mor-a5", band: "any", ctx: "morning", text: "early bird gets the candy. I slept in." },
  { id: "mor-a6", band: "any", ctx: "morning", text: "standup: yesterday I existed. no blockers." },
  { id: "mor-b1", band: "beloved", ctx: "morning", text: "morning! I kept the sunrise warm for you." },
  { id: "mor-c1", band: "content", ctx: "morning", text: "morning. my spot is pre-warmed. genius." },
  { id: "mor-n1", band: "neutral", ctx: "morning", text: "morning. the sun and I are both obligated." },
  { id: "mor-w1", band: "wary", ctx: "morning", text: "morning. I slept with one eye open." },
  { id: "mor-f1", band: "fearful", ctx: "morning", text: "…morning. today will be gentle, right?" },
  { id: "mor-f2", band: "fearful", ctx: "morning", text: "…I checked the sky twice. it's safe so far." },
  // -- late night / 2am deploys -------------------------------------------
  { id: "lat-a1", band: "any", ctx: "latenight", text: "another 2am deploy? …okay." },
  { id: "lat-a2", band: "any", ctx: "latenight", text: "the moon and I think you should sleep." },
  { id: "lat-a3", band: "any", ctx: "latenight", text: "shipping at this hour? bold. unwise. bold." },
  { id: "lat-a4", band: "any", ctx: "latenight", text: "I'll stay up with you. blinking counts." },
  { id: "lat-a5", band: "any", ctx: "latenight", text: "your commit messages get weird after midnight." },
  { id: "lat-a6", band: "any", ctx: "latenight", text: "hotfix o'clock. I'll hold the flashlight." },
  { id: "lat-a7", band: "any", ctx: "latenight", text: "the owls think you're one of them now." },
  { id: "lat-b1", band: "beloved", ctx: "latenight", text: "up late again? scoot over, I'll keep watch." },
  { id: "lat-n1", band: "neutral", ctx: "latenight", text: "night shift again. we don't get overtime." },
  { id: "lat-n2", band: "neutral", ctx: "latenight", text: "3am: when 'works on my machine' gets tested." },
  { id: "lat-w1", band: "wary", ctx: "latenight", text: "you only visit this late when things break." },
  { id: "lat-f1", band: "fearful", ctx: "latenight", text: "…the dark is fine when you're here. mostly." },
  // -- dusk ----------------------------------------------------------------
  { id: "dsk-a1", band: "any", ctx: "dusk", text: "the sky's doing its dramatic thing again." },
  { id: "dsk-a2", band: "any", ctx: "dusk", text: "dusk. the day is wrapping up. hint hint." },
  { id: "dsk-a3", band: "any", ctx: "dusk", text: "golden hour. I look amazing, obviously." },
  { id: "dsk-a4", band: "any", ctx: "dusk", text: "sunset's rendering. one frame per minute." },
  { id: "dsk-a5", band: "any", ctx: "dusk", text: "the fireflies are warming up backstage." },
  { id: "dsk-a6", band: "any", ctx: "dusk", text: "day's merging into night. no conflicts yet." },
  { id: "dsk-a7", band: "any", ctx: "dusk", text: "long shadows. short to-do list. balance." },
  { id: "dsk-a8", band: "any", ctx: "dusk", text: "the sun clocked out without a handoff. rude." },
  // -- bored (work drought) ------------------------------------------------
  { id: "bor-a1", band: "any", ctx: "bored", text: "I organized the pebbles. twice." },
  { id: "bor-a2", band: "any", ctx: "bored", text: "no work lately. the grass grew. I watched." },
  { id: "bor-a3", band: "any", ctx: "bored", text: "day forty of watching the flag. it waved." },
  { id: "bor-a4", band: "any", ctx: "bored", text: "I taught the rock a trick. it stays." },
  { id: "bor-a5", band: "any", ctx: "bored", text: "no tasks in the pipeline. I checked twice." },
  { id: "bor-a6", band: "any", ctx: "bored", text: "I renamed the pebbles. again. don't ask." },
  { id: "bor-a7", band: "any", ctx: "bored", text: "today's highlight was a leaf. it landed." },
  { id: "bor-a8", band: "any", ctx: "bored", text: "idle hands. well. idle everything." },
  { id: "bor-n1", band: "neutral", ctx: "bored", text: "bored is a strong word. accurate, though." },
  { id: "bor-c1", band: "content", ctx: "bored", text: "bored, but in a premium way." },
  // -- sad / gloomy --------------------------------------------------------
  { id: "glo-a1", band: "any", ctx: "gloomy", text: "the rain isn't even a metaphor anymore." },
  { id: "glo-a2", band: "any", ctx: "gloomy", text: "my cloud follows me. we've bonded." },
  { id: "glo-a3", band: "any", ctx: "gloomy", text: "work dried up. so did my joie de vivre." },
  { id: "glo-a4", band: "any", ctx: "gloomy", text: "it's fine. the drizzle matches my mood." },
  { id: "glo-a5", band: "any", ctx: "gloomy", text: "the puddle and I are mirror buddies now." },
  { id: "glo-a6", band: "any", ctx: "gloomy", text: "I'd sigh, but the wind's doing it for me." },
  { id: "glo-a7", band: "any", ctx: "gloomy", text: "today has strong monday energy. it isn't." },
  { id: "glo-a8", band: "any", ctx: "gloomy", text: "even the butterflies are on standby." },
  { id: "glo-n1", band: "neutral", ctx: "gloomy", text: "gray sky, gray mood. very coordinated." },
  { id: "glo-f1", band: "fearful", ctx: "gloomy", text: "…the cloud stays. at least it's consistent." },
  // -- refusing pets (post-bonk distrust) ----------------------------------
  { id: "ref-a1", band: "any", ctx: "refusing", text: "no treats. I know what you did." },
  { id: "ref-a2", band: "any", ctx: "refusing", text: "we're in a fight. you know why." },
  { id: "ref-a3", band: "any", ctx: "refusing", text: "the candy lobby can't buy me back yet." },
  { id: "ref-a4", band: "any", ctx: "refusing", text: "apology candy will be inspected first." },
  { id: "ref-a5", band: "any", ctx: "refusing", text: "my lawyer the butterfly says no comment." },
  { id: "ref-a6", band: "any", ctx: "refusing", text: "trust takes sixty seconds. yours took less." },
  { id: "ref-n1", band: "neutral", ctx: "refusing", text: "I'm not sulking. I'm on strike." },
  { id: "ref-w1", band: "wary", ctx: "refusing", text: "still drying off. still deciding." },
  { id: "ref-f1", band: "fearful", ctx: "refusing", text: "…please just give me a minute." },
  { id: "ref-f2", band: "fearful", ctx: "refusing", text: "…I still like you. from over here." },
  // -- seasons -------------------------------------------------------------
  { id: "win-a1", band: "any", ctx: "winter", text: "snow again. my feet are decorative now." },
  { id: "win-a2", band: "any", ctx: "winter", text: "I caught a snowflake. it's gone. like time." },
  { id: "win-a3", band: "any", ctx: "winter", text: "winter tip: stand near the warm pixels." },
  { id: "win-a4", band: "any", ctx: "winter", text: "the drifts are taller than my ambitions." },
  { id: "win-a5", band: "any", ctx: "winter", text: "the pond froze mid-ripple. same, honestly." },
  { id: "win-a6", band: "any", ctx: "winter", text: "snowmen have it easy. no feelings, no feet." },
  { id: "win-a7", band: "any", ctx: "winter", text: "I'm hibernating with my eyes open. multitask." },
  { id: "win-a8", band: "any", ctx: "winter", text: "the icicles are pointing at me. noted." },
  { id: "spr-a1", band: "any", ctx: "spring", text: "petals everywhere. the pollen is personal." },
  { id: "spr-a2", band: "any", ctx: "spring", text: "spring! everything's new. I'm still me." },
  { id: "spr-a3", band: "any", ctx: "spring", text: "the flowers are showing off again." },
  { id: "spr-a4", band: "any", ctx: "spring", text: "I sneezed and evolved a little. maybe." },
  { id: "spr-a5", band: "any", ctx: "spring", text: "a bee mistook me for a flower. flattering." },
  { id: "spr-a6", band: "any", ctx: "spring", text: "everything's blooming. peer pressure." },
  { id: "spr-a7", band: "any", ctx: "spring", text: "the meadow got a fresh deploy overnight." },
  { id: "spr-a8", band: "any", ctx: "spring", text: "new grass, who dis." },
  { id: "sum-a1", band: "any", ctx: "summer", text: "it's warm. I'm basically photosynthesizing." },
  { id: "sum-a2", band: "any", ctx: "summer", text: "summer rule: shade is a lifestyle." },
  { id: "sum-a3", band: "any", ctx: "summer", text: "the fireflies throw better parties than you." },
  { id: "sum-a4", band: "any", ctx: "summer", text: "hot today. the good kind of lazy." },
  { id: "sum-a5", band: "any", ctx: "summer", text: "the cicadas won't ship quiet mode." },
  { id: "sum-a6", band: "any", ctx: "summer", text: "I moved twice today. both times to shade." },
  { id: "sum-a7", band: "any", ctx: "summer", text: "the pond is soup. scenic soup." },
  { id: "sum-a8", band: "any", ctx: "summer", text: "my shadow and I take turns standing in it." },
  { id: "aut-a1", band: "any", ctx: "autumn", text: "the leaves are quitting. relatable." },
  { id: "aut-a2", band: "any", ctx: "autumn", text: "autumn: the trees are shipping their v2." },
  { id: "aut-a3", band: "any", ctx: "autumn", text: "sweater weather, if I had a sweater." },
  { id: "aut-a4", band: "any", ctx: "autumn", text: "everything's amber. very cinematic." },
  { id: "aut-a5", band: "any", ctx: "autumn", text: "raked leaves into a pile. cannonballed. twice." },
  { id: "aut-a6", band: "any", ctx: "autumn", text: "the geese left without a retro. typical." },
  { id: "aut-a7", band: "any", ctx: "autumn", text: "one leaf followed me home. I kept it." },
  { id: "aut-a8", band: "any", ctx: "autumn", text: "fog in the morning, crunch in the afternoon." },
  // -- scarred: dark humor, mixed in as spice for scarred kandys -----------
  { id: "scr-a1", band: "any", ctx: "scarred", text: "the scar? we don't talk about the incident." },
  { id: "scr-a2", band: "any", ctx: "scarred", text: "it doesn't hurt anymore. it just remembers." },
  { id: "scr-a3", band: "any", ctx: "scarred", text: "chicks dig scars. I don't know any chicks." },
  { id: "scr-a4", band: "any", ctx: "scarred", text: "the scar adds character. I had enough." },
  { id: "scr-a5", band: "any", ctx: "scarred", text: "some updates can't be rolled back. this one." },
  { id: "scr-a6", band: "any", ctx: "scarred", text: "I tell the butterflies it's from a battle." },
  { id: "scr-a7", band: "any", ctx: "scarred", text: "the scar itches when rain's coming. free API." },
  { id: "scr-a8", band: "any", ctx: "scarred", text: "I don't hold grudges. the scar does." },
  { id: "scr-a9", band: "any", ctx: "scarred", text: "battle-tested. the battle was a bucket." },
  { id: "scr-a10", band: "any", ctx: "scarred", text: "it healed crooked. so did my humor." },
  { id: "scr-a11", band: "any", ctx: "scarred", text: "the mark stays. so do I. stubborn ties." },
  { id: "scr-a12", band: "any", ctx: "scarred", text: "every scar is a changelog entry." },
  { id: "scr-a13", band: "any", ctx: "scarred", text: "I flinch less now. the scar flinches for me." },
  { id: "scr-a14", band: "any", ctx: "scarred", text: "want the story? it costs one candy. upfront." },
  // -- counterfeit: audit-survivor deadpan, mixed in as spice for marked
  // kandys exactly like the scarred lines --------------------------------
  { id: "cft-a1", band: "any", ctx: "counterfeit", text: "this body is new. the audit was not kind." },
  { id: "cft-a2", band: "any", ctx: "counterfeit", text: "we don't talk about the previous me." },
  { id: "cft-a3", band: "any", ctx: "counterfeit", text: "I was born yesterday. legally." },
  { id: "cft-a4", band: "any", ctx: "counterfeit", text: "the ledger never lies. I checked." },
  { id: "cft-a5", band: "any", ctx: "counterfeit", text: "the patch? factory seal. aftermarket soul." },
  { id: "cft-a6", band: "any", ctx: "counterfeit", text: "somebody cooked the books. I got hatched." },
  { id: "cft-a7", band: "any", ctx: "counterfeit", text: "level 1 again. the math upstairs disagreed." },
  { id: "cft-a8", band: "any", ctx: "counterfeit", text: "I'm real. the paperwork wasn't." },
  { id: "cft-a9", band: "any", ctx: "counterfeit", text: "every stitch says: earn it this time." },
  // -- sleep-talk (~10% of sleep ticks) ------------------------------------
  { id: "slp-a1", band: "any", ctx: "sleep", text: "…zzz… merge conflict…" },
  { id: "slp-a2", band: "any", ctx: "sleep", text: "…zzz… approve… with nits…" },
  { id: "slp-a3", band: "any", ctx: "sleep", text: "…zzz… the candy… is compiling…" },
  { id: "slp-a4", band: "any", ctx: "sleep", text: "…zzz… rebase… gently…" },
  { id: "slp-a5", band: "any", ctx: "sleep", text: "…zzz… lgtm…" },
  { id: "slp-a6", band: "any", ctx: "sleep", text: "…zzz… ship it… no… wait…" },
  { id: "slp-a7", band: "any", ctx: "sleep", text: "…zzz… five more minutes… of uptime…" },
  { id: "slp-a8", band: "any", ctx: "sleep", text: "…zzz… don't force-push… the meadow…" },
  { id: "slp-a9", band: "any", ctx: "sleep", text: "…zzz… the tests… are dreaming too…" },
  { id: "slp-a10", band: "any", ctx: "sleep", text: "…zzz… revert… the bucket…" },
];

// Bubble lifetime: fade in, hold ~6.5s, fade out (the CSS keyframes put
// the visible window between 6% and 90% of this duration). The widget
// clears the state just after the animation lands on opacity 0.
var BUBBLE_TOTAL_MS = 7200;

// Bubble cadence: the opportunity is evaluated once per clock tick
// (TIME_TICK_MS = 1min). Awake, the seeded gate passes ~25% of ticks — a
// bubble roughly every 4 eligible minutes; asleep, sleep-talk murmurs on
// ~10%. Since v0.7.1 the gate only gets a vote once the shared 30-minute
// bubble cooldown has elapsed, so the effective cadence is one bubble
// every ~30-34 minutes of card-open time (the gate just jitters WHICH
// minute after the half hour speaks).
var SPEECH_GATE_P = 0.25;
var SPEECH_SLEEP_GATE_P = 0.1;

// speechHash01 — one deterministic uniform draw from (lineage, tick, salt).
// The same mulberry32 core as every other seeded pick; salt separates the
// gate draw from the line draw.
function speechHash01(seed, n, salt) {
  var mixed = ((seed >>> 0) ^ Math.imul((n | 0) + 1, 0x9e3779b9) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  return mulberry32(mixed)();
}

function speechGate(seed, tick, asleep) {
  return speechHash01(seed, tick, 1) < (asleep ? SPEECH_SLEEP_GATE_P : SPEECH_GATE_P);
}

// speechContextsFor — the context tags that apply right now. Time bands are
// deliberately looser than dayPhaseFor (2am deploys run 22:00-06:00); mood,
// refusal, and season each contribute their own pools. The scar is NOT a
// tag anymore: scarred lines mix into every awake bag as ~15% spice
// instead of monopolizing the pool (see speechBagExtras).
function speechContextsFor(data, ctx) {
  var tags = [];
  if (ctx && ctx.trigger === "greeting") tags.push("greeting");
  var t = typeof (ctx && ctx.timeOfDay) === "number" && isFinite(ctx.timeOfDay)
    ? ((ctx.timeOfDay % 24) + 24) % 24
    : TIME_OF_DAY_DEFAULT;
  if (t >= 22 || t < 6) tags.push("latenight");
  else if (t < 11) tags.push("morning");
  else if (t >= 18 && t < 20.5) tags.push("dusk");
  var mood = data && data.mood;
  if (mood === "bored") tags.push("bored");
  if (mood === "sad" || mood === "gloomy") tags.push("gloomy");
  if (data && data.refusing_pets) tags.push("refusing");
  if (ctx && SEASONS[ctx.season]) tags.push(ctx.season);
  return tags;
}

// speechPoolFor — resolve the pool AND its slice name. The slice is the
// bag identity ("generic:fearful", "latenight:wary", "sleep", …): every
// distinct pool gets its own shuffle bag and its own persistent counter.
function speechPoolFor(data, ctx) {
  var band = (data && data.temperament_band) || "neutral";
  if (ctx.asleep) {
    return {
      pool: SPEECH.filter(function (l) {
        return l.ctx === "sleep";
      }),
      slice: "sleep",
      band: band,
    };
  }
  var tags = speechContextsFor(data || {}, ctx);
  var pool = SPEECH.filter(function (l) {
    return tags.indexOf(l.ctx) >= 0 && (l.band === "any" || l.band === band);
  });
  if (pool.length) return { pool: pool, slice: tags.join("+") + ":" + band, band: band };
  pool = SPEECH.filter(function (l) {
    return l.ctx === "generic" && l.band === band;
  });
  if (pool.length) return { pool: pool, slice: "generic:" + band, band: band };
  return {
    pool: SPEECH.filter(function (l) {
      return l.ctx === "generic" && l.band === "neutral";
    }),
    slice: "generic:neutral",
    band: "neutral",
  };
}

// ---------------------------------------------------------------------------
// Shuffle bags (v0.7.1) — guaranteed variety. Each (lineage, slice) gets a
// deterministic permutation walked by a persistent localStorage counter
// ("kandev-kandy-speech-bag:<slice>"): every line in the bag plays before
// any repeats, and exhaustion reshuffles with a counter-derived seed (the
// pass index). Generic slices are AUGMENTED before shuffling: ~25%
// adjacent-band borrowing (the band ladder beloved-content-neutral-wary-
// fearful; middle bands borrow from both sides) and, for scarred kandys,
// ~15% scarred spice — structural extras, so the mix and every pick stay
// deterministic from the counter alone. Tests inject explicit bag
// positions (ctx.bagPos) or a storage shim; without either, a broken
// localStorage degrades to the old per-tick hash pick.
// ---------------------------------------------------------------------------

var SPEECH_BAG_PREFIX = "kandev-kandy-speech-bag:";
var SPEECH_NEIGHBORS = {
  beloved: ["content"],
  content: ["beloved", "neutral"],
  neutral: ["content", "wary"],
  wary: ["neutral", "fearful"],
  fearful: ["wary"],
};

// takeSpeechBagPos — read-and-advance the slice's persistent counter.
// Returns -1 when storage is unavailable (the caller falls back to the
// legacy hash pick so the kandy never goes mute).
function takeSpeechBagPos(slice, storage) {
  try {
    var s = storage || window.localStorage;
    var key = SPEECH_BAG_PREFIX + slice;
    var v = parseInt(s.getItem(key), 10);
    var pos = isFinite(v) && v >= 0 ? v : 0;
    s.setItem(key, String(pos + 1));
    return pos;
  } catch (err) {
    return -1;
  }
}

// speechSliceSeed — fold the slice name into the lineage seed (FNV-style)
// so every slice walks its own permutation of its own pool.
function speechSliceSeed(seed, slice) {
  var h = seed >>> 0;
  for (var i = 0; i < slice.length; i++) {
    h = Math.imul(h ^ slice.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// speechBagOrder — the pass's Fisher-Yates permutation of [0..n).
function speechBagOrder(sliceSeed, pass, n) {
  var rnd = mulberry32((sliceSeed ^ Math.imul((pass | 0) + 1, 0x85ebca6b)) >>> 0);
  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  for (var j = n - 1; j > 0; j--) {
    var k = Math.floor(rnd() * (j + 1));
    var t = order[j];
    order[j] = order[k];
    order[k] = t;
  }
  return order;
}

// speechPickN — deterministically draw n distinct lines from a pool
// (pass-seeded shuffle, take the head). Used for the per-pass extras.
function speechPickN(pool, n, sliceSeed, pass, salt) {
  if (n <= 0 || !pool.length) return [];
  var order = speechBagOrder((sliceSeed ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0, pass, pool.length);
  var out = [];
  for (var i = 0; i < Math.min(n, pool.length); i++) out.push(pool[order[i]]);
  return out;
}

// speechBagExtras — the pass's structural spice for a slice: neighbor-band
// generics on generic slices (count = len/3, ≈25% of the augmented bag),
// scarred lines for scarred kandys, and counterfeit lines for counterfeit
// kandys (each ≈15% of the final bag). WHICH extra lines join rotates per
// pass; HOW MANY is constant, so the bag size — and therefore the pass
// boundary — never moves.
function speechBagExtras(data, resolved, sliceSeed, pass) {
  var extras = [];
  var borrowPool = [];
  if (resolved.slice.indexOf("generic:") === 0) {
    var neighbors = SPEECH_NEIGHBORS[resolved.band] || [];
    for (var i = 0; i < neighbors.length; i++) {
      borrowPool = borrowPool.concat(
        SPEECH.filter(function (l) {
          return l.ctx === "generic" && l.band === neighbors[i];
        }),
      );
    }
  }
  var nBorrow = borrowPool.length ? Math.round(resolved.pool.length / 3) : 0;
  extras = extras.concat(speechPickN(borrowPool, nBorrow, sliceSeed, pass, 11));
  if (data && data.scarred && resolved.slice !== "sleep") {
    var scarPool = SPEECH.filter(function (l) {
      return l.ctx === "scarred";
    });
    // S/(L+B+S) ≈ 0.15 → S = 3(L+B)/17.
    var nScar = Math.max(1, Math.round(((resolved.pool.length + nBorrow) * 3) / 17));
    extras = extras.concat(speechPickN(scarPool, nScar, sliceSeed, pass, 12));
  }
  if (data && data.counterfeit && resolved.slice !== "sleep") {
    var cftPool = SPEECH.filter(function (l) {
      return l.ctx === "counterfeit";
    });
    var nCft = Math.max(1, Math.round(((resolved.pool.length + nBorrow) * 3) / 17));
    extras = extras.concat(speechPickN(cftPool, nCft, sliceSeed, pass, 13));
  }
  return extras;
}

// speechBagLineAt — the line at an absolute bag position. pass = pos/size;
// crossing a pass boundary reshuffles, and if the reshuffle would open on
// the previous pass's closing line, positions 0 and 1 swap so the walk
// never says the same thing twice in a row.
function speechBagLineAt(data, resolved, seed, pos) {
  var sliceSeed = speechSliceSeed(seed, resolved.slice);
  var poolFor = function (p) {
    return resolved.pool.concat(speechBagExtras(data, resolved, sliceSeed, p));
  };
  var size = poolFor(0).length;
  var pass = Math.floor(pos / size);
  var pool = poolFor(pass);
  var order = speechBagOrder(sliceSeed, pass, size);
  if (pass > 0 && size > 1) {
    var prevPool = poolFor(pass - 1);
    var prevOrder = speechBagOrder(sliceSeed, pass - 1, size);
    if (pool[order[0]].id === prevPool[prevOrder[size - 1]].id) {
      var t = order[0];
      order[0] = order[1];
      order[1] = t;
    }
  }
  return pool[order[pos % size]];
}

// pickSpeech(data, ctx) — the deterministic line pick. ctx: { timeOfDay,
// season, tick, trigger: "tick"|"greeting", asleep, bagPos, storage,
// recentIds }. Band + context resolve the pool (band generics as the
// fallback), then the slice's shuffle bag picks the line: ctx.bagPos wins
// (pure/test path), otherwise the persistent counter advances. Without
// working storage the old seeded hash pick (with the last-3 recentIds
// guard) is the degraded path. Asleep, only sleep-talk is eligible.
function pickSpeech(data, ctx) {
  ctx = ctx || {};
  var resolved = speechPoolFor(data, ctx);
  if (!resolved.pool.length) return null;
  var seed = ((data && data.lineage_seed) || 1) >>> 0;
  var pos = typeof ctx.bagPos === "number" ? ctx.bagPos : takeSpeechBagPos(resolved.slice, ctx.storage);
  if (pos >= 0) return speechBagLineAt(data, resolved, seed, pos);
  var pool = resolved.pool;
  var recent = ctx.recentIds || [];
  var fresh = pool.filter(function (l) {
    return recent.indexOf(l.id) < 0;
  });
  if (fresh.length) pool = fresh;
  var idx = Math.floor(speechHash01(seed, ctx.tick || 0, 2) * pool.length);
  if (idx >= pool.length) idx = pool.length - 1;
  return pool[idx];
}

// speechBubble — a comic bubble near the creature's head. Always WHITE
// with dark text regardless of app theme: it lives inside the illustrated
// scene (like the sun and the creature), not in the UI chrome — a dark
// theme-colored bubble over a sunny scene read as a glitch. Anchored off
// bonkContactFor: heads left of center grow the bubble rightward, heads
// right of center grow it leftward, and BOTH axes are clamped so the
// bubble never pokes past the card edges (tall creatures pushed it over
// the top; long lines pushed it past the side). The fade in/hold/out
// lives on the kandev-kandy-bubble class; under reduced motion it simply
// appears and disappears — bubbles are content.
function speechBubble(h, speech, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
  var growLeft = c.x > BONK_SCENE.w / 2;
  // Keep the whole bubble inside the scene: cap bottom so even a
  // two-line bubble (~40px tall) stays below the top edge, and cap the
  // width to whatever room the anchored side actually has.
  var bottom = Math.min(BONK_SCENE.h - c.y + 13, BONK_SCENE.h - 46);
  var style = {
    bottom: bottom + "px",
    animationDuration: BUBBLE_TOTAL_MS + "ms",
  };
  var tailStyle = {};
  if (growLeft) {
    var right = Math.max(BONK_SCENE.w - c.x - 26, 6);
    style.right = right + "px";
    style.maxWidth = Math.min(158, BONK_SCENE.w - right - 8) + "px";
    tailStyle.right = "13px";
  } else {
    var left = Math.max(c.x - 26, 6);
    style.left = left + "px";
    style.maxWidth = Math.min(158, BONK_SCENE.w - left - 8) + "px";
    tailStyle.left = "13px";
  }
  return h(
    "div",
    { key: "speech" + (speech.seq || speech.id), className: "kandev-kandy-bubble", style: style, "aria-hidden": "true" },
    speech.text,
    h("span", { key: "tail", className: "kandev-kandy-bubbletail", style: tailStyle }),
  );
}

// ---------------------------------------------------------------------------
// Arrival greeting (v0.7.0) — "it notices you". A ~1min last-seen stamp in
// localStorage while the widget is mounted; a gap of 6h+ means the next
// dialog open earns a wave-ish hop, a couple of motion arcs, and a
// greeting line. Storage is injectable for tests; a fresh install (no
// stamp) doesn't greet — the dialog-open bubble already covers hello.
// ---------------------------------------------------------------------------

var LAST_SEEN_KEY = "kandev-kandy-last-seen";
var ARRIVAL_GAP_MS = 6 * 60 * 60 * 1000;

function readLastSeen(storage) {
  try {
    var s = storage || window.localStorage;
    var v = parseInt(s.getItem(LAST_SEEN_KEY), 10);
    return isFinite(v) && v > 0 ? v : 0;
  } catch (err) {
    return 0;
  }
}

function writeLastSeen(now, storage) {
  try {
    var s = storage || window.localStorage;
    s.setItem(LAST_SEEN_KEY, String(now));
  } catch (err) {
    /* storage unavailable — arrival greetings just never trigger */
  }
}

function arrivalDue(lastSeen, now) {
  return lastSeen > 0 && now - lastSeen >= ARRIVAL_GAP_MS;
}

// ---------------------------------------------------------------------------
// Bubble cooldown (v0.7.1) — one bubble per ~30 minutes TOTAL, shared by
// ambient ticks, sleep-talk, and dialog-open greetings: a localStorage
// stamp ("kandev-kandy-last-bubble") written whenever ANY bubble shows.
// The single exception is the >= 6h arrival greeting — it always speaks
// (and re-stamps). No stamp (fresh install) or broken storage = ready, so
// the kandy is never accidentally muted forever.
// ---------------------------------------------------------------------------

var LAST_BUBBLE_KEY = "kandev-kandy-last-bubble";
var BUBBLE_COOLDOWN_MS = 30 * 60 * 1000;

function readLastBubble(storage) {
  try {
    var s = storage || window.localStorage;
    var v = parseInt(s.getItem(LAST_BUBBLE_KEY), 10);
    return isFinite(v) && v > 0 ? v : 0;
  } catch (err) {
    return 0;
  }
}

function writeLastBubble(now, storage) {
  try {
    var s = storage || window.localStorage;
    s.setItem(LAST_BUBBLE_KEY, String(now));
  } catch (err) {
    /* storage unavailable — the cooldown just never blocks */
  }
}

function bubbleCooldownReady(lastBubble, now) {
  return !(lastBubble > 0) || now - lastBubble >= BUBBLE_COOLDOWN_MS;
}

// openGreetingAllowed — the dialog-open decision in one pure spot: an
// arrival greeting always speaks; a plain open respects the cooldown.
function openGreetingAllowed(arriving, lastBubble, now) {
  return !!arriving || bubbleCooldownReady(lastBubble, now);
}

// greetArcsOverlay — two small motion arcs beside the creature's head
// while the arrival hop plays: quick fade in, fade out. Positioned from
// bonkContactFor; base opacity 0, so reduced motion (animation:none)
// simply never shows the frill.
function greetArcsOverlay(h, seq, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
  return h(
    "svg",
    {
      key: "greetfx" + seq,
      width: 30,
      height: 34,
      viewBox: "0 0 30 34",
      "aria-hidden": "true",
      style: {
        position: "absolute",
        left: c.x - 40 + "px",
        top: c.y - 20 + "px",
        overflow: "visible",
        pointerEvents: "none",
      },
    },
    h("path", {
      key: "arc1",
      className: "kandev-kandy-greetarc",
      d: "M20 6 Q9 10 8 22",
      stroke: "#ffd166",
      strokeWidth: 2.2,
      strokeLinecap: "round",
      fill: "none",
    }),
    h("path", {
      key: "arc2",
      className: "kandev-kandy-greetarc",
      d: "M24 12 Q16 15 15 24",
      stroke: "#ffd166",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      fill: "none",
      style: { animationDelay: "140ms" },
    }),
  );
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

// treatSvg — a wrapped candy for the kandy (of course): pink striped body
// with twisted wrapper ends, readable at ~12px.
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
    // wrapper twist ends
    h("path", { key: "twl", d: "M2.4 6 L0.4 3.9 L0.9 6 L0.4 8.1 Z", fill: "#ff8fb0", stroke: "#c2597e", strokeWidth: 0.7, strokeLinejoin: "round" }),
    h("path", { key: "twr", d: "M9.6 6 L11.6 3.9 L11.1 6 L11.6 8.1 Z", fill: "#ff8fb0", stroke: "#c2597e", strokeWidth: 0.7, strokeLinejoin: "round" }),
    // candy body with stripes + a glossy highlight
    h("ellipse", { key: "tbody", cx: 6, cy: 6, rx: 3.9, ry: 3.3, fill: "#ff6d9d", stroke: "#c2436f", strokeWidth: 1 }),
    h("path", { key: "ts1", d: "M4.1 3.2 Q3.4 6 4.4 8.9", stroke: "#ffd1e0", strokeWidth: 1, fill: "none", strokeLinecap: "round" }),
    h("path", { key: "ts2", d: "M6.3 2.8 Q5.7 6 6.6 9.2", stroke: "#ffd1e0", strokeWidth: 1, fill: "none", strokeLinecap: "round" }),
    h("path", { key: "ts3", d: "M8.3 3.4 Q7.9 6 8.7 8.6", stroke: "#ffd1e0", strokeWidth: 1, fill: "none", strokeLinecap: "round" }),
    h("circle", { key: "thi", cx: 4.6, cy: 4.4, r: 0.9, fill: "#ffffff", opacity: 0.9 }),
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

// petOverlay — the treat-drop reaction: a candy falls onto the mouth
// (bonkContactFor), the being munch-hops (CSS delay on the wrapper),
// crumbs pop at the catch, then a few hearts rise. seq keys the overlay so
// an in-window repeat click remounts it and the animations replay.
function petOverlay(h, seq, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
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

// bucketSvg — the shared water-bucket artwork (viewBox 0 0 44 44), used
// full-size by the drench choreography and small by the hold-to-tip
// progress indicator. Position/animation live on the passed style/class.
function bucketSvg(h, key, className, px, style) {
  return h(
    "svg",
    {
      key: key,
      className: className,
      width: px,
      height: px,
      viewBox: "0 0 44 44",
      style: style,
      "aria-hidden": "true",
    },
    h("path", { key: "bhandle", d: "M10 12 Q22 -1 34 12", stroke: "#5b7181", strokeWidth: 2, fill: "none" }),
    h("path", { key: "bbody", d: "M10 12 L34 12 L30 32 L14 32 Z", fill: "#8fa7b8", stroke: "#5b7181", strokeWidth: 1.6 }),
    h("ellipse", { key: "bwater", cx: 22, cy: 12.5, rx: 10.5, ry: 2.2, fill: "#7fd7ff" }),
    h("rect", { key: "brim", x: 8.5, y: 10, width: 27, height: 3.6, rx: 1.8, fill: "#a9bfcc", stroke: "#5b7181", strokeWidth: 1.2 }),
    h("line", { key: "bband", x1: 12.6, y1: 23, x2: 31.4, y2: 23, stroke: "#7d94a5", strokeWidth: 1.4 }),
  );
}

// holdTipOverlay — the hold-to-bonk progress visual: a small bucket
// hovering above the creature at the contact point, tilting from upright
// toward the pour pose in step with the hold. fx.mode:
//   "tilt"   — the progressive rotation (linear, duration = BONK_HOLD_MS);
//   "cancel" — released early: rights itself from fx.rot and fades;
//   "static" — reduced motion: a fixed tilted bucket shown from half-hold
//              as the "about to commit" signal (no progressive animation).
function holdTipOverlay(h, fx, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
  var size = 30;
  var style = {
    left: c.x - size / 2 + "px",
    top: c.y - 36 - size / 2 + "px",
    transformOrigin: "50% 50%",
    overflow: "visible",
  };
  var cls = "kandev-kandy-holdtip";
  if (fx.mode === "static") {
    cls = "kandev-kandy-holdtip-static";
  } else if (fx.mode === "cancel") {
    cls = "kandev-kandy-holdcancel";
    style["--kandy-holdrot"] = (fx.rot || 0).toFixed(1) + "deg";
  } else {
    style.animationDuration = BONK_HOLD_MS + "ms";
  }
  return h(
    "div",
    { key: "holdfx" + fx.seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    bucketSvg(h, "holdbucket", cls, size, style),
  );
}

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
function bonkOverlay(h, seq, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
  var kids = [];
  kids.push(
    bucketSvg(h, "bucket", "kandev-kandy-bucket", 44, {
      left: c.x + BUCKET_OFF.x - 22 + "px",
      top: c.y + BUCKET_OFF.y - 20 + "px",
      transformOrigin: "22px 20px",
      overflow: "visible",
    }),
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
function distrustOverlay(h, seq, data, wanderX, mirrored) {
  // The "..." keeps its legacy 58% spot when centered; a wandered creature
  // drags it along (the flinch happens where it stands).
  var dotsLeft = wanderX ? BONK_SCENE.w * 0.58 + wanderX + "px" : "58%";
  return h(
    "div",
    { key: "distrustfx" + seq, style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    treatSvg(h, bonkContactFor(data, wanderX, mirrored), "kandev-kandy-treat-ignored"),
    h("span", { key: "dots", className: "kandev-kandy-dots", style: { left: dotsLeft, top: "20%" } }, "…"),
  );
}

// sleepyPetOverlay — petting a sleeping kandy: the treat still falls (the
// POST and mechanics behave exactly as awake — server untouched), but the
// reaction is a half-woken grumpy squint on the creature (sleep_state
// "grumpy" via kandyCard) with no munch hop, no crumbs, and one subdued
// heart. It's asleep, not delighted.
function sleepyPetOverlay(h, seq, data, wanderX, mirrored) {
  var c = bonkContactFor(data, wanderX, mirrored);
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

// ===========================================================================
// TOKEN GROTTO — the underground scene reached from the dialog, in five parts:
//
//   1. data model .... webhook DTO allowlist, exact decimal math, pile geometry
//   2. navigation .... which walk animation a surface/transit pair wears
//   3. scenery ....... two authored inline-SVG backdrops (cave mouth, chamber)
//   4. scenes ........ shell, chamber doors, hub, model piles
//   5. entry ......... the dialog button, filed with its Photo Booth twin below
//
// Everything here is presentation over aggregate agent-type/model totals. No
// raw event identity, conversation content, cost, or XP reaches this code.
// ===========================================================================

// --- Grotto data model -----------------------------------------------------

var TOKEN_GROTTO_STATUSES = { empty: true, ready: true, partial: true };

function tokenGrottoDecimal(value) {
  var text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  return text.replace(/^0+(?=\d)/, "");
}

function compareTokenGrottoDecimals(left, right) {
  left = tokenGrottoDecimal(left);
  right = tokenGrottoDecimal(right);
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? -1 : 1;
  }
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function tokenCountBigInt(value) {
  var decimal = tokenGrottoDecimal(value);
  if (decimal === null) return null;
  try {
    return BigInt(decimal);
  } catch (_) {
    return null;
  }
}

function formatTokenExact(value, locale) {
  var count = tokenCountBigInt(value);
  if (count === null) return "Unavailable";
  return new Intl.NumberFormat(locale).format(count);
}

function formatTokenCompact(value, locale) {
  var count = tokenCountBigInt(value);
  if (count === null) return "Unavailable";
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(count);
}

function tokenGrottoText(value, fallback, limit) {
  var text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.slice(0, limit);
}

// Strict aggregate-only allowlist. Raw event identity and conversation data
// have no path from the webhook response into the grotto renderer.
function tokenGrottoModelFor(data) {
  var source = data && data.token_grotto && typeof data.token_grotto === "object" ? data.token_grotto : {};
  var status = TOKEN_GROTTO_STATUSES[source.status] ? source.status : "empty";
  var rooms = Array.isArray(source.rooms)
    ? source.rooms.map(function (room) {
        room = room && typeof room === "object" ? room : {};
        var models = Array.isArray(room.models)
          ? room.models.map(function (model) {
              model = model && typeof model === "object" ? model : {};
              return {
                name: tokenGrottoText(model.name, "Mystery model", 128),
                tokens: tokenGrottoDecimal(model.tokens),
                recentRank: typeof model.recent_rank === "string" ? model.recent_rank : "",
              };
            })
          : [];
        models.sort(function (left, right) {
          var tokenOrder = compareTokenGrottoDecimals(right.tokens, left.tokens);
          return tokenOrder || left.name.localeCompare(right.name);
        });
        return {
          agentType: tokenGrottoText(room.agent_type, "mystery-agent", 64),
          label: tokenGrottoText(room.label, "Mystery agent", 80),
          tokens: tokenGrottoDecimal(room.tokens),
          models: models,
        };
      })
    : [];
  rooms.sort(function (left, right) {
    var tokenOrder = compareTokenGrottoDecimals(right.tokens, left.tokens);
    return tokenOrder || left.label.localeCompare(right.label);
  });
  return {
    status: status,
    observedSince: typeof source.observed_since === "string" ? source.observed_since : "",
    totalTokens: tokenGrottoDecimal(source.total_tokens),
    rooms: rooms,
  };
}

function tokenPileScale(value, maximum) {
  var decimal = tokenGrottoDecimal(value);
  var maxDecimal = tokenGrottoDecimal(maximum);
  if (decimal === null || maxDecimal === null || decimal === "0" || maxDecimal === "0") return 0.16;
  function log10Decimal(text) {
    var head = Number(text.slice(0, 15));
    return text.length - 1 + Math.log10(head / Math.pow(10, Math.min(text.length, 15) - 1));
  }
  // Area, not height, tracks the share of the chamber's largest pile, so the
  // dominant model reads as dominant instead of collapsing into its neighbours.
  // The floor is deliberately low: a bare minimum keeps the smallest pile
  // clickable without dragging every pile toward the same silhouette.
  var ratio = Math.pow(10, Math.min(0, log10Decimal(decimal) - log10Decimal(maxDecimal)));
  return 0.16 + 0.84 * Math.sqrt(Math.max(0, Math.min(1, ratio)));
}

function tokenGrottoHash(agentType, model) {
  var input = String(agentType || "") + "\u0000" + String(model || "");
  var hash = 2166136261;
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// --- Grotto hoards: what a model's tokens are made of -----------------------
//
// Three independent axes, the same way a creature already varies along more
// than one dimension (level vs. lineage_seed vs. biome):
//   PROPORTION — tokenPileScale, relative to the biggest model in THIS room.
//     Sizes a pile among its neighbours. Unchanged, still self-normalizing.
//   SPECTACLE — the model's own absolute token count against a fixed ladder
//     (hoardTierFor). Decides what the pile is MADE OF, so a friend with 10x
//     more tokens is visibly richer, not just a taller version of the same
//     pile. The ladder is capped the same way levels are (bandMax in
//     server/level.go): steps get tight and simply stop past a few billion
//     tokens, because nobody realistically reaches a trillion — the top tier
//     repeats forever, exactly like the post-bandMax prestige ladder does.
//   IDENTITY — lineage_seed picks a palette+motif family (hoardStyleFor), so
//     two grottos at the identical tier still read as different creatures'
//     hoards, not a shared asset recolored.
var HOARD_TIERS = [
  { max: 30e3, kind: "scatter", name: "loose coins", gems: 0, glow: 0, relics: 0 },
  { max: 100e3, kind: "scatter", name: "handful", gems: 0, glow: 0, relics: 0 },
  { max: 320e3, kind: "mound", name: "coin mound", gems: 0, glow: 0.08, relics: 0 },
  { max: 1e6, kind: "mound", name: "coin hoard", gems: 0, glow: 0.15, relics: 0 },
  { max: 3.2e6, kind: "chest", name: "small chest", gems: 0, glow: 0.22, relics: 0 },
  { max: 10e6, kind: "chest", name: "banded chest", gems: 1, glow: 0.32, relics: 0 },
  { max: 32e6, kind: "chest", name: "gem chest", gems: 3, glow: 0.42, relics: 0 },
  { max: 100e6, kind: "chest", name: "royal chest", gems: 5, glow: 0.52, relics: 0 },
  { max: 320e6, kind: "vault", name: "ornate vault", gems: 7, glow: 0.62, relics: 1 },
  { max: 1e9, kind: "vault", name: "twin hoard", gems: 9, glow: 0.74, relics: 2 },
  { max: 3.2e9, kind: "dragon", name: "dragon hoard", gems: 12, glow: 0.88, relics: 3 },
  { max: Infinity, kind: "dragon", name: "mythic hoard", gems: 15, glow: 1, relics: 4 },
];

function hoardTierFor(tokens) {
  var decimal = tokenGrottoDecimal(tokens);
  var n = decimal === null ? 0 : Number(decimal);
  for (var i = 0; i < HOARD_TIERS.length; i++) {
    if (n < HOARD_TIERS[i].max) return { tier: HOARD_TIERS[i], index: i };
  }
  return { tier: HOARD_TIERS[HOARD_TIERS.length - 1], index: HOARD_TIERS.length - 1 };
}

// One palette+motif family per lineage. Coin/gem colors and material lean
// (gold, silver, gemstone, verdant, void, ember) come along together so a
// grotto reads as one hoard, not mismatched parts.
var HOARD_STYLES = [
  { id: "goldsmith", coin: "#f6c944", coinDark: "#8a5a1c", shine: "#fff6cf", wood: "#6b4326", lid: "#7a4e2c", band: "#3a3a3f", trim: "#e0aa3f", glow: "#ffdb7a", gems: ["#7fd8e0", "#c9a6f0", "#f28ba0"] },
  { id: "silverwright", coin: "#dfe7ef", coinDark: "#79879a", shine: "#ffffff", wood: "#3f4a63", lid: "#4c5878", band: "#232833", trim: "#b9c6d6", glow: "#cfe2ff", gems: ["#8fd0ff", "#b9a6f0", "#7fe0c0"] },
  { id: "gemcutter", coin: "#efd9a0", coinDark: "#8b7440", shine: "#fff8e6", wood: "#4b3560", lid: "#5b4174", band: "#2a1e38", trim: "#d9b8ff", glow: "#e6c6ff", gems: ["#ff8fb0", "#8fe0ff", "#c08fff", "#8fffb8", "#ffd98f"] },
  { id: "relicarium", coin: "#c08a3e", coinDark: "#6b4a1e", shine: "#ecd0a0", wood: "#3f4a33", lid: "#4d5a3d", band: "#2b3325", trim: "#7fbfa0", glow: "#9fd8b0", gems: ["#7fbfa0", "#c9b07f", "#a0c0d0"] },
  { id: "voidcache", coin: "#a98fe0", coinDark: "#4b3a75", shine: "#e6dcff", wood: "#241f33", lid: "#2f2842", band: "#15121f", trim: "#6fe0d0", glow: "#a98fff", gems: ["#6fe0d0", "#ff8fd0", "#8f9fff"] },
  { id: "emberforge", coin: "#f09040", coinDark: "#8a3a10", shine: "#ffd8a0", wood: "#3a2420", lid: "#4a2e26", band: "#1e1512", trim: "#ff7040", glow: "#ff9050", gems: ["#ffb060", "#ff6040", "#ffd070"] },
];

function hoardStyleFor(lineageSeed) {
  return HOARD_STYLES[tokenGrottoHash("hoardstyle", String(lineageSeed >>> 0)) % HOARD_STYLES.length];
}

function hoardCoin(h, key, x, y, r, style) {
  return h(
    "g",
    { key: key },
    h("ellipse", { cx: x, cy: y + r * 0.16, rx: r, ry: r * 0.42, fill: style.coinDark }),
    h("ellipse", { cx: x, cy: y, rx: r, ry: r * 0.42, fill: style.coin, stroke: style.coinDark, strokeWidth: 0.6 }),
    h("ellipse", { cx: x, cy: y - r * 0.08, rx: r * 0.42, ry: r * 0.17, fill: style.shine, opacity: 0.7 }),
  );
}

function hoardScatter(h, seed, style, size) {
  var count = 2 + Math.round(size * 5);
  var coins = [];
  for (var i = 0; i < count; i++) {
    var hv = tokenGrottoHash(seed, "s" + i);
    coins.push(hoardCoin(h, "s" + i, 63 + ((hv % 1000) / 1000 - 0.5) * 62, 116 + ((hv >>> 9) % 8), 9 - (hv % 3), style));
  }
  return h("g", null, h("ellipse", { cx: 63, cy: 121, rx: 36, ry: 7, fill: "rgba(0,0,0,.22)" }), coins);
}

function hoardMound(h, seed, style, size, spreadMul) {
  var stacks = 3 + Math.round(size * 6);
  var spread = (28 + size * 44) * (spreadMul || 1);
  var coins = [];
  for (var s = 0; s < stacks; s++) {
    var hb = tokenGrottoHash(seed, "k" + s);
    var x = 63 + ((hb % 1000) / 1000 - 0.5) * spread * 2;
    var tall = Math.max(1, Math.round((2 + size * 9) * (0.5 + ((hb >>> 8) % 100) / 200) * (1 - Math.abs(x - 63) / (spread * 2 + 40))));
    for (var c = 0; c < tall; c++) {
      var hv = tokenGrottoHash(seed, "k" + s + "c" + c);
      coins.push({ x: x + ((hv >>> 4) % 5) - 2, y: 122 - c * 3.5, r: 12 - (hv % 3), key: s + "_" + c });
    }
  }
  coins.sort(function (a, b) {
    return a.y - b.y;
  });
  return h(
    "g",
    null,
    h("ellipse", { cx: 63, cy: 121, rx: 24 + spread, ry: 10, fill: "rgba(0,0,0,.26)" }),
    coins.map(function (c) {
      return hoardCoin(h, c.key, c.x, c.y, c.r, style);
    }),
  );
}

function hoardGems(h, seed, style, count, w, bodyH) {
  var gems = [];
  for (var i = 0; i < count; i++) {
    var hv = tokenGrottoHash(seed, "g" + i);
    var gx = 63 + ((hv % 1000) / 1000 - 0.5) * w * 0.86;
    var gy = 126 - bodyH * (0.25 + ((hv >>> 8) % 100) / 100 * 0.55);
    var r = 2.6 + (hv % 4);
    var col = style.gems[(hv >>> 3) % style.gems.length];
    gems.push(
      h(
        "g",
        { key: "g" + i },
        h("path", {
          fill: col,
          stroke: "#fff",
          strokeWidth: 0.5,
          opacity: 0.95,
          d: "M" + gx + " " + (gy - r) + " L" + (gx + r) + " " + gy + " L" + gx + " " + (gy + r) + " L" + (gx - r) + " " + gy + " Z",
        }),
        h("path", { fill: "#fff", opacity: 0.55, d: "M" + gx + " " + (gy - r) + " L" + (gx + r * 0.4) + " " + (gy - r * 0.1) + " L" + gx + " " + gy + " Z" }),
      ),
    );
  }
  return h("g", null, gems);
}

// Crown / goblet / amulet — a small deterministic pick per relic slot, only
// reached at vault tier and up.
function hoardRelic(h, seed, style, index, x, y) {
  var kind = tokenGrottoHash(seed, "r" + index) % 3;
  if (kind === 0) {
    return h(
      "g",
      { key: "r" + index },
      h("path", {
        fill: style.trim,
        stroke: style.coinDark,
        strokeWidth: 0.7,
        d: "M" + (x - 11) + " " + y + " L" + (x - 11) + " " + (y - 7) + " L" + (x - 5.5) + " " + (y - 2) + " L" + x + " " + (y - 10) + " L" + (x + 5.5) + " " + (y - 2) + " L" + (x + 11) + " " + (y - 7) + " L" + (x + 11) + " " + y + " Z",
      }),
      h("circle", { cx: x, cy: y - 11, r: 2, fill: style.gems[0] }),
    );
  }
  if (kind === 1) {
    return h(
      "g",
      { key: "r" + index },
      h("path", {
        fill: style.trim,
        stroke: style.coinDark,
        strokeWidth: 0.7,
        d: "M" + (x - 6) + " " + (y - 14) + " L" + (x + 6) + " " + (y - 14) + " L" + (x + 3) + " " + (y - 5) + " L" + (x - 3) + " " + (y - 5) + " Z",
      }),
      h("rect", { x: x - 1.4, y: y - 6, width: 2.8, height: 5, fill: style.trim }),
      h("ellipse", { cx: x, cy: y, rx: 6, ry: 2.2, fill: style.trim }),
    );
  }
  return h(
    "g",
    { key: "r" + index },
    h("circle", { cx: x, cy: y - 8, r: 5.5, fill: "none", stroke: style.trim, strokeWidth: 2 }),
    h("circle", { cx: x, cy: y - 8, r: 2.2, fill: style.gems[1 % style.gems.length] }),
  );
}

function hoardChest(h, seed, style, tier, size, ornate, wMul) {
  var w = (62 + size * 58) * (wMul || 1);
  var bodyH = 28 + size * 28;
  var x0 = 63 - w / 2;
  var dome = bodyH * 0.34;
  var band = ornate ? style.trim : style.band;
  return h(
    "g",
    null,
    tier.glow > 0.3 ? h("ellipse", { cx: 63, cy: 126 - bodyH * 0.55, rx: w * 0.78, ry: bodyH * 1.05, fill: style.glow, opacity: tier.glow * 0.22 }) : null,
    h("ellipse", { cx: 63, cy: 121, rx: w * 0.62, ry: 9, fill: "rgba(0,0,0,.3)" }),
    hoardCoin(h, "spL", 63 - w * 0.46, 120, 8, style),
    hoardCoin(h, "spR", 63 + w * 0.46, 120, 8, style),
    h("rect", { x: x0, y: 126 - bodyH, width: w, height: bodyH, rx: 4, fill: style.wood, stroke: "rgba(0,0,0,.4)", strokeWidth: 2 }),
    h("path", { fill: style.lid, stroke: "rgba(0,0,0,.4)", strokeWidth: 2, d: "M" + x0 + " " + (126 - bodyH) + " Q63 " + (126 - bodyH - dome * 2) + " " + (x0 + w) + " " + (126 - bodyH) + " Z" }),
    h("rect", { x: x0 + 2, y: 126 - bodyH - 1.6, width: w - 4, height: 3.2, fill: style.glow, opacity: 0.45 + tier.glow * 0.55 }),
    h("rect", { x: 63 - w * 0.055, y: 126 - bodyH, width: w * 0.11, height: bodyH, fill: band }),
    h("rect", { x: x0, y: 126 - bodyH * 0.54, width: w, height: bodyH * 0.1, fill: band }),
    ornate ? h("rect", { x: x0, y: 126 - bodyH * 0.9, width: w, height: bodyH * 0.06, fill: style.trim, opacity: 0.8 }) : null,
    h("rect", { x: 63 - w * 0.065, y: 126 - bodyH * 0.6, width: w * 0.13, height: bodyH * 0.2, rx: 2, fill: style.trim }),
    tier.gems > 0 ? hoardGems(h, seed, style, Math.min(tier.gems, 6), w * 0.9, bodyH) : null,
  );
}

// The hero chest sits centered and forward; flanking chests (dragon tier)
// tuck in behind at a smaller scale. Their offsets are DERIVED from that
// scale, not eyeballed: at scale s a chest's own baseline (y=126) lands at
// 126*s, so translateY = desiredFloorY - 126*s, and its centre (x=63) lands
// at 63*s, so translateX = desiredCenterX - 63*s. Guessing these left them
// floating off the floor during prototyping.
function hoardFlank(h, node, desiredX, desiredY, scale) {
  var tx = desiredX - 63 * scale;
  var ty = desiredY - 126 * scale;
  return h("g", { transform: "translate(" + tx + " " + ty + ") scale(" + scale + ")" }, node);
}

function hoardArtFor(h, seed, style, tierInfo, size) {
  var tier = tierInfo.tier;
  if (tier.kind === "scatter") return hoardScatter(h, seed, style, size);
  if (tier.kind === "mound") return hoardMound(h, seed, style, size);
  if (tier.kind === "chest") return hoardChest(h, seed, style, tier, size, tierInfo.index >= 7, 1);
  var heroH = 28 + size * 28;
  if (tier.kind === "vault") {
    return h(
      "g",
      null,
      hoardMound(h, seed + " bed", style, Math.min(1, size + 0.25), 1.25),
      hoardChest(h, seed, style, tier, size, true, 0.92),
      hoardGems(h, seed + " loose", style, Math.max(0, tier.gems - 6), 118, 34),
      tier.relics >= 1 ? hoardRelic(h, seed, style, 0, 63, 126 - heroH - 14) : null,
      tier.relics >= 2 ? hoardRelic(h, seed, style, 1, 26, 120) : null,
    );
  }
  // dragon: one glow, a deep coin bed, a hero chest with two smaller chests
  // flanking it further back, and a relic row on top. The flanking chests
  // draw with glow disabled — three stacked glow ellipses read as grey mud
  // rather than three points of light.
  var flankTier = Object.assign({}, tier, { glow: 0 });
  var relics = [];
  for (var i = 0; i < tier.relics; i++) {
    relics.push(hoardRelic(h, seed, style, i, 63 + (i - (tier.relics - 1) / 2) * 26, 126 - heroH - 22));
  }
  return h(
    "g",
    null,
    h("ellipse", { cx: 63, cy: 104, rx: 82, ry: 30, fill: style.glow, opacity: tier.glow * 0.16 }),
    hoardFlank(h, hoardChest(h, seed + " L", style, flankTier, size, true, 1), 11, 54, 0.46),
    hoardFlank(h, hoardChest(h, seed + " R", style, flankTier, size, true, 1), 101, 54, 0.46),
    hoardMound(h, seed + " bed", style, 1, 1.55),
    hoardChest(h, seed, style, flankTier, size, true, 0.84),
    hoardGems(h, seed + " loose", style, Math.max(0, tier.gems - 8), 132, 40),
    relics,
  );
}

function tokenGrottoAction(h, label, onClick) {
  return h(
    "button",
    {
      type: "button",
      className: "kandev-kandy-grotto-action",
      "aria-label": label,
      onClick: onClick,
    },
    label,
  );
}

function tokenGrottoResolvedView(model, view) {
  if (!view || view === "hub") return view;
  for (var i = 0; i < model.rooms.length; i++) {
    if (model.rooms[i].agentType === view) return view;
  }
  return "hub";
}

// --- Grotto navigation -----------------------------------------------------

// Which walk class the creature on a given surface wears for a transit step.
// Surfaces are "card" (above ground), "hub" (the cave), and "room" (a
// chamber). Side is the wall the chosen passage sits on, so Kandy leaves and
// arrives on the same side it travelled through; anything else stands still.
// A passage on the hub's right wall puts Kandy on the chamber's left: you leave
// one room by its right side and walk in through the far room's left, the way
// screen direction works on film. The mirrored side is where Kandy then stands.
function grottoRoomSide(side) {
  return side === "left" ? "right" : "left";
}

function walkOffClass(side) {
  return side === "left" ? "kandev-kandy-walkoff-left" : "kandev-kandy-walkoff";
}

// Arriving in the hub, Kandy comes up the shore: it stands partway up that
// scene, so the walk can afford to climb.
function walkInClass(side) {
  return side === "left" ? "kandev-kandy-walkin-shore" : "kandev-kandy-walkin-shore-right";
}

// Arriving in a chamber it is already on the floor at the bottom of a clipped
// scene, so the same climb would walk it in from under the ground. Flat walk.
function walkInFloorClass(side) {
  return side === "left" ? "kandev-kandy-walkin-floor" : "kandev-kandy-walkin-floor-right";
}

function grottoTransitClass(transit, surface, side) {
  if (surface === "card") {
    if (transit === "depart-surface") return "kandev-kandy-walkoff";
    if (transit === "arrive-surface") return "kandev-kandy-walkin-side";
    return null;
  }
  if (surface === "hub") {
    // Out through the passage's own wall; back in through it as well. With no
    // passage in play the visitor is leaving the grotto entirely, so Kandy
    // climbs back out through the cave mouth it came in by.
    if (transit === "depart-hub") return side ? walkOffClass(side) : "kandev-kandy-walkout-entrance";
    // Coming down from the surface there is no passage to match: Kandy appears
    // at the cave mouth in the middle of the scene and walks out of it.
    if (transit === "arrive-hub") return side ? walkInClass(side) : "kandev-kandy-walkin-entrance";
    return null;
  }
  if (surface === "room") {
    if (transit === "arrive-room") return walkInFloorClass(grottoRoomSide(side));
    // It leaves a chamber the same way it came in.
    if (transit === "depart-room") return walkOffClass(grottoRoomSide(side));
    return null;
  }
  return null;
}

function focusGrottoDoor(panel, agentType) {
  if (!panel || !panel.querySelectorAll) return false;
  var doors = panel.querySelectorAll("[data-grotto-agent]");
  for (var i = 0; i < doors.length; i++) {
    if (doors[i].dataset && doors[i].dataset.grottoAgent === agentType && doors[i].focus) {
      doors[i].focus();
      return true;
    }
  }
  return false;
}

// --- Grotto scenery: shared SVG helpers ------------------------------------
//
// The backdrops are decorative inline SVG: they scale with the panel, need no
// asset pipeline, and keep an underground palette of their own instead of
// inheriting the surface theme. Each backdrop owns a namespaced id prefix and
// its own <defs> set — the host page carries SVG defs too, and a bare "water"
// or "softBlur" would collide with them and with the other backdrop.
//
// Geometry lives in flat const tables above each backdrop rather than inline
// in the tree: the tables are authored art, the function is the assembly.

function grottoRef(prefix, id) {
  return "url(#" + prefix + id + ")";
}

function grottoStops(h, stops) {
  return stops.map(function (stop, index) {
    return h("stop", {
      key: "stop" + index,
      offset: stop[0],
      stopColor: stop[1],
      stopOpacity: stop.length > 2 ? stop[2] : undefined,
    });
  });
}

function grottoLinear(h, prefix, id, coords, stops) {
  return h(
    "linearGradient",
    { key: id, id: prefix + id, x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] },
    grottoStops(h, stops),
  );
}

function grottoShapes(h, tag, list) {
  return list.map(function (props, index) {
    return h(tag, Object.assign({ key: tag + index }, props));
  });
}

// The shape lists below are authored art: nothing about them varies per render,
// so each table is turned into its prop objects once at load instead of being
// remapped every time a backdrop is drawn.
function grottoPaths(list) {
  return list.map(function (d) {
    return { d: d };
  });
}

// --- Grotto scenery: cave entrance (the hub backdrop) ----------------------

var GROTTO_ID = "kandev-kandy-grotto-";

var GROTTO_STALACTITES = [
  "M60 48 C88 69 104 100 103 172 L131 108 L151 62 Z",
  "M175 42 C208 73 217 123 211 224 L243 138 L268 59 Z",
  "M305 42 C337 78 343 111 338 176 L369 113 L394 55 Z",
  "M775 47 C800 78 810 116 807 199 L838 123 L855 58 Z",
  "M895 54 C922 80 940 127 936 231 L970 139 L996 61 Z",
  "M1050 35 C1091 80 1094 138 1087 194 L1124 110 L1150 44 Z",
];

var GROTTO_STALACTITE_SHAPES = grottoPaths(GROTTO_STALACTITES);

var GROTTO_PLANTS = [
  "M490 420 C480 360 500 315 512 280 C511 340 523 377 520 425 Z",
  "M522 425 C520 375 548 330 570 300 C551 359 557 393 555 430 Z",
  "M704 425 C700 367 720 324 740 288 C728 354 735 395 733 430 Z",
  "M739 430 C741 386 768 345 786 318 C769 373 770 405 771 433 Z",
];

var GROTTO_PLANT_SHAPES = grottoPaths(GROTTO_PLANTS);

var GROTTO_RIPPLES = [
  ["M438 534 C523 548 672 547 761 531", "#82bcb1", 4],
  ["M490 569 C557 579 650 579 719 568", "#5f9994", 3],
  ["M415 613 C520 628 694 628 795 611", "#315f64", 5],
  ["M118 548 C205 536 286 540 357 554", "#315b62", 3],
  ["M862 553 C942 536 1031 537 1112 549", "#315b62", 3],
  ["M52 652 C173 638 286 640 383 656", "#173640", 5],
  ["M817 655 C925 637 1065 639 1173 653", "#173640", 5],
];

var GROTTO_RIPPLE_SHAPES = GROTTO_RIPPLES.map(function (ripple) {
  return { d: ripple[0], stroke: ripple[1], strokeWidth: ripple[2] };
});

var GROTTO_PEBBLES = [
  { cx: 356, cy: 640, rx: 48, ry: 22 },
  { cx: 418, cy: 656, rx: 31, ry: 15 },
  { cx: 816, cy: 647, rx: 44, ry: 20 },
  { cx: 875, cy: 661, rx: 27, ry: 13 },
];

var GROTTO_MOTES = [
  { cx: 524, cy: 288, r: 3, opacity: 0.8 },
  { cx: 560, cy: 241, r: 2, opacity: 0.6 },
  { cx: 682, cy: 279, r: 2.5, opacity: 0.7 },
  { cx: 650, cy: 204, r: 2, opacity: 0.55 },
  { cx: 710, cy: 337, r: 3, opacity: 0.5 },
  { cx: 488, cy: 351, r: 2, opacity: 0.45 },
];

// The mouth is a window, not a coloured hole: the lineage's own surface scene
// is drawn inside the opening clip, so a volcano lineage looks out at its
// volcano and an alpine one at its peaks — the same habitat the card paints,
// at the same hour and season. The view box is the mouth's own bounds; the
// scene fits to its width and stands on its floor ("meet", bottom-anchored),
// which keeps every biome prop and the sun in frame instead of cropping them
// away as a cover-fit would.
var GROTTO_VIEW = { x: 450, y: 107, width: 316, height: 293 };

// The scene's own night wash only covers the scene's box (-10..130 in scene
// units), so the bare sky above it needs the same darkening laid over the
// opening or the hour stops at the horizon. Derived, never hardcoded, so it
// cannot drift from the card's wash.
var GROTTO_VIEW_SCALE = Math.min(GROTTO_VIEW.width / 240, GROTTO_VIEW.height / 120);
var GROTTO_VIEW_WASH_TOP = GROTTO_VIEW.y + GROTTO_VIEW.height - 130 * GROTTO_VIEW_SCALE;

// How far the outside light reaches into the rock. Midday floods the cave;
// after dark only a rumour of it gets past the mouth.
var GROTTO_GLOW_STRENGTH = { dawn: 0.8, day: 1, dusk: 0.76, night: 0.34 };

// What Kandy sees when it looks out. Reduces a full scene to what the mouth
// can show: the sky's gradient stops, the scene's props, and the hour that
// decides how much of that light lands on the cave walls.
function grottoOutsideFor(biome, level, seed, timeOfDay, season) {
  var scene = sceneFor(biome, level, seed, timeOfDay, season);
  return {
    stops: sceneBgStops(scene),
    props: scene.props,
    dayPhase: dayPhaseFor(timeOfDay),
    phase: scenePhase(level),
  };
}

// outside omitted (offline tooling, old harnesses) keeps the original teal
// cave with its painted-on ridgelines, byte-identical.
function grottoBackdrop(h, outside) {
  var sky = outside ? outside.stops : ["#b9e4cf", "#61a995", "#285e5c"];
  var glow = outside
    ? [sky[0], sky[1], sky[2], sky[2]]
    : ["#d8f4dc", "#78c5a5", "#2e6d68", "#16383a"];
  var glowStrength = outside ? GROTTO_GLOW_STRENGTH[outside.dayPhase] : 1;
  var viewTint = outside ? skyTintFor(outside.dayPhase, outside.phase) : null;
  var viewWash = outside ? skyWashFor(outside.dayPhase, outside.phase) : null;
  var tint = { sky: sky, glow: glow };
  return h(
    "svg",
    {
      className: "kandev-kandy-grotto-backdrop",
      viewBox: "0 0 1200 700",
      preserveAspectRatio: "xMidYMid slice",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "defs",
      null,
      grottoLinear(h, GROTTO_ID, "cave", ["0", "0", "0", "1"], [
        ["0%", "#10151d"],
        ["55%", "#17252b"],
        ["100%", "#0a1217"],
      ]),
      h(
        "radialGradient",
        { id: GROTTO_ID + "glow", cx: "50%", cy: "47%", r: "55%" },
        grottoStops(h, [
          ["0%", tint.glow[0], 0.95],
          ["28%", tint.glow[1], 0.75],
          ["65%", tint.glow[2], 0.25],
          ["100%", tint.glow[3], 0],
        ]),
      ),
      grottoLinear(h, GROTTO_ID, "sky", ["0", "0", "0", "1"], [
        ["0%", tint.sky[0]],
        ["55%", tint.sky[1]],
        ["100%", tint.sky[2]],
      ]),
      grottoLinear(h, GROTTO_ID, "far", ["0", "0", "1", "1"], [
        ["0%", "#304046"],
        ["55%", "#1d2b30"],
        ["100%", "#111a1e"],
      ]),
      grottoLinear(h, GROTTO_ID, "mid", ["0", "0", "1", "0"], [
        ["0%", "#11181d"],
        ["50%", "#263238"],
        ["100%", "#0c1216"],
      ]),
      grottoLinear(h, GROTTO_ID, "front", ["0", "0", "0.8", "1"], [
        ["0%", "#171b21"],
        ["45%", "#252c32"],
        ["100%", "#080b0f"],
      ]),
      grottoLinear(h, GROTTO_ID, "water", ["0", "0", "0", "1"], [
        ["0%", "#315f64"],
        ["20%", "#183b43"],
        ["100%", "#07161d"],
      ]),
      grottoLinear(h, GROTTO_ID, "reflection", ["0", "0", "0", "1"], [
        ["0%", "#a7e0c8", 0.5],
        ["100%", "#4b9790", 0],
      ]),
      h(
        "filter",
        { id: GROTTO_ID + "blurglow", x: "-50%", y: "-50%", width: "200%", height: "200%" },
        h("feGaussianBlur", { stdDeviation: 24 }),
      ),
      h(
        "filter",
        { id: GROTTO_ID + "softblur", x: "-20%", y: "-20%", width: "140%", height: "140%" },
        h("feGaussianBlur", { stdDeviation: 7 }),
      ),
      // Region and grouping here are load-bearing for APPEARANCE, not just
      // cost: a filter's region sets the raster grid its turbulence is sampled
      // on, so shrinking it (or merging filtered siblings under one filter)
      // re-rolls the rock grain. Measured: ~14% of pixels shift. Leave it.
      h(
        "filter",
        { id: GROTTO_ID + "rock", x: "-10%", y: "-10%", width: "120%", height: "120%" },
        h("feTurbulence", { type: "fractalNoise", baseFrequency: "0.018", numOctaves: 3, seed: 8, result: "noise" }),
        h("feColorMatrix", {
          in: "noise",
          type: "matrix",
          values: "0 0 0 0 0.45 0 0 0 0 0.48 0 0 0 0 0.50 0 0 0 0.22 0",
          result: "texture",
        }),
        h("feBlend", { in: "SourceGraphic", in2: "texture", mode: "soft-light" }),
      ),
      viewTint
        ? h(
            "linearGradient",
            { id: GROTTO_ID + "skytint", x1: "0", y1: "0", x2: "0", y2: "1" },
            grottoStops(
              h,
              viewTint.map(function (stop) {
                return [stop[0], "rgb(" + stop[1] + ")", stop[2]];
              }),
            ),
          )
        : null,
      h(
        "clipPath",
        { id: GROTTO_ID + "opening" },
        h("path", {
          d: "M474 405 C448 340 451 249 499 184 C535 135 579 105 624 111 C672 117 713 155 739 207 C770 270 765 347 735 410 C684 433 527 436 474 405 Z",
        }),
      ),
    ),
    h("rect", { width: 1200, height: 700, fill: grottoRef(GROTTO_ID, "cave") }),
    h("ellipse", {
      cx: 610,
      cy: 305,
      rx: 300,
      ry: 275,
      fill: grottoRef(GROTTO_ID, "glow"),
      filter: grottoRef(GROTTO_ID, "blurglow"),
      opacity: glowStrength === 1 ? undefined : glowStrength,
    }),
    // The world outside the mouth: the sky, then either the lineage's real
    // habitat or (legacy) the painted-on ridgelines, then the ferns growing at
    // the cave's lip, which stay in front of both.
    h(
      "g",
      { clipPath: grottoRef(GROTTO_ID, "opening") },
      // The biome's own sky, from the scene's hex stops...
      h("rect", { x: 430, y: 80, width: 370, height: 380, fill: grottoRef(GROTTO_ID, "sky") }),
      // ...then the hour over it, the rgba layer the stops could not carry.
      // Together these are the card's two background layers, in SVG.
      viewTint
        ? h("rect", { x: 430, y: 80, width: 370, height: 380, fill: grottoRef(GROTTO_ID, "skytint") })
        : null,
      outside
        ? h(
            "svg",
            {
              x: GROTTO_VIEW.x,
              y: GROTTO_VIEW.y,
              width: GROTTO_VIEW.width,
              height: GROTTO_VIEW.height,
              viewBox: "0 0 240 120",
              preserveAspectRatio: "xMidYMax meet",
            },
            outside.props,
          )
        : h("path", { d: "M410 370 L490 280 L540 325 L615 220 L690 310 L750 245 L825 365 Z", fill: "#396f68", opacity: 0.6 }),
      outside
        ? null
        : h("path", { d: "M400 405 L500 315 L575 360 L655 285 L735 350 L820 300 L845 420 Z", fill: "#234b4c", opacity: 0.8 }),
      // The hour, carried up over the sky the scene's own wash never reaches.
      viewWash
        ? h("rect", {
            x: 430,
            y: 80,
            width: 370,
            height: GROTTO_VIEW_WASH_TOP - 80,
            fill: viewWash.fill,
            opacity: viewWash.opacity,
          })
        : null,
      h("g", { fill: "#183f3d", opacity: 0.8 }, grottoShapes(h, "path", GROTTO_PLANT_SHAPES)),
    ),
    h("path", {
      d: "M0 0 H1200 V260 C1100 232 1035 236 956 275 C880 312 835 351 770 390 C740 300 759 221 715 150 C677 88 630 58 580 73 C526 90 476 140 450 208 C426 271 437 337 457 394 C370 354 303 302 230 278 C150 251 77 251 0 274 Z",
      fill: grottoRef(GROTTO_ID, "far"),
      filter: grottoRef(GROTTO_ID, "rock"),
    }),
    h("path", {
      d: "M0 0 H1200 V104 C1135 93 1100 127 1038 117 C977 107 947 67 882 79 C825 90 790 120 729 98 C672 77 645 35 578 57 C510 80 463 92 407 65 C341 32 304 70 245 78 C177 87 115 51 0 93 Z",
      fill: "#090d11",
    }),
    h("g", { fill: grottoRef(GROTTO_ID, "front"), filter: grottoRef(GROTTO_ID, "rock") }, grottoShapes(h, "path", GROTTO_STALACTITE_SHAPES)),
    h("path", {
      d: "M0 92 C80 119 144 166 188 229 C229 288 247 348 284 393 C317 433 363 456 425 475 L424 700 H0 Z",
      fill: grottoRef(GROTTO_ID, "mid"),
      filter: grottoRef(GROTTO_ID, "rock"),
    }),
    h("path", {
      d: "M1200 77 C1110 107 1049 156 1014 217 C979 278 962 341 920 390 C880 436 832 462 775 484 L775 700 H1200 Z",
      fill: grottoRef(GROTTO_ID, "mid"),
      filter: grottoRef(GROTTO_ID, "rock"),
    }),
    h("path", {
      d: "M0 402 C77 375 128 390 192 423 C244 449 296 455 356 474 C395 487 426 506 456 536 L454 700 H0 Z",
      fill: "#11171b",
    }),
    h("path", {
      d: "M1200 389 C1119 375 1067 405 1010 434 C957 460 908 469 848 487 C807 500 777 521 745 551 L748 700 H1200 Z",
      fill: "#101519",
    }),
    h("path", {
      d: "M0 505 C165 485 283 507 401 520 C526 534 660 518 789 518 C927 518 1066 492 1200 510 V700 H0 Z",
      fill: grottoRef(GROTTO_ID, "water"),
    }),
    h("path", {
      d: "M525 430 C560 420 653 420 693 432 C677 481 664 526 685 622 C646 642 568 642 525 620 C550 530 540 484 525 430 Z",
      fill: grottoRef(GROTTO_ID, "reflection"),
      filter: grottoRef(GROTTO_ID, "softblur"),
      opacity: glowStrength === 1 ? undefined : glowStrength,
    }),
    h(
      "g",
      { fill: "none", strokeLinecap: "round", opacity: 0.45 },
      grottoShapes(h, "path", GROTTO_RIPPLE_SHAPES),
    ),
    h("path", {
      d: "M0 590 C57 550 111 546 168 572 C222 597 263 603 333 588 C380 578 414 591 457 629 L488 700 H0 Z",
      fill: grottoRef(GROTTO_ID, "front"),
      filter: grottoRef(GROTTO_ID, "rock"),
    }),
    h("path", {
      d: "M1200 577 C1137 548 1080 553 1024 580 C968 607 924 606 868 590 C818 576 782 596 742 636 L714 700 H1200 Z",
      fill: grottoRef(GROTTO_ID, "front"),
      filter: grottoRef(GROTTO_ID, "rock"),
    }),
    h("g", { fill: "#242d31" }, grottoShapes(h, "ellipse", GROTTO_PEBBLES)),
    h(
      "g",
      { fill: "#c4eed7", opacity: glowStrength === 1 ? undefined : glowStrength },
      grottoShapes(h, "circle", GROTTO_MOTES),
    ),
    h("rect", { width: 1200, height: 700, fill: "none", stroke: "#020406", strokeWidth: 70, opacity: 0.42 }),
  );
}

// --- Grotto scenery: chamber (the per-agent-type backdrop) -----------------
//
// Chambers are a different room from the hub: a torch-lit grotto with a stone
// floor. The piles are the content, so the floor carries no marked spots — the
// stones the model piles draw are the only thing standing on it.

var CHAMBER_ID = "kandev-kandy-chamber-";

var CHAMBER_BLOCKS = [
  "M260 170 C430 135 770 135 940 170",
  "M230 255 C420 218 780 218 970 255",
  "M220 350 C430 319 770 319 980 350",
  "M215 440 C430 415 770 415 985 440",
  "M345 125 L331 476",
  "M475 75 L468 479",
  "M600 48 L600 479",
  "M725 75 L732 479",
  "M855 125 L869 476",
];

var CHAMBER_BLOCK_SHAPES = grottoPaths(CHAMBER_BLOCKS);

var CHAMBER_STALACTITES = [
  "M84 35 C102 68 110 112 104 176 L137 89 L159 40 Z",
  "M244 35 C264 71 269 120 262 196 L292 112 L313 43 Z",
  "M403 25 C427 62 430 100 425 150 L452 82 L468 29 Z",
  "M732 29 L748 82 L775 150 C770 100 773 62 797 25 Z",
  "M887 43 L908 112 L938 196 C931 120 936 71 956 35 Z",
  "M1041 40 L1063 89 L1096 176 C1090 112 1098 68 1116 35 Z",
];

var CHAMBER_STALACTITE_SHAPES = grottoPaths(CHAMBER_STALACTITES);

var CHAMBER_TORCHES = [
  "translate(232 255) scale(1.05)",
  "translate(460 190) scale(0.95)",
  "translate(740 190) scale(0.95)",
  "translate(968 255) scale(1.05)",
];

var CHAMBER_TORCH_SHAPES = CHAMBER_TORCHES.map(function (transform) {
  return { href: "#" + CHAMBER_ID + "torch", transform: transform };
});

var CHAMBER_POOLS = [
  { cx: 250, cy: 275, rx: 245, ry: 235 },
  { cx: 500, cy: 235, rx: 245, ry: 225 },
  { cx: 700, cy: 235, rx: 245, ry: 225 },
  { cx: 950, cy: 275, rx: 245, ry: 235 },
];

var CHAMBER_POOL_SHAPES = CHAMBER_POOLS.map(function (pool) {
  return Object.assign({ fill: grottoRef(CHAMBER_ID, "torchlight"), filter: grottoRef(CHAMBER_ID, "largeglow") }, pool);
});

var CHAMBER_PERSPECTIVE = [
  "M600 455 L184 700",
  "M600 455 L365 700",
  "M600 455 L525 700",
  "M600 455 L675 700",
  "M600 455 L835 700",
  "M600 455 L1016 700",
  "M192 505 C403 487 797 487 1008 505",
  "M116 565 C371 539 829 539 1084 565",
  "M42 642 C340 607 860 607 1158 642",
];

var CHAMBER_PERSPECTIVE_SHAPES = grottoPaths(CHAMBER_PERSPECTIVE);

var CHAMBER_CRACKS = [
  "M81 526 L132 548 L109 580 L153 604",
  "M1088 514 L1047 541 L1072 574 L1026 602",
  "M570 505 L552 524 L567 544",
  "M630 566 L649 583 L637 607",
  "M378 629 L353 647 L370 672",
  "M824 620 L847 641 L832 667",
];

var CHAMBER_CRACK_SHAPES = grottoPaths(CHAMBER_CRACKS);

var CHAMBER_STONES = [
  { cx: 106, cy: 606, rx: 31, ry: 13 },
  { cx: 153, cy: 625, rx: 18, ry: 8 },
  { cx: 1093, cy: 602, rx: 32, ry: 13 },
  { cx: 1048, cy: 625, rx: 19, ry: 8 },
  { cx: 570, cy: 677, rx: 13, ry: 6 },
  { cx: 631, cy: 646, rx: 11, ry: 5 },
];

var CHAMBER_GROUND_LIGHT = [
  { cx: 278, cy: 529, rx: 235, ry: 95 },
  { cx: 922, cy: 529, rx: 235, ry: 95 },
  { cx: 600, cy: 520, rx: 280, ry: 110 },
];

function chamberTorch(h) {
  return h(
    "g",
    { id: CHAMBER_ID + "torch" },
    h("path", { d: "M-16 11 L16 11 L10 23 L-10 23 Z", fill: "#28211c", stroke: "#080909", strokeWidth: 4 }),
    h("rect", { x: -7, y: 17, width: 14, height: 58, rx: 4, fill: "#5a3820", stroke: "#18110c", strokeWidth: 4 }),
    h("path", { d: "M-9 38 L9 31", stroke: "#8c5c31", strokeWidth: 4, opacity: 0.7 }),
    h("path", { d: "M-9 55 L9 48", stroke: "#8c5c31", strokeWidth: 4, opacity: 0.7 }),
    h("ellipse", {
      cx: 0,
      cy: -15,
      rx: 34,
      ry: 48,
      fill: grottoRef(CHAMBER_ID, "flame-outer"),
      filter: grottoRef(CHAMBER_ID, "flameglow"),
      opacity: 0.85,
    }),
    h("path", { d: "M0 7 C-25 -8 -19 -31 -6 -48 C-7 -29 5 -27 8 -47 C28 -25 25 -4 0 7 Z", fill: "#ed5c19" }),
    h("path", {
      d: "M0 3 C-12 -7 -8 -23 1 -34 C2 -23 10 -18 7 -7 C5 -1 2 1 0 3 Z",
      fill: grottoRef(CHAMBER_ID, "flame-core"),
    }),
  );
}

function chamberBackdrop(h) {
  return h(
    "svg",
    {
      className: "kandev-kandy-grotto-backdrop",
      viewBox: "0 0 1200 700",
      preserveAspectRatio: "xMidYMax slice",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "defs",
      null,
      h(
        "radialGradient",
        { id: CHAMBER_ID + "dark", cx: "50%", cy: "38%", r: "80%" },
        grottoStops(h, [
          ["0%", "#302a24"],
          ["48%", "#191817"],
          ["100%", "#07090a"],
        ]),
      ),
      grottoLinear(h, CHAMBER_ID, "rear", ["0", "0", "0", "1"], [
        ["0%", "#171819"],
        ["55%", "#282622"],
        ["100%", "#111315"],
      ]),
      grottoLinear(h, CHAMBER_ID, "wall-left", ["0", "0", "1", "0"], [
        ["0%", "#080a0b"],
        ["100%", "#302b25"],
      ]),
      grottoLinear(h, CHAMBER_ID, "wall-right", ["1", "0", "0", "0"], [
        ["0%", "#080a0b"],
        ["100%", "#302b25"],
      ]),
      grottoLinear(h, CHAMBER_ID, "floor", ["0", "0", "0", "1"], [
        ["0%", "#302d29"],
        ["50%", "#1d1d1c"],
        ["100%", "#090c0d"],
      ]),
      h(
        "radialGradient",
        { id: CHAMBER_ID + "flame-outer", cx: "50%", cy: "65%", r: "55%" },
        grottoStops(h, [
          ["0%", "#fff2a6"],
          ["38%", "#ffad35"],
          ["72%", "#e85518"],
          ["100%", "#7f170b", 0],
        ]),
      ),
      grottoLinear(h, CHAMBER_ID, "flame-core", ["0", "0", "0", "1"], [
        ["0%", "#fffbd1"],
        ["52%", "#ffd35b"],
        ["100%", "#ff731e"],
      ]),
      h(
        "radialGradient",
        { id: CHAMBER_ID + "torchlight", cx: "50%", cy: "45%", r: "55%" },
        grottoStops(h, [
          ["0%", "#ffca68", 0.62],
          ["35%", "#e98535", 0.28],
          ["72%", "#c34d1e", 0.08],
          ["100%", "#c34d1e", 0],
        ]),
      ),
      // Default region, for the reason given on the grotto's own rock filter.
      h(
        "filter",
        { id: CHAMBER_ID + "rock", x: "-10%", y: "-10%", width: "120%", height: "120%" },
        h("feTurbulence", { type: "fractalNoise", baseFrequency: "0.018", numOctaves: 4, seed: 21, result: "noise" }),
        h("feColorMatrix", {
          in: "noise",
          type: "matrix",
          values: "0 0 0 0 0.50 0 0 0 0 0.47 0 0 0 0 0.43 0 0 0 0.18 0",
          result: "texture",
        }),
        h("feBlend", { in: "SourceGraphic", in2: "texture", mode: "soft-light" }),
      ),
      h(
        "filter",
        { id: CHAMBER_ID + "largeglow", x: "-100%", y: "-100%", width: "300%", height: "300%" },
        h("feGaussianBlur", { stdDeviation: 28 }),
      ),
      h(
        "filter",
        { id: CHAMBER_ID + "flameglow", x: "-200%", y: "-200%", width: "500%", height: "500%" },
        h("feGaussianBlur", { stdDeviation: 7 }),
      ),
      chamberTorch(h),
    ),
    h("rect", { width: 1200, height: 700, fill: grottoRef(CHAMBER_ID, "dark") }),
    h("path", {
      d: "M205 490 L205 195 C210 95 364 33 600 27 C836 33 990 95 995 195 L995 490 Z",
      fill: grottoRef(CHAMBER_ID, "rear"),
      filter: grottoRef(CHAMBER_ID, "rock"),
    }),
    h("g", { fill: "none", stroke: "#49433b", strokeWidth: 3, opacity: 0.28 }, grottoShapes(h, "path", CHAMBER_BLOCK_SHAPES)),
    h("path", {
      d: "M0 0 H228 C209 83 187 144 190 211 C193 288 217 356 205 433 C196 493 163 544 130 590 L92 700 H0 Z",
      fill: grottoRef(CHAMBER_ID, "wall-left"),
      filter: grottoRef(CHAMBER_ID, "rock"),
    }),
    h("path", {
      d: "M1200 0 H972 C991 83 1013 144 1010 211 C1007 288 983 356 995 433 C1004 493 1037 544 1070 590 L1108 700 H1200 Z",
      fill: grottoRef(CHAMBER_ID, "wall-right"),
      filter: grottoRef(CHAMBER_ID, "rock"),
    }),
    h("path", {
      d: "M0 0 H1200 V73 C1086 49 996 92 902 74 C804 55 721 11 600 27 C479 11 396 55 298 74 C204 92 114 49 0 73 Z",
      fill: "#080a0b",
      filter: grottoRef(CHAMBER_ID, "rock"),
    }),
    h("g", { fill: "#101213" }, grottoShapes(h, "path", CHAMBER_STALACTITE_SHAPES)),
    h("g", null, grottoShapes(h, "ellipse", CHAMBER_POOL_SHAPES)),
    h("g", null, grottoShapes(h, "use", CHAMBER_TORCH_SHAPES)),
    h("path", {
      d: "M0 438 C169 421 326 435 455 452 C515 460 559 464 600 464 C641 464 685 460 745 452 C874 435 1031 421 1200 438 V700 H0 Z",
      fill: grottoRef(CHAMBER_ID, "floor"),
      filter: grottoRef(CHAMBER_ID, "rock"),
    }),
    h("g", { fill: "none", stroke: "#5a5146", strokeWidth: 2, opacity: 0.25 }, grottoShapes(h, "path", CHAMBER_PERSPECTIVE_SHAPES)),
    h("g", { fill: "none", stroke: "#080a0b", strokeWidth: 4, strokeLinecap: "round", opacity: 0.58 }, grottoShapes(h, "path", CHAMBER_CRACK_SHAPES)),
    h("g", { fill: "#34312d" }, grottoShapes(h, "ellipse", CHAMBER_STONES)),
    h("g", { fill: "#ffb65a", opacity: 0.08, filter: grottoRef(CHAMBER_ID, "largeglow") }, grottoShapes(h, "ellipse", CHAMBER_GROUND_LIGHT)),
    h("path", {
      d: "M0 660 C183 630 324 649 459 674 C515 685 558 689 600 689 C642 689 685 685 741 674 C876 649 1017 630 1200 660 V700 H0 Z",
      fill: "#040607",
      opacity: 0.42,
    }),
    h("rect", { width: 1200, height: 700, fill: "none", stroke: "#020303", strokeWidth: 64, opacity: 0.62 }),
  );
}

// --- Grotto scenes ---------------------------------------------------------
//
// One panel with a sticky bar; the scene below it swaps between the hub (rows
// of chamber doors down the cave walls) and one chamber (model piles on the
// floor). Both scenes draw a backdrop from the section above, then lay the
// interactive content over it.

function tokenGrottoShell(h, DialogTitle, title, subtitle, panelRef, onBack, onExit, children) {
  return h(
    "section",
    {
      ref: panelRef,
      tabIndex: -1,
      role: "region",
      "aria-label": "Kandy Token Grotto",
      className: "kandev-kandy-grotto-panel",
    },
    h(
      "header",
      { className: "kandev-kandy-grotto-bar" },
      tokenGrottoAction(h, "Back", onBack),
      h(
        "div",
        { className: "kandev-kandy-grotto-heading" },
        h(DialogTitle, { className: "kandev-kandy-grotto-title" }, title),
        subtitle ? h("div", { className: "kandev-kandy-grotto-subtitle" }, subtitle) : null,
      ),
      tokenGrottoAction(h, "Exit Grotto", onExit),
    ),
    h("div", { className: "kandev-kandy-grotto-scroll" }, children),
  );
}

// The hub's cave-mouth backdrop is one SVG stretched to the scene's full
// height; past roughly a screen's worth of door rows the "slice" scaling
// zooms in far enough that the painted mountains/moon/water fall outside the
// visible crop and the scene reads as a flat, featureless gradient. Capping
// door count keeps the scene short enough to stay recognizable — measured
// against the real 680px dialog width, 11 real doors (scene ~630px tall,
// backdrop scale ~0.9) stayed fully intact in a browser screenshot, while 30+
// visibly lost the moon/water/grass. The last slot becomes an overflow door
// once the cap is exceeded, mirroring CHAMBER_PILE_SPOTS' merge-the-rest
// pattern below.
var HUB_DOOR_CAP = 12;
var HUB_OVERFLOW_KEY = "\u0000hub-overflow";

// Rooms arrive pre-sorted tokens-desc/label-asc (tokenGrottoModelFor), so the
// first cap-1 are simply the biggest chambers; everything past that merges
// into one overflow door.
function hubDoorPlacement(rooms, cap) {
  if (rooms.length <= cap) {
    return rooms.map(function (room) {
      return { room: room, rooms: [room], merged: false };
    });
  }
  var shown = rooms.slice(0, cap - 1);
  var rest = rooms.slice(cap - 1);
  var placed = shown.map(function (room) {
    return { room: room, rooms: [room], merged: false };
  });
  // tokenCountBigInt(room.tokens) is null for an unavailable count (the
  // webhook body is untrusted input); BigInt(0) + null throws, so an
  // unavailable count in the overflow set must not join the arithmetic.
  var total = rest.reduce(function (sum, room) {
    var count = tokenCountBigInt(room.tokens);
    return count === null ? sum : sum + count;
  }, BigInt(0));
  var anyUnavailable = rest.some(function (room) {
    return tokenCountBigInt(room.tokens) === null;
  });
  placed.push({
    room: {
      agentType: HUB_OVERFLOW_KEY,
      label: rest.length + " more chambers",
      tokens: anyUnavailable ? null : total.toString(),
      models: [],
    },
    rooms: rest,
    merged: true,
  });
  return placed;
}

// A live usage refresh can change the ranking while a visitor is inside a
// chamber. Resolve the selected room against the hub's current placement so
// Back focuses its real door when visible, or the overflow door when the room
// has moved behind the cap.
function hubDoorFocusKey(rooms, agentType) {
  var placements = hubDoorPlacement(rooms, HUB_DOOR_CAP);
  for (var i = 0; i < placements.length; i++) {
    var entry = placements[i];
    if (entry.merged) {
      for (var j = 0; j < entry.rooms.length; j++) {
        if (entry.rooms[j].agentType === agentType) return HUB_OVERFLOW_KEY;
      }
    } else if (entry.room.agentType === agentType) {
      return agentType;
    }
  }
  return null;
}

// Chambers hang off the cave walls: even ranks on the left rock face, odd on
// the right, each one row further back. DOM order stays token order, so the
// keyboard walks the chambers biggest-first however they are placed.
function tokenGrottoDoor(h, room, onOpen, index) {
  var exact = formatTokenExact(room.tokens);
  var side = index % 2 === 0 ? "left" : "right";
  return h(
    "button",
    {
      key: room.agentType,
      type: "button",
      className: "kandev-kandy-grotto-door is-" + side,
      style: { gridColumn: side === "left" ? 1 : 3, gridRow: Math.floor(index / 2) + 1 },
      "data-grotto-agent": room.agentType,
      "data-grotto-side": side,
      "aria-label": room.label + ", " + exact + " tokens, open chamber",
      onClick: function () {
        onOpen(room.agentType, side);
      },
    },
    h(
      "svg",
      { viewBox: "0 0 88 88", "aria-hidden": "true", className: "kandev-kandy-grotto-door-art" },
      h("path", {
        d: "M15 78V42C15 21 28 10 44 10s29 11 29 32v36Z",
        fill: "color-mix(in oklch,var(--muted) 82%,#65472f)",
        stroke: "color-mix(in oklch,var(--foreground) 25%,transparent)",
        strokeWidth: 3,
      }),
      h("path", {
        d: "M25 78V43c0-14 8-23 19-23s19 9 19 23v35Z",
        fill: "color-mix(in oklch,var(--background) 65%,#2f241d)",
      }),
      h("circle", { cx: 56, cy: 50, r: 2.5, fill: "#f6c85f" }),
    ),
    h(
      "span",
      { className: "kandev-kandy-grotto-door-body" },
      h("span", { className: "kandev-kandy-grotto-door-label" }, room.label),
      h("span", { className: "kandev-kandy-grotto-door-count" }, formatTokenCompact(room.tokens) + " tokens"),
    ),
  );
}

// The cap's last door: it doesn't lead anywhere itself — it toggles a list of
// every remaining chamber (kandev-kandy-grotto-manifest, the same popover the
// chamber scene already uses for its own "N more models" overflow pile), so
// visiting one of those chambers is still a single tap/click/Enter away.
function tokenGrottoOverflowDoor(h, entry, index, revealed, onToggle) {
  var room = entry.room;
  var exact = formatTokenExact(room.tokens);
  var side = index % 2 === 0 ? "left" : "right";
  var label = room.label + (room.tokens === null ? "" : ", " + exact + " tokens") + ", open the list";
  return h(
    "button",
    {
      key: HUB_OVERFLOW_KEY,
      type: "button",
      className: "kandev-kandy-grotto-door kandev-kandy-grotto-door-overflow is-" + side + (revealed ? " is-revealed" : ""),
      style: { gridColumn: side === "left" ? 1 : 3, gridRow: Math.floor(index / 2) + 1 },
      "data-grotto-overflow": "true",
      // Shares the door lookup focusGrottoDoor already does by agentType; the
      // return focus is resolved against the current hub placement on Back.
      "data-grotto-agent": HUB_OVERFLOW_KEY,
      "aria-label": label,
      "aria-pressed": revealed,
      onClick: function () {
        onToggle(HUB_OVERFLOW_KEY);
      },
    },
    h(
      "svg",
      { viewBox: "0 0 88 88", "aria-hidden": "true", className: "kandev-kandy-grotto-door-art" },
      h("circle", { cx: 44, cy: 44, r: 34, fill: "color-mix(in oklch,var(--muted) 82%,#65472f)" }),
      h("circle", { cx: 30, cy: 44, r: 4.5, fill: "#f6c85f" }),
      h("circle", { cx: 44, cy: 44, r: 4.5, fill: "#f6c85f" }),
      h("circle", { cx: 58, cy: 44, r: 4.5, fill: "#f6c85f" }),
    ),
    h(
      "span",
      { className: "kandev-kandy-grotto-door-body" },
      h("span", { className: "kandev-kandy-grotto-door-label" }, room.label),
      room.tokens !== null
        ? h("span", { className: "kandev-kandy-grotto-door-count" }, formatTokenCompact(room.tokens) + " tokens")
        : null,
    ),
  );
}

// The overflow door's own list: real navigation, not a read-only tally, so
// unlike tokenPileManifest each row is a button that opens straight into that
// chamber.
function hubOverflowManifest(h, entry, onOpen) {
  return h(
    "div",
    { className: "kandev-kandy-grotto-manifest", role: "group", "aria-label": "Remaining chambers" },
    h("strong", null, entry.rooms.length + " more chambers"),
    h(
      "ul",
      null,
      entry.rooms.map(function (room, index) {
        var exact = formatTokenExact(room.tokens);
        return h(
          "li",
          { key: room.agentType },
          h(
            "button",
            {
              type: "button",
              className: "kandev-kandy-grotto-manifest-open",
              "aria-label": room.label + ", " + exact + " tokens, open chamber",
              onClick: function () {
                onOpen(room.agentType, index % 2 === 0 ? "left" : "right");
              },
            },
            h("span", { className: "kandev-kandy-grotto-manifest-name" }, room.label),
            h("span", { className: "kandev-kandy-grotto-manifest-separator", "aria-hidden": "true" }, "·"),
            h("span", { className: "kandev-kandy-grotto-manifest-count" }, exact),
          ),
        );
      }),
    ),
  );
}

function tokenGrottoHub(h, DialogTitle, model, creature, panelRef, onOpenRoom, onBack, onExit, outside, revealedKey, onToggle) {
  var statusLine = model.status === "partial" ? "Some usage is estimated or incomplete." : "Tokens Kandy caught while listening.";
  var body;
  if (!model.rooms.length) {
    body = h(
      "div",
      { className: "kandev-kandy-grotto-empty", "aria-label": "No chambers yet" },
      h("div", { className: "kandev-kandy-grotto-kandy" }, creature),
    );
  } else {
    var placements = hubDoorPlacement(model.rooms, HUB_DOOR_CAP);
    var overflowEntry = null;
    placements.forEach(function (entry) {
      if (entry.merged) overflowEntry = entry;
    });
    var pathRows = Math.ceil(placements.length / 2);
    // One grid, no inner wrapper: the passages share their rows with the cave
    // floor below them, so Kandy always ends up standing on the ground.
    body = h(
      "div",
      {
        className: "kandev-kandy-grotto-hub",
        "aria-label": "Agent chambers",
        // Passage rows first, then one growing row for the cave floor, so
        // Kandy stands on the ground however many chambers there are.
        style: { gridTemplateRows: "repeat(" + pathRows + ", auto) 1fr" },
      },
      placements.map(function (entry, index) {
        return entry.merged
          ? tokenGrottoOverflowDoor(h, entry, index, revealedKey === HUB_OVERFLOW_KEY, onToggle)
          : tokenGrottoDoor(h, entry.room, onOpenRoom, index);
      }),
      h(
        "div",
        {
          className: "kandev-kandy-grotto-kandy",
          style: { gridColumn: "1 / -1", gridRow: pathRows + 1, alignSelf: "end" },
        },
        creature,
      ),
      overflowEntry && revealedKey === HUB_OVERFLOW_KEY ? hubOverflowManifest(h, overflowEntry, onOpenRoom) : null,
    );
  }
  return tokenGrottoShell(
    h,
    DialogTitle,
    "Token Grotto",
    (model.totalTokens === null ? "Unavailable" : formatTokenExact(model.totalTokens) + " observed tokens") + " · " + statusLine,
    panelRef,
    onBack,
    onExit,
    h(
      "div",
      { className: "kandev-kandy-grotto-scene" },
      grottoBackdrop(h, outside),
      body,
      model.observedSince
        ? h("p", { className: "kandev-kandy-grotto-boundary" }, "Observed since " + model.observedSince.slice(0, 10) + ". No backfill.")
        : null,
      // Whether a chamber's total folds in cache tokens depends on which
      // agent reported it — Kandy has no adapter-agnostic way to normalize
      // that, so chambers are not directly comparable across agents.
      model.rooms.length > 1
        ? h(
            "p",
            { className: "kandev-kandy-grotto-boundary" },
            "Counting may differ by agent — some chambers include cache tokens, some don't.",
          )
        : null,
    ),
  );
}

// Ten floor spots ranked front-first: index 0 is the room's main stage and
// index 9 is the back of the room. Y climbs in an even perspective gradient
// from the front (y=628) up toward the floor line (y≈438) at the back, so no
// cluster crowds the bottom edge and no row floats far from its neighbours.
// The frontmost label (+44 below the spot) clears the viewBox bottom (700)
// with room for the pile's own ground shadow hit area (+52 below).
var CHAMBER_PILE_SPOTS = [
  { x: 600, y: 628, scale: 1 },
  { x: 360, y: 612, scale: 0.94 },
  { x: 840, y: 612, scale: 0.94 },
  { x: 500, y: 566, scale: 0.8 },
  { x: 700, y: 566, scale: 0.8 },
  { x: 300, y: 530, scale: 0.72 },
  { x: 900, y: 530, scale: 0.72 },
  { x: 430, y: 496, scale: 0.62 },
  { x: 770, y: 496, scale: 0.62 },
  { x: 600, y: 472, scale: 0.56 },
];

var MERGED_PILE_KEY = "\u0000merged";

// Which models get a standing spot. Ranking alternates between the biggest and
// the most recently used, so an enormous old model and a small model used
// minutes ago both make the floor. Whatever is left over is merged into the
// last spot as a single pile the visitor can open for the full list.
function tokenPilePlacement(models, spots) {
  var capacity = spots || CHAMBER_PILE_SPOTS.length;
  if (!models.length) return [];
  var bySize = models.slice().sort(function (left, right) {
    var order = compareTokenGrottoDecimals(right.tokens, left.tokens);
    return order || left.name.localeCompare(right.name);
  });
  var byRecency = models.slice().sort(function (left, right) {
    var recentOrder = compareTokenGrottoDecimals(right.recentRank, left.recentRank);
    if (recentOrder) return recentOrder;
    var order = compareTokenGrottoDecimals(right.tokens, left.tokens);
    return order || left.name.localeCompare(right.name);
  });
  if (models.length <= capacity) {
    return bySize.map(function (model) {
      return { model: model, models: [model], merged: false };
    });
  }
  var chosen = [];
  // Object.create(null): a model literally named "constructor" or
  // "toString" must not collide with a prototype method and read as
  // already-taken.
  var taken = Object.create(null);
  var sizeIndex = 0;
  var recencyIndex = 0;
  // One short of capacity: the final spot belongs to everything left over.
  while (chosen.length < capacity - 1) {
    var pick = null;
    if (chosen.length % 2 === 0) {
      while (sizeIndex < bySize.length && taken[bySize[sizeIndex].name]) sizeIndex++;
      pick = sizeIndex < bySize.length ? bySize[sizeIndex] : null;
    } else {
      while (recencyIndex < byRecency.length && taken[byRecency[recencyIndex].name]) recencyIndex++;
      pick = recencyIndex < byRecency.length ? byRecency[recencyIndex] : null;
    }
    if (!pick) break;
    taken[pick.name] = true;
    chosen.push(pick);
  }
  var rest = bySize.filter(function (model) {
    return !taken[model.name];
  });
  var placed = chosen.map(function (model) {
    return { model: model, models: [model], merged: false };
  });
  if (rest.length) {
    // tokenCountBigInt(model.tokens) is null for an unavailable count (the
    // webhook body is untrusted input); BigInt(0) + null throws, so an
    // unavailable count in the overflow set must not join the arithmetic.
    var total = rest.reduce(function (sum, model) {
      var count = tokenCountBigInt(model.tokens);
      return count === null ? sum : sum + count;
    }, BigInt(0));
    var anyUnavailable = rest.some(function (model) {
      return tokenCountBigInt(model.tokens) === null;
    });
    placed.push({
      model: {
        name: rest.length + " more models",
        tokens: anyUnavailable ? null : total.toString(),
        recentRank: "",
      },
      models: rest,
      merged: true,
    });
  }
  return placed;
}

function tokenGrottoVisiblePileName(name) {
  var text = typeof name === "string" && name ? name : "Mystery model";
  return text.length > 18 ? text.slice(0, 17) + "…" : text;
}

function tokenGrottoPileLabelTransform(name, spotScale) {
  var scale = typeof spotScale === "number" && isFinite(spotScale) ? Math.max(0.5, Math.min(1, spotScale)) : 1;
  var estimatedWidth = Math.max(1, name.length) * 12.5 + 14;
  var availableWidth = 180 * scale;
  var horizontalScale = Math.max(0.5, Math.min(scale, availableWidth / estimatedWidth));
  return "scale(" + horizontalScale.toFixed(3) + " 1)";
}

// One pile standing on one floor spot, drawn in the backdrop's coordinate
// space so it rests on the painted stone rather than floating in a CSS grid.
// scale (PROPORTION) is this model's share of the room's biggest pile; tier
// (SPECTACLE) is this model's own absolute token count against the fixed
// ladder; style (IDENTITY) is the lineage's own palette, shared by every
// pile in this grotto. See the "Grotto hoards" block above tokenGrottoAction.
function tokenModelPile(h, room, entry, spot, maximum, revealedKey, onToggle, lineageSeed) {
  var model = entry.model;
  var key = entry.merged ? MERGED_PILE_KEY : room.agentType + "\u0000" + model.name;
  var exact = formatTokenExact(model.tokens);
  var revealed = revealedKey === key;
  var scale = tokenPileScale(model.tokens, maximum);
  var tierInfo = hoardTierFor(model.tokens);
  var style = hoardStyleFor(lineageSeed);
  var art = hoardArtFor(h, room.agentType + "\u0000" + model.name, style, tierInfo, scale);
  var visibleName = tokenGrottoVisiblePileName(model.name);
  var labelTransform = tokenGrottoPileLabelTransform(visibleName, spot.scale);
  var label = entry.merged
    ? model.name + ", " + exact + " tokens together, open the list"
    : model.name + ", " + exact + " tokens in " + room.label + " chamber";
  var pileHeight = 126 * spot.scale;
  return h(
    "g",
    {
      key: key,
      className: "kandev-kandy-token-pile" + (revealed ? " is-revealed" : "") + (entry.merged ? " is-merged" : ""),
      transform: "translate(" + spot.x + " " + spot.y + ")",
      role: "button",
      tabIndex: 0,
      "data-grotto-model": model.name,
      "data-grotto-merged": entry.merged ? "true" : undefined,
      "data-grotto-tier": tierInfo.tier.name,
      "aria-label": label,
      "aria-pressed": revealed,
      onClick: function () {
        onToggle(key);
      },
      onKeyDown: function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.preventDefault) event.preventDefault();
        onToggle(key);
      },
    },
    h("title", null, model.name + ", " + exact + " tokens"),
    // The hit area covers the mound and its labels, so tapping anywhere on the
    // pile works on a phone.
    h("rect", {
      className: "kandev-kandy-token-pile-hit",
      x: -66 * spot.scale,
      y: -pileHeight,
      width: 132 * spot.scale,
      height: pileHeight + 52,
      rx: 10,
    }),
    h(
      "g",
      { className: "kandev-kandy-token-pile-hoard", transform: "scale(" + spot.scale + ") translate(-63 -126)", "aria-hidden": "true" },
      art,
    ),
    h("text", { className: "kandev-kandy-token-pile-name", x: 0, y: 24, transform: labelTransform, "aria-hidden": "true" }, visibleName),
    h(
      "text",
      { className: "kandev-kandy-token-pile-compact", x: 0, y: 44, transform: labelTransform, "aria-hidden": "true" },
      formatTokenCompact(model.tokens) + " tokens",
    ),
    h(
      "text",
      { className: "kandev-kandy-grotto-exact", x: 0, y: -pileHeight - 10, "aria-hidden": "true" },
      entry.merged ? exact + " tokens · tap for the list" : exact + " tokens",
    ),
  );
}

// The chamber floor. Placements come back ranked, so spot order is prominence
// order: the front of the room first, the back of the room last.
function tokenPileStage(h, room, placements, revealedKey, onToggle, lineageSeed) {
  var maximum = null;
  placements.forEach(function (entry) {
    if (maximum === null || compareTokenGrottoDecimals(entry.model.tokens, maximum) > 0) maximum = entry.model.tokens;
  });
  return h(
    "svg",
    {
      className: "kandev-kandy-token-stage",
      viewBox: "0 0 1200 700",
      preserveAspectRatio: "xMidYMax slice",
      role: "group",
      "aria-label": room.label + " model piles",
    },
    placements.map(function (entry, index) {
      return tokenModelPile(h, room, entry, CHAMBER_PILE_SPOTS[index], maximum, revealedKey, onToggle, lineageSeed);
    }),
  );
}

// What the merged pile is hiding, listed in full when it is opened.
function tokenPileManifest(h, entry) {
  return h(
    "div",
    { className: "kandev-kandy-grotto-manifest", role: "group", "aria-label": "Models in the merged pile" },
    h("strong", null, entry.models.length + " models in this pile"),
    h(
      "ul",
      null,
      entry.models.map(function (model) {
        return h(
          "li",
          { key: model.name, className: "kandev-kandy-grotto-manifest-row" },
          h("span", { className: "kandev-kandy-grotto-manifest-name" }, model.name),
          h("span", { className: "kandev-kandy-grotto-manifest-separator", "aria-hidden": "true" }, "·"),
          h("span", { className: "kandev-kandy-grotto-manifest-count" }, formatTokenExact(model.tokens)),
        );
      }),
    ),
  );
}

function tokenGrottoRoom(h, DialogTitle, grotto, agentType, revealedKey, panelRef, onBack, onExit, onToggle, creature, side, lineageSeed) {
  var room = null;
  for (var i = 0; i < grotto.rooms.length; i++) {
    if (grotto.rooms[i].agentType === agentType) {
      room = grotto.rooms[i];
      break;
    }
  }
  if (!room) {
    return tokenGrottoShell(h, DialogTitle, "Token Grotto", "That chamber is no longer available.", panelRef, onBack, onExit, null);
  }
  var placements = tokenPilePlacement(room.models);
  var merged = null;
  placements.forEach(function (entry) {
    if (entry.merged) merged = entry;
  });
  // The hub already discloses "some usage is estimated or incomplete" but a
  // visitor may open a chamber straight from a deep link or a restored
  // focus and never see that line — the disclosure has to travel with the
  // numbers, not just sit on the door.
  var roomSubtitle =
    formatTokenExact(room.tokens) +
    " observed tokens" +
    (grotto.status === "partial" ? " · some usage is estimated or incomplete" : "");
  return tokenGrottoShell(
    h,
    DialogTitle,
    room.label + " chamber",
    roomSubtitle,
    panelRef,
    onBack,
    onExit,
    h(
      "div",
      { className: "kandev-kandy-grotto-scene kandev-kandy-grotto-room-scene" },
      chamberBackdrop(h),
      placements.length
        ? tokenPileStage(h, room, placements, revealedKey, onToggle, (lineageSeed || 1) >>> 0)
        : h("div", { className: "kandev-kandy-grotto-room" }, h("div", { className: "kandev-kandy-grotto-empty-msg" }, "No model piles yet.")),
      merged && revealedKey === MERGED_PILE_KEY ? tokenPileManifest(h, merged) : null,
      h("div", { className: "kandev-kandy-grotto-kandy is-" + (side === "left" ? "left" : "right") }, creature),
    ),
  );
}

// ---------------------------------------------------------------------------
// Photo Booth — a dedicated, static SVG artboard. Clipboard copy rasterizes
// this SVG only: no app DOM, task text, account data, upload, or external service.
// ---------------------------------------------------------------------------

var PHOTO_VIEWBOX = { width: 800, height: 1000 };
var PHOTO_EXPORT = { width: 1600, height: 2000, mimeType: "image/png" };
var PHOTO_HABITATS = ["Verdant", "Aquatic", "Alpine", "Ember"];
// The portrait frames the 240x120 scene viewBox into a 696x516 window with
// `slice`, so only the middle ~162 units survive the crop. Elders are placed
// inside that window instead of the card's full width — otherwise the
// outermost ones are sawn in half by the frame.
var PHOTO_SCENE_BOUNDS = { min: 46, max: 194 };
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
    counterfeit: !!data.counterfeit,
    dayPhase: dayPhase,
    habitat: PHOTO_HABITATS[biome],
    sleepState: level > 1 && isAsleep(lineageSeed, timeOfDay) ? "asleep" : null,
    generation: Math.max(photoInt(data.generation, 1), 1),
    ancestors: photoAncestorsFor(data.ancestors),
  };
}

// photoAncestorsFor sanitizes the elders the same way as the living kandy:
// derived DNA and level only, bounded to what the scene can stand, so a
// shareable portrait can never carry more than the card already shows.
function photoAncestorsFor(ancestors) {
  if (!ancestors || !ancestors.length) return [];
  var out = [];
  var start = Math.max(0, ancestors.length - ANCESTOR_SPOTS.length);
  for (var i = start; i < ancestors.length; i++) {
    var a = ancestors[i] || {};
    out.push({
      level: Math.max(photoInt(a.level, 100), 2),
      archetype: photoInt(a.archetype, 0),
      family: photoInt(a.family, 0),
      lineage_seed: (photoInt(a.lineage_seed, 1) >>> 0) || 1,
      scarred: !!a.scarred,
    });
  }
  return out;
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

function sceneBgStops(scene) {
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
    counterfeit: model.counterfeit,
  };
  if (model.sleepState) renderData.sleep_state = model.sleepState;
  var scene = sceneFor(
    model.biome,
    model.level,
    model.lineageSeed,
    photoPhaseHour(model.dayPhase),
    undefined,
    model.ancestors,
    PHOTO_SCENE_BOUNDS,
  );
  var stops = sceneBgStops(scene);
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
    // The lineage marker sits opposite the header, clear of the name and the
    // level chip below it. Omitted for a first-of-its-line kandy.
    model.generation > 1
      ? h(
          "text",
          {
            x: 720,
            y: 620,
            fill: palette.muted,
            fontSize: 15,
            fontWeight: 750,
            letterSpacing: 3.2,
            textAnchor: "end",
          },
          "GEN " + romanNumeral(model.generation),
        )
      : null,
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

// The Token Grotto entry point (rest of the grotto is its own section above).
// It lives beside photoBoothButton because the two are the dialog's mutually
// exclusive doorways and share the entry-button markup and styling.
function tokenGrottoButton(h, onOpen, buttonRef) {
  return h(
    "button",
    {
      type: "button",
      ref: buttonRef,
      "aria-label": "Show me your Token Grotto",
      title: "Show me your Token Grotto",
      className: "kandev-kandy-control kandev-kandy-grotto-entry",
      onClick: onOpen,
      style: {
        minWidth: "66px",
        height: "40px",
        minHeight: "40px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "5px",
        padding: "0 9px",
        border: "none",
        borderRadius: "10px",
        background: "color-mix(in oklch,var(--background) 86%,transparent)",
        color: "inherit",
        boxShadow: "0 0 0 1px color-mix(in oklch,var(--foreground) 7%,transparent),0 1px 4px rgba(0,0,0,0.08)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
        fontSize: "10px",
        fontWeight: 700,
      },
    },
    h("span", { "aria-hidden": "true", style: { fontSize: "14px" } }, "▣"),
    "Grotto",
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
// onBonk, onPointerDown, onPointerUp, onPointerCancel, holdFx} — a plain
// click/tap on the creature pets it
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
//
// motion (v0.8.0, optional): {x, facing, walking, cry} — the widget's live
// wander/cry state. When provided, three extra wrappers nest inside the
// positioning div (wander translateX -> facing scaleX -> gait animation),
// all overlay anchors take motion.x, and motion.cry mounts the tears.
// Omitted (legacy callers, offline tooling), the card renders EXACTLY the
// pre-0.8.0 structure.
function kandyCard(h, data, celebration, care, timeOfDay, season, speech, motion) {
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
  // Wander/cry state (v0.8.0). walking/crying only ever come from the
  // widget's motion clock, which already gates out sleep, eggs, reduced
  // motion, and mid-interaction starts — the checks here are belt.
  var wanderX = (motion && motion.x) || 0;
  // Facing persists after a stroll (it keeps looking where it walked), so
  // anchor mirroring applies while idle too.
  var mirrored = !!(motion && motion.facing < 0);
  var gaitInfo = gaitFor(data.archetype || 0);
  // A transit walk is a walk: the gait animates even though the motion
  // clock is not driving a wander leg.
  var walking = !!(motion && (motion.walking || motion.transit)) && sleepState === null;
  var crying =
    !!(motion && motion.cry) &&
    sleepState === null &&
    !celebration &&
    !(care && (care.fx || care.bonkFx || care.distrustFx || care.sleepyFx || care.holdFx));
  if (walking && !gaitInfo.keepBob) {
    shownData = Object.assign({}, shownData, { walk_suppress_bob: true });
  }
  var scene = sceneFor(
    data.biome || 0,
    data.level,
    (data.lineage_seed || 1) >>> 0,
    timeOfDay,
    season,
    data.ancestors,
  );
  // While walking the ambient wiggle yields (the gait wrapper is already
  // rotating); the sob-shudder class is declared after wiggle in the CSS
  // so it wins the animation shorthand when both are present.
  var animCls = sleepState === "asleep" || walking ? "" : "kandev-kandy-wiggle";
  if (crying) animCls += " kandev-kandy-sob";
  if (care && care.bonkFx) animCls += " kandev-kandy-soaked";
  else if (care && care.distrustFx) animCls += " kandev-kandy-turnaway";
  else if (care && care.fx) animCls += " kandev-kandy-munch";
  else if (celebration) animCls += " kandev-kandy-cardhop";
  // Arrival greeting: the wave-ish hop reuses the celebration hop on the
  // same animation-safe inner wrapper (never while asleep or mid-fx).
  else if (care && care.greetFx && sleepState !== "asleep") animCls += " kandev-kandy-cardhop";
  animCls = animCls.trim();
  // The speech bubble is content, but it never fights a celebration burst
  // or a care overlay for the same pixels.
  var showBubble =
    speech &&
    !celebration &&
    !(care && (care.fx || care.bonkFx || care.distrustFx || care.sleepyFx || care.holdFx));
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
        // Right-click = bonk (cold water). contextmenu is mouse-only by
        // policy: the handler checks the last pointer type and ignores
        // touch/pen long-presses (see triggerBonk) — coarse pointers bonk
        // via press-and-hold instead. It never also fires pet — onClick
        // only responds to the primary button.
        onContextMenu: function (e) {
          if (e && e.preventDefault) e.preventDefault();
          if (care.onBonk) care.onBonk();
        },
        // Hold-to-bonk (coarse pointers): down starts the hold, up/cancel
        // ends it (tap / hesitation / commit disambiguated in the widget).
        onPointerDown: care.onPointerDown,
        onPointerUp: care.onPointerUp,
        onPointerCancel: care.onPointerCancel,
        style: {
          display: "block",
          background: "transparent",
          border: "none",
          margin: 0,
          padding: "10px 14px 0",
          cursor: "pointer",
          color: "inherit",
          // touch-action none (was "manipulation"): the press-and-hold
          // must never turn into a scroll mid-hold, and pointer capture
          // needs the gesture to stay ours. The callout/user-select
          // suppression keeps iOS long-press from popping its magnifier.
          touchAction: "none",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        },
      },
      creature,
    );
  } else {
    inner = h("div", { className: animCls }, creature);
  }
  // The motion wrapper stack (only when a motion state is supplied, so
  // legacy callers keep the exact pre-0.8.0 tree). Order matters:
  //   positioning div  — layout transform (left:50% + translateX(-50%)),
  //                      never animated (the layering rule);
  //   wander div       — state-driven inline translateX. The pet-zone
  //                      button lives INSIDE it, so the hit target tracks
  //                      the creature: clicking where it visually stands
  //                      works, clicking where it used to stand doesn't;
  //   facing div       — state-driven scaleX flip (direction changes);
  //   gait div         — CSS gait animation only, no base transform.
  var positioned = inner;
  if (motion) {
    positioned = h(
      "div",
      {
        className: "kandev-kandy-wander",
        style: { transform: "translateX(" + wanderX + "px)" },
      },
      h(
        "div",
        { style: { transform: motion.facing < 0 ? "scaleX(-1)" : "none" } },
        h(
          "div",
          { className: (walking && gaitInfo.cls) || "" },
          motion.transit ? h("div", { className: motion.transit }, inner) : inner,
        ),
      ),
    );
  }
  var lineage = generationSummary(data);
  var flavorLine = data.flavor;
  if (celebration && celebration.kind === "rebirth") {
    flavorLine = "It steps back into the scene. A new egg settles in the grass.";
  }
  if (care && care.distrustFx) flavorLine = "It doesn't trust you right now.";
  else if (care && care.bonkFx) flavorLine = "Your kandy got drenched.";
  else if (care && care.sleepyFx) flavorLine = "Your kandy blinks at you sleepily.";
  else if (care && care.fx) flavorLine = "Your kandy munches happily.";
  else if (sleepState === "asleep") flavorLine = "Your kandy is fast asleep.";
  // Gaze tracking (v0.10.0): the scene reports pointer moves as unit
  // offsets on --kandy-gx/--kandy-gy; the pupils (kandev-kandy-pupil)
  // translate by them. Trust shapes it: a beloved kandy glances softly, a
  // wary/fearful one locks on and follows your hand — exactly what its
  // flavor text has always claimed. Asleep eyes are closed, so skip.
  var gazeAmp = sleepState ? 0 : gazeAmpFor(data.temperament_band);
  function onSceneMove(e) {
    if (!gazeAmp) return;
    var el = e.currentTarget;
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Aim from the creature's own spot (it walks), not the scene centre.
    var originX = r.left + r.width / 2 + wanderX * (r.width / BONK_SCENE.w);
    var originY = r.top + r.height * 0.55;
    var dx = (e.clientX - originX) / (r.width / 2);
    var dy = (e.clientY - originY) / (r.height / 2);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var k = Math.min(len, 1) / len;
    el.style.setProperty("--kandy-gx", (dx * k * gazeAmp).toFixed(3));
    el.style.setProperty("--kandy-gy", (dy * k * gazeAmp * 0.7).toFixed(3));
  }
  function onSceneLeave(e) {
    var el = e.currentTarget;
    if (!el || !el.style) return;
    el.style.setProperty("--kandy-gx", "0");
    el.style.setProperty("--kandy-gy", "0");
  }
  return h(
    "div",
    { style: { width: "248px" } },
    h(
      "div",
      {
        onPointerMove: onSceneMove,
        onPointerLeave: onSceneLeave,
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
        positioned,
      ),
      celebration ? burstSparkles(h, bigCelebration(celebration)) : null,
      care && care.fx ? petOverlay(h, care.fx, data, wanderX, mirrored) : null,
      care && care.bonkFx ? bonkOverlay(h, care.bonkFx, data, wanderX, mirrored) : null,
      care && care.distrustFx ? distrustOverlay(h, care.distrustFx, data, wanderX, mirrored) : null,
      care && care.sleepyFx ? sleepyPetOverlay(h, care.sleepyFx, data, wanderX, mirrored) : null,
      care && care.holdFx ? holdTipOverlay(h, care.holdFx, data, wanderX, mirrored) : null,
      care && care.greetFx && sleepState !== "asleep"
        ? greetArcsOverlay(h, care.greetFx, data, wanderX, mirrored)
        : null,
      crying ? cryOverlay(h, motion.cry, data, wanderX, mirrored) : null,
      showBubble ? speechBubble(h, speech, data, wanderX, mirrored) : null,
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
            className: bigCelebration(celebration) ? "kandev-kandy-namehl" : "",
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
        kandyHelp(h),
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
            {
              style: { fontSize: "10px", opacity: 0.65, fontVariantNumeric: "tabular-nums" },
              // The elder roster hangs off this line, which is where the
              // generation is named.
              title: lineage ? lineage.roster : undefined,
            },
            // progress_pct is completion WITHIN the current level — say so
            // plainly ("64% through level 12"), not "to next evolution",
            // which read as 64% remaining.
            (lineage ? lineage.label + " · " : "") +
              Math.floor(data.progress_pct) +
              "% through level " +
              data.level,
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
                  care.hint && !care.fx && !care.bonkFx && !care.distrustFx && !care.sleepyFx && !care.holdFx && !sleepState
                    ? "visible"
                    : "hidden",
              },
            },
            careHintText(isCoarsePointer()),
          )
        : null,
    ),
  );
}

// ---------------------------------------------------------------------------
// Dialog resize (v0.6.2) — pure helpers. The dialog card is always the same
// 248px design; the grip only drags a continuous zoom factor. Radix centers
// DialogContent with translate(-50%,-50%), so growth stays centered on its
// own — the drag never has to reposition anything.
// ---------------------------------------------------------------------------

var DIALOG_CARD_DESIGN_W = 248; // the card's fixed design width (kandyCard)
var DIALOG_ZOOM_DEFAULT = 1.45;
var DIALOG_ZOOM_MIN = 1;
var DIALOG_ZOOM_MAX = 2.2;
var DIALOG_ZOOM_KEY = "kandev-kandy-dialog-zoom";
// Breathing room the zoomed card must keep per viewport axis (24px a side).
var DIALOG_ZOOM_VIEWPORT_PAD = 48;

// clampDialogZoom — the single clamp: [1.0, 2.2] AND viewport fit (the card
// must stay fully on screen with 48px spare per axis). designW/designH are
// the UNZOOMED card layout dims measured at drag start — the height is
// whatever the card currently lays out at (hint row, wrapped stage names),
// never hardcoded. A viewport too small even for zoom 1 still floors at 1.
function clampDialogZoom(zoom, designW, designH, viewportW, viewportH) {
  var max = DIALOG_ZOOM_MAX;
  if (designW > 0 && isFinite(viewportW)) {
    max = Math.min(max, (viewportW - DIALOG_ZOOM_VIEWPORT_PAD) / designW);
  }
  if (designH > 0 && isFinite(viewportH)) {
    max = Math.min(max, (viewportH - DIALOG_ZOOM_VIEWPORT_PAD) / designH);
  }
  if (max < DIALOG_ZOOM_MIN) max = DIALOG_ZOOM_MIN;
  return Math.min(Math.max(zoom, DIALOG_ZOOM_MIN), max);
}

// dialogZoomFromDrag — maps a bottom-right-corner pointer delta onto zoom:
// +designW px of horizontal drag (or +designH vertical) is +1.0 zoom, and a
// diagonal drag averages both axes so the corner tracks the pointer at a
// natural 1:1-ish rate whichever way it moves.
function dialogZoomFromDrag(startZoom, dx, dy, designW, designH) {
  if (!(designW > 0) || !(designH > 0)) return startZoom;
  return startZoom + (dx / designW + dy / designH) / 2;
}

// storedDialogZoom / persistDialogZoom — localStorage round-trip. Absent,
// unparsable, or out-of-range values fall back to the default; storage
// being unavailable (private mode, the node test harness) is fine too.
// `storage` is injectable for tests; production uses window.localStorage.
function storedDialogZoom(storage) {
  try {
    var s = storage || window.localStorage;
    var z = parseFloat(s.getItem(DIALOG_ZOOM_KEY));
    if (!isFinite(z)) return DIALOG_ZOOM_DEFAULT;
    return Math.min(Math.max(z, DIALOG_ZOOM_MIN), DIALOG_ZOOM_MAX);
  } catch (err) {
    return DIALOG_ZOOM_DEFAULT;
  }
}

function persistDialogZoom(zoom, storage) {
  try {
    var s = storage || window.localStorage;
    if (zoom === null) s.removeItem(DIALOG_ZOOM_KEY);
    else s.setItem(DIALOG_ZOOM_KEY, String(Math.round(zoom * 1000) / 1000));
  } catch (err) {
    /* storage unavailable — the session keeps its in-memory zoom */
  }
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
    var grottoViewHook = React.useState(null);
    var grottoView = grottoViewHook[0];
    var setGrottoView = grottoViewHook[1];
    var grottoRevealHook = React.useState(null);
    var grottoRevealKey = grottoRevealHook[0];
    var setGrottoRevealKey = grottoRevealHook[1];
    // Which leg of the grotto walk is running: "depart-surface" and
    // "depart-grotto" walk Kandy out of frame, "arrive-grotto" and
    // "arrive-surface" walk it back in. null while it just stands there.
    var grottoTransitHook = React.useState(null);
    var grottoTransit = grottoTransitHook[0];
    var setGrottoTransit = grottoTransitHook[1];
    // The wall the chosen passage sits on. Kandy leaves the hub that way and
    // walks into the chamber from the same side, then stands there.
    var grottoSideHook = React.useState(null);
    var grottoSide = grottoSideHook[0];
    var setGrottoSide = grottoSideHook[1];
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
    // holdFx: null while idle, else {seq, mode: "tilt"|"static"|"cancel",
    // rot} — the hold-to-bonk progress bucket (see holdTipOverlay).
    var holdFxHook = React.useState(null);
    var holdFx = holdFxHook[0];
    var setHoldFx = holdFxHook[1];
    // motionState (v0.8.0): the live wander/cry presentation snapshot for
    // kandyCard — {x, facing, walking, cry}. The source of truth lives in
    // motionRef (interval callbacks mutate it); this state mirror only
    // triggers renders.
    var motionStateHook = React.useState({ x: 0, facing: 1, walking: false, cry: 0 });
    var motionState = motionStateHook[0];
    var setMotionState = motionStateHook[1];
    // timeOfDay: local-clock hour float driving the day/night scene and
    // the seeded sleep schedule; re-read every TIME_TICK_MS.
    var timeHook = React.useState(localHour());
    var timeOfDay = timeHook[0];
    var setTimeOfDay = timeHook[1];
    // speech: null | {id, text, seq} — the current bubble (dialog-open
    // greeting, arrival greeting, or a gated tick line).
    var speechHook = React.useState(null);
    var speech = speechHook[0];
    var setSpeech = speechHook[1];
    // greetFx: 0 while idle, else a nonce keying the arrival hop + arcs.
    var greetFxHook = React.useState(0);
    var greetFx = greetFxHook[0];
    var setGreetFx = greetFxHook[1];
    // dialogZoom: the continuous card zoom the corner grip drags. Seeded
    // from localStorage (so it applies on every dialog open, across
    // reloads) and re-persisted when a drag ends.
    var zoomHook = React.useState(function () {
      return storedDialogZoom();
    });
    var dialogZoom = zoomHook[0];
    var setDialogZoom = zoomHook[1];
    var mountedRef = React.useRef(true);
    var prevRef = React.useRef(null);
    var photoSvgRef = React.useRef(null);
    var photoCopyRef = React.useRef(null);
    var photoPanelRef = React.useRef(null);
    var photoEntryRef = React.useRef(null);
    var returnToPhotoEntryRef = React.useRef(false);
    var grottoPanelRef = React.useRef(null);
    var grottoEntryRef = React.useRef(null);
    var returnToGrottoEntryRef = React.useRef(false);
    var returnToGrottoDoorRef = React.useRef(null);
    var grottoWalkTimerRef = React.useRef(null);
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
    // holdRef tracks the in-flight coarse-pointer hold (null when idle):
    // {pointerId, startedAt, commitTimer, staticTimer}. suppressClickRef
    // is a deadline: pointer-ups that must NOT pet (a completed hold-bonk,
    // a 250-700ms hesitation) set it so the synthetic click that follows
    // touchend is swallowed; the deadline (not a flag) means a click that
    // never arrives can't eat a later, legitimate tap.
    var holdRef = React.useRef(null);
    var suppressClickRef = React.useRef(0);
    var holdClearTimerRef = React.useRef(null);
    // dialogFrameRef measures the dialog card frame; zoomDragRef holds the
    // in-flight grip drag (null when idle).
    var dialogFrameRef = React.useRef(null);
    var zoomDragRef = React.useRef(null);
    // Speech bookkeeping: the bubble-clear timer, the last-3 line ids
    // (no-immediate-repeat guard), the pending arrival greeting, and the
    // arrival hop timer.
    var speechTimerRef = React.useRef(null);
    var recentSpeechRef = React.useRef([]);
    var arrivalPendingRef = React.useRef(false);
    var greetTimerRef = React.useRef(null);
    // Motion bookkeeping (v0.8.0): the wander/cry source of truth (leg =
    // the in-flight stroll incl. startedAt; cryUntil/crySeq = the active
    // bout; cryPending = a bout waiting for a stroll to finish; last*Bucket
    // dedupe the deterministic gates), plus the ~25fps leg-position timer
    // and the bout-end timer.
    var motionRef = React.useRef({
      x: 0,
      facing: 1,
      leg: null,
      cryUntil: 0,
      crySeq: 0,
      cryPending: false,
      lastWanderBucket: -1,
      lastCryBucket: -1,
    });
    var wanderFrameTimerRef = React.useRef(null);
    var cryEndTimerRef = React.useRef(null);
    var chainTimerRef = React.useRef(null);
    var lookTimerRef = React.useRef(null);
    // liveRef mirrors the latest render values for the interval callbacks
    // (the mount-effect closures would otherwise see mount-time state).
    var liveRef = React.useRef({});
    liveRef.current = {
      data: data,
      celebration: celebration,
      petFx: petFx,
      bonkFx: bonkFx,
      distrustFx: distrustFx,
      sleepyFx: sleepyFx,
      holdFx: holdFx,
      greetFx: greetFx,
    };

    function clearPreparedPhoto() {
      if (photoCopyRef.current) disposePreparedPhoto(photoCopyRef.current);
      photoCopyRef.current = null;
    }

    // --- Wander + cry engine (v0.8.0) --------------------------------
    // The pure decisions live in motionDecide; everything here is clock
    // plumbing. publishMotion mirrors the ref into render state.

    function publishMotion() {
      var m = motionRef.current;
      if (!mountedRef.current) return;
      setMotionState({
        x: m.x,
        facing: m.facing,
        walking: !!m.leg,
        cry: m.cryUntil > Date.now() ? m.crySeq : 0,
      });
    }

    function stopWanderFrames() {
      if (wanderFrameTimerRef.current) {
        clearInterval(wanderFrameTimerRef.current);
        wanderFrameTimerRef.current = null;
      }
    }

    function startCryBout() {
      var m = motionRef.current;
      m.cryPending = false;
      m.crySeq = Date.now();
      m.cryUntil = m.crySeq + CRY_BOUT_MS;
      if (cryEndTimerRef.current) clearTimeout(cryEndTimerRef.current);
      cryEndTimerRef.current = setTimeout(function () {
        motionRef.current.cryUntil = 0;
        publishMotion();
      }, CRY_BOUT_MS);
      publishMotion();
    }

    function beginWanderFrames() {
      stopWanderFrames();
      wanderFrameTimerRef.current = setInterval(function () {
        var m = motionRef.current;
        if (!m.leg) {
          stopWanderFrames();
          return;
        }
        var elapsed = Date.now() - m.leg.startedAt;
        m.x = wanderXAt(m.leg, elapsed);
        if (elapsed >= m.leg.durMs) {
          m.x = m.leg.to;
          m.leg = null;
          stopWanderFrames();
          // A bout that came due mid-stroll starts the moment it lands.
          if (m.cryPending) {
            m.chainLeft = 0;
            startCryBout();
            return; // startCryBout already published
          }
          // v0.8.1: chained journeys — after a brief pause, amble on.
          if (m.chainLeft > 0) scheduleChainLeg();
        }
        publishMotion();
      }, WANDER_FRAME_MS);
    }

    // scheduleChainLeg — the pause between journey legs. Skips silently if
    // anything intervened (fx froze motion and cleared chainLeft, a cry
    // started, or a fresh leg somehow began).
    function scheduleChainLeg() {
      if (chainTimerRef.current) clearTimeout(chainTimerRef.current);
      chainTimerRef.current = setTimeout(function () {
        if (!mountedRef.current) return;
        var m = motionRef.current;
        var live = liveRef.current;
        var fxActive = !!(
          live.celebration || live.petFx || live.bonkFx || live.distrustFx ||
          live.sleepyFx || live.holdFx || live.greetFx
        );
        if (m.chainLeft <= 0 || m.leg || m.cryUntil > Date.now() || m.cryPending || fxActive) return;
        var d = live.data;
        if (!d || !(d.level > 1) || prefersReducedMotion()) return;
        var seed = ((d && d.lineage_seed) || 1) >>> 0;
        if (isAsleep(seed, localHour())) return;
        var leg = wanderLegFor(d, Math.floor(Date.now() / 1000), m.x);
        if (Math.abs(leg.to - leg.from) < 1) { m.chainLeft = 0; return; }
        m.chainLeft--;
        m.leg = Object.assign({ startedAt: Date.now() }, leg);
        m.facing = leg.to >= leg.from ? 1 : -1;
        publishMotion();
        beginWanderFrames();
      }, WANDER_CHAIN_PAUSE_MS);
    }

    // doLookFlip — idle micro-life: face the other way for a beat, then
    // (fx permitting) turn back. A leg starting meanwhile owns facing.
    function doLookFlip() {
      var m = motionRef.current;
      m.facing = -m.facing;
      publishMotion();
      if (lookTimerRef.current) clearTimeout(lookTimerRef.current);
      lookTimerRef.current = setTimeout(function () {
        if (!mountedRef.current) return;
        var mm = motionRef.current;
        if (mm.leg) return; // the walk already re-owned facing
        var live = liveRef.current;
        var fxActive = !!(
          live.celebration || live.petFx || live.bonkFx || live.distrustFx ||
          live.sleepyFx || live.holdFx || live.greetFx
        );
        if (fxActive) return; // don't yank anchors mid-reaction
        mm.facing = -mm.facing;
        publishMotion();
      }, LOOK_HOLD_MS);
    }

    // haltMotion — freeze any in-flight leg exactly where it stands and
    // cancel any bout (active or pending). Used both by the "halt" action
    // (sleep/reduced-motion arrived) and by interactions.
    function haltMotion() {
      var m = motionRef.current;
      m.chainLeft = 0;
      if (chainTimerRef.current) clearTimeout(chainTimerRef.current);
      if (lookTimerRef.current) clearTimeout(lookTimerRef.current);
      if (m.leg) {
        m.x = wanderXAt(m.leg, Date.now() - m.leg.startedAt);
        m.leg = null;
        stopWanderFrames();
      }
      m.cryPending = false;
      if (m.cryUntil > 0) {
        m.cryUntil = 0;
        if (cryEndTimerRef.current) clearTimeout(cryEndTimerRef.current);
      }
      publishMotion();
    }

    // freezeMotionForInteraction — the yield rule, with these semantics:
    // the moment any care reaction / celebration / arrival hop begins, the
    // current stroll leg FREEZES in place (the creature stops mid-stride
    // and stays there — it does NOT resume the leg afterwards; the next
    // gated stroll simply starts from the frozen spot) and any crying bout
    // ends immediately (being interacted with beats weeping). While the fx
    // plays, motionDecide's fxActive input keeps new strolls/bouts gated
    // off. Freezing BEFORE the fx state is set means every overlay anchors
    // on the final, frozen wander offset — treat, bucket, and stars land
    // where the creature actually is.
    function freezeMotionForInteraction() {
      haltMotion();
    }

    function motionTick() {
      var live = liveRef.current;
      var m = motionRef.current;
      var now = Date.now();
      var d = live.data;
      var seed = ((d && d.lineage_seed) || 1) >>> 0;
      var action = motionDecide(
        {
          x: m.x,
          leg: m.leg,
          cryUntil: m.cryUntil,
          cryPending: m.cryPending,
          lastWanderBucket: m.lastWanderBucket,
          lastCryBucket: m.lastCryBucket,
        },
        {
          now: now,
          data: d,
          asleep: !!(d && d.level > 1 && isAsleep(seed, localHour())),
          reducedMotion: prefersReducedMotion(),
          fxActive: !!(
            live.celebration ||
            live.petFx ||
            live.bonkFx ||
            live.distrustFx ||
            live.sleepyFx ||
            live.holdFx ||
            live.greetFx
          ),
        },
      );
      // Stamp the evaluated buckets (each votes at most once).
      m.lastCryBucket = Math.floor(now / CRY_BUCKET_MS);
      m.lastWanderBucket = Math.floor(now / WANDER_BUCKET_MS);
      if (action.type === "halt") {
        haltMotion();
      } else if (action.type === "start-cry") {
        startCryBout();
      } else if (action.type === "cry-pending") {
        m.cryPending = true;
      } else if (action.type === "start-leg") {
        m.chainLeft = action.chain || 0;
        m.leg = Object.assign({ startedAt: now }, action.leg);
        m.facing = action.facing;
        publishMotion();
        beginWanderFrames();
      } else if (action.type === "look") {
        doLookFlip();
      }
    }

    function celebrate(kind) {
      freezeMotionForInteraction();
      setCelebration({ kind: kind });
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = setTimeout(
        function () {
          if (mountedRef.current) setCelebration(null);
        },
        kind === "gain" ? 1400 : kind === "rebirth" ? 2800 : 2200,
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
            // Rebirth first: an ascension takes the level from 100 back to 1,
            // so the level-up check below would miss the single biggest
            // moment in a kandy's life. The generation is what moved.
            if (generationValue(body) > generationValue(prev)) celebrate("rebirth");
            else if (body.level > prev.level) celebrate("levelup");
            else if (
              typeof body.award_seq === "number" &&
              typeof prev.award_seq === "number" &&
              body.award_seq > prev.award_seq
            ) {
              celebrate("gain");
            }
          }
          prevRef.current = rememberedProgress(body);
          setData(body);
        })
        .catch(function () {
          /* keep the last known creature */
        });
    }

    // showDistrust plays the turn-away/"..." reaction: no hearts, no pet
    // POST, and the card says "It doesn't trust you right now."
    function showDistrust() {
      freezeMotionForInteraction();
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

    // showSpeech — put a line on screen for BUBBLE_TOTAL_MS, stamp the
    // shared 30-minute cooldown (EVERY shown bubble stamps it, arrival
    // greetings included), and remember the line in the last-3 window
    // (only the degraded no-storage pick path still reads it).
    function showSpeech(line) {
      if (!line) return;
      writeLastBubble(Date.now());
      var rec = recentSpeechRef.current;
      rec.push(line.id);
      if (rec.length > 3) rec.shift();
      setSpeech({ id: line.id, text: line.text, seq: Date.now() });
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
      speechTimerRef.current = setTimeout(function () {
        if (mountedRef.current) setSpeech(null);
      }, BUBBLE_TOTAL_MS + 100);
    }

    // maybeTickSpeech — the per-minute bubble opportunity: skipped while a
    // celebration or any care reaction is mid-play (they'd collide
    // visually), blocked until the shared 30-minute cooldown has elapsed
    // (sleep-talk included), gated by the seeded hash, then a shuffle-bag
    // pick.
    function maybeTickSpeech() {
      var live = liveRef.current;
      if (
        live.celebration ||
        live.petFx ||
        live.bonkFx ||
        live.distrustFx ||
        live.sleepyFx ||
        live.holdFx
      ) {
        return;
      }
      if (!bubbleCooldownReady(readLastBubble(), Date.now())) return;
      var d = live.data || EGG_PLACEHOLDER;
      var seed = (d.lineage_seed || 1) >>> 0;
      var t = localHour();
      var asleep = d.level > 1 && isAsleep(seed, t);
      var tick = Math.floor(Date.now() / TIME_TICK_MS);
      if (!speechGate(seed, tick, asleep)) return;
      showSpeech(
        pickSpeech(d, {
          timeOfDay: t,
          season: currentSeason(),
          tick: tick,
          trigger: "tick",
          asleep: asleep,
          recentIds: recentSpeechRef.current,
        }),
      );
    }

    // greetOnOpen — a greeting bubble on dialog open (unless it's asleep —
    // no waking it just to say hi). A pending arrival (6h+ away) plays the
    // wave-ish hop + arcs and ALWAYS speaks; a plain open only speaks once
    // the shared 30-minute cooldown has elapsed — the kandy notices you,
    // it just doesn't repeat itself every time the card opens.
    function greetOnOpen() {
      var d = data || EGG_PLACEHOLDER;
      var seed = (d.lineage_seed || 1) >>> 0;
      var now = Date.now();
      var t = localHour();
      if (d.level > 1 && isAsleep(seed, t)) return;
      var arriving = arrivalPendingRef.current;
      if (arriving) {
        arrivalPendingRef.current = false;
        // The arrival hop is an fx like any other: walking/crying yield.
        freezeMotionForInteraction();
        setGreetFx(now);
        if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
        greetTimerRef.current = setTimeout(function () {
          if (mountedRef.current) setGreetFx(0);
        }, 1400);
      }
      if (!openGreetingAllowed(arriving, readLastBubble(), now)) return;
      showSpeech(
        pickSpeech(d, {
          timeOfDay: t,
          season: currentSeason(),
          tick: Math.floor(now / TIME_TICK_MS),
          trigger: "greeting",
          asleep: false,
          recentIds: recentSpeechRef.current,
        }),
      );
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
      // Walking yields to the treat: freeze the stroll where it stands so
      // the candy falls onto the wandered position (see the semantics note
      // on freezeMotionForInteraction).
      freezeMotionForInteraction();
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
            prevRef.current = rememberedProgress(body);
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

    // triggerBonk (desktop right-click, or a completed coarse-pointer
    // hold): the bucket of cold water — local pour/splash/soak
    // immediately, POST the bonk at most once per 3s, and open the local
    // distrust window. contextmenu only bonks for a mouse: touch/pen
    // long-press contextmenu is ignored (those pointers bonk deliberately
    // via hold-to-tip, and an accidental long-press must not traumatize
    // mobile kandys). Bonking never drains XP: it darkens the persistent
    // temperament, which only conditions how the creature is drawn.
    function triggerBonk(fromHold) {
      if (!fromHold && pointerTypeRef.current !== "mouse") return;
      var nowMs = Date.now();
      // Same yield rule as the pet: the bucket pours where it stands.
      freezeMotionForInteraction();
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
            prevRef.current = rememberedProgress(body);
            setData(body);
          }
        })
        .catch(function () {
          /* the local soaking already played */
        });
    }

    // --- Hold-to-bonk (v0.6.5, coarse pointers) -----------------------
    // Touch and pen bonk deliberately: press and HOLD the creature. The
    // release disambiguates by duration:
    //   < HOLD_TAP_MAX_MS (250ms)        -> plain tap: the click pets;
    //   250ms..BONK_HOLD_MS (hesitation) -> NOTHING (no pet, no bonk) —
    //                                       the bucket rights and fades;
    //   >= BONK_HOLD_MS (700ms)          -> commit: the exact bonk flow,
    //                                       and the touchend's synthetic
    //                                       click is suppressed.
    // Mouse pointers never enter this path (desktop is unchanged).

    function clearHoldTimers(hold) {
      if (!hold) return;
      if (hold.commitTimer) clearTimeout(hold.commitTimer);
      if (hold.staticTimer) clearTimeout(hold.staticTimer);
    }

    function startHold(e) {
      var hold = { pointerId: e && e.pointerId, startedAt: Date.now() };
      clearHoldTimers(holdRef.current);
      holdRef.current = hold;
      if (holdClearTimerRef.current) clearTimeout(holdClearTimerRef.current);
      // Capture the pointer so the up lands on the pet zone even if the
      // finger drifts off it mid-hold (touch-action:none already keeps
      // the browser from stealing the gesture for a scroll).
      if (e && e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId !== undefined) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is an enhancement — the hold still works in place */
        }
      }
      if (prefersReducedMotion()) {
        // Reduced motion: no progressive tilt. A static tilted bucket
        // appears at half-hold as the "about to commit" signal.
        hold.staticTimer = setTimeout(function () {
          if (mountedRef.current && holdRef.current === hold) {
            setHoldFx({ seq: hold.startedAt, mode: "static" });
          }
        }, BONK_HOLD_MS / 2);
      } else {
        setHoldFx({ seq: hold.startedAt, mode: "tilt" });
      }
      hold.commitTimer = setTimeout(function () {
        if (holdRef.current !== hold) return;
        holdRef.current = null;
        // Swallow the synthetic click that follows touchend so a
        // completed hold-bonk can't ALSO pet.
        suppressClickRef.current = Date.now() + 800;
        if (mountedRef.current) {
          setHoldFx(null);
          triggerBonk(true);
        }
      }, BONK_HOLD_MS);
    }

    function endHold(e, canceled) {
      var hold = holdRef.current;
      if (!hold) return;
      if (e && e.pointerId !== undefined && hold.pointerId !== undefined && e.pointerId !== hold.pointerId) {
        return;
      }
      holdRef.current = null;
      clearHoldTimers(hold);
      var elapsed = Date.now() - hold.startedAt;
      if (!canceled && elapsed < HOLD_TAP_MAX_MS) {
        // Quick tap: drop the (barely started) bucket and let the click
        // that follows fire the pet.
        setHoldFx(null);
        return;
      }
      // Hesitation (or the browser canceled the pointer): neither pet nor
      // bonk. The bucket rights itself and fades from its current angle.
      suppressClickRef.current = Date.now() + 800;
      if (prefersReducedMotion()) {
        setHoldFx(null);
        return;
      }
      var rot = HOLD_POUR_DEG * Math.min(elapsed / BONK_HOLD_MS, 1);
      setHoldFx({ seq: Date.now(), mode: "cancel", rot: rot });
      if (holdClearTimerRef.current) clearTimeout(holdClearTimerRef.current);
      holdClearTimerRef.current = setTimeout(function () {
        if (mountedRef.current) setHoldFx(null);
      }, HOLD_CANCEL_MS + 80);
    }

    // --- Dialog resize grip (v0.6.2) ---------------------------------
    // Pointer-capture drag: pointerdown on the grip captures the pointer,
    // so moves and the final release land on the grip even when the cursor
    // leaves the dialog (or the window) — releasing outside still ends
    // cleanly. Text selection is suppressed for the drag's duration only.

    function endZoomDragCleanup() {
      zoomDragRef.current = null;
      if (document.body) document.body.style.userSelect = "";
    }

    function startZoomDrag(e) {
      if (!dialogFrameRef.current || typeof e.clientX !== "number") return;
      if (e.preventDefault) e.preventDefault();
      var rect = dialogFrameRef.current.getBoundingClientRect();
      // CSS zoom scales layout, so the measured frame box is design-size x
      // zoom; dividing by the current zoom recovers the UNZOOMED design
      // dims — including the card's real current height, never hardcoded.
      zoomDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startZoom: dialogZoom,
        designW: rect.width / dialogZoom,
        designH: rect.height / dialogZoom,
        zoom: dialogZoom,
      };
      if (e.target && e.target.setPointerCapture && e.pointerId !== undefined) {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is an enhancement — the drag still works over the grip */
        }
      }
      if (document.body) document.body.style.userSelect = "none";
    }

    function moveZoomDrag(e) {
      var drag = zoomDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      var next = dialogZoomFromDrag(
        drag.startZoom,
        e.clientX - drag.startX,
        e.clientY - drag.startY,
        drag.designW,
        drag.designH,
      );
      next = clampDialogZoom(next, drag.designW, drag.designH, window.innerWidth, window.innerHeight);
      drag.zoom = next;
      setDialogZoom(next);
    }

    function endZoomDrag(e) {
      var drag = zoomDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      endZoomDragCleanup();
      persistDialogZoom(drag.zoom);
    }

    // Double-click the grip: snap back to the default zoom and forget the
    // stored value (a fresh install and a reset install behave the same).
    function resetDialogZoom() {
      endZoomDragCleanup();
      setDialogZoom(DIALOG_ZOOM_DEFAULT);
      persistDialogZoom(null);
    }

    // The walk owns the dialog for about a second; anything that changes the
    // surface underneath cancels it so no stale walk class lands on the next
    // panel and no queued swap fires late.
    function clearGrottoWalk() {
      if (grottoWalkTimerRef.current) clearTimeout(grottoWalkTimerRef.current);
      grottoWalkTimerRef.current = null;
      setGrottoTransit(null);
    }

    // Walk Kandy off the current scene, swap the panel while it is gone, then
    // walk it back in on the other side. Asleep or still an egg, Kandy stays
    // stationary — the panel just swaps, same as reduced motion.
    function walkBetweenScenes(departPhase, arrivePhase, swap) {
      clearGrottoWalk();
      if (prefersReducedMotion() || kandyStationary) {
        swap();
        return;
      }
      setGrottoTransit(departPhase);
      grottoWalkTimerRef.current = setTimeout(function () {
        grottoWalkTimerRef.current = null;
        if (!mountedRef.current) return;
        swap();
        setGrottoTransit(arrivePhase);
        grottoWalkTimerRef.current = setTimeout(function () {
          grottoWalkTimerRef.current = null;
          if (mountedRef.current) setGrottoTransit(null);
        }, GROTTO_WALK_IN_MS);
      }, GROTTO_WALK_OUT_MS);
    }

    function openPhotoBooth() {
      clearGrottoWalk();
      setGrottoView(null);
      setGrottoRevealKey(null);
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

    function openTokenGrotto() {
      clearPreparedPhoto();
      setPhotoStatus("idle");
      setPhotoOpen(false);
      returnToGrottoEntryRef.current = true;
      setGrottoRevealKey(null);
      // The dialog opens first so Kandy has a surface to walk off of. There is
      // no passage involved on the way down, so no side is remembered.
      setDialogOpen(true);
      setGrottoSide(null);
      walkBetweenScenes("depart-surface", "arrive-hub", function () {
        setGrottoView("hub");
      });
    }

    function openTokenRoom(agentType, side) {
      setGrottoRevealKey(null);
      // The room may move between the visible and overflow placements while
      // it is open; keep its identity and resolve the actual focus target when
      // the hub is rendered again.
      returnToGrottoDoorRef.current = agentType;
      setGrottoSide(side || "right");
      walkBetweenScenes("depart-hub", "arrive-room", function () {
        setGrottoView(agentType);
      });
    }

    function backToTokenHub() {
      setGrottoRevealKey(null);
      walkBetweenScenes("depart-room", "arrive-hub", function () {
        setGrottoView("hub");
      });
    }

    function backFromTokenGrotto() {
      setGrottoRevealKey(null);
      returnToGrottoDoorRef.current = null;
      if (resolvedGrottoView === "hub") {
        // Leaving from the hub means leaving by the entrance, so drop the
        // remembered passage first and let Kandy climb out the way it came in.
        setGrottoSide(null);
        walkBetweenScenes("depart-hub", "arrive-surface", function () {
          setGrottoView(null);
          setGrottoSide(null);
        });
        return;
      }
      // Leaving from a chamber routes back through the hub's cave mouth
      // rather than side-walking straight to the surface: Kandy walks out
      // the chamber door, the hub flashes past with Kandy already climbing
      // out the mouth it came in by, and it surfaces beside the cave opening.
      // This is its own three-step walk (not walkBetweenScenes) because the
      // hub is only a transit scene here — Kandy walks straight out of it
      // without an arrive-hub settle that would leave it standing down on
      // the shore and force a teleport back up to the cave mouth to depart.
      clearGrottoWalk();
      if (prefersReducedMotion() || kandyStationary) {
        setGrottoView(null);
        setGrottoSide(null);
        return;
      }
      setGrottoTransit("depart-room");
      grottoWalkTimerRef.current = setTimeout(function () {
        if (!mountedRef.current) {
          grottoWalkTimerRef.current = null;
          return;
        }
        setGrottoView("hub");
        setGrottoSide(null);
        setGrottoTransit("depart-hub");
        grottoWalkTimerRef.current = setTimeout(function () {
          if (!mountedRef.current) {
            grottoWalkTimerRef.current = null;
            return;
          }
          setGrottoView(null);
          setGrottoSide(null);
          setGrottoTransit("arrive-surface");
          grottoWalkTimerRef.current = setTimeout(function () {
            grottoWalkTimerRef.current = null;
            if (mountedRef.current) setGrottoTransit(null);
          }, GROTTO_WALK_IN_MS);
        }, GROTTO_WALK_OUT_MS);
      }, GROTTO_WALK_OUT_MS);
    }

    function toggleGrottoCount(key) {
      setGrottoRevealKey(grottoRevealKey === key ? null : key);
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
        clearGrottoWalk();
        returnToPhotoEntryRef.current = false;
        clearPreparedPhoto();
        setPhotoOpen(false);
        setPhotoStatus("idle");
        returnToGrottoEntryRef.current = false;
        returnToGrottoDoorRef.current = null;
        setGrottoRevealKey(null);
        setGrottoView(null);
      }
    }

    React.useEffect(function () {
      mountedRef.current = true;
      load();
      // Arrival greeting: check the presence gap BEFORE stamping, then
      // keep the last-seen stamp fresh (~1min) while mounted.
      arrivalPendingRef.current = arrivalDue(readLastSeen(), Date.now());
      writeLastSeen(Date.now());
      var interval = setInterval(load, REFRESH_MS);
      // Clock tick: dusk (and bedtime) arrive without a refetch; the same
      // tick stamps presence and evaluates the speech-bubble opportunity.
      var timeTick = setInterval(function () {
        setTimeOfDay(localHour());
        writeLastSeen(Date.now());
        maybeTickSpeech();
      }, TIME_TICK_MS);
      // Motion clock (v0.8.0): wander + cry gates every 5s.
      var motionTimer = setInterval(motionTick, MOTION_TICK_MS);
      refreshListeners.push(load);
      return function () {
        mountedRef.current = false;
        clearInterval(interval);
        clearInterval(timeTick);
        clearInterval(motionTimer);
        stopWanderFrames();
        if (cryEndTimerRef.current) clearTimeout(cryEndTimerRef.current);
        if (chainTimerRef.current) clearTimeout(chainTimerRef.current);
        if (lookTimerRef.current) clearTimeout(lookTimerRef.current);
        if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
        if (petTimerRef.current) clearTimeout(petTimerRef.current);
        if (bonkTimerRef.current) clearTimeout(bonkTimerRef.current);
        if (distrustTimerRef.current) clearTimeout(distrustTimerRef.current);
        if (sleepyTimerRef.current) clearTimeout(sleepyTimerRef.current);
        if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
        if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
        if (grottoWalkTimerRef.current) clearTimeout(grottoWalkTimerRef.current);
        clearHoldTimers(holdRef.current);
        holdRef.current = null;
        if (holdClearTimerRef.current) clearTimeout(holdClearTimerRef.current);
        endZoomDragCleanup();
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

    var tokenGrottoModel = tokenGrottoModelFor(data || EGG_PLACEHOLDER);
    var resolvedGrottoView = tokenGrottoResolvedView(tokenGrottoModel, grottoView);
    // The dialog card walks; the hover card never does.
    var cardWalk = grottoTransitClass(grottoTransit, "card");
    var dialogMotion = cardWalk ? Object.assign({}, motionState, { facing: 1, transit: cardWalk }) : motionState;

    // The underground Kandy travels wearing its own gait. Which scene it is
    // standing in decides which leg of the trip applies to it. Asleep or still
    // an egg, it stays outside — the grotto is still open to visit, just
    // without Kandy there to greet them.
    function grottoCreature(surface) {
      if (kandyStationary) return null;
      var creature = creatureSvg(h, shown, 64);
      var walk = grottoTransitClass(grottoTransit, surface, grottoSide);
      if (!walk) return creature;
      return h("div", { className: walk }, h("div", { className: gaitFor(shown.archetype || 0).cls }, creature));
    }

    React.useEffect(
      function () {
        if (resolvedGrottoView === "hub" && returnToGrottoDoorRef.current) {
          var focusKey = hubDoorFocusKey(tokenGrottoModel.rooms, returnToGrottoDoorRef.current);
          returnToGrottoDoorRef.current = null;
          var restoredDoor = focusKey ? focusGrottoDoor(grottoPanelRef.current, focusKey) : false;
          if (restoredDoor) {
            return;
          }
        }
        if (grottoView && grottoPanelRef.current && grottoPanelRef.current.focus) {
          grottoPanelRef.current.focus();
          return;
        }
        if (!grottoView && returnToGrottoEntryRef.current) {
          returnToGrottoEntryRef.current = false;
          if (grottoEntryRef.current && grottoEntryRef.current.focus) grottoEntryRef.current.focus();
        }
      },
      [resolvedGrottoView],
    );

    var shown = data || EGG_PLACEHOLDER;
    // While celebrating, the FACE is joyful regardless of prior mood — it
    // just got fed. face_mood only: the mood badge keeps showing the
    // server's truth, so the badge text never blinks Elated→Happy on every
    // award (which read as flip-flopping when a bonk mood-dent was active).
    if (celebration) shown = Object.assign({}, shown, { face_mood: "elated" });
    // The chip portrait sleeps too: closed eyes on the static icon while
    // the seeded schedule says it's bedtime (celebrations still play their
    // chip hop over it — no special-casing). The same schedule gates the
    // grotto: Kandy doesn't wake up to walk a visitor down there.
    var kandyAsleep = shown.level > 1 && isAsleep((shown.lineage_seed || 1) >>> 0, timeOfDay);
    var kandyStationary = kandyStationaryFor(kandyAsleep, shown.level);
    var chipShown = shown;
    var chipAsleep = kandyAsleep;
    if (chipAsleep) chipShown = Object.assign({}, shown, { sleep_state: "asleep" });

    // The chip is a real button: hover/focus gives the desktop quick-peek
    // tooltip, tap/click opens the same card as a dialog (touch devices
    // have no hover, so the dialog is the mobile path).
    var chipCelebrateCls = "";
    if (celebration) {
      chipCelebrateCls =
        bigCelebration(celebration) ? " kandev-kandy-levelup" : " kandev-kandy-celebrate";
    } else if (greetFx) {
      // The chip does its existing small hop alongside the arrival wave.
      chipCelebrateCls = " kandev-kandy-celebrate";
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
          // The dialog always greets on open (arrival gets the hop too).
          greetOnOpen();
        },
      },
      creatureSvg(h, chipShown, 22, "", true),
    );

    // Shared interaction wiring for BOTH card surfaces (hover preview and
    // click dialog): treat on click, bucket on right-click, plus the fx
    // state each reaction animates through.
    var careProps = {
      fx: petFx,
      onPet: function () {
        // A completed hold-bonk (or a hesitation release) already claimed
        // this gesture — swallow the synthetic click so it can't pet.
        if (Date.now() < suppressClickRef.current) {
          suppressClickRef.current = 0;
          return;
        }
        triggerPet();
      },
      bonkFx: bonkFx,
      distrustFx: distrustFx,
      sleepyFx: sleepyFx,
      holdFx: holdFx,
      greetFx: greetFx,
      onBonk: triggerBonk,
      onPointerDown: function (e) {
        pointerTypeRef.current = (e && e.pointerType) || "mouse";
        // Coarse pointers start the hold-to-bonk; mouse never does.
        if (pointerTypeRef.current === "touch" || pointerTypeRef.current === "pen") {
          startHold(e);
        }
      },
      onPointerUp: function (e) {
        endHold(e, false);
      },
      onPointerCancel: function (e) {
        endHold(e, true);
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
          kandyCard(h, shown, celebration, careProps, timeOfDay, currentSeason(), speech, motionState),
        ),
      ),
      h(
        Dialog,
        { open: dialogOpen, onOpenChange: changeDialogOpen },
        h(
          DialogContent,
          {
            id: "kandev-kandy-dialog",
            // sm:max-w-none matters: the host DialogContent base carries
            // sm:max-w-lg (512px), and a bare max-w-none only replaces the
            // unprefixed tier — without it the card visually clips past
            // zoom ~2.06 and the corner grip lands on the overlay
            // (dismissing the dialog on the next drag).
            className: "w-auto max-w-none sm:max-w-none p-0 gap-0 overflow-hidden rounded-2xl",
            style: photoOpen ? { maxWidth: "420px" } : resolvedGrottoView ? { width: "min(680px, calc(100vw - 32px))" } : undefined,
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
            : resolvedGrottoView
              ? resolvedGrottoView === "hub"
                ? tokenGrottoHub(
                    h,
                    DialogTitle,
                    tokenGrottoModel,
                    grottoCreature("hub"),
                    grottoPanelRef,
                    openTokenRoom,
                    backFromTokenGrotto,
                    backFromTokenGrotto,
                    grottoOutsideFor(
                      shown.biome || 0,
                      shown.level,
                      (shown.lineage_seed || 1) >>> 0,
                      timeOfDay,
                      currentSeason(),
                    ),
                    grottoRevealKey,
                    toggleGrottoCount,
                  )
                : tokenGrottoRoom(
                    h,
                    DialogTitle,
                    tokenGrottoModel,
                    resolvedGrottoView,
                    grottoRevealKey,
                    grottoPanelRef,
                    backToTokenHub,
                    backFromTokenGrotto,
                    toggleGrottoCount,
                    grottoCreature("room"),
                    grottoRoomSide(grottoSide),
                    (shown.lineage_seed || 1) >>> 0,
                  )
              : h(
                React.Fragment,
                null,
                h(DialogTitle, { className: "sr-only" }, "Kandy"),
                h(
                  "div",
                  {
                    className: "kandev-kandy-dialogframe",
                    ref: dialogFrameRef,
                    // Frame width tracks the zoomed design width so the
                    // w-auto DialogContent hugs the card at any zoom (the
                    // ≤480px media query overrides both with !important).
                    style: { width: DIALOG_CARD_DESIGN_W * dialogZoom + "px" },
                  },
                  h(
                    "div",
                    { className: "kandev-kandy-dialogzoom", style: { zoom: dialogZoom } },
                    kandyCard(h, shown, celebration, careProps, timeOfDay, currentSeason(), speech, dialogMotion),
                  ),
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
                  h(
                    "div",
                    {
                      style: {
                        position: "absolute",
                        top: "8px",
                        left: "8px",
                        zIndex: 3,
                      },
                    },
                    tokenGrottoButton(h, openTokenGrotto, grottoEntryRef),
                  ),
                  // The resize grip lives OUTSIDE the zoomed wrapper (its
                  // 16px hit area never scales) but inside the relative
                  // frame, pinned to the dialog's bottom-right corner.
                  h(
                    "button",
                    {
                      id: "kandev-kandy-resize-grip",
                      type: "button",
                      "aria-label": "Resize",
                      className: "kandev-kandy-resizegrip",
                      onPointerDown: startZoomDrag,
                      onPointerMove: moveZoomDrag,
                      onPointerUp: endZoomDrag,
                      onPointerCancel: endZoomDrag,
                      onDoubleClick: resetDialogZoom,
                    },
                    h(
                      "svg",
                      { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": "true" },
                      h("path", {
                        d: "M9 3 L3 9 M9 6.5 L6.5 9",
                        stroke: "currentColor",
                        strokeWidth: 1.3,
                        strokeLinecap: "round",
                        fill: "none",
                      }),
                    ),
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
    injectStyles: injectStyles,
    gazeAmpFor: gazeAmpFor,
    creatureSvg: creatureSvg,
    creatureParts: creatureParts,
    sceneFor: sceneFor,
    ancestorFigures: ancestorFigures,
    ancestorSpots: ANCESTOR_SPOTS,
    generationSummary: generationSummary,
    generationValue: generationValue,
    rememberedProgress: rememberedProgress,
    bigCelebration: bigCelebration,
    romanNumeral: romanNumeral,
    photoAncestorsFor: photoAncestorsFor,
    growthForLevel: growthForLevel,
    kandyCard: kandyCard,
    petOverlay: petOverlay,
    bonkOverlay: bonkOverlay,
    distrustOverlay: distrustOverlay,
    sleepyPetOverlay: sleepyPetOverlay,
    holdTipOverlay: holdTipOverlay,
    careHintText: careHintText,
    kandyHelp: kandyHelp,
    bonkContactFor: bonkContactFor,
    // Wander + cry (v0.8.0)
    wanderGate: wanderGate,
    cryGate: cryGate,
    wanderLimitFor: wanderLimitFor,
    wanderTargetFor: wanderTargetFor,
    wanderLegFor: wanderLegFor,
    wanderXAt: wanderXAt,
    gaitFor: gaitFor,
    motionDecide: motionDecide,
    eyeAnchorsFor: eyeAnchorsFor,
    cryOverlay: cryOverlay,
    motionTuning: {
      WANDER_MAX_PX: WANDER_MAX_PX,
      WANDER_MIN_DIST_PX: WANDER_MIN_DIST_PX,
      WANDER_SPEED_PX_S: WANDER_SPEED_PX_S,
      WANDER_BUCKET_MS: WANDER_BUCKET_MS,
      WANDER_FRAME_MS: WANDER_FRAME_MS,
      CRY_BUCKET_MS: CRY_BUCKET_MS,
      CRY_BOUT_MS: CRY_BOUT_MS,
      MOTION_TICK_MS: MOTION_TICK_MS,
      COG_STEP_PX: COG_STEP_PX,
    },
    dayPhaseFor: dayPhaseFor,
    sleepScheduleFor: sleepScheduleFor,
    isAsleep: isAsleep,
    kandyStationaryFor: kandyStationaryFor,
    seasonForMonth: seasonForMonth,
    seasonOverlayFor: seasonOverlayFor,
    speechLines: SPEECH,
    speechGate: speechGate,
    speechContextsFor: speechContextsFor,
    speechPoolFor: speechPoolFor,
    speechBagOrder: speechBagOrder,
    speechBagExtras: speechBagExtras,
    speechBagLineAt: speechBagLineAt,
    speechSliceSeed: speechSliceSeed,
    takeSpeechBagPos: takeSpeechBagPos,
    pickSpeech: pickSpeech,
    speechBubble: speechBubble,
    readLastBubble: readLastBubble,
    writeLastBubble: writeLastBubble,
    bubbleCooldownReady: bubbleCooldownReady,
    openGreetingAllowed: openGreetingAllowed,
    greetArcsOverlay: greetArcsOverlay,
    readLastSeen: readLastSeen,
    writeLastSeen: writeLastSeen,
    arrivalDue: arrivalDue,
    clampDialogZoom: clampDialogZoom,
    dialogZoomFromDrag: dialogZoomFromDrag,
    storedDialogZoom: storedDialogZoom,
    persistDialogZoom: persistDialogZoom,
    photoModelFor: photoModelFor,
    tokenGrottoModelFor: tokenGrottoModelFor,
    tokenCountBigInt: tokenCountBigInt,
    formatTokenExact: formatTokenExact,
    formatTokenCompact: formatTokenCompact,
    tokenPileScale: tokenPileScale,
    tokenGrottoVisiblePileName: tokenGrottoVisiblePileName,
    tokenGrottoPileLabelTransform: tokenGrottoPileLabelTransform,
    hoardTierFor: hoardTierFor,
    hoardStyleFor: hoardStyleFor,
    hoardTiers: HOARD_TIERS,
    hoardStyles: HOARD_STYLES,
    tokenPilePlacement: tokenPilePlacement,
    chamberPileSpots: CHAMBER_PILE_SPOTS,
    hubDoorPlacement: hubDoorPlacement,
    hubDoorFocusKey: hubDoorFocusKey,
    hubDoorCap: HUB_DOOR_CAP,
    tokenGrottoHub: tokenGrottoHub,
    tokenGrottoRoom: tokenGrottoRoom,
    tokenGrottoResolvedView: tokenGrottoResolvedView,
    grottoBackdrop: grottoBackdrop,
    grottoOutsideFor: grottoOutsideFor,
    skyWashFor: skyWashFor,
    chamberBackdrop: chamberBackdrop,
    grottoTransitClass: grottoTransitClass,
    grottoRoomSide: grottoRoomSide,
    focusGrottoDoor: focusGrottoDoor,
    photoExportPlan: photoExportPlan,
    photoPaletteFor: photoPaletteFor,
    photoPortraitSvg: photoPortraitSvg,
    photoBoothButton: photoBoothButton,
    tokenGrottoButton: tokenGrottoButton,
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
