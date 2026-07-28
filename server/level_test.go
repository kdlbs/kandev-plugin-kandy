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

func TestTierForLevel_SceneRotationInBand(t *testing.T) {
	const salt = 7
	require.Equal(t, 0, tierForLevel(salt, 1), "the egg hatches in the meadow")

	seen := map[int]bool{}
	for level := 2; level <= bandMax; level++ {
		tier := tierForLevel(salt, level)
		require.GreaterOrEqual(t, tier, 0)
		require.Less(t, tier, numScenes)
		seen[tier] = true
		// Scenes rotate every 2-3 levels: any 4-level window spans a block
		// boundary, and adjacent blocks always differ.
		if level+3 <= bandMax {
			require.NotEqual(t, tier, tierForLevel(salt, level+3),
				"scene must change within 3 levels of %d", level)
		}
	}
	require.GreaterOrEqual(t, len(seen), 12, "band tours nearly the whole scene vocabulary")
}

func TestTierForLevel_InfiniteLadderBeyondBand(t *testing.T) {
	const salt = 7
	require.Equal(t, numScenes, tierForLevel(salt, bandMax+1))
	require.Equal(t, numScenes, tierForLevel(salt, bandMax+5))
	require.Equal(t, numScenes+1, tierForLevel(salt, bandMax+6))
	require.Less(t, tierForLevel(salt, 100), tierForLevel(salt, 1000),
		"cosmos keeps advancing forever")
}

func TestArchetypeForLevel_AdjacentLevelsAlwaysDiffer(t *testing.T) {
	for _, salt := range []uint32{0, 7, 42, 20260728} {
		require.Equal(t, -1, archetypeForLevel(salt, 1), "level 1 is the egg")
		prev := -1
		for level := 2; level <= 120; level++ {
			arch := archetypeForLevel(salt, level)
			require.GreaterOrEqual(t, arch, 0)
			require.Less(t, arch, numArchetypes)
			require.NotEqual(t, prev, arch,
				"salt=%d: levels %d and %d share a silhouette", salt, level-1, level)
			prev = arch
		}
	}
}

func TestArchetypeForLevel_Deterministic(t *testing.T) {
	for level := 1; level <= 50; level++ {
		require.Equal(t, archetypeForLevel(42, level), archetypeForLevel(42, level))
	}
}

// TestAdjacentLevelsDifferBeyondPalette is the distinctness property: for
// every consecutive pair in the designed band, the appearance descriptor
// (archetype silhouette; the scene also rotates every 2-3 levels) differs —
// never only the palette/seed.
func TestAdjacentLevelsDifferBeyondPalette(t *testing.T) {
	const salt = 20260728
	for level := 1; level < bandMax; level++ {
		aThis := archetypeForLevel(salt, level)
		aNext := archetypeForLevel(salt, level+1)
		require.NotEqual(t, aThis, aNext, "levels %d/%d share a silhouette", level, level+1)
		require.NotEqual(t, stageName(salt, level), stageName(salt, level+1))
	}
}

func TestAppearanceSeed_DeterministicPerLevel(t *testing.T) {
	require.Equal(t, appearanceSeed(42, 3), appearanceSeed(42, 3))
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(42, 4), "evolving changes the look")
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(43, 3), "instances have distinct lineages")
}

func TestStageName_TracksArchetype(t *testing.T) {
	const salt = 7
	require.Equal(t, "Egg", stageName(salt, 1))
	for level := 2; level <= bandMax; level++ {
		name := stageName(salt, level)
		species := speciesByArchetype[archetypeForLevel(salt, level)]
		require.True(t, strings.HasSuffix(name, " "+species),
			"level %d: %q must name its silhouette %q", level, name, species)
		require.Equal(t, name, stageName(salt, level), "stable per level")
	}
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
