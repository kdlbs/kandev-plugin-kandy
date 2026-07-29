package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGenLevels_MatchesRealFunctions(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, genLevels(&buf, []string{"-salt", "7", "-levels", "1,6,41"}))

	var out []levelInfo
	require.NoError(t, json.Unmarshal(buf.Bytes(), &out))
	require.Len(t, out, 3)
	for i, level := range []int{1, 6, 41} {
		require.Equal(t, level, out[i].Level)
		require.Equal(t, stageForLevel(level), out[i].Stage)
		require.Equal(t, archetypeForLineage(7), out[i].Archetype)
		require.Equal(t, paletteFamilyForLineage(7), out[i].Family)
		require.Equal(t, biomeForLineage(7), out[i].Biome)
		require.Equal(t, lineageSeed(7), out[i].LineageSeed)
		require.Equal(t, stageName(7, level), out[i].StageName)
		require.Equal(t, appearanceSeed(7, level), out[i].AppearanceSeed)
	}
}

func TestGenLevels_RejectsJunk(t *testing.T) {
	var buf bytes.Buffer
	require.Error(t, genLevels(&buf, []string{"-levels", "1,zero"}))
	require.Error(t, genLevels(&buf, []string{"-levels", "0"}))
	require.Error(t, genLevels(&buf, []string{"-xps", "abc"}))
}

func TestGenLevels_XPsUseRealCurve(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, genLevels(&buf, []string{"-salt", "7", "-xps", "0,2860,51480"}))
	var out []levelInfo
	require.NoError(t, json.Unmarshal(buf.Bytes(), &out))
	require.Len(t, out, 3)
	require.Equal(t, 1, out[0].Level)
	require.Equal(t, levelForXP(2860), out[1].Level)
	require.Equal(t, levelForXP(51480), out[2].Level)
}
