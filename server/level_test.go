package main

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLevelForXP_BaseCases(t *testing.T) {
	require.Equal(t, 1, levelForXP(0))
	require.Equal(t, 1, levelForXP(-50), "negative XP clamps to the egg")
	require.Equal(t, 1, levelForXP(math.NaN()))
	require.Equal(t, 1, levelForXP(math.Inf(1)))
	require.Equal(t, 1, levelForXP(math.Inf(-1)))
}

func TestLevelForXP_TunedConstants(t *testing.T) {
	// K=5100, B=1.0545: level 2 at ~278 XP — a solid stretch of real agent
	// work (tens of turns), not something a couple of clicks can farm.
	require.Equal(t, 1, levelForXP(276))
	require.Equal(t, 2, levelForXP(280))
	require.Greater(t, thresholdXP(2), 10*xpAgentCompleted,
		"a handful of agent completions must not clear an early level")
}

// measuredMonthlyXP is the user's real production pace with the task factor
// removed: ~129 turns x8 + ~260 messages + agent completions per active day
// (~1,600 XP), 18 active days per 30 calendar days => ~28.8k XP/month.
const measuredMonthlyXP = 1600 * 18

func TestLevelForXP_MeasuredPaceTargets(t *testing.T) {
	day1 := levelForXP(1600)
	require.GreaterOrEqual(t, day1, 5, "day one ends around Lv6")
	require.LessOrEqual(t, day1, 7)

	month1 := levelForXP(measuredMonthlyXP)
	require.GreaterOrEqual(t, month1, 33, "month one lands mid-30s")
	require.LessOrEqual(t, month1, 39)

	month6 := levelForXP(6 * measuredMonthlyXP)
	require.GreaterOrEqual(t, month6, 64)
	require.LessOrEqual(t, month6, 70)

	month12 := levelForXP(12 * measuredMonthlyXP)
	require.GreaterOrEqual(t, month12, 77, "year one lands around Lv80")
	require.LessOrEqual(t, month12, 83)

	month30 := levelForXP(30 * measuredMonthlyXP)
	require.GreaterOrEqual(t, month30, 94)
	require.LessOrEqual(t, month30, 99)

	// "Max" (level 100) stays reachable in ~2.5-3 years at the measured pace.
	require.Less(t, levelForXP(24*measuredMonthlyXP), 100)
	require.GreaterOrEqual(t, levelForXP(36*measuredMonthlyXP), 100)
}

func TestLevelForXP_MonotonicAndUnbounded(t *testing.T) {
	prevLevel := 0
	// Sweep on a geometric grid; the curve must never decrease and must
	// keep producing new levels far beyond the designed band (no cap).
	for xp := 1.0; xp < 1e12; xp *= 1.3 {
		level := levelForXP(xp)
		require.GreaterOrEqual(t, level, prevLevel, "xp=%f", xp)
		prevLevel = level
	}
	require.Greater(t, prevLevel, bandMax, "curve keeps evolving beyond the band")
}

func TestThresholds_StrictlyIncreasingAndConsistent(t *testing.T) {
	for level := 1; level <= 150; level++ {
		lo := thresholdXP(level)
		hi := thresholdXP(level + 1)
		require.Less(t, lo, hi, "level %d", level)
		require.False(t, math.IsNaN(lo) || math.IsInf(lo, 0))
		// Exactly at a threshold you are exactly that level.
		require.Equal(t, level, levelForXP(lo), "xp at threshold(%d)", level)
	}
}

func TestProgressPct_AlwaysInRange(t *testing.T) {
	samples := []float64{0, 1, 146, 147, 148, 310, 1e4, 1e6, 1e9, -5, math.NaN(), math.Inf(1)}
	for xp := 1.0; xp < 1e10; xp *= 1.7 {
		samples = append(samples, xp, thresholdXP(levelForXP(xp)))
	}
	for _, xp := range samples {
		pct := progressPct(xp)
		require.False(t, math.IsNaN(pct), "xp=%f", xp)
		require.GreaterOrEqual(t, pct, 0.0, "xp=%f", xp)
		require.Less(t, pct, 100.0, "xp=%f", xp)
	}
	require.Zero(t, progressPct(0), "fresh egg starts at 0%%")
}

func TestRoundDownToTenth_NeverReaches100(t *testing.T) {
	require.Equal(t, 99.9, roundDownToTenth(99.99999))
	require.Equal(t, 42.1, roundDownToTenth(42.19))
}

func TestLineageDNA_DeterministicAndInRange(t *testing.T) {
	for _, salt := range []uint32{0, 7, 42, 20260728} {
		arch := archetypeForLineage(salt)
		require.GreaterOrEqual(t, arch, 0)
		require.Less(t, arch, numArchetypes)
		require.Equal(t, arch, archetypeForLineage(salt))

		family := paletteFamilyForLineage(salt)
		require.GreaterOrEqual(t, family, 0)
		require.Less(t, family, numFamilies)

		biome := biomeForLineage(salt)
		require.GreaterOrEqual(t, biome, 0)
		require.Less(t, biome, numBiomes)

		require.Equal(t, lineageSeed(salt), lineageSeed(salt))
		require.NotEqual(t, salt, lineageSeed(salt), "raw salt is never exposed")
	}
}

// TestCrossSeedDiversity: different installs at the same level are clearly
// different beings — over 8 salts, multiple archetypes and palette families
// show up.
func TestCrossSeedDiversity(t *testing.T) {
	salts := []uint32{1, 2, 3, 4, 5, 6, 7, 8}
	archetypes := map[int]bool{}
	families := map[int]bool{}
	names := map[string]bool{}
	for _, salt := range salts {
		archetypes[archetypeForLineage(salt)] = true
		families[paletteFamilyForLineage(salt)] = true
		names[stageName(salt, 20)] = true
	}
	require.GreaterOrEqual(t, len(archetypes), 3, "distinct species across seeds")
	require.GreaterOrEqual(t, len(families), 3, "distinct palettes across seeds")
	require.GreaterOrEqual(t, len(names), 3, "distinct names across seeds")
}

// TestLineageDNA_StreamsDecorrelated: the three DNA picks must be
// independent — two installs that roll the same species must still spread
// across (nearly) the whole palette and biome space. Regression test for the
// linear-xorshift seededIndex, where salts colliding on the archetype stream
// usually collided on palette and biome too (e.g. salts 111/666/8080 were
// identical triples).
func TestLineageDNA_StreamsDecorrelated(t *testing.T) {
	familiesByArch := map[int]map[int]bool{}
	biomesByArch := map[int]map[int]bool{}
	for salt := uint32(0); salt < 5000; salt++ {
		arch := archetypeForLineage(salt)
		if familiesByArch[arch] == nil {
			familiesByArch[arch] = map[int]bool{}
			biomesByArch[arch] = map[int]bool{}
		}
		familiesByArch[arch][paletteFamilyForLineage(salt)] = true
		biomesByArch[arch][biomeForLineage(salt)] = true
	}
	require.Len(t, familiesByArch, numArchetypes, "all archetypes reachable")
	for arch, families := range familiesByArch {
		require.GreaterOrEqual(t, len(families), numFamilies-2,
			"archetype %d: same-species installs must span palette families", arch)
		require.Len(t, biomesByArch[arch], numBiomes,
			"archetype %d: same-species installs must span all biomes", arch)
	}
}

// TestCoherence_SameIdentityAcrossBand: for levels 2..bandMax, consecutive
// levels are the SAME being (archetype, palette family, biome, species all
// constant) AND differ by at least one additive element (richness strictly
// grows). This replaces the v0.2 adjacent-distinctness property.
func TestCoherence_SameIdentityAcrossBand(t *testing.T) {
	const salt = 20260728
	arch := archetypeForLineage(salt)
	family := paletteFamilyForLineage(salt)
	biome := biomeForLineage(salt)
	species := speciesByArchetype[arch]
	for level := 2; level <= bandMax; level++ {
		require.Equal(t, arch, archetypeForLineage(salt), "level %d", level)
		require.Equal(t, family, paletteFamilyForLineage(salt))
		require.Equal(t, biome, biomeForLineage(salt))
		require.Contains(t, stageName(salt, level), species,
			"level %d keeps its species name", level)
		require.GreaterOrEqual(t, richnessScore(level), richnessScore(level-1),
			"level %d must never regress", level)
		if level >= 3 {
			require.Greater(t, richnessScore(level), richnessScore(level-2),
				"levels %d..%d must add something new", level-2, level)
		}
	}
}

func TestStageForLevel_MetamorphosisMilestones(t *testing.T) {
	require.Equal(t, stageEgg, stageForLevel(1))
	require.Equal(t, stageHatch, stageForLevel(2))
	require.Equal(t, stageHatch, stageForLevel(11))
	require.Equal(t, stageJuvenile, stageForLevel(12))
	require.Equal(t, stageAdult, stageForLevel(30))
	require.Equal(t, stageMajestic, stageForLevel(55))
	require.Equal(t, stageMythic, stageForLevel(80))
	require.Equal(t, stageMythic, stageForLevel(1000))
}

// TestRichness_MonotonicAwesomeness: the awesomeness budget never dips,
// gains at least every 2 levels across the whole 1..bandMax arc, and stays
// non-decreasing forever after.
func TestRichness_MonotonicAwesomeness(t *testing.T) {
	for level := 2; level <= bandMax; level++ {
		require.GreaterOrEqual(t, richnessScore(level), richnessScore(level-1),
			"richness must never dip (level %d)", level)
	}
	for level := 1; level <= bandMax-2; level++ {
		require.Greater(t, richnessScore(level+2), richnessScore(level),
			"richness must gain at least every 2 levels (level %d)", level)
	}
	prev := richnessScore(bandMax)
	for level := bandMax + 1; level <= 300; level++ {
		score := richnessScore(level)
		require.GreaterOrEqual(t, score, prev, "richness dipped at level %d", level)
		prev = score
	}
}

// TestEpithets_NoAdjacentRepeats: the deterministic collision-avoidance
// never lets two consecutive levels share an epithet.
func TestEpithets_NoAdjacentRepeats(t *testing.T) {
	for _, salt := range []uint32{7, 42, 20260728} {
		for level := 3; level <= 120; level++ {
			require.NotEqual(t, epithetFor(salt, level-1), epithetFor(salt, level),
				"salt=%d: levels %d/%d repeat an epithet", salt, level-1, level)
		}
	}
}

func TestAppearanceSeed_DeterministicPerLevel(t *testing.T) {
	require.Equal(t, appearanceSeed(42, 3), appearanceSeed(42, 3))
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(42, 4), "evolving changes the look")
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(43, 3), "instances have distinct lineages")
}

func TestStageName_FixedSpeciesRisingEpithets(t *testing.T) {
	const salt = 7
	require.Equal(t, "Egg", stageName(salt, 1))
	species := speciesByArchetype[archetypeForLineage(salt)]
	for level := 2; level <= bandMax; level++ {
		name := stageName(salt, level)
		require.True(t, strings.HasSuffix(name, " "+species),
			"level %d: %q keeps the lineage species %q", level, name, species)
		require.Equal(t, name, stageName(salt, level), "stable per level")
	}
	// The epithet ladder tells the dull->awesome story: humble words early,
	// radiant words late.
	humble := stageName(salt, 3)
	require.Contains(t, epithetBands[0], strings.TrimSuffix(humble, " "+species))
	epic := stageName(salt, 95)
	require.Contains(t, epithetBands[4], strings.TrimSuffix(epic, " "+species))
}

func TestStageName_MythicLadderBeyondBand(t *testing.T) {
	const salt = 7
	name41 := stageName(salt, bandMax+1)
	require.True(t, strings.HasPrefix(name41, "Cosmic "), "got %q", name41)
	// A generation numeral appears every 50 levels past the band.
	name := stageName(salt, bandMax+1+50)
	require.True(t, strings.HasSuffix(name, " II"), "got %q", name)
	deep := stageName(salt, 1000)
	require.NotEmpty(t, deep)
	require.Less(t, len(deep), 48, "names stay label-sized forever")
}

func TestMoodFor_TierBoundaries(t *testing.T) {
	cases := []struct {
		since time.Duration
		want  string
	}{
		{-5 * time.Minute, "elated"}, // unknown counts as "just now"
		{0, "elated"},
		{9 * time.Minute, "elated"},
		{10 * time.Minute, "happy"},
		{7 * time.Hour, "happy"},
		{8 * time.Hour, "content"},
		{47 * time.Hour, "content"},
		{48 * time.Hour, "bored"},
		{95 * time.Hour, "bored"},
		{96 * time.Hour, "sad"},
		{167 * time.Hour, "sad"},
		{168 * time.Hour, "gloomy"},
		{24 * 365 * time.Hour, "gloomy"},
	}
	for _, tc := range cases {
		require.Equal(t, tc.want, moodFor(tc.since), "since=%s", tc.since)
	}
}

func TestFlavorText_TracksMoodAndNeverItemizesFactors(t *testing.T) {
	require.Equal(t, "Your kandy is thrilled!", flavorText(7, 5, "elated"))
	require.Equal(t, "Your kandy looks energized.", flavorText(7, 5, "happy"))
	require.Equal(t, "Your kandy is getting restless.", flavorText(7, 5, "bored"))
	require.Contains(t, flavorText(7, 5, "sad"), "misses you")
	require.Contains(t, flavorText(7, 5, "gloomy"), "rain")
	require.Equal(t, "The egg is warm. Keep working.", flavorText(7, 1, "sad"), "the egg has no moods")
	for _, mood := range []string{"elated", "happy", "content", "bored", "sad", "gloomy"} {
		for _, level := range []int{1, 2, 9, 40} {
			line := flavorText(7, level, mood)
			require.NotEmpty(t, line)
			for _, banned := range []string{"XP", "token", "turn", "message", "task"} {
				require.NotContains(t, strings.ToLower(line), strings.ToLower(banned))
			}
		}
	}
}
