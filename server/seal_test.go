// seal_test.go — the anti-tamper seal (v0.9.0). Covers canonical-signature
// stability, the full load-time decision table (grandfather / valid /
// tampered / vault error / deleted row), counterfeit permanence, and the
// webhook exposure rules. The feature IS these tests: a false "counterfeit"
// verdict on an infrastructure error would be worse than missing a forgery.
package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

func testSealKey() []byte { return bytes.Repeat([]byte{0xAB}, 32) }

// fullLedger populates EVERY sealed field so the canonicality test can
// prove each one participates in the signature.
func fullLedger() *ledger {
	return &ledger{
		XP:                5000,
		Messages:          10,
		Turns:             20,
		AgentRuns:         3,
		Salt:              7,
		CreatedAt:         "2026-07-01T00:00:00Z",
		UpdatedAt:         "2026-07-27T00:00:00Z",
		AwardSeq:          33,
		LastAwardAt:       "2026-07-27T00:00:00Z",
		LastPettedAt:      "2026-07-26T00:00:00Z",
		PetsGiven:         5,
		BonksGiven:        2,
		Temperament:       -12.5,
		Scarred:           true,
		LastBonkedAt:      "2026-07-20T00:00:00Z",
		LastPetEffectAt:   "2026-07-26T00:00:00Z",
		LastPassiveHealAt: "2026-07-25T00:00:00Z",
		Counterfeit:       false,
		Generation:        3,
		HomeSalt:          991,
		RebornAt:          "2026-07-10T00:00:00Z",
		Ancestors: []ancestorRecord{
			{Salt: 11, Level: 100, BornAt: "2026-01-01T00:00:00Z", RetiredAt: "2026-04-01T00:00:00Z"},
			{Salt: 12, Level: 100, BornAt: "2026-04-01T00:00:00Z", RetiredAt: "2026-07-10T00:00:00Z", Scarred: true},
		},
	}
}

// seedSealed persists a properly sealed ledger and its vault key — the
// state of a healthy install where sealing has begun.
func seedSealed(host *fakeHost, l *ledger, key []byte) {
	sealLedger(l, key)
	host.state[stateMapKey(stateScope, "", stateKey)] = ledgerToMap(l)
	host.secrets[secretKeyLedgerHMAC] = hex.EncodeToString(key)
}

func persistedLedger(t *testing.T, host *fakeHost) *ledger {
	t.Helper()
	value, ok := host.state[stateMapKey(stateScope, "", stateKey)]
	require.True(t, ok, "ledger persisted")
	return ledgerFromMap(value)
}

func TestSeal_SameLedgerSameSig(t *testing.T) {
	key := testSealKey()
	a, b := fullLedger(), fullLedger()
	sealLedger(a, key)
	sealLedger(b, key)
	require.NotEmpty(t, a.Sig)
	require.Equal(t, a.Sig, b.Sig, "identical ledgers must seal identically")
	// Re-sealing an already-sealed ledger is stable (sig excludes itself).
	prev := a.Sig
	sealLedger(a, key)
	require.Equal(t, prev, a.Sig)
	require.True(t, sealValid(a, key))
	require.False(t, sealValid(a, bytes.Repeat([]byte{0xCD}, 32)), "different key, different sig")
}

func TestSeal_EveryFieldChangesTheSig(t *testing.T) {
	key := testSealKey()
	base := fullLedger()
	sealLedger(base, key)
	mutations := map[string]func(*ledger){
		"xp":                   func(l *ledger) { l.XP++ },
		"messages":             func(l *ledger) { l.Messages++ },
		"turns":                func(l *ledger) { l.Turns++ },
		"agent_runs":           func(l *ledger) { l.AgentRuns++ },
		"salt":                 func(l *ledger) { l.Salt++ },
		"created_at":           func(l *ledger) { l.CreatedAt = "2026-07-02T00:00:00Z" },
		"updated_at":           func(l *ledger) { l.UpdatedAt = "2026-07-28T00:00:00Z" },
		"award_seq":            func(l *ledger) { l.AwardSeq++ },
		"last_award_at":        func(l *ledger) { l.LastAwardAt = "2026-07-28T00:00:00Z" },
		"last_petted_at":       func(l *ledger) { l.LastPettedAt = "" },
		"pets_given":           func(l *ledger) { l.PetsGiven++ },
		"bonks_given":          func(l *ledger) { l.BonksGiven++ },
		"temperament":          func(l *ledger) { l.Temperament += 0.5 },
		"scarred":              func(l *ledger) { l.Scarred = false },
		"last_bonked_at":       func(l *ledger) { l.LastBonkedAt = "" },
		"last_pet_effect_at":   func(l *ledger) { l.LastPetEffectAt = "" },
		"last_passive_heal_at": func(l *ledger) { l.LastPassiveHealAt = "" },
		"counterfeit":          func(l *ledger) { l.Counterfeit = true },
		"generation":           func(l *ledger) { l.Generation++ },
		"home_salt":            func(l *ledger) { l.HomeSalt++ },
		"reborn_at":            func(l *ledger) { l.RebornAt = "" },
		"ancestor_count":       func(l *ledger) { l.Ancestors = l.Ancestors[:1] },
		"ancestor_salt":        func(l *ledger) { l.Ancestors[0].Salt++ },
		"ancestor_level":       func(l *ledger) { l.Ancestors[1].Level = 42 },
		"ancestor_born_at":     func(l *ledger) { l.Ancestors[0].BornAt = "" },
		"ancestor_retired_at":  func(l *ledger) { l.Ancestors[1].RetiredAt = "" },
		"ancestor_scarred":     func(l *ledger) { l.Ancestors[1].Scarred = false },
	}
	for field, mutate := range mutations {
		l := fullLedger()
		mutate(l)
		sealLedger(l, key)
		require.NotEqual(t, base.Sig, l.Sig, "changing %s must change the sig", field)
		mutated := fullLedger()
		mutate(mutated)
		mutated.Sig = base.Sig
		mutated.Sealv = sealVersion
		require.False(t, sealValid(mutated, key), "old sig must not cover a changed %s", field)
	}
}

// GRANDFATHER: an install upgrading to 0.9.0 has a ledger but no vault key.
// The first load creates the key and seals the ledger exactly as it is —
// nothing is lost, nothing is marked, and updated_at is not touched.
func TestSeal_GrandfathersUnsignedLedger(t *testing.T) {
	host := newFakeHost(nil)
	host.state[stateMapKey(stateScope, "", stateKey)] = map[string]any{
		"xp": 5000.0, "salt": 7.0,
		"created_at": "2026-07-01T00:00:00Z",
		"updated_at": "2026-07-28T00:00:00Z",
	}
	p := newTestPlugin(t, host)

	state := fetchKandy(t, p, "")
	require.Equal(t, levelForXP(5000), state.Level, "existing kandys keep everything")
	require.False(t, state.Counterfeit)

	keyHex, ok := host.secrets[secretKeyLedgerHMAC]
	require.True(t, ok, "first load mints the vault key")
	key, err := hex.DecodeString(keyHex)
	require.NoError(t, err)
	require.Len(t, key, 32)

	sealed := persistedLedger(t, host)
	require.True(t, sealValid(sealed, key), "ledger sealed in place")
	require.Equal(t, 5000.0, sealed.XP)
	require.Equal(t, "2026-07-28T00:00:00Z", sealed.UpdatedAt, "grandfathering is not a mutation")
	require.False(t, sealed.Counterfeit)

	// A restart later verifies and accepts the grandfathered seal.
	p2 := newTestPlugin(t, host)
	require.Equal(t, levelForXP(5000), fetchKandy(t, p2, "").Level)
	require.False(t, fetchKandy(t, p2, "").Counterfeit)
}

func TestSeal_ValidSignatureAccepted(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	p := newTestPlugin(t, host)

	state := fetchKandy(t, p, "")
	require.Equal(t, levelForXP(5000), state.Level)
	require.False(t, state.Counterfeit)
	require.Equal(t, int64(33), state.AwardSeq, "nothing reset")
}

// TAMPERED: a direct DB edit of any sealed field (here: the classic
// xp bump) rebirths a marked counterfeit — fresh DNA, everything zeroed,
// and the permanent mark.
func TestSeal_TamperedXPRebirthsCounterfeit(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	host.state[stateMapKey(stateScope, "", stateKey)]["xp"] = 999999.0

	p := newTestPlugin(t, host)
	state := fetchKandy(t, p, "")
	require.Equal(t, 1, state.Level, "back to the egg")
	require.True(t, state.Counterfeit, "the mark")
	require.Equal(t, int64(0), state.AwardSeq)
	require.False(t, state.Scarred, "the scar does not carry over")
	require.Equal(t, "neutral", state.TemperamentBand)
	require.Equal(t, lineageSeed(42), state.LineageSeed, "new random salt = new DNA")
	require.Equal(t, "2026-07-28T12:00:00Z", state.AliveSince, "created_at is now")

	reborn := persistedLedger(t, host)
	require.Zero(t, reborn.XP)
	require.Zero(t, reborn.Messages)
	require.Zero(t, reborn.Turns)
	require.Zero(t, reborn.AgentRuns)
	require.Zero(t, reborn.PetsGiven)
	require.Zero(t, reborn.BonksGiven)
	require.Zero(t, reborn.Temperament)
	require.True(t, reborn.Counterfeit)
	require.True(t, sealValid(reborn, testSealKey()), "the rebirth itself is sealed")
}

// Deleting just the signature while the key exists is also tampering: an
// unsigned ledger under a live key is exactly what a forger who cannot
// compute sigs would leave behind.
func TestSeal_SigDeletedWithKeyPresentRebirths(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	delete(host.state[stateMapKey(stateScope, "", stateKey)], "sig")

	p := newTestPlugin(t, host)
	state := fetchKandy(t, p, "")
	require.Equal(t, 1, state.Level)
	require.True(t, state.Counterfeit)
}

// Infrastructure errors are NEVER tampering. With the vault down the ledger
// is served as-is (even one that would fail verification), nothing is
// persisted, and the next load retries.
func TestSeal_VaultErrorNeverRebirths(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	host.state[stateMapKey(stateScope, "", stateKey)]["xp"] = 999999.0
	host.getSecretErr = errors.New("vault down")

	p := newTestPlugin(t, host)
	state := fetchKandy(t, p, "")
	require.Equal(t, levelForXP(999999), state.Level, "served as-is, unverified")
	require.False(t, state.Counterfeit, "no false positives on infra errors")
	require.Equal(t, 999999.0, persistedXP(t, host), "state untouched — no rebirth write")

	// Awards during the outage are served from memory but not persisted:
	// an unsealable write would read as tampering after recovery.
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	require.Equal(t, 999999.0, persistedXP(t, host), "no unsealed persist")

	// Vault recovers: the next load verifies for real and the tampered
	// ledger is caught.
	host.getSecretErr = nil
	state = fetchKandy(t, p, "")
	require.Equal(t, 1, state.Level)
	require.True(t, state.Counterfeit)
}

// A vault that cannot store the new key postpones grandfathering — served
// as-is, retried, and completed once the vault recovers.
func TestSeal_SetSecretErrorPostponesGrandfather(t *testing.T) {
	host := newFakeHost(nil)
	host.state[stateMapKey(stateScope, "", stateKey)] = map[string]any{
		"xp": 600.0, "salt": 7.0, "updated_at": "2026-07-28T00:00:00Z",
	}
	host.setSecretErr = errors.New("vault readonly")
	p := newTestPlugin(t, host)

	state := fetchKandy(t, p, "")
	require.Equal(t, levelForXP(600), state.Level)
	require.False(t, state.Counterfeit)
	require.Empty(t, host.secrets, "no key minted")
	require.NotContains(t, host.state[stateMapKey(stateScope, "", stateKey)], "sig")

	host.setSecretErr = nil
	fetchKandy(t, p, "")
	require.Contains(t, host.secrets, secretKeyLedgerHMAC, "grandfather completed on retry")
	require.Contains(t, host.state[stateMapKey(stateScope, "", stateKey)], "sig")
}

// A fully deleted ledger row is murder, not fraud: a clean fresh egg with
// NO counterfeit mark, even though the seal key still exists.
func TestSeal_DeletedRowIsCleanEgg(t *testing.T) {
	host := newFakeHost(nil)
	host.secrets[secretKeyLedgerHMAC] = hex.EncodeToString(testSealKey())
	p := newTestPlugin(t, host)

	state := fetchKandy(t, p, "")
	require.Equal(t, 1, state.Level)
	require.False(t, state.Counterfeit, "wiping your pet is allowed")

	// The replacement kandy's first award persists sealed under the
	// existing key.
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	sealed := persistedLedger(t, host)
	require.True(t, sealValid(sealed, testSealKey()))
	require.False(t, sealed.Counterfeit)
}

// Ordinary writes re-seal: after normal awards the persisted ledger always
// verifies, across restarts.
func TestSeal_WritesResealAndSurviveRestart(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	}
	keyHex := host.secrets[secretKeyLedgerHMAC]
	key, err := hex.DecodeString(keyHex)
	require.NoError(t, err)
	require.True(t, sealValid(persistedLedger(t, host), key))

	p2 := newTestPlugin(t, host)
	state := fetchKandy(t, p2, "")
	require.Equal(t, levelForXP(40), state.Level)
	require.False(t, state.Counterfeit)
}

// Counterfeit is FOREVER: it survives every future write (awards, pets,
// bonks) and a second tampering rebirths again but stays counterfeit.
func TestSeal_CounterfeitIsForever(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	host.state[stateMapKey(stateScope, "", stateKey)]["xp"] = 999999.0

	p := newTestPlugin(t, host)
	require.True(t, fetchKandy(t, p, "").Counterfeit, "first rebirth")

	// The counterfeit kandy lives on: work feeds it, care shapes it, and
	// none of it launders the mark.
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("agent.completed", map[string]any{})))
	state := fetchKandy(t, p, "")
	require.True(t, state.Counterfeit)
	require.Equal(t, int64(1), state.AwardSeq, "it still earns like any kandy")
	require.Equal(t, 20.0, persistedXP(t, host))
	require.True(t, petKandy(t, p).Counterfeit, "petting never clears it")
	require.True(t, persistedLedger(t, host).Counterfeit)
	require.True(t, sealValid(persistedLedger(t, host), testSealKey()))

	// Second tampering, this time ON the counterfeit: rebirths again,
	// still counterfeit.
	host.state[stateMapKey(stateScope, "", stateKey)]["xp"] = 424242.0
	p2 := newTestPlugin(t, host)
	state = fetchKandy(t, p2, "")
	require.Equal(t, 1, state.Level, "reborn again")
	require.Equal(t, int64(0), state.AwardSeq)
	require.True(t, state.Counterfeit, "counterfeit, once set, is forever")
	require.True(t, persistedLedger(t, host).Counterfeit)
}

// The webhook exposes the counterfeit verdict and nothing else of the seal:
// no sig, no sealv, and obviously no key material.
func TestSeal_WebhookExposesCounterfeitNeverSig(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	host.state[stateMapKey(stateScope, "", stateKey)]["xp"] = 999999.0
	p := newTestPlugin(t, host)

	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	body := string(resp.Body)
	require.Contains(t, body, `"counterfeit":true`)
	require.NotContains(t, body, `"sig"`)
	require.NotContains(t, body, `"sealv"`)
	require.NotContains(t, body, hex.EncodeToString(testSealKey()))
}

// The no-XP invariant is untouched by the seal: pets and bonks on a sealed
// ledger still never move XP, level, or the award sequence — they just
// re-seal the care fields they always wrote.
func TestSeal_CareStillNeverTouchesXP(t *testing.T) {
	host := newFakeHost(nil)
	seedSealed(host, fullLedger(), testSealKey())
	p := newTestPlugin(t, host)
	before := fetchKandy(t, p, "")

	petted := petKandy(t, p)
	require.Equal(t, before.Level, petted.Level)
	require.Equal(t, before.AwardSeq, petted.AwardSeq)
	require.Equal(t, 5000.0, persistedXP(t, host))
	require.True(t, sealValid(persistedLedger(t, host), testSealKey()), "care writes re-seal")
}
