// level.go — the gotchi's growth math and procedural presentation
// (stage names, flavor text, appearance seeds). Everything here is pure and
// deterministic so the same lifetime XP always presents the same creature.
//
// The XP -> level curve is logarithmic and unbounded:
//
//	threshold(L) = K * (B^(L-1) - 1)   // lifetime XP needed to reach level L
//	level(xp)    = floor(log(1+xp/K) / log(B)) + 1
//
// Early levels come fast (level 2 at 150 XP) and each next level costs ~1.75x
// more than the last, forever — float64 logs stay finite and monotonic for
// any reachable XP, so there is no final form.
package main

import (
	"fmt"
	"hash/fnv"
	"math"
	"time"
)

const (
	levelK = 200.0
	levelB = 1.75

	// levelsPerTier groups levels into visual "eras": each tier swaps the
	// scene background and palette family in the UI.
	levelsPerTier = 5
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

// tierForLevel groups levels into visual eras (0-based).
func tierForLevel(level int) int {
	if level < 1 {
		level = 1
	}
	return (level - 1) / levelsPerTier
}

// appearanceSeed derives the deterministic per-level look seed from the
// instance's lifetime salt. It changes on every evolution but never between
// renders of the same level.
func appearanceSeed(salt uint32, level int) uint32 {
	h := fnv.New32a()
	fmt.Fprintf(h, "%d:%d", salt, level)
	return h.Sum32()
}

// seededIndex picks a deterministic index in [0, n) from a seed and a
// stream discriminator (so different word lists don't correlate).
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

// Species by tier: the creature's "family" evolves every tier. Past the
// handcrafted list the ladder of mythic prefixes keeps producing new stage
// families indefinitely.
var speciesByTier = []string{
	"Blip",       // tier 0 — meadow
	"Sproutling", // tier 1 — forest
	"Riplet",     // tier 2 — lake
	"Cragling",   // tier 3 — mountain
	"Streetling", // tier 4 — city dusk
	"Neonite",    // tier 5 — neon night
	"Auroran",    // tier 6 — aurora
	"Starbeast",  // tier 7 — deep space
}

var mythicLadder = []string{"Cosmic", "Elder", "Mythic", "Eternal", "Transcendent"}

var stageAdjectives = []string{
	"Wobbly", "Curious", "Mossy", "Sparky", "Dozy", "Zippy", "Plucky",
	"Shiny", "Grumbly", "Bouncy", "Misty", "Ember", "Frosty", "Sunny",
	"Peppy", "Snazzy", "Velvet", "Twinkly", "Rumbly", "Breezy", "Gilded",
	"Lunar", "Prismatic", "Radiant",
}

// stageName builds the procedural stage label for a level. Level 1 is
// always the egg; later levels are "<seeded adjective> <tier species>",
// with an unbounded mythic prefix ladder past the handcrafted tiers.
func stageName(salt uint32, level int) string {
	if level <= 1 {
		return "Egg"
	}
	seed := appearanceSeed(salt, level)
	adjective := stageAdjectives[seededIndex(seed, 1, len(stageAdjectives))]
	tier := tierForLevel(level)
	if tier < len(speciesByTier) {
		return adjective + " " + speciesByTier[tier]
	}
	overflow := tier - len(speciesByTier)
	prefix := mythicLadder[overflow%len(mythicLadder)]
	generation := overflow/len(mythicLadder) + 2 // "Cosmic Starbeast", then "... II"
	if overflow < len(mythicLadder) {
		return prefix + " " + adjective + " Starbeast"
	}
	return fmt.Sprintf("%s %s Starbeast %s", prefix, adjective, romanNumeral(generation))
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
