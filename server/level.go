// level.go — the kandy's growth math and procedural presentation.
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
	// Retuned when the task-completion XP factor was removed (it was
	// abusable: creating and archiving a task is free). Only agent
	// activity feeds XP now — at the measured pace that's ~1,600 XP per
	// active day (~129 turns x8 + ~260 messages x1 + agent completions),
	// 18 active days/30. K scaled by the rate ratio (9174 x 1600/2860 ≈
	// 5100) so the level timeline is unchanged: day one ends ~Lv6, month
	// one ~Lv36, year one ~Lv80, level 100 at ~2.8 years, and an early
	// level still costs roughly a solid session of agent work.
	levelK = 5100.0
	levelB = 1.0545

	// bandMax is the last level of the designed dull->awesome arc, and the
	// creature's resting place: a kandy that reaches 100 STAYS there, in its
	// final form, for a full level's worth of XP (~53k, about a month at the
	// measured pace). Two and a half years of growth deserve to be looked at.
	bandMax = 100

	// ascendLevel is the level no kandy ever occupies. The award that would
	// carry it past the band closes the arc instead: the creature retires
	// into the scene background as an ancestor and a fresh egg with new DNA
	// takes its place (see applyRebirth). Levels beyond bandMax are therefore
	// unreachable in normal play; the mythic-ladder naming below stays as the
	// fallback for a ledger that somehow carries more XP than one band.
	ascendLevel = bandMax + 1

	numArchetypes = 10 // body silhouettes (per-lineage identity)
	numFamilies   = 12 // palette families (per-lineage identity)
	numBiomes     = 4  // scene biome families (per-lineage identity)
)

// Metamorphosis milestones: the same creature matures — bigger, better
// proportioned — while carrying its palette and signature parts forward.
const (
	stageEgg      = 0 // level 1
	stageHatch    = 1 // levels 2..11
	stageJuvenile = 2 // levels 12..29
	stageAdult    = 3 // levels 30..54
	stageMajestic = 4 // levels 55..79
	stageMythic   = 5 // levels 80+
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
// seededIndex mixes with murmur3's fmix32 finalizer. The multiplications
// make it non-linear over GF(2) — a pure-xorshift mixer is linear, so the
// XOR-difference between two seeds propagates identically through every
// stream, and salts that collided on one DNA pick (archetype) tended to
// collide on the others (palette, biome) too.
func seededIndex(seed, stream uint32, n int) int {
	if n <= 0 {
		return 0
	}
	x := seed + stream*0x9e3779b9
	x ^= x >> 16
	x *= 0x85ebca6b
	x ^= x >> 13
	x *= 0xc2b2ae35
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
	case level < 12:
		return stageHatch
	case level < 30:
		return stageJuvenile
	case level < 55:
		return stageAdult
	case level < 80:
		return stageMajestic
	default:
		return stageMythic
	}
}

// growthUnlocks lists, per additive element, the levels at which it appears
// or upgrades — spread over the 1..100 band. Together with the stage
// boundaries (2/12/30/55/80), the flags below, and the saturation ramp
// (levels 2..50), the richness score gains at least every 2 levels across
// the whole band (verified by the monotonic-awesomeness test).
var growthUnlocks = map[string][]int{
	"markings":   {4, 9, 17, 23, 27, 34, 43, 53, 62, 72, 83, 93},
	"sparkles":   {40, 47, 52, 59, 67, 75, 81, 88, 95, 98},
	"tail":       {6, 20, 35, 57},
	"horns":      {8, 26, 42, 66},
	"wings":      {45, 54, 63, 86},
	"aura":       {60, 69, 77},
	"companions": {28, 49, 74},
	"crown":      {25, 82},
	"orbitstars": {64, 79, 90},
}

// growthFlags are one-shot unlocks (level at which the element appears).
// starDiadem / lightPillars / constellation are the 85+ top-shelf prestige
// pieces — endgame gear nobody sees in the lower band.
var growthFlags = map[string]int{
	"mouth":         3,
	"blush":         5,
	"tufts":         7,
	"held":          15,
	"flag":          22,
	"glow":          32,
	"gem":           38,
	"halo":          50,
	"rays":          70,
	"stardiadem":    85,
	"lightpillars":  91,
	"constellation": 97,
	"burst":         bandMax,
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
		score += minInt(level, 50)
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

// Band boundaries spread across the 1..100 arc.
var epithetBandStarts = []int{2, 15, 35, 55, 80}

func epithetBand(level int) int {
	band := 0
	for i, start := range epithetBandStarts {
		if level >= start {
			band = i
		}
	}
	return band
}

// epithetFor picks the level's epithet with deterministic adjacent-level
// collision avoidance: within a band, a level that would repeat the
// previous level's word skips to the next one. Computed by walking from
// the band's first level so the whole chain stays deterministic.
func epithetFor(salt uint32, level int) string {
	band := epithetBand(level)
	words := epithetBands[band]
	prev := ""
	cur := ""
	for l := epithetBandStarts[band]; l <= level; l++ {
		idx := seededIndex(appearanceSeed(salt, l), 1, len(words))
		cur = words[idx]
		if cur == prev {
			cur = words[(idx+1)%len(words)]
		}
		prev = cur
	}
	return cur
}

var mythicLadder = []string{"Cosmic", "Elder", "Mythic", "Eternal", "Transcendent"}

// stageName: level 1 is the egg; band levels are "<epithet> <species>" with
// the epithet band rising; past the band the mythic prefix ladder plus a
// roman generation numeral every 50 levels keeps names moving forever.
func stageName(salt uint32, level int) string {
	if level <= 1 {
		return "Egg"
	}
	epithet := epithetFor(salt, level)
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

// generationLabel names the lineage's current generation. The first
// generation is nameless — a kandy only becomes "Gen II" once there is an
// elder standing behind it.
func generationLabel(generation int) string {
	if generation <= 1 {
		return ""
	}
	return "Gen " + romanNumeral(generation)
}

// eggFlavor is the status line for an egg. The first egg of a lineage is
// alone; every later one is watched by the elders in the background.
func eggFlavor(generation int) string {
	if generation <= 1 {
		return "The egg is warm. Keep working."
	}
	return "A new egg. The elders watch from the treeline."
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

// ---------------------------------------------------------------------------
// Mood — derived at webhook time from how long ago the last XP award
// happened. Calendar-time on purpose (a kandy that missed you over a
// long break is the tamagotchi charm), but generous enough that normal
// work cadence — nights, weekends — never drops below content/bored.
// ---------------------------------------------------------------------------

type moodTier struct {
	name   string
	within time.Duration
}

var moodTiers = []moodTier{
	{"elated", 10 * time.Minute},
	{"happy", 8 * time.Hour},
	{"content", 48 * time.Hour},
	{"bored", 96 * time.Hour},
	{"sad", 168 * time.Hour},
}

const moodGloomy = "gloomy" // >= 168h

// moodFor maps time-since-last-award to a mood tier. Negative (unknown)
// durations count as "just now" — never as ancient.
func moodFor(sinceAward time.Duration) string {
	if sinceAward < 0 {
		sinceAward = 0
	}
	for _, tier := range moodTiers {
		if sinceAward < tier.within {
			return tier.name
		}
	}
	return moodGloomy
}

// petLiftWindow is how long a petting lifts the displayed mood.
const petLiftWindow = 60 * time.Minute

// moodOrder ranks moods best-to-worst for the pet lift.
var moodOrder = []string{"elated", "happy", "content", "bored", "sad", moodGloomy}

// liftMood raises a mood one tier, capped at "happy": petting can never
// fake "elated" (only real shipped work does that), and a gloomy kandy
// petted becomes merely sad. Presentational only — the base mood still
// derives from last_award_at.
func liftMood(mood string) string {
	for i, name := range moodOrder {
		if name == mood {
			if i <= 1 {
				return mood // elated stays elated; happy stays happy
			}
			return moodOrder[i-1]
		}
	}
	return mood
}

var idleFlavor = []string{
	"Your kandy hums a tiny tune.",
	"Something stirs beneath the surface.",
	"Your kandy seems pleased with itself.",
	"It is dreaming of far-off places.",
	"Your kandy wiggles contentedly.",
	"It watches the cursor with great interest.",
	"Your kandy is thinking very hard about nothing.",
	"A faint glow. Probably fine.",
}

// flavorText picks the cryptic status line for a mood. Content moods fall
// back to the seeded idle lines; nothing here ever itemizes XP sources.
func flavorText(salt uint32, level int, mood string) string {
	if level <= 1 {
		return "The egg is warm. Keep working."
	}
	switch mood {
	case "elated":
		return "Your kandy is thrilled!"
	case "happy":
		return "Your kandy looks energized."
	case "bored":
		return "Your kandy is getting restless."
	case "sad":
		return "Your kandy misses you — ship something."
	case moodGloomy:
		return "Your kandy sits in the rain, waiting for a ship."
	default:
		seed := appearanceSeed(salt, level)
		return idleFlavor[seededIndex(seed, 2, len(idleFlavor))]
	}
}
