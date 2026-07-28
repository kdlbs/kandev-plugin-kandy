// level.go — the gotchi's growth math and procedural presentation (scene
// rotation, body archetypes, stage names, appearance seeds). Everything here
// is pure and deterministic from (salt, level), so the same lifetime XP
// always presents the same creature.
//
// The XP -> level curve is logarithmic and unbounded:
//
//	threshold(L) = K * (B^(L-1) - 1)   // lifetime XP needed to reach level L
//	level(xp)    = floor(log(1+xp/K) / log(B)) + 1
//
// v0.2.0 retune (K=400, B=1.32): level 2 lands inside the first day of
// light use (128 XP), a solo dev's first year reaches ~level 24, a heavy
// multi-agent user's ~level 32 — so the designed 1..40 "band" covers the
// game people actually play, and the infinite ladder continues beyond it.
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

	// bandMax is the last level of the designed band: every level in
	// 2..bandMax gets a distinct silhouette + palette + frequently-rotating
	// scene. Beyond it the infinite prestige ladder takes over.
	bandMax = 40

	numScenes     = 14 // handcrafted scene vocabulary in the UI
	numArchetypes = 10 // body silhouettes in the UI
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

// permOf returns a deterministic Fisher-Yates permutation of 0..n-1 from
// (salt, stream) — the per-instance evolution orders.
func permOf(salt, stream uint32, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	x := salt ^ (stream * 0x9e3779b9)
	if x == 0 {
		x = 0x2545f491
	}
	for i := n - 1; i > 0; i-- {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		j := int(x % uint32(i+1))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// sceneBlock groups band levels into alternating blocks of 2 and 3 levels
// starting at level 2 (2,3,2,3, ...), so the scene changes every 2-3 levels.
func sceneBlock(level int) int {
	q := (level - 2) / 5
	r := (level - 2) % 5
	b := 2 * q
	if r >= 2 {
		b++
	}
	return b
}

// tierForLevel returns the scene index for a level. Level 1 hatches in the
// meadow; band levels walk a salt-shuffled tour of the 14 handcrafted
// scenes in 2-3 level blocks (adjacent blocks always differ; at most two
// scenes repeat before level 40). Beyond the band the seeded-cosmos ladder
// advances every 5 levels, forever.
func tierForLevel(salt uint32, level int) int {
	if level <= 1 {
		return 0
	}
	if level > bandMax {
		return numScenes + (level-bandMax-1)/5
	}
	perm := scenePerm(salt)
	return perm[sceneBlock(level)%numScenes]
}

// scenePerm keeps meadow first (a beginning should feel like one) and
// shuffles the remaining 13 scenes per instance.
func scenePerm(salt uint32) []int {
	rest := permOf(salt, 3, numScenes-1)
	out := make([]int, 0, numScenes)
	out = append(out, 0)
	for _, v := range rest {
		out = append(out, v+1)
	}
	return out
}

// archetypeForLevel picks the body silhouette for a level (-1 = egg).
// It walks a salt-shuffled permutation of the 10 archetypes with a
// +1-per-cycle rotation, which guarantees consecutive levels always land on
// different permutation slots — i.e. back-to-back levels never share a
// silhouette, at any level, forever.
func archetypeForLevel(salt uint32, level int) int {
	if level <= 1 {
		return -1
	}
	perm := permOf(salt, 4, numArchetypes)
	i := level - 2
	return perm[(i+i/numArchetypes)%numArchetypes]
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

// speciesByArchetype names the creature family after its silhouette, so a
// serpentine level is never called a Blip. Indexes mirror the UI's body
// builders.
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

var mythicLadder = []string{"Cosmic", "Elder", "Mythic", "Eternal", "Transcendent"}

var stageAdjectives = []string{
	"Wobbly", "Curious", "Mossy", "Sparky", "Dozy", "Zippy", "Plucky",
	"Shiny", "Grumbly", "Bouncy", "Misty", "Ember", "Frosty", "Sunny",
	"Peppy", "Snazzy", "Velvet", "Twinkly", "Rumbly", "Breezy", "Gilded",
	"Lunar", "Prismatic", "Radiant",
}

// stageName builds the procedural stage label for a level. Level 1 is
// always the egg; band levels are "<seeded adjective> <archetype species>";
// past the band the mythic prefix ladder (new prefix every 10 levels, a
// roman generation numeral every 50) keeps names moving forever.
func stageName(salt uint32, level int) string {
	if level <= 1 {
		return "Egg"
	}
	seed := appearanceSeed(salt, level)
	adjective := stageAdjectives[seededIndex(seed, 1, len(stageAdjectives))]
	species := speciesByArchetype[archetypeForLevel(salt, level)]
	if level <= bandMax {
		return adjective + " " + species
	}
	overflow := level - bandMax - 1
	name := mythicLadder[(overflow/10)%len(mythicLadder)] + " " + adjective + " " + species
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
