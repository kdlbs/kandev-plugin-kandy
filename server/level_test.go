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
	// K=200, B=1.75: level 2 at 150 XP, level 3 at 412.5 XP — a light day
	// of use (or one finished task) hatches the egg.
	require.Equal(t, 1, levelForXP(149))
	require.Equal(t, 2, levelForXP(150))
	require.Equal(t, 2, levelForXP(412))
	require.Equal(t, 3, levelForXP(413))
}

func TestLevelForXP_MonotonicAndUnbounded(t *testing.T) {
	prevLevel := 0
	// Sweep across 40+ levels on a geometric grid; the curve must never
	// decrease and must keep producing new levels (no cap).
	for xp := 1.0; xp < 1e12; xp *= 1.3 {
		level := levelForXP(xp)
		require.GreaterOrEqual(t, level, prevLevel, "xp=%f", xp)
		prevLevel = level
	}
	require.GreaterOrEqual(t, prevLevel, 40, "curve keeps evolving far beyond early levels")
}

func TestThresholds_StrictlyIncreasingAndConsistent(t *testing.T) {
	for level := 1; level <= 60; level++ {
		lo := thresholdXP(level)
		hi := thresholdXP(level + 1)
		require.Less(t, lo, hi, "level %d", level)
		require.False(t, math.IsNaN(lo) || math.IsInf(lo, 0))
		// Exactly at a threshold you are exactly that level.
		require.Equal(t, level, levelForXP(lo), "xp at threshold(%d)", level)
	}
}

func TestProgressPct_AlwaysInRange(t *testing.T) {
	samples := []float64{0, 1, 149, 150, 151, 412, 413, 1e4, 1e6, 1e9, -5, math.NaN(), math.Inf(1)}
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

func TestTierForLevel(t *testing.T) {
	require.Equal(t, 0, tierForLevel(1))
	require.Equal(t, 0, tierForLevel(5))
	require.Equal(t, 1, tierForLevel(6))
	require.Equal(t, 7, tierForLevel(36))
	require.Equal(t, 8, tierForLevel(41), "tiers keep climbing past the handcrafted scenes")
}

func TestAppearanceSeed_DeterministicPerLevel(t *testing.T) {
	require.Equal(t, appearanceSeed(42, 3), appearanceSeed(42, 3))
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(42, 4), "evolving changes the look")
	require.NotEqual(t, appearanceSeed(42, 3), appearanceSeed(43, 3), "instances have distinct lineages")
}

func TestStageName_Procedural(t *testing.T) {
	require.Equal(t, "Egg", stageName(7, 1))
	name := stageName(7, 2)
	require.NotEqual(t, "Egg", name)
	require.Equal(t, name, stageName(7, 2), "stable per level")
	require.Contains(t, name, "Blip", "tier 0 species")
	require.Contains(t, stageName(7, 6), "Sproutling", "tier 1 species")

	// Past the handcrafted tiers the mythic ladder keeps names fresh forever.
	deep := stageName(7, 41) // tier 8
	require.Contains(t, deep, "Starbeast")
	require.True(t, strings.HasPrefix(deep, "Cosmic "), "got %q", deep)
	deeper := stageName(7, 66) // tier 13
	require.Contains(t, deeper, "Starbeast II")
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
