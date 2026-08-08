// seal.go — the anti-tamper seal (v0.9.0).
//
// The ledger lives in kandev's plugin_state table, which anyone with the
// SQLite file can edit. The seal makes such edits DETECTABLE: every persist
// signs a canonical serialization of the ledger with HMAC-SHA256 under a
// key held in kandev's encrypted secrets vault (capabilities.secrets, the
// vault is encrypted under kandev's master key) — a raw DB edit cannot
// reach the key, so it cannot forge the signature.
//
// Detection is cryptographic ONLY. There are no heuristics, and an
// infrastructure error is never treated as tampering. The decision table
// applied on every ledger load (verifyLoadedLedger):
//
//   - Vault unavailable / GetSecret errors -> serve the ledger as-is,
//     skip verification this round (no false positives), retry next load.
//   - No vault key yet -> GRANDFATHER: create the key, seal the current
//     ledger in place, accept it. Existing kandys keep everything. (Key
//     existence doubles as the "sealing has begun" marker.)
//   - Key exists + signature valid -> accept.
//   - Key exists + signature missing OR invalid -> TAMPERED -> counterfeit
//     rebirth: a fresh egg (new random salt = new DNA, everything zeroed)
//     carrying a PERMANENT counterfeit mark.
//   - A fully DELETED ledger row -> fresh egg WITHOUT the mark (wiping
//     your pet is murder, not fraud — allowed). That path never reaches
//     verifyLoadedLedger; see readLedger.
//
// Counterfeit, once set, is FOREVER: it is part of the sealed field list,
// survives every future write, and a second tampering on a counterfeit
// kandy rebirths again but stays counterfeit.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

const (
	// sealVersion tags the canonical serialization. Bump it when the
	// sealed field list changes so old signatures can be migrated
	// deliberately instead of rejected as tampering.
	sealVersion = 1

	// secretKeyLedgerHMAC is the vault key holding the hex-encoded
	// 32-byte HMAC key. Its existence is the "sealing has begun" marker.
	secretKeyLedgerHMAC = "ledger-hmac-key"
)

// canonicalLedgerString serializes every sealed ledger field in a FIXED,
// explicitly ordered list — never map iteration — so the same ledger always
// yields the same bytes. The signature itself is excluded; counterfeit IS
// included, so clearing the mark in the DB invalidates the signature (and
// the resulting rebirth sets it right back).
func canonicalLedgerString(l *ledger) string {
	pairs := []string{
		"sealv=" + strconv.Itoa(l.Sealv),
		"xp=" + strconv.FormatFloat(l.XP, 'g', -1, 64),
		"messages=" + strconv.FormatInt(l.Messages, 10),
		"turns=" + strconv.FormatInt(l.Turns, 10),
		"agent_runs=" + strconv.FormatInt(l.AgentRuns, 10),
		"salt=" + strconv.FormatUint(uint64(l.Salt), 10),
		"created_at=" + l.CreatedAt,
		"updated_at=" + l.UpdatedAt,
		"award_seq=" + strconv.FormatInt(l.AwardSeq, 10),
		"last_award_at=" + l.LastAwardAt,
		"last_petted_at=" + l.LastPettedAt,
		"pets_given=" + strconv.FormatInt(l.PetsGiven, 10),
		"bonks_given=" + strconv.FormatInt(l.BonksGiven, 10),
		"temperament=" + strconv.FormatFloat(l.Temperament, 'g', -1, 64),
		"scarred=" + strconv.FormatBool(l.Scarred),
		"last_bonked_at=" + l.LastBonkedAt,
		"last_pet_effect_at=" + l.LastPetEffectAt,
		"last_passive_heal_at=" + l.LastPassiveHealAt,
		"counterfeit=" + strconv.FormatBool(l.Counterfeit),
	}
	return strings.Join(pairs, "\n")
}

// ledgerSig computes the hex HMAC-SHA256 over the canonical serialization.
func ledgerSig(l *ledger, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(canonicalLedgerString(l)))
	return hex.EncodeToString(mac.Sum(nil))
}

// sealLedger stamps the current seal version and signature in place.
func sealLedger(l *ledger, key []byte) {
	l.Sealv = sealVersion
	l.Sig = ledgerSig(l, key)
}

// sealValid reports whether the ledger's stored signature matches its
// canonical content under key. A missing signature is never valid.
func sealValid(l *ledger, key []byte) bool {
	if l.Sig == "" {
		return false
	}
	return hmac.Equal([]byte(l.Sig), []byte(ledgerSig(l, key)))
}

// ensureSealKey returns the HMAC key, fetching it from the vault on first
// use and creating it when the vault has none yet. created is true only when
// this call minted the key — the grandfather signal. Any vault error returns
// err: callers must treat that as "infrastructure, not fraud".
//
// The decoded key is memoized for the process lifetime, so only the first
// award costs a vault round-trip. Nothing is cached on error, so a failure
// is retried on the next call and nothing else.
//
// sealMu serializes the fetch (two concurrent awards must not mint two keys)
// while p.mu is only taken to read and publish the cached value — never
// across the vault call itself.
func (p *plugin) ensureSealKey(ctx context.Context, host pluginsdk.Host) (key []byte, created bool, err error) {
	if cached := p.cachedSealKey(); cached != nil {
		return cached, false, nil
	}
	p.sealMu.Lock()
	defer p.sealMu.Unlock()
	if cached := p.cachedSealKey(); cached != nil {
		return cached, false, nil
	}
	hexKey, found, err := p.getSecret(ctx, host, secretKeyLedgerHMAC)
	if err != nil {
		return nil, false, err
	}
	if found {
		decoded, decErr := hex.DecodeString(strings.TrimSpace(hexKey))
		if decErr != nil || len(decoded) == 0 {
			// A corrupt vault entry is an infrastructure problem, not
			// evidence of ledger tampering — never rebirth over it.
			return nil, false, errors.New("stored seal key is not valid hex")
		}
		p.publishSealKey(decoded)
		return decoded, false, nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, false, err
	}
	if err := p.setSecret(ctx, host, secretKeyLedgerHMAC, hex.EncodeToString(raw)); err != nil {
		return nil, false, err
	}
	p.publishSealKey(raw)
	return raw, true, nil
}

func (p *plugin) cachedSealKey() []byte {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.sealKey
}

func (p *plugin) publishSealKey(key []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sealKey = key
}

// getSecret / setSecret are the bounded vault round-trips.
func (p *plugin) getSecret(ctx context.Context, host pluginsdk.Host, key string) (string, bool, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	return host.GetSecret(callCtx, key)
}

func (p *plugin) setSecret(ctx context.Context, host pluginsdk.Host, key, value string) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.SetSecret(callCtx, key, value)
}

// verifyLoadedLedger applies the decision table (top of file) to a ledger
// just read from Host state. Returns the ledger to serve and whether it may
// be cached — false means "vault was unavailable, serve as-is this round
// and re-verify on the next load".
//
// Callers hold loadMu and MUST NOT hold p.mu: this does Host I/O. Writing
// stateKey from here is safe despite writeLoop owning that key, because the
// ledger is not cached yet and nothing can mutate it until it is.
func (p *plugin) verifyLoadedLedger(ctx context.Context, host pluginsdk.Host, l *ledger) (*ledger, bool) {
	key, created, err := p.ensureSealKey(ctx, host)
	if err != nil {
		log.Printf("kandy: seal key unavailable, serving ledger unverified this round: %v", err)
		return l, false
	}
	if created {
		// GRANDFATHER: sealing begins now. Seal the ledger exactly as it
		// is (no UpdatedAt stamp — this is not a mutation) and accept it.
		sealLedger(l, key)
		if err := p.setState(ctx, host, stateKey, ledgerToMap(l)); err != nil {
			log.Printf("kandy: persisting grandfathered seal: %v", err)
		}
		return l, true
	}
	if sealValid(l, key) {
		return l, true
	}
	// TAMPERED: the row was modified outside the plugin. Counterfeit
	// rebirth — and if the previous ledger was already counterfeit, the
	// new one is too (the mark is forever).
	reborn := p.counterfeitRebirth()
	sealLedger(reborn, key)
	if err := p.setState(ctx, host, stateKey, ledgerToMap(reborn)); err != nil {
		log.Printf("kandy: persisting counterfeit rebirth: %v", err)
	}
	log.Printf("kandy: ledger seal invalid — tampered state detected; rebirthing as a counterfeit (the mark is permanent)")
	return reborn, true
}

// counterfeitRebirth builds the fresh-but-marked egg served after tamper
// detection: new random salt (new DNA), XP 0, all counters and care state
// zeroed, no scar — and the permanent counterfeit mark.
func (p *plugin) counterfeitRebirth() *ledger {
	now := p.now().UTC().Format(time.RFC3339)
	return &ledger{
		Salt:        p.saltFunc(),
		CreatedAt:   now,
		UpdatedAt:   now,
		Counterfeit: true,
	}
}
