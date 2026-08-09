// genlineage.go — dev/demo subcommand: run the REAL rebirth path and emit the
// webhook payloads a lineage produces on its way through the generations.
// Driving a plugin's ledger to each sampled level exercises applyRebirth
// exactly as production does, so offline tooling (the README screenshots)
// renders from the true presentation instead of a hand-written fixture.
//
// Kandev always spawns the plugin with no arguments, so this path never runs
// in production.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// lineageSample is one webhook payload plus the reason it was captured.
type lineageSample struct {
	Sampled string        `json:"sampled"`
	View    kandyResponse `json:"view"`
}

func genLineage(w io.Writer, args []string) error {
	fs := flag.NewFlagSet("genlineage", flag.ContinueOnError)
	salt := fs.Uint("salt", 20260728, "first lineage salt (each rebirth derives the next deterministically)")
	generations := fs.Int("generations", 4, "how many generations to walk (1 = never reborn)")
	levelsCSV := fs.String("levels", "1,40,100,101", "levels to sample within EACH generation; the band is 1..100, and landing on 101 is the ascension")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *generations < 1 {
		return fmt.Errorf("genlineage: -generations must be >= 1")
	}
	levels, err := parseLevelList(*levelsCSV)
	if err != nil {
		return err
	}

	// A fixed clock and a deterministic salt chain: the same command always
	// prints the same lineage.
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	nextSalt := uint32(*salt)
	p := newPlugin()
	p.now = func() time.Time { return clock }
	p.saltFunc = func() uint32 {
		out := nextSalt
		nextSalt = nextSalt*1664525 + 1013904223
		return out
	}
	stamp := clock.UTC().Format(time.RFC3339)
	l := &ledger{Salt: p.saltFunc(), CreatedAt: stamp, UpdatedAt: stamp}

	out := []lineageSample{}
	for gen := 1; gen <= *generations; gen++ {
		for _, level := range levels {
			// Land exactly on the level, then present. Level 100 IS a resting
			// place (the victory lap); sampling 101 is what ascends the
			// creature, turning that award into the next generation's egg —
			// precisely the frame to render.
			l.XP = thresholdXP(level)
			l.AwardSeq++
			l.LastAwardAt = clock.UTC().Format(time.RFC3339)
			p.applyRebirth(l)
			clock = clock.Add(24 * time.Hour)
			out = append(out, lineageSample{
				Sampled: fmt.Sprintf("generation %d, ledger at level %d", gen, level),
				View:    p.presentLedger(l, nil),
			})
		}
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

// parseLevelList reads a comma-separated level list, rejecting anything that
// is not a level.
func parseLevelList(csv string) ([]int, error) {
	var levels []int
	for _, part := range strings.Split(csv, ",") {
		level, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || level < 1 {
			return nil, fmt.Errorf("bad level %q", part)
		}
		levels = append(levels, level)
	}
	if len(levels) == 0 {
		return nil, fmt.Errorf("no levels given")
	}
	return levels, nil
}
