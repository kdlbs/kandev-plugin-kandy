package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

func (p *plugin) doJarJSON(
	ctx context.Context,
	method, origin, path, bearer string,
	requestBody any,
	responseBody any,
) (int, error) {
	var requestReader io.Reader
	if requestBody != nil {
		raw, err := json.Marshal(requestBody)
		if err != nil {
			return 0, err
		}
		requestReader = bytes.NewReader(raw)
	}
	callCtx, cancel := context.WithTimeout(ctx, jarHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, method, origin+path, requestReader)
	if err != nil {
		return 0, err
	}
	if requestBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := &http.Client{
		Transport: http.DefaultTransport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if !jarResponseMatchesOrigin(resp, origin) {
		return resp.StatusCode, fmt.Errorf("response origin mismatch")
	}
	limited := io.LimitReader(resp.Body, jarResponseLimit+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return resp.StatusCode, err
	}
	if len(body) > jarResponseLimit {
		return resp.StatusCode, fmt.Errorf("response too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, &jarUpstreamResponseError{
			status:      resp.StatusCode,
			contentType: resp.Header.Get("Content-Type"),
			body:        append([]byte(nil), body...),
		}
	}
	if responseBody != nil {
		mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
		if err != nil || !strings.EqualFold(mediaType, "application/json") {
			return resp.StatusCode, fmt.Errorf("upstream response is not JSON")
		}
		if err := decodeStrictJSON(body, responseBody); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

func jarResponseMatchesOrigin(resp *http.Response, origin string) bool {
	if resp == nil || resp.Request == nil || resp.Request.URL == nil {
		return false
	}
	actual, err := normalizeJarOrigin(resp.Request.URL.Scheme + "://" + resp.Request.URL.Host)
	return err == nil && actual == origin
}

func jarUpstreamStatus(status int) int {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict, http.StatusGone, http.StatusUnprocessableEntity:
		return http.StatusBadRequest
	case http.StatusTooManyRequests:
		return http.StatusTooManyRequests
	default:
		return http.StatusBadGateway
	}
}

func (p *plugin) revokeJarPublication(ctx context.Context, origin, installationID, token string) error {
	status, err := p.doJarJSON(ctx, http.MethodDelete, origin,
		"/api/v1/installations/"+url.PathEscape(installationID)+"/publication", token, nil, nil)
	if err != nil {
		if invalidPublisherResponse(err) {
			// A newly paired plugin rotates this installation's credential and
			// atomically unpublishes the old snapshot. The stale client has no
			// remaining remote authority, so it is safe to forget locally.
			return nil
		}
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("invalid revoke status")
	}
	return nil
}

func invalidPublisherResponse(err error) bool {
	var upstream *jarUpstreamResponseError
	if !errors.As(err, &upstream) || upstream.status != http.StatusUnauthorized {
		return false
	}
	mediaType, _, parseErr := mime.ParseMediaType(upstream.contentType)
	if parseErr != nil || !strings.EqualFold(mediaType, "application/json") {
		return false
	}
	var response struct {
		Error string `json:"error"`
	}
	return decodeStrictJSON(upstream.body, &response) == nil && response.Error == "invalid_publisher"
}

func (p *plugin) compensateFailedJarConnect(ctx context.Context, host pluginsdk.Host, origin, installationID, token string) {
	if !p.revokeFailedJarConnect(ctx, origin, installationID, token) {
		return
	}
	_ = p.deleteJarSecret(ctx, host)
}

func (p *plugin) revokeFailedJarConnect(ctx context.Context, origin, installationID, token string) bool {
	revokeCtx, cancel := p.detachedContext(ctx)
	err := p.revokeJarPublication(revokeCtx, origin, installationID, token)
	cancel()
	return err == nil
}

func normalizeJarOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil {
		return "", fmt.Errorf("invalid Kandy Jar origin")
	}
	if parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawPath != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", fmt.Errorf("configured Kandy Jar URL must contain only an origin")
	}

	scheme := strings.ToLower(parsed.Scheme)
	hostname := strings.ToLower(parsed.Hostname())
	if scheme != "https" {
		ip := net.ParseIP(hostname)
		loopback := hostname == "localhost" || (ip != nil && ip.IsLoopback())
		if scheme != "http" || !loopback {
			return "", fmt.Errorf("configured Kandy Jar origin must use HTTPS outside localhost development")
		}
	}
	return scheme + "://" + strings.ToLower(parsed.Host), nil
}
