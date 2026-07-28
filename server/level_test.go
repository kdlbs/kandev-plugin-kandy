package main

import (
	"math"
	"strings"
	"testing"

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
	// K=400, B=1.32: level 2 at 128 XP — inside the first day of light use
	// (the fast first evolution is the hook).
	require.Equal(t, 1, levelForXP(120))
	require.Equal(t, 2, levelForXP(129))
	require.Equal(t, 3, levelForXP(300), "~day two of light use")
}

func TestLevelForXP_YearOneTargets(t *testing.T) {
	// Rate assumptions (per the v0.2.0 retune): heavy multi-agent user
	// ~6,600 XP/day (~20 finished tasks + turns/messages/completions),
	// solo dev ~800 XP/day.
	heavyYear := levelForXP(6600 * 365)
	require.GreaterOrEqual(t, heavyYear, 30, "heavy user year-one lands in 30..40")
	require.LessOrEqual(t, heavyYear, 40)

	soloYear := levelForXP(800 * 365)
	require.GreaterOrEqual(t, soloYear, 20, "solo dev year-one lands in 20..25")
	require.LessOrEqual(t, soloYear, 25)

	heavyMonth := levelForXP(6600 * 30)
	require.GreaterOrEqual(t, heavyMonth, 18)
	require.LessOrEqual(t, heavyMonth, 28)

	soloMonth := levelForXP(800 * 30)
	require.GreaterOrEqual(t, soloMonth, 12)
	require.LessOrEqual(t, soloMonth, 18)
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
	for level := 1; level <= 80; level++ {
		lo := thresholdXP(level)
		hi := thresholdXP(level + 1)
		require.Less(t, lo, hi, "level %d", level)
		require.False(t, math.IsNaN(lo) || math.IsInf(lo, 0))
		// Exactly at a threshold you are exactly that level.
		require.Equal(t, level, levelForXP(lo), "xp at threshold(%d)", level)
	}
}

func TestProgressPct_AlwaysInRange(t *testing.T) {
	samples := []float64{0, 1, 127, 128, 129, 300, 1e4, 1e6, 1e9, -5, math.NaN(), math.Inf(1)}
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
		require.Greater(t, richnessScore(level), richnessScore(level-1),
			"level %d must add something new", level)
	}
}

func TestStageForLevel_MetamorphosisMilestones(t *testing.T) {
	require.Equal(t, stageEgg, stageForLevel(1))
	require.Equal(t, stageHatch, stageForLevel(2))
	require.Equal(t, stageHatch, stageForLevel(7))
	require.Equal(t, stageJuvenile, stageForLevel(8))
	require.Equal(t, stageAdult, stageForLevel(18))
	require.Equal(t, stageMajestic, stageForLevel(30))
	require.Equal(t, stageMajestic, stageForLevel(1000))
}

// TestRichness_MonotonicAwesomeness: the awesomeness budget never dips, is
// strictly increasing through the whole 1..bandMax arc (every level adds),
// and stays non-decreasing forever after.
func TestRichness_MonotonicAwesomeness(t *testing.T) {
	for level := 2; level <= bandMax; level++ {
		require.Greater(t, richnessScore(level), richnessScore(level-1),
			"richness must strictly increase at level %d", level)
	}
	prev := richnessScore(bandMax)
	for level := bandMax + 1; level <= 200; level++ {
		score := richnessScore(level)
		require.GreaterOrEqual(t, score, prev, "richness dipped at level %d", level)
		prev = score
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
	epic := stageName(salt, 40)
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
	require.Less(t, len(deep), 40, "names stay label-sized forever")
}

func TestFlavorText_NeverItemizesFactors(t *testing.T) {
	require.Equal(t, "Your gotchi looks energized.", flavorText(7, 5, 0))
	require.Equal(t, "Your gotchi is napping quietly.", flavorText(7, 5, 48*3600*1e9))
	for _, level := range []int{1, 2, 9, 40} {
		line := flavorText(7, level, 3600*1e9)
		require.NotEmpty(t, line)
		for _, banned := range []string{"XP", "token", "turn", "message", "task"} {
			require.NotContains(t, strings.ToLower(line), strings.ToLower(banned))
		}
	}
}
