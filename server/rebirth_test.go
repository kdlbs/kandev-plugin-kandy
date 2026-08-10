// rebirth_test.go — reaching level 100 retires the kandy into the scene
// background and hatches a fresh egg (see applyRebirth). Covers what crosses
// the rebirth and what does not, the ancestor list, the presentation
// boundary, and the seal migration that makes the new fields safe to add.
package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

// saltChain replaces the plugin's random salt source with a deterministic
// sequence, so a test can name the DNA of every generation.
func saltChain(p *plugin, salts ...uint32) {
	i := 0
	p.saltFunc = func() uint32 {
		if i >= len(salts) {
			return salts[len(salts)-1] + uint32(i)
		}
		out := salts[i]
		i++
		return out
	}
}

// grownLedger is a kandy resting at the top of the band, one award short
// of ascending.
func grownLedger(salt uint32) *ledger {
	return &ledger{
		XP:          thresholdXP(ascendLevel) - 1,
		Messages:    900,
		Turns:       400,
		AgentRuns:   80,
		Salt:        salt,
		CreatedAt:   "2023-01-01T00:00:00Z",
		UpdatedAt:   "2026-07-28T00:00:00Z",
		AwardSeq:    12345,
		LastAwardAt: "2026-07-28T11:00:00Z",
	}
}

// The victory lap: level 100 is a resting place, not a trigger. Two and a
// half years of raising it earn a full level's worth of standing around in
// the finished form — the ascension waits for the award that would leave the
// band entirely.
func TestRebirth_Level100IsAVictoryLapNotATrigger(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	saltChain(p, 777)
	ctx := context.Background()

	l := grownLedger(4242)
	l.XP = thresholdXP(bandMax) // the award that REACHES the top of the band
	seedSealed(host, l, testSealKey())

	view := fetchKandy(t, p, "")
	require.Equal(t, bandMax, view.Level, "it rests at 100")
	require.Equal(t, 1, view.Generation, "and is still the first of its line")
	require.Empty(t, view.Ancestors)

	// A month of ordinary work later it is still the same creature.
	for i := 0; i < 50; i++ {
		require.NoError(t, p.OnEvent(ctx, busEvent(eventAgentCompleted, map[string]any{"agent_id": "a"})))
	}
	after := fetchKandy(t, p, "")
	require.Equal(t, bandMax, after.Level)
	require.Equal(t, 1, after.Generation)
	require.Equal(t, view.LineageSeed, after.LineageSeed, "same DNA, same creature")
	require.Greater(t, after.ProgressPct, 0.0, "the lap is measurable")
}

func TestRebirth_AscendingRetiresIntoAnAncestorAndLaysANewEgg(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	saltChain(p, 777)
	l := grownLedger(4242)
	require.Equal(t, bandMax, levelForXP(l.XP), "the fixture is resting at the top of the band")

	l.XP += 1 // the award that closes the band
	p.applyRebirth(l)

	require.Equal(t, 1, levelForXP(l.XP), "a fresh egg")
	require.Equal(t, 2, generationOf(l))
	require.Equal(t, uint32(777), l.Salt, "new DNA")
	require.Equal(t, "2026-07-28T12:00:00Z", l.CreatedAt, "the egg was laid now")
	require.Equal(t, "2026-07-28T12:00:00Z", l.RebornAt)
	require.Zero(t, l.Messages)
	require.Zero(t, l.Turns)
	require.Zero(t, l.AgentRuns)

	require.Len(t, l.Ancestors, 1)
	elder := l.Ancestors[0]
	require.Equal(t, uint32(4242), elder.Salt, "the elder keeps the DNA it grew with")
	require.Equal(t, bandMax, elder.Level)
	require.Equal(t, "2023-01-01T00:00:00Z", elder.BornAt)
	require.Equal(t, "2026-07-28T12:00:00Z", elder.RetiredAt)
}

// The award bookkeeping is deliberately NOT reset: the egg was laid by work
// that just landed, so it starts fed rather than instantly bored.
func TestRebirth_KeepsTheAwardBookkeeping(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	saltChain(p, 777)
	l := grownLedger(4242)
	l.XP = thresholdXP(ascendLevel)
	p.applyRebirth(l)

	require.Equal(t, int64(12345), l.AwardSeq)
	require.Equal(t, "2026-07-28T11:00:00Z", l.LastAwardAt)
	require.Equal(t, "happy", p.presentLedger(l, nil).Mood, "an hour after the award that hatched it")
}

// No shipped work is swallowed by the moment the ledger tips over: only the
// band itself is spent, and the surplus starts the next one.
func TestRebirth_CarriesTheOverflowIntoTheEgg(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	saltChain(p, 777)
	l := grownLedger(4242)
	l.XP = thresholdXP(ascendLevel) + 137

	p.applyRebirth(l)

	require.InDelta(t, 137.0, l.XP, 1e-6)
	require.Equal(t, 1, levelForXP(l.XP))
	require.Greater(t, p.presentLedger(l, nil).ProgressPct, 0.0, "the egg is already warming")
}

// The bond is with the keeper, not the body: a new creature has heard about
// you, but only second-hand. A scar belongs to the body that earned it.
func TestRebirth_HalvesTemperamentAndClearsTheScar(t *testing.T) {
	for _, tc := range []struct {
		name string
		from float64
		want float64
	}{
		{"beloved", 80, 40},
		{"traumatised", -90, -45},
		{"neutral", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newTestPlugin(t, newFakeHost(nil))
			saltChain(p, 777)
			l := grownLedger(4242)
			l.XP = thresholdXP(ascendLevel)
			l.Temperament = tc.from
			l.Scarred = true

			p.applyRebirth(l)

			require.InDelta(t, tc.want, l.Temperament, 1e-9)
			require.False(t, l.Scarred, "the new body carries no scar")
			require.True(t, l.Ancestors[0].Scarred, "the elder still wears it")
		})
	}
}

// The counterfeit mark outlives every lineage — exactly what seal.go promises.
func TestRebirth_CounterfeitSurvivesTheAscension(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	saltChain(p, 777)
	l := grownLedger(4242)
	l.XP = thresholdXP(ascendLevel)
	l.Counterfeit = true

	p.applyRebirth(l)

	require.True(t, l.Counterfeit)
	require.True(t, p.presentLedger(l, nil).Counterfeit)
}

// The creature is re-rolled; the place is not. The elders stand in this
// scene, so the habitat must not swap out from under them.
func TestRebirth_BiomeStaysWithTheLineage(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	// Salts chosen so the naive (per-creature) biome would differ.
	saltChain(p, 3, 9, 17)
	l := grownLedger(1)
	homeBiome := p.presentLedger(l, nil).Biome

	for gen := 2; gen <= 4; gen++ {
		l.XP = thresholdXP(ascendLevel)
		p.applyRebirth(l)
		view := p.presentLedger(l, nil)
		require.Equal(t, gen, view.Generation)
		require.Equal(t, homeBiome, view.Biome, "generation %d moved house", gen)
	}
	require.NotEqual(t, uint32(0), l.HomeSalt)
}

func TestRebirth_AncestorListIsCappedOldestFirst(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	salts := make([]uint32, 0, maxAncestors+3)
	for i := 0; i < maxAncestors+3; i++ {
		salts = append(salts, uint32(1000+i))
	}
	saltChain(p, salts...)
	l := grownLedger(500)

	for i := 0; i < maxAncestors+2; i++ {
		l.XP = thresholdXP(ascendLevel)
		p.applyRebirth(l)
	}

	require.Len(t, l.Ancestors, maxAncestors, "the ledger row stays small")
	require.Equal(t, maxAncestors+3, generationOf(l), "the generation count never truncates")
	// Oldest kept first; the two eldest (salt 500 and 1000) were dropped.
	require.Equal(t, uint32(1001), l.Ancestors[0].Salt)
	require.Equal(t, salts[maxAncestors], l.Ancestors[len(l.Ancestors)-1].Salt)

	// Presented generations count back from the living one, so a truncated
	// list never renumbers the elders it still holds.
	views := presentAncestors(l)
	require.Len(t, views, maxAncestors)
	require.Equal(t, generationOf(l)-maxAncestors, views[0].Generation)
	require.Equal(t, generationOf(l)-1, views[len(views)-1].Generation)
}

// ?debug_grant can hand over more XP than several bands at once. The loop is
// bounded and the ledger lands somewhere sane rather than spinning.
func TestRebirth_AbsurdGrantIsBounded(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	saltChain(p, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
	l := grownLedger(500)
	l.XP = thresholdXP(ascendLevel) * 1e6

	p.applyRebirth(l)

	require.Equal(t, maxRebirthsPerAward+1, generationOf(l))
	require.Equal(t, bandMax, levelForXP(l.XP), "parked at the top of the band, not spinning")
}

// Only real growth closes the band: care never touches XP, so it can never
// trigger an ascension.
func TestRebirth_CareNeverAscends(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	saltChain(p, 777)
	ctx := context.Background()

	seedSealed(host, grownLedger(4242), testSealKey())
	require.Equal(t, bandMax, fetchKandy(t, p, "").Level)

	p.handlePet(ctx)
	p.handleBonk(ctx)

	view := fetchKandy(t, p, "")
	require.Equal(t, bandMax, view.Level)
	require.Equal(t, 1, view.Generation)
	require.Empty(t, view.Ancestors)
}

// End to end: bus events feed the kandy over the threshold and the webhook
// reports the new egg with its elder.
func TestRebirth_ThroughOnEventAndWebhook(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	saltChain(p, 777)
	ctx := context.Background()

	l := grownLedger(4242)
	l.XP = thresholdXP(ascendLevel) - 1
	seedSealed(host, l, testSealKey())

	require.NoError(t, p.OnEvent(ctx, busEvent(eventAgentCompleted, map[string]any{"agent_id": "a1"})))

	view := fetchKandy(t, p, "")
	require.Equal(t, 1, view.Level)
	require.Equal(t, "Egg", view.StageName)
	require.Equal(t, 2, view.Generation)
	require.Equal(t, "A new egg. The elders watch from the treeline.", view.Flavor)
	require.Len(t, view.Ancestors, 1)
	require.Equal(t, bandMax, view.Ancestors[0].Level)
	require.Equal(t, archetypeForLineage(4242), view.Ancestors[0].Archetype)
	require.Equal(t, lineageSeed(4242), view.Ancestors[0].LineageSeed)
	require.Equal(t, stageName(4242, bandMax), view.Ancestors[0].StageName)

	// It survives the round-trip through Host state.
	stored := persistedLedger(t, host)
	require.Equal(t, 2, stored.Generation)
	require.Len(t, stored.Ancestors, 1)
	require.True(t, sealValid(stored, testSealKey()))
}

// The presentation boundary holds for the dead as well as the living: the
// raw DNA salt never reaches the UI.
func TestRebirth_WebhookNeverLeaksAncestorSalts(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	saltChain(p, 777)

	l := grownLedger(0xDEADBEEF)
	l.XP = thresholdXP(ascendLevel)
	p.applyRebirth(l)
	seedSealed(host, l, testSealKey())

	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var raw map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &raw))
	elders, _ := raw["ancestors"].([]any)
	require.Len(t, elders, 1)
	elder, _ := elders[0].(map[string]any)
	require.NotContains(t, elder, "salt")
	require.NotContains(t, elder, "born_at")
	require.NotContains(t, string(resp.Body), "3735928559", "the ancestor salt must not appear anywhere")
}

// A pre-0.13 install carries a genuine v1 signature. It must migrate to the
// current scheme silently — never be read as tampering.
func TestRebirth_SealV1LedgerMigratesInsteadOfRebirthing(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	key := testSealKey()

	old := grownLedger(4242)
	old.Sealv = 1
	old.Sig = ledgerSig(old, key, 1)
	host.state[stateMapKey(stateScope, "", stateKey)] = ledgerToMap(old)
	host.secrets[secretKeyLedgerHMAC] = hex.EncodeToString(key)

	view := fetchKandy(t, p, "")
	require.False(t, view.Counterfeit, "an honest v1 ledger is not a forgery")
	require.Equal(t, bandMax, view.Level, "nothing was lost")

	stored := persistedLedger(t, host)
	require.Equal(t, sealVersion, stored.Sealv, "re-sealed at the current scheme")
	require.True(t, sealValid(stored, key))
}

// A v1 signature does not cover the rebirth fields, so anything sitting in
// them was written by something other than this plugin. The migration drops
// them rather than sealing a fabricated lineage in place.
func TestRebirth_SealMigrationDropsUnsignedLineageFields(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	key := testSealKey()

	old := grownLedger(4242)
	old.Sealv = 1
	old.Sig = ledgerSig(old, key, 1)
	row := ledgerToMap(old)
	// A raw DB edit smuggling in a lineage the v1 scheme never signed.
	row["generation"] = float64(9)
	row["ancestors"] = []any{map[string]any{"salt": float64(1), "level": float64(100)}}
	host.state[stateMapKey(stateScope, "", stateKey)] = row
	host.secrets[secretKeyLedgerHMAC] = hex.EncodeToString(key)

	view := fetchKandy(t, p, "")
	require.Equal(t, 1, view.Generation, "the forged generation is dropped")
	require.Empty(t, view.Ancestors)
	require.False(t, view.Counterfeit, "the rest of the ledger is genuine")
}

// A v2 ledger whose sealv is edited to an unknown scheme is not verifiable
// and must be treated as tampering, not accepted.
func TestRebirth_UnknownSealVersionIsInvalid(t *testing.T) {
	key := testSealKey()
	l := fullLedger()
	sealLedger(l, key)
	l.Sealv = sealVersion + 1
	require.False(t, sealValid(l, key))
	l.Sealv = 0
	require.False(t, sealValid(l, key))
}

func TestGenerationLabelAndEggFlavor(t *testing.T) {
	require.Equal(t, "", generationLabel(1))
	require.Equal(t, "", generationLabel(0))
	require.Equal(t, "Gen II", generationLabel(2))
	require.Equal(t, "Gen IX", generationLabel(9))
	require.Equal(t, "The egg is warm. Keep working.", eggFlavor(1))
	require.Contains(t, eggFlavor(4), "elders")
}

// A lineage that has never rebirthed reports exactly what it always did.
func TestRebirth_FirstGenerationPresentationIsUnchanged(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	l := &ledger{Salt: 4242, CreatedAt: "2026-01-01T00:00:00Z", XP: 5000}
	view := p.presentLedger(l, nil)
	require.Equal(t, 1, view.Generation)
	require.Nil(t, view.Ancestors)
	require.Empty(t, view.RebornAt)
	require.Equal(t, biomeForLineage(4242), view.Biome)
}
