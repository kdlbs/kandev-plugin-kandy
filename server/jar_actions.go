package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

func (p *plugin) HandleAction(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	if req == nil {
		return jarActionError(http.StatusBadRequest, "invalid request"), nil
	}
	if req.Context.ActorID == "" {
		return jarActionError(http.StatusUnauthorized, "authentication required"), nil
	}
	if req.Context.WorkspaceID == "" {
		return jarActionError(http.StatusBadRequest, "workspace is required"), nil
	}
	switch req.ActionKey {
	case actionKeyJarConnect:
		return p.handleJarConnect(ctx, req)
	case actionKeyJarDisconnect:
		return p.handleJarDisconnect(ctx, req)
	case actionKeyJarStatus:
		return p.handleJarStatus(ctx, req)
	default:
		return jarActionError(http.StatusNotFound, "unknown action"), nil
	}
}

func (p *plugin) handleJarStatus(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}
	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	}
	if !found {
		return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
	}
	pendingRevision := int64(0)
	if state.Pending != nil {
		pendingRevision = state.Pending.Revision
	}
	return jarActionJSON(http.StatusOK, map[string]any{
		"connected":           !state.Revoked,
		"installation_id":     state.InstallationID,
		"origin":              state.Origin,
		"acked_revision":      state.AckedRevision,
		"pending_revision":    pendingRevision,
		"publication_pending": state.Pending != nil,
	}), nil
}

func (p *plugin) handleJarDisconnect(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}
	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	}
	if !found {
		return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
	}
	if !state.Revoked {
		credential, found, err := p.getJarSecret(ctx, host)
		if err != nil || !found || credential.Origin != state.Origin {
			return jarActionError(http.StatusServiceUnavailable, "publisher credential is unavailable"), nil
		}
		if err := p.revokeJarPublication(ctx, state.Origin, state.InstallationID, credential.Token); err != nil {
			return jarActionError(http.StatusBadGateway, "Kandy Jar could not be disconnected"), nil
		}
		// Persist the remote revocation before deleting the only credential.
		// A local cleanup failure can then be retried without attempting to
		// authenticate to an already-revoked publication.
		state.Revoked = true
		if err := p.storeJarConnection(ctx, host, state); err != nil {
			return jarActionError(http.StatusServiceUnavailable, "disconnect state could not be stored"), nil
		}
	}
	if err := p.deleteJarSecret(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "publisher credential could not be deleted"), nil
	}
	if err := p.deleteJarConnection(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state could not be deleted"), nil
	}
	return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
}

func (p *plugin) handleJarConnect(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	var input jarConnectBody
	if err := decodeStrictJSON(req.Body, &input); err != nil {
		return jarActionError(http.StatusBadRequest, "invalid pairing code"), nil
	}
	pairingCode, err := normalizeJarPairingCode(input.PairingCode)
	if err != nil {
		return jarActionError(http.StatusBadRequest, "invalid pairing code"), nil
	}
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}

	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	if _, found, err := p.loadJarConnection(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	} else if found {
		return jarActionError(http.StatusConflict, "Kandy Jar is already connected"), nil
	}
	ledger, authoritative := p.ledgerSnapshot(ctx)
	if !authoritative || ledger.transient {
		return jarActionError(http.StatusServiceUnavailable, "authoritative Kandy state is unavailable"), nil
	}

	origin, err := p.configuredJarOrigin(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandy Jar origin is invalid"), nil
	}
	credential, credentialFound, err := p.getJarSecret(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "publisher credential is unavailable"), nil
	}
	tokenStored := credentialFound && credential.Origin == origin
	token := credential.Token
	var tokenHash string
	if tokenStored {
		tokenHash = jarPublisherTokenHash(token)
	} else {
		token, tokenHash, err = newJarPublisherToken()
		if err != nil {
			return jarActionError(http.StatusInternalServerError, "publisher credential generation failed"), nil
		}
	}
	installationID, status, err := p.redeemJarPairing(ctx, origin, pairingCode, tokenHash)
	if err != nil {
		return jarActionError(status, "pairing code is invalid, used, expired, or temporarily unavailable"), nil
	}
	if !tokenStored {
		if err := p.setJarSecret(ctx, host, origin, token); err != nil {
			p.revokeFailedJarConnect(ctx, origin, installationID, token)
			return jarActionError(http.StatusServiceUnavailable, "publisher credential could not be stored"), nil
		}
	}

	pending := &jarPendingSnapshot{
		Revision: 1,
		Kandy:    projectJarKandy(p.presentLedger(ledger, nil)),
	}
	state := jarConnectionState{
		StateVersion:       jarConnectionStateVersion,
		ProtocolVersion:    jarProtocolVersion,
		InstallationID:     installationID,
		Origin:             origin,
		ConnectedByActorID: req.Context.ActorID,
		ConnectedAt:        p.now().UTC().Format(time.RFC3339),
		Pending:            pending,
	}
	if err := p.storeJarConnection(ctx, host, state); err != nil {
		if errors.Is(err, errJarConnectionCommitUnknown) {
			// The Host may have committed the sealed state. Keep the only
			// recovery credential and wake the passive publisher; either is
			// harmless if the write was actually rejected.
			p.signalJarPublisher()
			return jarActionError(http.StatusServiceUnavailable, "connection state could not be confirmed"), nil
		}
		p.compensateFailedJarConnect(ctx, host, origin, installationID, token)
		return jarActionError(http.StatusServiceUnavailable, "connection state could not be stored"), nil
	}
	p.signalJarPublisher()
	return jarActionJSON(http.StatusOK, map[string]any{
		"connected":        true,
		"installation_id":  installationID,
		"origin":           origin,
		"pending_revision": pending.Revision,
	}), nil
}

func normalizeJarPairingCode(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !jarPairingCodePattern.MatchString(code) {
		return "", fmt.Errorf("invalid pairing code")
	}
	return code, nil
}

func decodeStrictJSON(body []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request must contain one JSON value")
	}
	return nil
}

func (p *plugin) configuredJarOrigin(ctx context.Context, host pluginsdk.Host) (string, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	config, err := host.GetConfig(callCtx)
	if err != nil {
		return "", err
	}
	raw := defaultJarOrigin
	if configured, ok := config[configKeyJarOrigin].(string); ok && strings.TrimSpace(configured) != "" {
		raw = configured
	}
	return normalizeJarOrigin(raw)
}

func newJarPublisherToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", "", err
	}
	token = "kjp_v1_" + base64.RawURLEncoding.EncodeToString(raw)
	return token, jarPublisherTokenHash(token), nil
}

func jarPublisherTokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (p *plugin) redeemJarPairing(ctx context.Context, origin, code, tokenHash string) (string, int, error) {
	request := jarRedeemRequest{
		ProtocolVersion:      jarProtocolVersion,
		UserCode:             code,
		PublisherTokenSHA256: tokenHash,
	}
	for attempt := 0; attempt < 2; attempt++ {
		var response jarRedeemResponse
		status, err := p.doJarJSON(ctx, http.MethodPost, origin, "/api/v1/pairings/redeem", "", request, &response)
		if err != nil {
			if attempt == 0 && jarRedeemRetryable(status) {
				continue
			}
			return "", jarUpstreamStatus(status), err
		}
		if status != http.StatusOK && status != http.StatusCreated {
			return "", jarUpstreamStatus(status), fmt.Errorf("pairing rejected")
		}
		if response.ProtocolVersion != jarProtocolVersion || !jarUUIDPattern.MatchString(response.InstallationID) {
			return "", http.StatusBadGateway, fmt.Errorf("invalid pairing response")
		}
		return strings.ToLower(response.InstallationID), http.StatusOK, nil
	}
	return "", http.StatusBadGateway, fmt.Errorf("pairing failed")
}

func jarRedeemRetryable(status int) bool {
	return status == 0 || status == http.StatusRequestTimeout || status >= 500
}

func jarActionError(status int, message string) *pluginsdk.PluginActionResponse {
	return jarActionJSON(status, map[string]any{"error": message})
}

func jarActionJSON(status int, value any) *pluginsdk.PluginActionResponse {
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"encoding response"}`)
	}
	return &pluginsdk.PluginActionResponse{
		Status: status,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: body,
	}
}
