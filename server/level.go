// level.go — the gotchi's growth math and procedural presentation.
// Everything here is pure and deterministic.
//
// v0.3.0 model — DNA vs growth:
//
//   - The lifetime salt is the creature's DNA: it fixes WHO the creature is
//     for its whole life — one body archetype (species), one palette
//     family, one scene biome, and per-lineage style picks (via
//     lineageSeed). Two installs at the same level look clearly different.
//   - The level only decides how GROWN and how AWESOME that same creature
//     is: every level in the designed band adds or upgrades exactly one
//     visible element (growthUnlocks below), and a few metamorphosis
//     milestones mature the body within the same archetype. Richness is
//     strictly increasing — dull hatchling to epic Lv40 payoff.
//
// The XP -> level curve is logarithmic and unbounded:
//
//	threshold(L) = K * (B^(L-1) - 1)   // lifetime XP needed to reach level L
//	level(xp)    = floor(log(1+xp/K) / log(B)) + 1
//
// K=400, B=1.32: level 2 lands inside the first day of light use; a solo
// dev's first year reaches ~level 24, a heavy multi-agent user's ~level 32.
package main

import (
	"fmt"
	"hash/fnv"
	"math"
	"time"
)

const (
	levelK = 400.0
	levelB = 1.32

	// bandMax is the last level of the designed dull->awesome arc; beyond
	// it the infinite prestige ladder (names, celestial scenes) continues.
	bandMax = 40

	numArchetypes = 10 // body silhouettes (per-lineage identity)
	numFamilies   = 12 // palette families (per-lineage identity)
	numBiomes     = 4  // scene biome families (per-lineage identity)
)

// Metamorphosis milestones: the same creature matures — bigger, better
// proportioned — while carrying its palette and signature parts forward.
const (
	stageEgg      = 0 // level 1
	stageHatch    = 1 // levels 2..7
	stageJuvenile = 2 // levels 8..17
	stageAdult    = 3 // levels 18..29
	stageMajestic = 4 // levels 30+
)

// thresholdXP returns the lifetime XP needed to reach the given level.
// Level 1 (and anything below) is 0.
func thresholdXP(level int) float64 {
	if level <= 1 {
		return 0
	}
	return levelK * (math.Pow(levelB, float64(level-1)) - 1)
}

// levelForXP maps lifetime XP to a level, >= 1. Negative or non-finite
// input is treated as 0 XP.
func levelForXP(xp float64) int {
	if math.IsNaN(xp) || math.IsInf(xp, 0) || xp < 0 {
		xp = 0
	}
	level := int(math.Floor(math.Log(1+xp/levelK)/math.Log(levelB))) + 1
	if level < 1 {
		return 1
	}
	// Guard against float rounding at exact thresholds: floor(log) can land
	// one level low or high by an ulp, so settle by the threshold table.
	for thresholdXP(level+1) <= xp {
		level++
	}
	for level > 1 && thresholdXP(level) > xp {
		level--
	}
	return level
}

// progressPct returns the position between the current and next level
// thresholds, always in [0, 100).
func progressPct(xp float64) float64 {
	if math.IsNaN(xp) || math.IsInf(xp, 0) || xp < 0 {
		xp = 0
	}
	level := levelForXP(xp)
	lo := thresholdXP(level)
	hi := thresholdXP(level + 1)
	if hi <= lo {
		return 0
	}
	pct := (xp - lo) / (hi - lo) * 100
	if pct < 0 {
		return 0
	}
	if pct >= 100 {
		// Can only happen through float rounding right at a threshold.
		return math.Nextafter(100, 0)
	}
	return pct
}

// roundDownToTenth truncates to one decimal, flooring so a value just under
// 100 can never round up to 100 (progress stays in [0, 100)).
func roundDownToTenth(x float64) float64 {
	return math.Floor(x*10) / 10
}

// seededIndex picks a deterministic index in [0, n) from a seed and a
// stream discriminator (so different picks don't correlate).
func seededIndex(seed, stream uint32, n int) int {
	if n <= 0 {
		return 0
	}
	x := seed ^ (stream * 0x9e3779b9)
	x ^= x << 13
	x ^= x >> 17
	x ^= x << 5
	x ^= x >> 16
	return int(x % uint32(n))
}

// ---------------------------------------------------------------------------
// Lineage DNA — all fixed for the whole lifetime, derived only from salt.
// ---------------------------------------------------------------------------

// archetypeForLineage picks the creature's species silhouette, once.
func archetypeForLineage(salt uint32) int {
	return seededIndex(salt, 21, numArchetypes)
}

// paletteFamilyForLineage picks the creature's color family, once.
func paletteFamilyForLineage(salt uint32) int {
	return seededIndex(salt, 22, numFamilies)
}

// biomeForLineage picks the scene biome family (verdant / aquatic / alpine
// / ember), once. The biome matures with level; it never randomly switches.
func biomeForLineage(salt uint32) int {
	return seededIndex(salt, 23, numBiomes)
}

// lineageSeed derives the stable per-install style seed the UI uses for
// lineage picks (eye/horn/tail/marking styles, part placement). Derived so
// the raw salt itself is never exposed.
func lineageSeed(salt uint32) uint32 {
	h := fnv.New32a()
	fmt.Fprintf(h, "lineage:%d", salt)
	return h.Sum32()
}

// appearanceSeed derives the per-level seed (used for the epithet pick and
// minor per-level scene shimmer). Changes on every evolution.
func appearanceSeed(salt uint32, level int) uint32 {
	h := fnv.New32a()
	fmt.Fprintf(h, "%d:%d", salt, level)
	return h.Sum32()
}

// ---------------------------------------------------------------------------
// Growth — a strictly additive unlock ladder. Every level in 2..bandMax
// adds or upgrades exactly one element (verified by the richness tests), so
// comparing Lv N and Lv N+1 always reads "it grew something new".
// The UI mirrors these thresholds in its renderer.
// ---------------------------------------------------------------------------

// stageForLevel returns the metamorphosis stage.
func stageForLevel(level int) int {
	switch {
	case level <= 1:
		return stageEgg
	case level < 8:
		return stageHatch
	case level < 18:
		return stageJuvenile
	case level < 30:
		return stageAdult
	default:
		return stageMajestic
	}
}

// growthUnlocks lists, per additive element, the levels at which it appears
// or upgrades. The union of all entries (plus the stage boundaries
// 2/8/18/30) covers every level 2..40 with no gaps.
var growthUnlocks = map[string][]int{
	"markings":   {4, 9, 14, 19, 26, 34},
	"sparkles":   {17, 24, 32, 37, 40},
	"tail":       {6, 12, 23},
	"horns":      {7, 16, 28},
	"wings":      {21, 27, 39},
	"aura":       {31, 36},
	"companions": {13, 22},
	"crown":      {15, 38},
}

// growthFlags are one-shot unlocks (level at which the element appears).
var growthFlags = map[string]int{
	"mouth":      3,
	"blush":      5,
	"held":       10,
	"tufts":      11,
	"flag":       20,
	"glow":       25,
	"gem":        29,
	"halo":       30,
	"orbitstars": 33,
	"rays":       35,
	"burst":      40,
}

func countUnlocked(levels []int, level int) int {
	n := 0
	for _, l := range levels {
		if level >= l {
			n++
		}
	}
	return n
}

// richnessScore is the awesomeness budget: part count + effect layers +
// saturation step + maturity. Strictly increasing across the band (every
// level unlocks something and saturation ramps), non-decreasing forever.
func richnessScore(level int) int {
	if level < 1 {
		level = 1
	}
	score := stageForLevel(level) * 2
	for _, levels := range growthUnlocks {
		score += countUnlocked(levels, level)
	}
	for _, at := range growthFlags {
		if level >= at {
			score++
		}
	}
	// Saturation/detail ramp: colors desaturate at hatch and grow vivid.
	if level > 1 {
		score += minInt(level, 25)
	}
	return score
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ---------------------------------------------------------------------------
// Names — species fixed per lineage (tracks the archetype); the epithet
// ladder grows grander with level, telling the dull->awesome story.
// ---------------------------------------------------------------------------

// speciesByArchetype names the creature family after its silhouette.
// Indexes mirror the UI's body builders.
var speciesByArchetype = []string{
	"Blip",      // 0 round blob
	"Willow",    // 1 tall / lanky
	"Chonk",     // 2 squat / wide
	"Noodle",    // 3 serpentine
	"Sporeling", // 4 mushroom-capped
	"Wisp",      // 5 ghost / floaty
	"Shardling", // 6 crystalline / angular
	"Cogling",   // 7 mech / boxy
	"Gazer",     // 8 multi-eyed alien
	"Flitter",   // 9 winged sprite
}

// epithetBands: humble words early, radiant words late.
var epithetBands = [][]string{
	{"Dusty", "Plain", "Timid", "Meek", "Scruffy", "Drowsy", "Pale", "Mousy"},
	{"Curious", "Chirpy", "Nimble", "Perky", "Sprightly", "Eager", "Lively", "Spry"},
	{"Vivid", "Gleaming", "Dashing", "Valiant", "Blazing", "Stalwart", "Noble", "Bright"},
	{"Grand", "Luminous", "Majestic", "Exalted", "Brilliant", "Regal", "Splendid", "Radiant"},
	{"Resplendent", "Sovereign", "Transcendent", "Celestial", "Astral", "Empyrean", "Eternal", "Supreme"},
}

func epithetBand(level int) int {
	switch {
	case level < 8:
		return 0
	case level < 15:
		return 1
	case level < 25:
		return 2
	case level < 33:
		return 3
	default:
		return 4
	}
}

var mythicLadder = []string{"Cosmic", "Elder", "Mythic", "Eternal", "Transcendent"}

// stageName: level 1 is the egg; band levels are "<epithet> <species>" with
// the epithet band rising; past the band the mythic prefix ladder plus a
// roman generation numeral every 50 levels keeps names moving forever.
func stageName(salt uint32, level int) string {
	if level <= 1 {
		return "Egg"
	}
	seed := appearanceSeed(salt, level)
	band := epithetBands[epithetBand(level)]
	epithet := band[seededIndex(seed, 1, len(band))]
	species := speciesByArchetype[archetypeForLineage(salt)]
	if level <= bandMax {
		return epithet + " " + species
	}
	overflow := level - bandMax - 1
	name := mythicLadder[(overflow/10)%len(mythicLadder)] + " " + epithet + " " + species
	if gen := overflow / 50; gen >= 1 {
		name += " " + romanNumeral(gen+1)
	}
	return name
}

// romanNumeral covers the generations any real instance could ever reach.
func romanNumeral(n int) string {
	values := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	symbols := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	if n <= 0 {
		return "I"
	}
	out := ""
	for i, v := range values {
		for n >= v {
			out += symbols[i]
			n -= v
		}
	}
	return out
}

var idleFlavor = []string{
	"Your gotchi hums a tiny tune.",
	"Something stirs beneath the surface.",
	"Your gotchi seems pleased with itself.",
	"It is dreaming of far-off places.",
	"Your gotchi wiggles contentedly.",
	"It watches the cursor with great interest.",
	"Your gotchi is thinking very hard about nothing.",
	"A faint glow. Probably fine.",
}

const (
	flavorEnergizedWithin = 15 * time.Minute
	flavorNapAfter        = 24 * time.Hour
)

// flavorText picks the cryptic status line. Recent activity and long idle
// override the seeded default; nothing here ever itemizes XP sources.
func flavorText(salt uint32, level int, sinceActivity time.Duration) string {
	if level <= 1 {
		return "The egg is warm. Keep working."
	}
	if sinceActivity >= 0 && sinceActivity < flavorEnergizedWithin {
		return "Your gotchi looks energized."
	}
	if sinceActivity >= flavorNapAfter {
		return "Your gotchi is napping quietly."
	}
	seed := appearanceSeed(salt, level)
	return idleFlavor[seededIndex(seed, 2, len(idleFlavor))]
}
