package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

func (p *plugin) loadJarConnection(ctx context.Context, host pluginsdk.Host) (jarConnectionState, bool, error) {
	value, found, err := p.getState(ctx, host, jarConnectionStateKey)
	if err != nil || !found {
		return jarConnectionState{}, found, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return jarConnectionState{}, false, err
	}
	var state jarConnectionState
	if err := decodeStrictJSON(raw, &state); err != nil {
		return jarConnectionState{}, false, err
	}
	// There is intentionally no unsigned-state grandfather path. An old
	// unsigned row cannot be distinguished from one whose origin or outbox
	// was forged, so it must fail closed and be paired again.
	if state.StateVersion != jarConnectionStateVersion ||
		state.SealVersion != jarConnectionSealVersion || state.Sig == "" {
		return jarConnectionState{}, false, fmt.Errorf("unsealed connection state")
	}
	key, err := p.existingJarConnectionSealKey(ctx, host)
	if err != nil {
		return jarConnectionState{}, false, err
	}
	if !jarConnectionSealValid(state, key) {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection state seal")
	}
	if state.ProtocolVersion != jarProtocolVersion ||
		!jarUUIDPattern.MatchString(state.InstallationID) || state.ConnectedByActorID == "" {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection state")
	}
	normalizedOrigin, err := normalizeJarOrigin(state.Origin)
	if err != nil || normalizedOrigin != state.Origin {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection origin")
	}
	if state.AckedRevision < 0 || state.AckedRevision > jarMaxSafeRevision {
		return jarConnectionState{}, false, fmt.Errorf("invalid acknowledged revision")
	}
	if state.Pending != nil && (state.Pending.Revision <= state.AckedRevision || state.Pending.Revision > jarMaxSafeRevision) {
		return jarConnectionState{}, false, fmt.Errorf("invalid pending revision")
	}
	return state, true, nil
}

func (p *plugin) storeJarConnection(ctx context.Context, host pluginsdk.Host, state jarConnectionState) error {
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		return err
	}
	state.StateVersion = jarConnectionStateVersion
	state.SealVersion = jarConnectionSealVersion
	state.Sig = jarConnectionSignature(state, key)
	if state.Sig == "" {
		return fmt.Errorf("connection state could not be sealed")
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	writeErr := p.setState(ctx, host, jarConnectionStateKey, value)
	if writeErr == nil {
		return nil
	}
	if err := p.setState(ctx, host, jarConnectionStateKey, value); err == nil {
		return nil
	}

	// Host writes are not transactional from the caller's point of view: a
	// response can be lost after the state committed. Retry exact reads without
	// inheriting caller cancellation. Only the exact sealed document proves the
	// intended state committed; every other result remains unknown.
	for attempt := 0; attempt < 2; attempt++ {
		readCtx, cancel := p.detachedContext(ctx)
		persisted, found, readErr := p.loadJarConnection(readCtx, host)
		cancel()
		if readErr != nil {
			continue
		}
		if found && reflect.DeepEqual(persisted, state) {
			return nil
		}
	}
	// Missing and different readbacks are not a commit barrier: a timed-out
	// RPC can still commit after both reads. Once a write was attempted, only
	// the exact sealed document proves a safe outcome.
	return fmt.Errorf("%w: %v", errJarConnectionCommitUnknown, writeErr)
}

func jarConnectionSignature(state jarConnectionState, key []byte) string {
	state.Sig = ""
	encoded, err := json.Marshal(state)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(jarConnectionSealDomain))
	_, _ = mac.Write(encoded)
	return hex.EncodeToString(mac.Sum(nil))
}

func jarConnectionSealValid(state jarConnectionState, key []byte) bool {
	if state.StateVersion != jarConnectionStateVersion ||
		state.SealVersion != jarConnectionSealVersion || state.Sig == "" {
		return false
	}
	want := jarConnectionSignature(state, key)
	return want != "" && hmac.Equal([]byte(state.Sig), []byte(want))
}

func (p *plugin) existingJarConnectionSealKey(ctx context.Context, host pluginsdk.Host) ([]byte, error) {
	if cached := p.cachedSealKey(); cached != nil {
		return cached, nil
	}
	p.sealMu.Lock()
	defer p.sealMu.Unlock()
	if cached := p.cachedSealKey(); cached != nil {
		return cached, nil
	}
	hexKey, found, err := p.getSecret(ctx, host, secretKeyLedgerHMAC)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("connection seal key is unavailable")
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(hexKey))
	if err != nil || len(decoded) == 0 {
		return nil, fmt.Errorf("stored seal key is not valid hex")
	}
	p.publishSealKey(decoded)
	return decoded, nil
}

func (p *plugin) setJarSecret(ctx context.Context, host pluginsdk.Host, origin, token string) error {
	value, err := json.Marshal(jarPublisherSecret{
		Version: jarPublisherSecretVersion,
		Origin:  origin,
		Token:   token,
	})
	if err != nil {
		return err
	}
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.SetSecret(callCtx, jarPublisherSecretKey, string(value))
}

func (p *plugin) getJarSecret(ctx context.Context, host pluginsdk.Host) (jarPublisherSecret, bool, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	value, found, err := host.GetSecret(callCtx, jarPublisherSecretKey)
	if err != nil || !found {
		return jarPublisherSecret{}, found, err
	}
	var credential jarPublisherSecret
	if err := decodeStrictJSON([]byte(value), &credential); err != nil {
		return jarPublisherSecret{}, false, fmt.Errorf("invalid publisher credential")
	}
	normalizedOrigin, originErr := normalizeJarOrigin(credential.Origin)
	if credential.Version != jarPublisherSecretVersion || originErr != nil ||
		normalizedOrigin != credential.Origin || !jarPublisherPattern.MatchString(credential.Token) {
		return jarPublisherSecret{}, false, fmt.Errorf("invalid publisher credential")
	}
	return credential, true, nil
}

func (p *plugin) deleteJarSecret(ctx context.Context, host pluginsdk.Host) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.DeleteSecret(callCtx, jarPublisherSecretKey)
}

func (p *plugin) deleteJarConnection(ctx context.Context, host pluginsdk.Host) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.DeleteState(callCtx, stateScope, "", jarConnectionStateKey)
}
