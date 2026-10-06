package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

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
			_, _ = fmt.Fprintf(w,
				`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"published","received_at":"2026-08-19T12:00:00Z"}`,
				installationID, request.Revision,
			)
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
	require.Equal(t, "actor-1", state.ConnectedByActorID)
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
			_, _ = fmt.Fprintf(w,
				`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"published","received_at":"2026-08-19T12:00:00Z"}`,
				installationID, request.Revision,
			)
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

func TestJarActions_HostAuthorizedActorCanInspectAndDisconnect(t *testing.T) {
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
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
	})
	putJarSecret(t, host, server.URL, token)
	p := newTestPlugin(t, host)

	status, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.status",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-2", WorkspaceID: "workspace-2"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, status.Status)
	require.NotContains(t, string(status.Body), token)
	require.Contains(t, string(status.Body), installationID)

	disconnected, err := p.HandleAction(context.Background(), &pluginsdk.PluginActionRequest{
		ActionKey: "jar.disconnect",
		Context:   pluginsdk.VerifiedActionContext{ActorID: "actor-2", WorkspaceID: "workspace-1"},
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
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
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
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T12:00:00Z",
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
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
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
