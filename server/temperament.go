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
//   - Time heals, but only toward neutral (v0.6.4 "forgiveness patch"):
//     left alone for full days after a bonk, a hurt kandy passively drifts
//     back toward 0 — and NEVER above it. Positive trust is built only
//     through accepted pets.
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
	// petTemperamentGain per effective pet; a mistreated one heals at
	// petHealGain while below zero — but not at all within careCalmWindow
	// of a bonk (care isn't "consistent" within hours of hitting it).
	//
	// Forgiveness patch (v0.6.4): healing a hurt kandy is humane now.
	// Repair pets are worth MORE than trust-building pets (+3 vs +1), the
	// effect window is 5 minutes, and the post-bonk embargo is 3 hours.
	// Concrete pace: a fearful -60 kandy needs 20 effective pets (under
	// 2 hours of devoted petting; a casual few-pets-a-day pace plus the
	// passive drift below heals it in under a week). Building beloved
	// (+30) from neutral still takes 30 effective pets.
	petEffectWindow    = 5 * time.Minute
	petTemperamentGain = 1.0
	petHealGain        = 3.0
	careCalmWindow     = 3 * time.Hour

	// Time heals (v0.6.4): once the last bonk is passiveHealDelay old, a
	// negative temperament passively drifts up by passiveHealPerDay for
	// every FULL elapsed day, clamped at 0 — passive healing never builds
	// positive trust, it only lets wounds close. Applied lazily on webhook
	// computation (like mood — no background jobs); last_passive_heal_at
	// checkpoints the accrual so it is never double-applied.
	passiveHealDelay  = 24 * time.Hour
	passiveHealPerDay = 4.0

	// Affection fades (v0.11.0): the mirror of "time heals". Once the last
	// treat is affectionFadeDelay old, a POSITIVE temperament drifts back
	// down by affectionFadePerDay for every FULL elapsed day — clamped at
	// 0, never below. Neglect makes a kandy forget the bond; it never
	// makes one distrust you. Only a bucket can do that, which keeps the
	// moral logic intact: forgetting to feed it is not cruelty.
	//
	// Accrues per HOUR (not per day like healing) so the bond visibly
	// slips rather than dropping in daily steps.
	//
	// Concrete pace: a beloved +30 kandy left alone slips to "content"
	// (+10) in two days and to neutral in three. Holding beloved costs
	// roughly ten treats a day (petTemperamentGain is +1, one effective
	// pet per five minutes) — affection is meant to be actively kept.
	affectionFadeDelay   = 12 * time.Hour
	affectionFadePerHour = 10.0 / 24.0

	// scarThreshold: reaching this depth latches scarred forever.
	scarThreshold = -60.0
)

// passiveHealUpdate applies the "time heals" rule to the ledger and reports
// whether anything changed (callers persist only when it did). Rules:
//
//   - Only a hurt kandy (temperament < 0) heals passively; at or above 0
//     this is a no-op and the checkpoint is left alone.
//   - Migration semantics (deliberate, documented choice): the FIRST time a
//     hurt ledger is seen without a last_passive_heal_at checkpoint, the
//     checkpoint is set to now and NO healing is applied — no retro-heal
//     lump on upgrade. Passive healing starts accruing from the moment the
//     forgiveness patch first computes the ledger.
//   - Nothing accrues within passiveHealDelay of the last bonk.
//   - Otherwise +passiveHealPerDay per FULL elapsed day since
//     max(last_bonked_at, last_passive_heal_at), clamped at 0 — passive
//     healing NEVER raises temperament above 0.
//   - The checkpoint advances by exactly the full days consumed, so partial
//     days keep accruing and healing is never double-applied.
func passiveHealUpdate(l *ledger, now time.Time) bool {
	if l.Temperament > 0 {
		return affectionFadeUpdate(l, now)
	}
	if l.Temperament == 0 {
		return false
	}
	start, err := time.Parse(time.RFC3339, l.LastPassiveHealAt)
	if err != nil {
		l.LastPassiveHealAt = now.Format(time.RFC3339)
		return true
	}
	if bonk, err := time.Parse(time.RFC3339, l.LastBonkedAt); err == nil {
		if now.Sub(bonk) < passiveHealDelay {
			return false
		}
		if bonk.After(start) {
			start = bonk
		}
	}
	days := int(now.Sub(start) / (24 * time.Hour))
	if days <= 0 {
		return false
	}
	if healed := l.Temperament + passiveHealPerDay*float64(days); healed < 0 {
		l.Temperament = healed
	} else {
		l.Temperament = 0 // wounds close; trust is only built by pets
	}
	l.LastPassiveHealAt = start.Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	return true
}

// affectionFadeUpdate applies the "affection fades" rule to a ledger whose
// temperament is positive, reporting whether anything changed (callers
// persist only when it did). It deliberately mirrors passiveHealUpdate:
//
//   - Only a fond kandy (temperament > 0) fades; the drift stops dead at 0
//     so neglect can never push a kandy into wary/fearful. Earning distrust
//     still requires the bucket.
//   - The clock runs from the last EFFECTIVE treat (last_pet_effect_at) or
//     the checkpoint, whichever is later, and only once the last treat is
//     affectionFadeDelay old: a few hours away costs nothing.
//   - Same lazy accrual and checkpoint as healing (no background jobs), but
//     in whole HOURS, so a bond slips visibly instead of in daily steps.
//   - Same migration semantics: a fond ledger first seen without a
//     checkpoint gets one stamped NOW, so upgrading never retro-fades a
//     bond that was earned before this rule existed.
func affectionFadeUpdate(l *ledger, now time.Time) bool {
	start, err := time.Parse(time.RFC3339, l.LastPassiveHealAt)
	if err != nil {
		l.LastPassiveHealAt = now.Format(time.RFC3339)
		return true
	}
	if pet, err := time.Parse(time.RFC3339, l.LastPetEffectAt); err == nil {
		if now.Sub(pet) < affectionFadeDelay {
			return false
		}
		if pet.After(start) {
			start = pet
		}
	}
	hours := int(now.Sub(start) / time.Hour)
	if hours <= 0 {
		return false
	}
	if faded := l.Temperament - affectionFadePerHour*float64(hours); faded > 0 {
		l.Temperament = faded
	} else {
		l.Temperament = 0 // the bond is forgotten, never soured
	}
	l.LastPassiveHealAt = start.Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
	return true
}

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
