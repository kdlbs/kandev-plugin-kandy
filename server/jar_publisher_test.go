package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

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
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
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
		_, _ = fmt.Fprintf(w,
			`{"protocol_version":1,"installation_id":"%s","revision":%d,"status":"unchanged","received_at":"2026-08-19T12:00:00Z"}`,
			installationID, request.Revision,
		)
	}))
	t.Cleanup(server.Close)

	host := newFakeHost(nil)
	putJarState(t, host, jarConnectionState{
		StateVersion: 1, ProtocolVersion: 1, InstallationID: installationID,
		Origin: server.URL, ConnectedByActorID: "actor-1", ConnectedAt: "2026-08-19T11:00:00Z",
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
