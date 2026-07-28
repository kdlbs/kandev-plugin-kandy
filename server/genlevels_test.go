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
		require.Equal(t, tierForLevel(level), out[i].Tier)
		require.Equal(t, stageName(7, level), out[i].StageName)
		require.Equal(t, appearanceSeed(7, level), out[i].AppearanceSeed)
	}
}

func TestGenLevels_RejectsJunk(t *testing.T) {
	var buf bytes.Buffer
	require.Error(t, genLevels(&buf, []string{"-levels", "1,zero"}))
	require.Error(t, genLevels(&buf, []string{"-levels", "0"}))
}
