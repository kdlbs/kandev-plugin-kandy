// Care-system tests: temperament math (bounds, rate limits, slow heal,
// scar latch), the bonk/pet webhooks, distrust, and — most importantly —
// the hard invariant that pets and bonks NEVER touch XP-derived facts.
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
	// Pets inside the 10min effect window still stamp (mood lift) but add
	// no temperament.
	advance(p, base, 3*time.Minute)
	petKandy(t, p)
	require.Equal(t, petTemperamentGain, persistedTemperament(t, host))
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	pets, _ := value["pets_given"].(float64)
	require.Equal(t, 2.0, pets, "every pet is counted")
	// Past the window the next pet lands its effect.
	advance(p, base, petEffectWindow+time.Second)
	petKandy(t, p)
	require.Equal(t, 2*petTemperamentGain, persistedTemperament(t, host))
}

func TestPet_HealsNegativeSlowly_OnlyUnderConsistentCare(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	base := p.now()

	// Two spaced bonks: temperament -16.
	bonkKandy(t, p)
	advance(p, base, 20*time.Second)
	bonkKandy(t, p)
	require.Equal(t, -16.0, persistedTemperament(t, host))

	// Petting within 24h of a bonk: accepted (past distrust) but heals
	// NOTHING — care isn't consistent the same day you hit it.
	advance(p, base, 2*time.Hour)
	petKandy(t, p)
	require.Equal(t, -16.0, persistedTemperament(t, host))

	// Past the calm window pets heal at petHealGain per effective pet —
	// half the positive-side rate. -16 -> 0 needs 32 effective pets.
	for i := 0; i < 32; i++ {
		advance(p, base, 25*time.Hour+time.Duration(i)*petEffectWindow)
		petKandy(t, p)
	}
	require.Equal(t, 0.0, persistedTemperament(t, host))
	// From zero the full gain applies again.
	advance(p, base, 25*time.Hour+33*petEffectWindow)
	petKandy(t, p)
	require.Equal(t, petTemperamentGain, persistedTemperament(t, host))
}

func TestBonk_DistrustWindowRefusesPets(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	base := p.now()

	state := bonkKandy(t, p)
	require.True(t, state.RefusingPets)
	require.Equal(t, "Your kandy flinched.", state.Flavor)

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
		"temperament", "pets_given", "bonks_given", "last_bonked_at", "last_pet_effect_at",
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
