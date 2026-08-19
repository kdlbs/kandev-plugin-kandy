package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
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
	h.fakeHost.mu.Lock()
	h.pendingState = value
	h.fakeHost.mu.Unlock()
	return errors.New("Jar state write response timed out")
}

func (h *delayedJarStateCommitHost) GetState(
	ctx context.Context,
	scope, scopeID, key string,
) (map[string]any, bool, error) {
	if key != jarConnectionStateKey {
		return h.fakeHost.GetState(ctx, scope, scopeID, key)
	}
	h.fakeHost.mu.Lock()
	pending := h.pendingState
	h.fakeHost.mu.Unlock()
	if pending == nil {
		return h.fakeHost.GetState(ctx, scope, scopeID, key)
	}
	if h.confirmationReads.Add(1) == 2 {
		// The read was linearized while the row was absent, then the timed-out
		// write committed before its missing response reached the caller.
		h.fakeHost.mu.Lock()
		h.fakeHost.state[stateMapKey(scope, scopeID, key)] = pending
		h.fakeHost.mu.Unlock()
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
				Origin: "https://jar.example.com", OwnerActorID: "actor-1",
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

func TestJarConnect_UsesAdminOriginAndKeepsPublisherTokenSecret(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var publishedHash string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			require.Equal(t, http.MethodPost, r.Method)
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.ElementsMatch(t,
				[]string{"protocol_version", "user_code", "publisher_token_sha256"}, mapKeys(body))
			require.Equal(t, float64(1), body["protocol_version"])
			require.Equal(t, "KJ-ABCD-EFGH-KJMN", body["user_code"])
			publishedHash, _ = body["publisher_token_sha256"].(string)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `","revision":1,"status":"published","received_at":"2026-08-19T12:00:00Z"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context: pluginsdk.VerifiedActionContext{
			ActorID: "actor-1", WorkspaceID: "workspace-1",
		},
		Body: []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)

	credential := readJarSecret(t, host)
	token := credential.Token
	host.mu.Lock()
	state := host.state[stateMapKey(stateScope, "", "kandy_jar.connection")]
	host.mu.Unlock()
	require.Equal(t, server.URL, credential.Origin)
	require.True(t, strings.HasPrefix(token, "kjp_v1_"))
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(token, "kjp_v1_"))
	require.NoError(t, err)
	require.Len(t, decoded, 32)
	hash := sha256.Sum256([]byte(token))
	require.Equal(t, base64.RawURLEncoding.EncodeToString(hash[:]), publishedHash)

	stateJSON, err := json.Marshal(state)
	require.NoError(t, err)
	require.NotContains(t, string(stateJSON), token)
	require.NotContains(t, string(stateJSON), "KJ-ABCD-EFGH-KJMN")
	require.Equal(t, "actor-1", state["owner_actor_id"])
	require.Equal(t, installationID, state["installation_id"])
	require.NotContains(t, string(resp.Body), token)
}

func TestJarConnect_RejectsRequestSuppliedOriginBeforeNetwork(t *testing.T) {
	var hits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN","origin":"https://attacker.example"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, resp.Status)
	require.Zero(t, hits.Load())
	require.Empty(t, host.secrets)
	require.Empty(t, host.state)
}

func TestJarConnect_FailsBeforeRedeemWhenAuthoritativeLedgerIsUnavailable(t *testing.T) {
	var hits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	host.getStateErr[stateMapKey(stateScope, "", stateKey)] = errors.New("state unavailable")
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.Status)
	require.Zero(t, hits.Load(), "pairing code must not be consumed without authoritative Kandy state")
	require.Empty(t, host.secrets)
	require.NotContains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarConnect_DoesNotFollowCrossOriginRedirects(t *testing.T) {
	var targetHits atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		targetHits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"9c7673a3-b8d5-43df-a9f6-0448c18402fd"}`))
	}))
	t.Cleanup(target.Close)
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(redirector.Close)

	host := newFakeHost(map[string]any{"jar_origin": redirector.URL})
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusBadGateway, resp.Status)
	require.Zero(t, targetHits.Load())
	require.Empty(t, host.secrets)
	require.Empty(t, host.state)
}

func TestJarConnect_RejectsNonJSONSuccessResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"9c7673a3-b8d5-43df-a9f6-0448c18402fd"}`))
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusBadGateway, resp.Status)
	require.Empty(t, host.secrets)
	require.Empty(t, host.state)
}

func TestJarConnect_RevokesRedeemedInstallationWhenVaultWriteFails(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var redeemedHash string
	var revoked atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			var request jarRedeemRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			redeemedHash = request.PublisherTokenSHA256
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/publication":
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			digest := sha256.Sum256([]byte(token))
			require.Equal(t, redeemedHash, base64.RawURLEncoding.EncodeToString(digest[:]))
			revoked.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	host.setSecretErr = errors.New("vault unavailable")
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.Status)
	require.Equal(t, int64(1), revoked.Load())
	require.Empty(t, host.secrets)
	require.Empty(t, host.state)
}

func TestJarConnect_AcceptsExactStateWhenSetResponseIsLostAfterCommit(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var revokeHits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			var request jarPublishRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(fmt.Sprintf(
				`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"published","received_at":"2026-08-19T12:00:00Z"}`,
				installationID, request.Revision,
			)))
		case "/api/v1/installations/" + installationID + "/publication":
			revokeHits.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	host.commitStateErr[stateMapKey(stateScope, "", jarConnectionStateKey)] = errors.New("response lost after commit")
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.Zero(t, revokeHits.Load(), "an exactly committed connection must not be compensated")
	require.NotEmpty(t, host.secrets[jarPublisherSecretKey])

	state := getJarState(t, host)
	require.Equal(t, installationID, state.InstallationID)
	require.Equal(t, "actor-1", state.OwnerActorID)
	host.mu.Lock()
	sealSignature := host.state[stateMapKey(stateScope, "", jarConnectionStateKey)]["sig"]
	host.mu.Unlock()
	require.NotEmpty(t, sealSignature)
}

func TestJarConnect_ConfirmsCommittedStateAfterCallerCancellation(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var revokeHits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `","revision":1,"status":"published","received_at":"2026-08-19T12:00:00Z"}`))
		case "/api/v1/installations/" + installationID + "/publication":
			revokeHits.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	host := &cancelAfterJarStateCommitHost{
		fakeHost: newFakeHost(map[string]any{"jar_origin": server.URL}),
		cancel:   cancel,
	}
	p := newPlugin()
	p.skipJarResumeProbe = true
	p.SetHost(host)
	t.Cleanup(p.close)
	resp, err := p.HandleAction(ctx, &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.Zero(t, revokeHits.Load())
	require.NotEmpty(t, host.secrets[jarPublisherSecretKey])
	require.Contains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarConnect_UnknownCommitNeverDeletesTheRecoveryCredential(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var revokeHits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/publication":
			revokeHits.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := &unreadableAfterJarStateCommitHost{
		fakeHost: newFakeHost(map[string]any{"jar_origin": server.URL}),
	}
	p := newPlugin()
	p.skipJarResumeProbe = true
	p.SetHost(host)
	t.Cleanup(p.close)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.Status)
	require.Zero(t, revokeHits.Load(), "an unknown commit must not be destructively compensated")
	require.NotEmpty(t, host.secrets[jarPublisherSecretKey])
	require.Contains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarConnect_NeverCompensatesAWriteThatCommitsAfterMissingReadbacks(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var revokeHits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/publication":
			revokeHits.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := &delayedJarStateCommitHost{
		fakeHost: newFakeHost(map[string]any{"jar_origin": server.URL}),
	}
	p := newPlugin()
	p.skipJarResumeProbe = true
	p.SetHost(host)
	t.Cleanup(p.close)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.Status)
	require.Zero(t, revokeHits.Load())
	require.Contains(t, host.secrets, jarPublisherSecretKey)
	require.Contains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarConnect_ReusesARecoveryCredentialWhenConnectionStateIsAbsent(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token := testJarPublisherToken()
	digest := sha256.Sum256([]byte(token))
	wantHash := base64.RawURLEncoding.EncodeToString(digest[:])
	var redeemedHash string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			var request jarRedeemRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			redeemedHash = request.PublisherTokenSHA256
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `","revision":1,"status":"published","received_at":"2026-08-19T12:00:00Z"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.Equal(t, wantHash, redeemedHash)
	require.Equal(t, token, readJarSecret(t, host).Token)
}

func TestJarConnect_NeverReusesARecoveryCredentialAcrossOrigins(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	oldToken := testJarPublisherToken()
	oldJar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("the previous Jar must not receive recovery traffic")
	}))
	t.Cleanup(oldJar.Close)

	var redeemedHash string
	newJar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			var request jarRedeemRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			redeemedHash = request.PublisherTokenSHA256
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `","revision":1,"status":"published","received_at":"2026-08-19T12:00:00Z"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(newJar.Close)

	host := newFakeHost(map[string]any{"jar_origin": newJar.URL})
	host.secrets[jarPublisherSecretKey] = fmt.Sprintf(
		`{"version":1,"origin":%q,"token":%q}`,
		oldJar.URL,
		oldToken,
	)
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarConnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.NotEqual(t, jarPublisherTokenHash(oldToken), redeemedHash)

	var stored struct {
		Version int    `json:"version"`
		Origin  string `json:"origin"`
		Token   string `json:"token"`
	}
	require.NoError(t, decodeStrictJSON([]byte(host.secrets[jarPublisherSecretKey]), &stored))
	require.Equal(t, 1, stored.Version)
	require.Equal(t, newJar.URL, stored.Origin)
	require.NotEqual(t, oldToken, stored.Token)
	require.Equal(t, redeemedHash, jarPublisherTokenHash(stored.Token))
}

func TestJarConnect_RetriesRedeemOnceWithIdenticalTokenHash(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	bodies := make(chan []byte, 2)
	var attempts atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			body, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			bodies <- append([]byte(nil), body...)
			if attempts.Add(1) == 1 {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			var request jarPublishRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(fmt.Sprintf(
				`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"published","received_at":"2026-08-19T12:00:00Z"}`,
				installationID, request.Revision,
			)))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.Equal(t, int64(2), attempts.Load())
	require.Equal(t, <-bodies, <-bodies)
}

func TestJarActions_OnlyOwnerCanInspectOrDisconnect(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token := testJarPublisherToken()
	var revokeHits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodDelete, r.Method)
		require.Equal(t, "/api/v1/installations/"+installationID+"/publication", r.URL.Path)
		require.Equal(t, "Bearer "+token, r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		require.Empty(t, body)
		revokeHits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
	})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)

	for _, action := range []string{"jar.status", "jar.disconnect"} {
		resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
			ActionKey: action,
			Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-2", WorkspaceID: "workspace-1"},
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusForbidden, resp.Status, action)
	}
	require.Zero(t, revokeHits.Load())

	status, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.status",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-2"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, status.Status)
	require.NotContains(t, string(status.Body), token)
	require.Contains(t, string(status.Body), installationID)

	disconnected, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.disconnect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, disconnected.Status)
	require.Equal(t, int64(1), revokeHits.Load())
	require.NotContains(t, string(disconnected.Body), token)
	require.NotContains(t, host.secrets, jarPublisherSecretKey)
	require.Empty(t, host.state)
}

func TestJarDisconnect_ForgetsAConnectionWhoseCredentialWasReplaced(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token := testJarPublisherToken()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodDelete, r.Method)
		require.Equal(t, "Bearer "+token, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_publisher"}`))
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
	})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)

	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarDisconnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.Status)
	require.NotContains(t, host.secrets, jarPublisherSecretKey)
	require.NotContains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarDisconnect_DoesNotForgetOnAnUnrecognizedUnauthorizedResponse(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token := testJarPublisherToken()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"proxy_authentication_required"}`))
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
	})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)

	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: actionKeyJarDisconnect,
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusBadGateway, resp.Status)
	require.Equal(t, token, readJarSecret(t, host).Token)
	require.Contains(t, host.state, stateMapKey(stateScope, "", jarConnectionStateKey))
}

func TestJarDisconnect_NeverSendsMalformedVaultCredential(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	var hits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
	})
	host.secrets["kandy_jar.publisher_token"] = "malformed-token"
	p := newTestPlugin(t, host)
	resp, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.disconnect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.Status)
	require.Zero(t, hits.Load())
	require.Contains(t, host.secrets, "kandy_jar.publisher_token")
	require.Contains(t, host.state, stateMapKey(stateScope, "", "kandy_jar.connection"))
}

func TestJarOutbox_RetainsPendingUntilAckThenStagesLatestDesiredRevision(t *testing.T) {
	first := jarKandy{
		Level: 4, StageName: "First", Mood: "content", Generation: 1,
		Ancestors: make([]jarAncestor, 0),
	}
	latest := jarKandy{
		Level: 5, StageName: "Latest", Mood: "happy", Generation: 1,
		Ancestors: make([]jarAncestor, 0),
	}
	state := jarConnectionState{
		AckedRevision: 0,
		Pending:       &jarPendingSnapshot{Revision: 1, Kandy: first},
	}

	require.True(t, stageJarDesired(&state, latest))
	require.Equal(t, int64(1), state.Pending.Revision)
	require.Equal(t, first, state.Pending.Kandy)
	require.NotNil(t, state.Desired)
	require.Equal(t, latest, *state.Desired)

	require.NoError(t, acknowledgeJarPending(&state, 1))
	require.Equal(t, int64(1), state.AckedRevision)
	require.NotNil(t, state.Published)
	require.Equal(t, first, *state.Published)
	require.NotNil(t, state.Pending)
	require.Equal(t, int64(2), state.Pending.Revision)
	require.Equal(t, latest, state.Pending.Kandy)
	require.Nil(t, state.Desired)

	// A projection equal to the exact in-flight payload cancels a later
	// desired update; acknowledging it must not burn another revision.
	other := jarKandy{
		Level: 6, StageName: "Other", Mood: "bored", Generation: 1,
		Ancestors: make([]jarAncestor, 0),
	}
	require.True(t, stageJarDesired(&state, other))
	require.NotNil(t, state.Desired)
	require.True(t, stageJarDesired(&state, latest))
	require.Nil(t, state.Desired)
	require.NoError(t, acknowledgeJarPending(&state, 2))
	require.Nil(t, state.Pending)
	require.Equal(t, int64(2), state.AckedRevision)
	require.False(t, stageJarDesired(&state, latest))
	require.Nil(t, state.Pending)
}

func TestJarPublish_RetriesTheExactPendingBodyAndRevision(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token, _, err := newJarPublisherToken()
	require.NoError(t, err)
	bodies := make(chan []byte, 2)
	var attempts atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPut, r.Method)
		require.Equal(t, "/api/v1/installations/"+installationID+"/snapshot", r.URL.Path)
		require.Equal(t, "Bearer "+token, r.Header.Get("Authorization"))
		body, readErr := io.ReadAll(r.Body)
		require.NoError(t, readErr)
		require.LessOrEqual(t, len(body), 16<<10)
		bodies <- append([]byte(nil), body...)
		if attempts.Add(1) == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"temporary"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `","revision":7,"status":"published","received_at":"2026-08-19T12:00:00Z"}`))
	}))
	t.Cleanup(server.Close)

	pending := jarPendingSnapshot{
		Revision: 7,
		Kandy: jarKandy{
			Level: 21, Stage: 3, StageName: "Retry Kandy", Mood: "content", Generation: 2,
			Ancestors: make([]jarAncestor, 0),
		},
	}
	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
		AckedRevision: 6, Pending: &pending,
	})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)

	require.True(t, p.publishJarOnce(context.Background()), "500 should retain the outbox for retry")
	failedState := getJarState(t, host)
	require.NotNil(t, failedState.Pending)
	require.Equal(t, pending, *failedState.Pending)

	require.False(t, p.publishJarOnce(context.Background()), "acknowledged outbox has no work left")
	firstBody := <-bodies
	secondBody := <-bodies
	require.Equal(t, firstBody, secondBody)
	var published map[string]any
	require.NoError(t, json.Unmarshal(firstBody, &published))
	require.ElementsMatch(t, []string{"protocol_version", "revision", "kandy"}, mapKeys(published))
	require.Equal(t, float64(7), published["revision"])
	publishedKandy, ok := published["kandy"].(map[string]any)
	require.True(t, ok)
	ancestors, ok := publishedKandy["ancestors"].([]any)
	require.True(t, ok, "first-generation publish must send an array, not null")
	require.Empty(t, ancestors)

	ackedState := getJarState(t, host)
	require.Nil(t, ackedState.Pending)
	require.Equal(t, int64(7), ackedState.AckedRevision)
	require.NotNil(t, ackedState.Published)
	require.Equal(t, pending.Kandy, *ackedState.Published)
}

func TestJarPublisher_PublishesInitialAndEventSnapshotsWithMonotonicRevisions(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	published := make(chan jarPublishRequest, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/pairings/redeem":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"protocol_version":1,"installation_id":"` + installationID + `"}`))
		case "/api/v1/installations/" + installationID + "/snapshot":
			var request jarPublishRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			published <- request
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(fmt.Sprintf(
				`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"published","received_at":"2026-08-19T12:00:00Z"}`,
				installationID, request.Revision,
			)))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(map[string]any{"jar_origin": server.URL})
	p := newTestPlugin(t, host)
	connected, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.connect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-1", WorkspaceID: "workspace-1"},
		Body:      []byte(`{"pairing_code":"KJ-ABCD-EFGH-KJMN"}`),
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, connected.Status)

	first := waitJarPublish(t, published)
	require.Equal(t, int64(1), first.Revision)
	require.NoError(t, p.OnEvent(context.Background(), busEvent(eventAgentCompleted, map[string]any{"agent_id": "agent-1"})))
	second := waitJarPublish(t, published)
	require.Equal(t, int64(2), second.Revision)
	require.NotEqual(t, first.Kandy, second.Kandy)
}

func TestJarPublisher_ResumesPersistedPendingSnapshotAfterHostInjection(t *testing.T) {
	const installationID = "9c7673a3-b8d5-43df-a9f6-0448c18402fd"
	token, _, err := newJarPublisherToken()
	require.NoError(t, err)
	published := make(chan jarPublishRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request jarPublishRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		published <- request
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(
			`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"unchanged","received_at":"2026-08-19T12:00:00Z"}`,
			installationID, request.Revision,
		)))
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, OwnerActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
		AckedRevision: 2,
		Pending: &jarPendingSnapshot{
			Revision: 3,
			Kandy:    jarKandy{Level: 9, StageName: "Restarted", Mood: "content", Generation: 1},
		},
	})
	putJarSecret(t, host, server.URL, token)
	p := newPlugin()
	p.SetHost(host)
	t.Cleanup(p.close)

	request := waitJarPublish(t, published)
	require.Equal(t, int64(3), request.Revision)
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
