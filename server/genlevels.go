// genlevels.go — dev/demo subcommand: emit the deterministic presentation
// facts (level, tier, stage name, appearance seed) for a list of levels and
// a fixed lineage salt, as JSON. Used by demo/render-evolution-sheet.mjs to
// build the evolution poster from the *real* naming/seed functions instead
// of a reimplementation. Kandev always spawns the plugin with no arguments,
// so this path never runs in production.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"
)

type levelInfo struct {
	Level          int    `json:"level"`
	Tier           int    `json:"tier"`
	Archetype      int    `json:"archetype"`
	StageName      string `json:"stage_name"`
	AppearanceSeed uint32 `json:"appearance_seed"`
}

func genLevels(w io.Writer, args []string) error {
	fs := flag.NewFlagSet("genlevels", flag.ContinueOnError)
	salt := fs.Uint("salt", 20260728, "lineage salt (fixed for reproducible posters)")
	levelsCSV := fs.String("levels", "1,2,3,4,5,10,20,50,100", "comma-separated levels")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var out []levelInfo
	for _, part := range strings.Split(*levelsCSV, ",") {
		level, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || level < 1 {
			return fmt.Errorf("genlevels: bad level %q", part)
		}
		out = append(out, levelInfo{
			Level:          level,
			Tier:           tierForLevel(uint32(*salt), level),
			Archetype:      archetypeForLevel(uint32(*salt), level),
			StageName:      stageName(uint32(*salt), level),
			AppearanceSeed: appearanceSeed(uint32(*salt), level),
		})
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}
