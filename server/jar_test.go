package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestJarOrigin_RequiresAnOriginAndTLSOutsideLoopbackDevelopment(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{name: "production", raw: "https://jar.example.com", want: "https://jar.example.com", ok: true},
		{name: "trailing slash", raw: "https://jar.example.com/", want: "https://jar.example.com", ok: true},
		{name: "https port", raw: "https://jar.example.com:8443", want: "https://jar.example.com:8443", ok: true},
		{name: "localhost dev", raw: "http://localhost:8787", want: "http://localhost:8787", ok: true},
		{name: "ipv4 loopback dev", raw: "http://127.0.0.1:8787", want: "http://127.0.0.1:8787", ok: true},
		{name: "ipv6 loopback dev", raw: "http://[::1]:8787", want: "http://[::1]:8787", ok: true},
		{name: "cleartext remote", raw: "http://jar.example.com", ok: false},
		{name: "path", raw: "https://jar.example.com/tenant", ok: false},
		{name: "query", raw: "https://jar.example.com?origin=evil", ok: false},
		{name: "fragment", raw: "https://jar.example.com#evil", ok: false},
		{name: "userinfo", raw: "https://admin:secret@jar.example.com", ok: false},
		{name: "wrong scheme", raw: "file:///tmp/jar", ok: false},
		{name: "missing host", raw: "https://", ok: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeJarOrigin(tc.raw)
			if !tc.ok {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
}

func TestJarPairingCode_NormalizesCrockfordAndRejectsAmbiguousLetters(t *testing.T) {
	got, err := normalizeJarPairingCode("  kj-abcd-efgh-kjmn \n")
	require.NoError(t, err)
	require.Equal(t, "KJ-ABCD-EFGH-KJMN", got)

	for _, code := range []string{
		"KJ-ABCI-EFGH-KJMN",
		"KJ-ABCL-EFGH-KJMN",
		"KJ-ABCO-EFGH-KJMN",
		"KJ-ABCU-EFGH-KJMN",
		"KJ-ABCD-EFGH-KJM!",
	} {
		_, err := normalizeJarPairingCode(code)
		require.Error(t, err, code)
	}
}

func TestJarProjection_ContainsOnlyTheFrozenPublicAllowlist(t *testing.T) {
	ancestors := make([]ancestorView, 9)
	for i := range ancestors {
		ancestors[i] = ancestorView{
			Level:       i + 1,
			Archetype:   i + 2,
			Family:      i + 3,
			LineageSeed: uint32(i + 4),
			StageName:   "elder",
			Generation:  i + 1,
			Scarred:     i%2 == 0,
			RetiredAt:   "2026-08-19T12:00:00Z",
		}
	}
	view := kandyResponse{
		Level:           12,
		Stage:           3,
		Archetype:       4,
		Family:          5,
		Biome:           6,
		LineageSeed:     7,
		StageName:       "Radiant Kandy",
		ProgressPct:     42.5,
		AppearanceSeed:  8,
		Mood:            "happy",
		AwardSeq:        999,
		LastAwardAt:     "2026-08-19T12:00:00Z",
		TemperamentBand: "beloved",
		Scarred:         true,
		Counterfeit:     true,
		RefusingPets:    true,
		Flavor:          "private flavor",
		AliveSince:      "2026-01-01T00:00:00Z",
		Generation:      10,
		Ancestors:       ancestors,
		RebornAt:        "2026-08-19T12:00:00Z",
	}

	raw, err := json.Marshal(projectJarKandy(view))
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(raw, &got))
	require.ElementsMatch(t, []string{
		"level", "stage", "archetype", "family", "biome", "lineage_seed",
		"stage_name", "progress_pct", "appearance_seed", "mood",
		"temperament_band", "scarred", "counterfeit", "generation", "ancestors",
	}, mapKeys(got))

	gotAncestors, ok := got["ancestors"].([]any)
	require.True(t, ok)
	require.Len(t, gotAncestors, maxAncestors)
	for _, item := range gotAncestors {
		ancestor, ok := item.(map[string]any)
		require.True(t, ok)
		require.ElementsMatch(t, []string{
			"level", "archetype", "family", "lineage_seed", "stage_name", "generation", "scarred",
		}, mapKeys(ancestor))
	}

	for _, private := range []string{
		"token_grotto", "award_seq", "last_award_at", "alive_since", "reborn_at",
		"retired_at", "refusing_pets", "flavor", "xp", "messages", "turns",
		"agent_runs", "salt", "temperament", "sig", "sealv", "task_id",
		"session_id", "model", "provider", "tokens",
	} {
		require.NotContains(t, string(raw), `"`+private+`"`)
	}
}

func TestJarProjection_AlwaysSerializesCanonicalAncestorsArray(t *testing.T) {
	raw, err := json.Marshal(projectJarKandy(kandyResponse{}))
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	ancestors, ok := body["ancestors"].([]any)
	require.True(t, ok)
	require.Empty(t, ancestors)
}

func TestCloneJarKandy_PreservesCanonicalEmptyAncestorsArray(t *testing.T) {
	cloned := cloneJarKandy(jarKandy{Ancestors: make([]jarAncestor, 0)})
	raw, err := json.Marshal(cloned)
	require.NoError(t, err)
	require.Contains(t, string(raw), `"ancestors":[]`)
}

func TestJarQueue_RejectsTransientStandInLedger(t *testing.T) {
	p := newPlugin()
	p.skipJarResumeProbe = true
	t.Cleanup(p.close)

	p.queueJarForLedger(&ledger{Salt: 42, transient: true})
	p.jarQueueMu.Lock()
	queued := p.jarQueued
	p.jarQueueMu.Unlock()
	require.Nil(t, queued, "a Host-read stand-in must never become public state")
}

type jarSecretObservingHost struct {
	*fakeHost
	publisherSecretReads atomic.Int64
}

func (h *jarSecretObservingHost) GetSecret(ctx context.Context, key string) (string, bool, error) {
	if key == jarPublisherSecretKey {
		h.publisherSecretReads.Add(1)
	}
	return h.fakeHost.GetSecret(ctx, key)
}

type cancelAfterJarStateCommitHost struct {
	*fakeHost
	cancel context.CancelFunc
}

func (h *cancelAfterJarStateCommitHost) SetState(
	ctx context.Context,
	scope, scopeID, key string,
	value map[string]any,
) error {
	if err := h.fakeHost.SetState(ctx, scope, scopeID, key, value); err != nil {
		return err
	}
	if key == jarConnectionStateKey {
		h.cancel()
		return errors.New("response lost after committed Jar state")
	}
	return nil
}

func (h *cancelAfterJarStateCommitHost) GetState(
	ctx context.Context,
	scope, scopeID, key string,
) (map[string]any, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	return h.fakeHost.GetState(ctx, scope, scopeID, key)
}

type delayedJarStateCommitHost struct {
	*fakeHost
	confirmationReads atomic.Int64
	pendingState      map[string]any
}

func (h *delayedJarStateCommitHost) SetState(
	ctx context.Context,
	scope, scopeID, key string,
	value map[string]any,
) error {
	if key != jarConnectionStateKey {
		return h.fakeHost.SetState(ctx, scope, scopeID, key, value)
	}
	h.mu.Lock()
	h.pendingState = value
	h.mu.Unlock()
	return errors.New("Jar state write response timed out")
}

func (h *delayedJarStateCommitHost) GetState(
	ctx context.Context,
	scope, scopeID, key string,
) (map[string]any, bool, error) {
	if key != jarConnectionStateKey {
		return h.fakeHost.GetState(ctx, scope, scopeID, key)
	}
	h.mu.Lock()
	pending := h.pendingState
	h.mu.Unlock()
	if pending == nil {
		return h.fakeHost.GetState(ctx, scope, scopeID, key)
	}
	if h.confirmationReads.Add(1) == 2 {
		// The read was linearized while the row was absent, then the timed-out
		// write committed before its missing response reached the caller.
		h.mu.Lock()
		h.state[stateMapKey(scope, scopeID, key)] = pending
		h.mu.Unlock()
	}
	return nil, false, nil
}

type unreadableAfterJarStateCommitHost struct {
	*fakeHost
	jarStateCommitted atomic.Bool
}

func (h *unreadableAfterJarStateCommitHost) SetState(
	ctx context.Context,
	scope, scopeID, key string,
	value map[string]any,
) error {
	if err := h.fakeHost.SetState(ctx, scope, scopeID, key, value); err != nil {
		return err
	}
	if key == jarConnectionStateKey {
		h.jarStateCommitted.Store(true)
		return errors.New("response lost after committed Jar state")
	}
	return nil
}

func (h *unreadableAfterJarStateCommitHost) GetState(
	ctx context.Context,
	scope, scopeID, key string,
) (map[string]any, bool, error) {
	if key == jarConnectionStateKey && h.jarStateCommitted.Load() {
		return nil, false, errors.New("Jar state confirmation unavailable")
	}
	return h.fakeHost.GetState(ctx, scope, scopeID, key)
}

func TestJarConnectionSeal_RejectsTamperedStateBeforeCredentialOrNetwork(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token := testJarPublisherToken()
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any, string)
	}{
		{
			name: "origin",
			mutate: func(value map[string]any, attackerOrigin string) {
				value["origin"] = attackerOrigin
			},
		},
		{
			name: "pending projection",
			mutate: func(value map[string]any, _ string) {
				pending := value["pending"].(map[string]any)
				kandy := pending["kandy"].(map[string]any)
				kandy["level"] = float64(999)
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var networkHits atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				networkHits.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
			}))
			t.Cleanup(server.Close)

			host := &jarSecretObservingHost{fakeHost: newFakeHost(nil)}
			writer := newPlugin()
			writer.skipJarResumeProbe = true
			writer.SetHost(host)
			require.NoError(t, writer.storeJarConnection(context.Background(), host, jarConnectionState{
				StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
				Origin: "https://jar.example.com", ConnectedByActorID: "actor-1",
				ConnectedAt: "2026-08-19T11:00:00Z",
				Pending: &jarPendingSnapshot{
					Revision: 1,
					Kandy: jarKandy{
						Level: 3, StageName: "Stored", Mood: "content",
						Ancestors: make([]jarAncestor, 0),
					},
				},
			}))
			writer.close()
			host.mu.Lock()
			persisted := host.state[stateMapKey(stateScope, "", jarConnectionStateKey)]
			tc.mutate(persisted, server.URL)
			host.mu.Unlock()
			putJarSecret(t, host.fakeHost, "https://jar.example.com", token)

			restarted := newPlugin()
			restarted.skipJarResumeProbe = true
			restarted.SetHost(host)
			t.Cleanup(restarted.close)
			require.False(t, restarted.publishJarOnce(context.Background()))
			require.Zero(t, host.publisherSecretReads.Load(), "tampered state must fail before publisher credential lookup")
			require.Zero(t, networkHits.Load(), "tampered state must never choose a network destination or publish")
		})
	}
}

func TestJarConnectionSeal_RejectsLegacyUnsignedState(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	host := newFakeHost(nil)
	host.state[stateMapKey(stateScope, "", jarConnectionStateKey)] = map[string]any{
		"state_version":    float64(1),
		"protocol_version": float64(1),
		"installation_id":  installationID,
		"origin":           "https://jar.example.com",
		"owner_actor_id":   "actor-1",
		"connected_at":     "2026-08-19T11:00:00Z",
	}
	p := newTestPlugin(t, host)

	_, found, err := p.loadJarConnection(context.Background(), host)
	require.Error(t, err)
	require.False(t, found, "an unsigned legacy row cannot be distinguished from forged state and must be re-paired")
}

func TestJarPublisher_StateReadFailureRequeuesPassivelyWithoutBusyLoop(t *testing.T) {
	host := newFakeHost(nil)
	host.getStateErr[stateMapKey(stateScope, "", jarConnectionStateKey)] = errors.New("state unavailable")
	p := newTestPlugin(t, host)

	p.queueJarProjection(jarKandy{Level: 2, Ancestors: make([]jarAncestor, 0)})
	require.Eventually(t, func() bool { return host.calls.Load() >= 2 }, time.Second, 10*time.Millisecond)
	require.Equal(t, int64(2), host.calls.Load())
	time.Sleep(4 * jarDebounceDelay)
	require.Equal(t, int64(2), host.calls.Load(), "a persistent Host error must wait for an external signal or refresh tick")
}

func waitJarPublish(t *testing.T, published <-chan jarPublishRequest) jarPublishRequest {
	t.Helper()
	select {
	case request := <-published:
		return request
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Kandy Jar publication")
		return jarPublishRequest{}
	}
}

func putJarState(t *testing.T, host *fakeHost, state jarConnectionState) {
	t.Helper()
	key := []byte("kandy-jar-test-seal-key-32-byte!")
	require.Len(t, key, 32)
	state.StateVersion = jarConnectionStateVersion
	state.SealVersion = jarConnectionSealVersion
	state.Sig = jarConnectionSignature(state, key)
	raw, err := json.Marshal(state)
	require.NoError(t, err)
	var value map[string]any
	require.NoError(t, json.Unmarshal(raw, &value))
	host.mu.Lock()
	host.state[stateMapKey(stateScope, "", "kandy_jar.connection")] = value
	host.secrets[secretKeyLedgerHMAC] = hex.EncodeToString(key)
	host.mu.Unlock()
}

func getJarState(t *testing.T, host *fakeHost) jarConnectionState {
	t.Helper()
	host.mu.Lock()
	value := host.state[stateMapKey(stateScope, "", "kandy_jar.connection")]
	host.mu.Unlock()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	var state jarConnectionState
	require.NoError(t, json.Unmarshal(raw, &state))
	return state
}

func putJarSecret(t *testing.T, host *fakeHost, origin, token string) {
	t.Helper()
	raw, err := json.Marshal(jarPublisherSecret{
		Version: jarPublisherSecretVersion,
		Origin:  origin,
		Token:   token,
	})
	require.NoError(t, err)
	host.mu.Lock()
	host.secrets[jarPublisherSecretKey] = string(raw)
	host.mu.Unlock()
}

func readJarSecret(t *testing.T, host *fakeHost) jarPublisherSecret {
	t.Helper()
	host.mu.Lock()
	raw := host.secrets[jarPublisherSecretKey]
	host.mu.Unlock()
	var credential jarPublisherSecret
	require.NoError(t, decodeStrictJSON([]byte(raw), &credential))
	return credential
}

func testJarPublisherToken() string {
	return "kjp_v1_" + strings.Repeat("A", 43)
}

func mapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
