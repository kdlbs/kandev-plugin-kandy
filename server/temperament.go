// temperament.go — the care system (v0.3.0): pet or bonk.
//
// The kandy carries a persistent temperament score in [-100, +100]. Pets
// push it up, bonks with the stick push it down, and the score conditions
// HOW the creature is drawn (bands, scar, kind-vs-wary variant styling) —
// never WHAT it is (DNA) or how grown it is (XP/level). The raw score
// never leaves the server; the webhook only exposes a coarse band.
//
// Design invariants (tested):
//   - Pet and bonk NEVER touch xp, level, progress, award_seq or
//     last_award_at. Temperament is presentation-conditioning only.
//   - No passive healing: a negative temperament decays toward neutral
//     ONLY through consistent care (accepted pets), and slowly — deep
//     negative takes days of regular petting to heal, not minutes.
//   - Scarring is permanent: once temperament ever reaches scarThreshold
//     the scarred latch is set and never clears, no matter how beloved the
//     kandy later becomes.
package main

import "time"

const (
	temperamentMin = -100.0
	temperamentMax = 100.0

	// A bonk subtracts bonkTemperamentDelta, but the server accepts at most
	// one bonk EFFECT per bonkEffectWindow — every bonk re-stamps
	// last_bonked_at, so hammering the webhook faster than the window
	// keeps resetting the clock and never lands a second effect
	// (scripting cannot insta-traumatize). Deliberate, spaced cruelty
	// still works: 0 -> scarred takes 8 bonks at least 10s apart.
	bonkTemperamentDelta = 8.0
	bonkEffectWindow     = 10 * time.Second

	// After a bonk the displayed mood drops one tier for bonkMoodWindow,
	// and pets are refused entirely for distrustWindow ("it doesn't trust
	// you right now").
	bonkMoodWindow = 30 * time.Minute
	distrustWindow = 60 * time.Second

	// Pets: at most one temperament EFFECT per petEffectWindow (extra pets
	// still stamp last_petted_at for the mood lift). A content kandy gains
	// petTemperamentGain per effective pet; a mistreated one heals at only
	// petHealGain while below zero — and not at all within careCalmWindow
	// of a bonk (care isn't "consistent" the same day you hit it).
	//
	// Concrete pace: max healing is 0.5 per 10 minutes = +3/hour of
	// obsessive petting, so a fearful -60 kandy needs 120 effective pets
	// (20+ hours of petting every 10 minutes — several days of devoted
	// care in practice; a casual few-pets-a-day pace takes weeks).
	// Building beloved (+30) from neutral takes 30 effective pets.
	petEffectWindow    = 10 * time.Minute
	petTemperamentGain = 1.0
	petHealGain        = 0.5
	careCalmWindow     = 24 * time.Hour

	// scarThreshold: reaching this depth latches scarred forever.
	scarThreshold = -60.0
)

func clampTemperament(v float64) float64 {
	if v < temperamentMin {
		return temperamentMin
	}
	if v > temperamentMax {
		return temperamentMax
	}
	return v
}

// temperamentBand coarsens the private score into the only shape the UI
// ever sees. Thresholds: beloved >= +30, content >= +10, neutral in
// (-10, +10), wary <= -10, fearful <= -40.
func temperamentBand(v float64) string {
	switch {
	case v >= 30:
		return "beloved"
	case v >= 10:
		return "content"
	case v <= -40:
		return "fearful"
	case v <= -10:
		return "wary"
	default:
		return "neutral"
	}
}

// lowerMood drops a mood one tier (floored at gloomy) — the bonk's inverse
// of liftMood.
func lowerMood(mood string) string {
	for i, name := range moodOrder {
		if name == mood {
			if i >= len(moodOrder)-1 {
				return mood
			}
			return moodOrder[i+1]
		}
	}
	return mood
}

// moodIndex ranks a mood in moodOrder (0 = elated/best); unknown -> -1.
func moodIndex(mood string) int {
	for i, name := range moodOrder {
		if name == mood {
			return i
		}
	}
	return -1
}

// capMoodForBand is the FINAL step of the mood pipeline: temperament caps
// the displayed mood after every other modifier (pet lift, bonk drop) has
// run. A mistreated kandy can't beam "Happy" at its abuser no matter how
// much work is flowing — wary caps the mood at "content", fearful at
// "bored"; winning trust back lifts the ceiling. The cap only lowers:
// a mood already at or below the ceiling is never raised.
func capMoodForBand(mood, band string) string {
	var ceiling string
	switch band {
	case "wary":
		ceiling = "content"
	case "fearful":
		ceiling = "bored"
	default:
		return mood
	}
	if i := moodIndex(mood); i >= 0 && i < moodIndex(ceiling) {
		return ceiling
	}
	return mood
}
