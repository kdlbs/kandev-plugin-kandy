// Care-system tests: temperament math (bounds, rate limits, repair-pet
// healing, passive "time heals" drift, scar latch), the bonk/pet webhooks,
// distrust, and — most importantly — the hard invariant that pets and
// bonks NEVER touch XP-derived facts.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

func bonkKandy(t *testing.T, p *plugin) kandyResponse {
	t.Helper()
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyBonk, Method: "POST"})
	require.NoError(t, err)
	return kandyState(t, resp)
}

func persistedTemperament(t *testing.T, host *fakeHost) float64 {
	t.Helper()
	value, ok := host.state[stateMapKey(stateScope, "", stateKey)]
	require.True(t, ok, "ledger persisted")
	v, _ := value["temperament"].(float64)
	return v
}

// advance moves the plugin's fake clock to base+d.
func advance(p *plugin, base time.Time, d time.Duration) {
	p.now = func() time.Time { return base.Add(d) }
}

func TestTemperamentBand_Thresholds(t *testing.T) {
	for v, want := range map[float64]string{
		100: "beloved", 30: "beloved", 29.9: "content", 10: "content",
		9.9: "neutral", 0: "neutral", -9.9: "neutral",
		-10: "wary", -39.9: "wary", -40: "fearful", -100: "fearful",
	} {
		require.Equal(t, want, temperamentBand(v), "temperament=%v", v)
	}
}

func TestBonk_DropsTemperamentRateLimited(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// First bonk lands its effect; a second bonk 3s later is inside the
	// 10s window — it stamps and counts but adds no trauma.
	bonkKandy(t, p)
	require.Equal(t, -bonkTemperamentDelta, persistedTemperament(t, host))
	advance(p, base, 3*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -bonkTemperamentDelta, persistedTemperament(t, host))
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	bonks, _ := value["bonks_given"].(float64)
	require.Equal(t, 2.0, bonks, "every bonk is counted")

	// Spam keeps RESETTING the window: 3s apart forever never lands a
	// second effect (scripting cannot insta-traumatize).
	for i := 2; i < 10; i++ {
		advance(p, base, time.Duration(i*3)*time.Second)
		bonkKandy(t, p)
	}
	require.Equal(t, -bonkTemperamentDelta, persistedTemperament(t, host))

	// Deliberate spaced bonks do accumulate.
	advance(p, base, 60*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -2*bonkTemperamentDelta, persistedTemperament(t, host))
}

func TestBonk_ScarLatchIsPermanent(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// 8 bonks spaced 11s apart: -64 <= -60 latches the scar.
	var state kandyResponse
	for i := 0; i < 8; i++ {
		advance(p, base, time.Duration(i)*11*time.Second)
		state = bonkKandy(t, p)
	}
	require.Equal(t, -64.0, persistedTemperament(t, host))
	require.True(t, state.Scarred)
	require.Equal(t, "fearful", state.TemperamentBand)

	// Heal all the way back to beloved: the scar never clears.
	for i := 0; i < 200; i++ {
		advance(p, base, 30*time.Hour+time.Duration(i)*petEffectWindow)
		petKandy(t, p)
	}
	require.Greater(t, persistedTemperament(t, host), 30.0)
	final := fetchKandy(t, p, "")
	require.Equal(t, "beloved", final.TemperamentBand)
	require.True(t, final.Scarred, "scarred latches forever")
}

func TestTemperament_Bounds(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// Floor at -100: 20 spaced bonks would be -160.
	for i := 0; i < 20; i++ {
		advance(p, base, time.Duration(i)*11*time.Second)
		bonkKandy(t, p)
	}
	require.Equal(t, temperamentMin, persistedTemperament(t, host))

	// Ceiling at +100 on a fresh kandy petted forever.
	host2 := newFakeHost(nil)
	p2 := newTestPlugin(t, host2)
	base2 := p2.now()
	for i := 0; i < 120; i++ {
		advance(p2, base2, time.Duration(i)*petEffectWindow)
		petKandy(t, p2)
	}
	require.Equal(t, temperamentMax, persistedTemperament(t, host2))
}

func TestPet_TemperamentEffectRateLimited(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	petKandy(t, p)
	require.Equal(t, petTemperamentGain, persistedTemperament(t, host))
	// Pets inside the 5min effect window still stamp (mood lift) but add
	// no temperament — right up to the boundary.
	advance(p, base, 3*time.Minute)
	petKandy(t, p)
	require.Equal(t, petTemperamentGain, persistedTemperament(t, host))
	advance(p, base, petEffectWindow-time.Second)
	petKandy(t, p)
	require.Equal(t, petTemperamentGain, persistedTemperament(t, host))
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	pets, _ := value["pets_given"].(float64)
	require.Equal(t, 3.0, pets, "every pet is counted")
	// At exactly the window the next pet lands its effect.
	advance(p, base, petEffectWindow)
	petKandy(t, p)
	require.Equal(t, 2*petTemperamentGain, persistedTemperament(t, host))
}

// The forgiveness patch's +3/+1 split: a repair pet (temperament < 0) is
// worth petHealGain (+3); once the score is at or above zero the ordinary
// petTemperamentGain (+1) applies. The whole test runs inside the 24h
// passive-heal delay so only pets move the score.
func TestPet_HealGainSplit_ThreeBelowZeroOneAbove(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// Two spaced bonks: temperament -16.
	bonkKandy(t, p)
	advance(p, base, 20*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -16.0, persistedTemperament(t, host))

	// Past the 3h embargo, effective pets heal at +3 each:
	// -16 -> -13 -> -10 -> -7 -> -4 -> -1.
	for i := 0; i < 5; i++ {
		advance(p, base, 4*time.Hour+time.Duration(i)*petEffectWindow)
		petKandy(t, p)
	}
	require.Equal(t, -1.0, persistedTemperament(t, host))
	// The repair boost applies to the whole pet while below zero: -1 -> +2.
	advance(p, base, 4*time.Hour+5*petEffectWindow)
	petKandy(t, p)
	require.Equal(t, 2.0, persistedTemperament(t, host))
	// At or above zero the ordinary gain applies: +2 -> +3.
	advance(p, base, 4*time.Hour+6*petEffectWindow)
	petKandy(t, p)
	require.Equal(t, 3.0, persistedTemperament(t, host))
}

// The post-bonk embargo boundary: pets earn nothing within careCalmWindow
// (3h) of the last bonk — accepted and counted, but no temperament effect
// — and land their full repair gain from exactly 3h on.
func TestPet_CareCalmEmbargoBoundary(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	bonkKandy(t, p)
	require.Equal(t, -8.0, persistedTemperament(t, host))

	// One second inside the embargo: stamped and counted, zero effect —
	// and it does NOT consume the pet-effect cooldown.
	advance(p, base, careCalmWindow-time.Second)
	petKandy(t, p)
	require.Equal(t, -8.0, persistedTemperament(t, host))
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	pets, _ := value["pets_given"].(float64)
	require.Equal(t, 1.0, pets, "embargoed pet is still counted")
	require.Empty(t, value["last_pet_effect_at"], "embargoed pet consumes no effect")

	// At exactly 3h the embargo is over and the repair gain lands.
	advance(p, base, careCalmWindow)
	petKandy(t, p)
	require.Equal(t, -8.0+petHealGain, persistedTemperament(t, host))
}

func TestBonk_DistrustWindowRefusesPets(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	base := p.now()

	state := bonkKandy(t, p)
	require.True(t, state.RefusingPets)
	require.Equal(t, "Your kandy got drenched.", state.Flavor)

	// 30s later a pet is refused: no stamp, no temperament change.
	advance(p, base, 30*time.Second)
	refused := petKandy(t, p)
	require.True(t, refused.RefusingPets)
	require.Equal(t, "It doesn't trust you right now.", refused.Flavor)
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	require.Empty(t, value["last_petted_at"], "refused pet does not stamp")
	pets, _ := value["pets_given"].(float64)
	require.Equal(t, 0.0, pets, "refused pet is not counted")

	// 61s after the bonk trust returns and the pet lands.
	advance(p, base, 61*time.Second)
	accepted := petKandy(t, p)
	require.False(t, accepted.RefusingPets)
	value = host.state[stateMapKey(stateScope, "", stateKey)]
	stamp, _ := value["last_petted_at"].(string)
	require.NotEmpty(t, stamp)
}

func TestBonk_DropsDisplayedMoodAndCancelsPetLift(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	base := p.now()

	// bored (60h idle) petted -> content (lift active).
	advance(p, base, 60*time.Hour)
	require.Equal(t, "content", petKandy(t, p).Mood)

	// Bonk: cancels the lift AND drops one more tier -> sad.
	advance(p, base, 60*time.Hour+time.Minute)
	state := bonkKandy(t, p)
	require.Equal(t, "sad", state.Mood, "lift cancelled + one tier down")

	// The drop holds inside 30min and expires after.
	advance(p, base, 60*time.Hour+29*time.Minute)
	require.Equal(t, "sad", fetchKandy(t, p, "").Mood)
	advance(p, base, 60*time.Hour+32*time.Minute)
	require.Equal(t, "bored", fetchKandy(t, p, "").Mood, "mood drop expired")
}

func TestWebhook_TemperamentShape(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	bonkKandy(t, p)

	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var raw map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &raw))
	require.Contains(t, raw, "temperament_band")
	require.Contains(t, raw, "scarred")
	require.Contains(t, raw, "refusing_pets")
	require.Equal(t, "neutral", raw["temperament_band"], "-8 is still neutral")
	// The raw score and care bookkeeping never cross the boundary.
	for _, banned := range []string{
		"temperament", "pets_given", "bonks_given", "last_bonked_at",
		"last_pet_effect_at", "last_passive_heal_at",
	} {
		require.NotContains(t, raw, banned)
	}
}

func TestWebhook_BandFlavorLines(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	fetchKandy(t, p, "debug_grant=100000") // past the egg
	base := p.now()

	// Push to wary (-16), then fearful (-48), checking the flavor bands.
	bonkKandy(t, p)
	advance(p, base, 20*time.Second)
	bonkKandy(t, p)
	// Outside the 30min bonk window so mood/flavor are the resting view.
	advance(p, base, 2*time.Hour)
	require.Contains(t, fetchKandy(t, p, "").Flavor, "warily")
	for i := 0; i < 4; i++ {
		advance(p, base, 3*time.Hour+time.Duration(i)*11*time.Second)
		bonkKandy(t, p)
	}
	advance(p, base, 5*time.Hour)
	state := fetchKandy(t, p, "")
	require.Equal(t, "fearful", state.TemperamentBand)
	require.Contains(t, state.Flavor, "trembles")
}

// Trust gates happiness: wary caps the displayed mood at "content",
// fearful at "bored"; all other bands leave it untouched, and the cap
// never raises a mood already at or below the ceiling.
func TestCapMoodForBand_Table(t *testing.T) {
	moods := []string{"elated", "happy", "content", "bored", "sad", "gloomy"}
	want := map[string][]string{
		// band -> expected displayed mood per base mood (same order).
		"beloved": {"elated", "happy", "content", "bored", "sad", "gloomy"},
		"content": {"elated", "happy", "content", "bored", "sad", "gloomy"},
		"neutral": {"elated", "happy", "content", "bored", "sad", "gloomy"},
		"wary":    {"content", "content", "content", "bored", "sad", "gloomy"},
		"fearful": {"bored", "bored", "bored", "bored", "sad", "gloomy"},
	}
	for band, expected := range want {
		for i, mood := range moods {
			require.Equal(t, expected[i], capMoodForBand(mood, band),
				"band=%s mood=%s", band, mood)
		}
	}
	// Unknown moods pass through untouched rather than snapping to a cap.
	require.Equal(t, "???", capMoodForBand("???", "fearful"))
}

// End-to-end through the webhook: the cap runs LAST, after the pet lift
// and bonk drop, so neither fresh XP (elated) nor petting can bust the
// ceiling of a wary or fearful kandy.
func TestTemperamentCap_GatesDisplayedMood(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	base := p.now()

	// Two spaced bonks -> -16 (wary).
	bonkKandy(t, p)
	advance(p, base, 20*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -16.0, persistedTemperament(t, host))

	// Outside the 30min bonk-drop window: only the cap is in play.
	advance(p, base, 2*time.Hour)
	state := fetchKandy(t, p, "debug_idle_hours=0")
	require.Equal(t, "wary", state.TemperamentBand)
	require.Equal(t, "content", state.Mood, "elated capped at content when wary")
	require.Equal(t, "bored", fetchKandy(t, p, "debug_idle_hours=60").Mood,
		"bored is below the wary ceiling — unchanged")

	// Pet lift never busts the ceiling: content would lift to happy, but
	// the cap runs after the lift.
	petKandy(t, p)
	require.Equal(t, "content", fetchKandy(t, p, "debug_idle_hours=24").Mood,
		"content + pet lift still capped at content")

	// Four more spaced bonks -> -48 (fearful): ceiling drops to bored.
	for i := 0; i < 4; i++ {
		advance(p, base, 3*time.Hour+time.Duration(i)*11*time.Second)
		bonkKandy(t, p)
	}
	advance(p, base, 5*time.Hour)
	state = fetchKandy(t, p, "debug_idle_hours=0")
	require.Equal(t, "fearful", state.TemperamentBand)
	require.Equal(t, "bored", state.Mood, "elated capped at bored when fearful")
	require.Equal(t, "gloomy", fetchKandy(t, p, "debug_idle_hours=200").Mood,
		"gloomy is below the fearful ceiling — unchanged")
}

// A beloved kandy keeps its full mood range: the cap only exists for the
// mistreated bands.
func TestTemperamentCap_BelovedUncapped(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	base := p.now()
	for i := 0; i < 30; i++ {
		advance(p, base, time.Duration(i)*petEffectWindow)
		petKandy(t, p)
	}
	require.Equal(t, 30.0, persistedTemperament(t, host))
	// Past the 60min pet-lift window so the base mood shows raw.
	advance(p, base, 30*petEffectWindow+2*time.Hour)
	state := fetchKandy(t, p, "debug_idle_hours=0")
	require.Equal(t, "beloved", state.TemperamentBand)
	require.Equal(t, "elated", state.Mood, "beloved never caps")
}

func persistedCheckpoint(t *testing.T, host *fakeHost) string {
	t.Helper()
	value, ok := host.state[stateMapKey(stateScope, "", stateKey)]
	require.True(t, ok, "ledger persisted")
	s, _ := value["last_passive_heal_at"].(string)
	return s
}

// Time heals (v0.6.4): the pure accrual rule, table-driven.
func TestPassiveHealUpdate_Table(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	ago := func(d time.Duration) string { return now.Add(-d).Format(time.RFC3339) }
	day := 24 * time.Hour
	tests := []struct {
		name           string
		in             ledger
		wantTemp       float64
		wantChanged    bool
		wantCheckpoint string
	}{
		{"fond ledger without a checkpoint: stamped now, never retro-faded",
			ledger{Temperament: 5}, 5, true, ago(0)},
		{"zero temperament untouched",
			ledger{Temperament: 0, LastPassiveHealAt: ago(10 * day)},
			0, false, ago(10 * day)},
		{"migration: missing checkpoint inits to now, no retro-heal",
			ledger{Temperament: -78, LastBonkedAt: ago(10 * day)},
			-78, true, ago(0)},
		{"no accrual within 24h of bonk",
			ledger{Temperament: -20, LastBonkedAt: ago(23 * time.Hour), LastPassiveHealAt: ago(48 * time.Hour)},
			-20, false, ago(48 * time.Hour)},
		{"bonk exactly 24h old opens the gate: one full day heals +4",
			ledger{Temperament: -20, LastBonkedAt: ago(day), LastPassiveHealAt: ago(30 * time.Hour)},
			-16, true, ago(0)},
		{"partial day accrues nothing",
			ledger{Temperament: -20, LastBonkedAt: ago(48 * time.Hour), LastPassiveHealAt: ago(23 * time.Hour)},
			-20, false, ago(23 * time.Hour)},
		{"checkpoint newer than bonk wins the accrual start",
			ledger{Temperament: -20, LastBonkedAt: ago(50 * time.Hour), LastPassiveHealAt: ago(26 * time.Hour)},
			-16, true, ago(2 * time.Hour)},
		{"multiple full days accrue together, checkpoint keeps the remainder",
			ledger{Temperament: -78, LastBonkedAt: ago(20 * day), LastPassiveHealAt: ago(10*day + 5*time.Hour)},
			-38, true, ago(5 * time.Hour)},
		{"clamps at exactly zero",
			ledger{Temperament: -3, LastBonkedAt: ago(6 * day), LastPassiveHealAt: ago(5 * day)},
			0, true, ago(0)},
		{"never rises above zero no matter the accrual",
			ledger{Temperament: -1, LastBonkedAt: ago(40 * day), LastPassiveHealAt: ago(30 * day)},
			0, true, ago(0)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.in
			require.Equal(t, tc.wantChanged, passiveHealUpdate(&l, now))
			require.Equal(t, tc.wantTemp, l.Temperament)
			require.Equal(t, tc.wantCheckpoint, l.LastPassiveHealAt)
		})
	}
}

// The checkpoint persists through Host state and healing is never
// double-applied: repeated webhook computations inside the same accrual
// day change nothing.
func TestPassiveHeal_CheckpointPersistedNoDoubleApply(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// Two spaced bonks: -16; the checkpoint initializes at the second bonk
	// (first sight of a hurt ledger).
	bonkKandy(t, p)
	advance(p, base, 20*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -16.0, persistedTemperament(t, host))
	require.Equal(t, base.Add(20*time.Second).Format(time.RFC3339),
		persistedCheckpoint(t, host))

	// 26h later one full day has accrued: +4; the checkpoint advances by
	// exactly one day, keeping the partial-day remainder accruing.
	advance(p, base, 26*time.Hour)
	require.Equal(t, "wary", fetchKandy(t, p, "").TemperamentBand)
	require.Equal(t, -12.0, persistedTemperament(t, host))
	require.Equal(t, base.Add(20*time.Second).Add(24*time.Hour).Format(time.RFC3339),
		persistedCheckpoint(t, host))

	// Recomputing at the same instant — and again 20h later, still inside
	// the next accrual day — applies nothing more.
	fetchKandy(t, p, "")
	require.Equal(t, -12.0, persistedTemperament(t, host))
	advance(p, base, 46*time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, -12.0, persistedTemperament(t, host))

	// The next full day lands the next +4.
	advance(p, base, 49*time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, -8.0, persistedTemperament(t, host))
}

// A fresh bonk re-gates the passive drift: nothing accrues within 24h of
// the new bonk, then accrual restarts from the bonk stamp.
func TestPassiveHeal_FreshBonkRegatesAccrual(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	bonkKandy(t, p) // -8; checkpoint initializes on the next computation
	advance(p, base, time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, base.Add(time.Hour).Format(time.RFC3339),
		persistedCheckpoint(t, host))

	// One full day past the checkpoint: -8 -> -4.
	advance(p, base, 30*time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, -4.0, persistedTemperament(t, host))

	// A fresh bonk (-12) closes the gate for 24h...
	advance(p, base, 30*time.Hour+time.Minute)
	bonkKandy(t, p)
	require.Equal(t, -12.0, persistedTemperament(t, host))
	advance(p, base, 53*time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, -12.0, persistedTemperament(t, host))

	// ...and once it reopens, accrual restarts from the bonk stamp.
	advance(p, base, 55*time.Hour+time.Minute)
	fetchKandy(t, p, "")
	require.Equal(t, -8.0, persistedTemperament(t, host))
}

// Migration: a pre-0.6.4 hurt ledger has no last_passive_heal_at. The
// chosen semantic is NO retro-heal — on first sight the checkpoint is set
// to now and the score is untouched, so upgrading never pays out a lump
// for old neglect; passive healing starts earning from the upgrade moment.
func TestPassiveHeal_MigrationDefaultNoRetroHeal(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()
	host.state[stateMapKey(stateScope, "", stateKey)] = map[string]any{
		"xp":             500.0,
		"salt":           42.0,
		"created_at":     base.Add(-30 * 24 * time.Hour).Format(time.RFC3339),
		"updated_at":     base.Add(-10 * 24 * time.Hour).Format(time.RFC3339),
		"temperament":    -78.0,
		"last_bonked_at": base.Add(-10 * 24 * time.Hour).Format(time.RFC3339),
	}

	// First computation: 10 bonk-free days of history earn NOTHING.
	state := fetchKandy(t, p, "")
	require.Equal(t, "fearful", state.TemperamentBand)
	require.Equal(t, -78.0, persistedTemperament(t, host))
	require.Equal(t, base.Format(time.RFC3339), persistedCheckpoint(t, host))

	// From the upgrade moment onward time heals normally: one day -> +4.
	advance(p, base, 25*time.Hour)
	fetchKandy(t, p, "")
	require.Equal(t, -74.0, persistedTemperament(t, host))
}

// The hard integrity rule: an arbitrary pet/bonk sequence leaves every
// XP-derived fact byte-identical, and never touches the ledger's xp,
// award_seq, or last_award_at.
func TestCare_NeverTouchesXPFacts(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	for i := 0; i < 40; i++ {
		require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	}
	base := p.now()

	snapshot := func() []byte {
		s := fetchKandy(t, p, "")
		b, err := json.Marshal(map[string]any{
			"level": s.Level, "progress_pct": s.ProgressPct, "award_seq": s.AwardSeq,
		})
		require.NoError(t, err)
		return b
	}
	ledgerFacts := func() string {
		v := host.state[stateMapKey(stateScope, "", stateKey)]
		return fmt.Sprintf("%v|%v|%v", v["xp"], v["award_seq"], v["last_award_at"])
	}
	before := snapshot()
	factsBefore := ledgerFacts()

	// Arbitrary care chaos: pets, spam bonks, refused pets, spaced bonks,
	// heal pets, across clock jumps.
	step := time.Duration(0)
	for i := 0; i < 60; i++ {
		step += time.Duration((i%7)*13) * time.Second
		advance(p, base, step)
		if i%3 == 0 {
			bonkKandy(t, p)
		} else {
			petKandy(t, p)
		}
	}
	for i := 0; i < 20; i++ {
		advance(p, base, 48*time.Hour+time.Duration(i)*petEffectWindow)
		petKandy(t, p)
	}

	advance(p, base, 0)
	require.Equal(t, string(before), string(snapshot()),
		"level/progress_pct/award_seq byte-identical across the care sequence")
	require.Equal(t, factsBefore, ledgerFacts(),
		"xp, award_seq and last_award_at untouched in the persisted ledger")
}

// Affection fades (v0.11.0): the mirror of "time heals". Neglect walks a
// fond kandy back toward neutral — and stops there. Only a bucket can make
// it distrust you.
func TestAffectionFadeUpdate_Table(t *testing.T) {
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	const day = 24 * time.Hour
	ago := func(d time.Duration) string { return now.Add(-d).UTC().Format(time.RFC3339) }

	for _, tc := range []struct {
		name           string
		in             ledger
		wantTemp       float64
		wantChanged    bool
		wantCheckpoint string
	}{
		{"petted today: nothing fades",
			ledger{Temperament: 32, LastPetEffectAt: ago(3 * time.Hour), LastPassiveHealAt: ago(9 * day)},
			32, false, ago(9 * day)},
		{"a full day since the last treat: one day's fade",
			ledger{Temperament: 32, LastPetEffectAt: ago(1 * day), LastPassiveHealAt: ago(1 * day)},
			32 - affectionFadePerDay, true, ago(0)},
		{"two days of silence cost two days of fade",
			ledger{Temperament: 32, LastPetEffectAt: ago(2 * day), LastPassiveHealAt: ago(2 * day)},
			32 - 2*affectionFadePerDay, true, ago(0)},
		{"a week of neglect walks beloved to neutral, never below",
			ledger{Temperament: 32, LastPetEffectAt: ago(8 * day), LastPassiveHealAt: ago(8 * day)},
			0, true, ago(0)},
		{"partial days do not accrue",
			ledger{Temperament: 20, LastPetEffectAt: ago(30 * time.Hour), LastPassiveHealAt: ago(30 * time.Hour)},
			20 - affectionFadePerDay, true, ago(6 * time.Hour)},
		{"the clock runs from the LAST treat, not the older checkpoint",
			ledger{Temperament: 20, LastPetEffectAt: ago(2 * day), LastPassiveHealAt: ago(9 * day)},
			20 - 2*affectionFadePerDay, true, ago(0)},
		{"a hurt kandy still heals upward (the other direction is untouched)",
			ledger{Temperament: -20, LastBonkedAt: ago(9 * day), LastPassiveHealAt: ago(2 * day)},
			-20 + 2*passiveHealPerDay, true, ago(0)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.in
			changed := passiveHealUpdate(&l, now)
			require.Equal(t, tc.wantChanged, changed)
			require.InDelta(t, tc.wantTemp, l.Temperament, 1e-9)
			if tc.wantCheckpoint != "" {
				require.Equal(t, tc.wantCheckpoint, l.LastPassiveHealAt)
			}
		})
	}
}

// Neglect must never manufacture distrust: from any positive score, any
// amount of silence lands exactly on neutral and stops.
func TestAffectionFade_FloorsAtNeutralNeverWary(t *testing.T) {
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	const day = 24 * time.Hour
	for _, start := range []float64{1, 10, 30, 100} {
		for _, silence := range []time.Duration{5 * day, 30 * day, 365 * day} {
			l := ledger{
				Temperament:       start,
				LastPetEffectAt:   now.Add(-silence).UTC().Format(time.RFC3339),
				LastPassiveHealAt: now.Add(-silence).UTC().Format(time.RFC3339),
			}
			passiveHealUpdate(&l, now)
			require.GreaterOrEqual(t, l.Temperament, 0.0,
				"neglect never pushes below neutral (start %v, silence %v)", start, silence)
			require.NotEqual(t, "wary", temperamentBand(l.Temperament))
			require.NotEqual(t, "fearful", temperamentBand(l.Temperament))
		}
	}
}
