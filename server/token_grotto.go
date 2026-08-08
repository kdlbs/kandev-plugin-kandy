package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

const (
	tokenGrottoStateKey      = "kandy-token-grotto"
	tokenUsageEventPrefix    = "session_prompt_usage.updated."
	tokenGrottoSchemaVersion = 1
	tokenGrottoDigestLimit   = 512
)

type tokenGrottoLedger struct {
	SchemaVersion    int               `json:"schema_version"`
	Lineage          string            `json:"lineage"`
	ObservedSince    string            `json:"observed_since"`
	UpdatedAt        string            `json:"updated_at"`
	TotalTokens      string            `json:"total_tokens"`
	Partial          bool              `json:"partial,omitempty"`
	Rooms            []tokenGrottoRoom `json:"rooms"`
	RecentBodyHashes []string          `json:"recent_body_hashes,omitempty"`
	SealVersion      int               `json:"seal_version,omitempty"`
	Sig              string            `json:"sig,omitempty"`
}

type tokenGrottoRoom struct {
	AgentType string             `json:"agent_type"`
	Tokens    string             `json:"tokens"`
	Models    []tokenGrottoModel `json:"models"`
}

type tokenGrottoModel struct {
	Name   string `json:"name"`
	Tokens string `json:"tokens"`
	// LastSeen is the source timestamp of the most recent observation for this
	// model, kept so the chamber can show recently used models beside the
	// biggest ones. Omitted when empty, which keeps ledgers written before this
	// field byte-identical — and therefore still valid under their old seal.
	LastSeen string `json:"last_seen,omitempty"`
}

type tokenGrottoResponse struct {
	Status        string                    `json:"status"`
	ObservedSince string                    `json:"observed_since,omitempty"`
	TotalTokens   string                    `json:"total_tokens"`
	Rooms         []tokenGrottoRoomResponse `json:"rooms"`
}

type tokenGrottoRoomResponse struct {
	AgentType string                     `json:"agent_type"`
	Label     string                     `json:"label"`
	Tokens    string                     `json:"tokens"`
	Models    []tokenGrottoModelResponse `json:"models"`
}

type tokenGrottoModelResponse struct {
	Name     string `json:"name"`
	Tokens   string `json:"tokens"`
	LastSeen string `json:"last_seen,omitempty"`
}

type observedTokenUsage struct {
	AgentType string
	Model     string
	Tokens    *big.Int
	Timestamp string
	DedupKey  string
	Partial   bool
}

type canonicalTokenField struct {
	Present bool   `json:"present"`
	Value   string `json:"value,omitempty"`
}

type canonicalTokenUsageBody struct {
	Timestamp   string              `json:"timestamp"`
	TaskID      string              `json:"task_id"`
	SessionID   string              `json:"session_id"`
	AgentID     string              `json:"agent_id"`
	AgentType   string              `json:"agent_type"`
	Model       string              `json:"model"`
	Input       canonicalTokenField `json:"input"`
	Output      canonicalTokenField `json:"output"`
	CacheRead   canonicalTokenField `json:"cache_read"`
	CacheWrite  canonicalTokenField `json:"cache_write"`
	Thought     canonicalTokenField `json:"thought"`
	Total       canonicalTokenField `json:"total"`
	Estimated   bool                `json:"estimated"`
	HasEstimate bool                `json:"has_estimate"`
}

func isTokenUsageEvent(eventType string) bool {
	return strings.HasPrefix(eventType, tokenUsageEventPrefix) && len(eventType) > len(tokenUsageEventPrefix)
}

func (p *plugin) observeTokenUsage(ctx context.Context, event *pluginsdk.Event) {
	// Token history follows Kandy lineage. Persist a sealed zero-XP Kandy
	// before its first usage observation so a process restart cannot mint a
	// different salt and orphan the separate grotto row. This persistence is
	// deliberately not a creature mutation: no timestamps or XP bookkeeping
	// change when token metadata arrives.
	kandy, persisted := p.ensureTokenGrottoLineage(ctx)
	if !persisted {
		return
	}
	lineage := strconv.FormatUint(uint64(kandy.Salt), 10)
	loaded, err := p.loadTokenGrotto(ctx, lineage)
	if err != nil {
		return
	}
	grotto := cloneTokenGrotto(loaded)
	usage, ok := normalizeTokenUsage(event)
	if !ok {
		grotto.Partial = true
		grotto.UpdatedAt = p.now().UTC().Format(time.RFC3339)
		observedAt := tokenUsageTimestamp(event, p.now())
		if grotto.ObservedSince == "" || observedAt < grotto.ObservedSince {
			grotto.ObservedSince = observedAt
		}
		p.persistTokenGrotto(ctx, grotto)
		return
	}
	for _, digest := range grotto.RecentBodyHashes {
		if digest == usage.DedupKey {
			return
		}
	}
	addTokenUsage(grotto, usage)
	if usage.Partial {
		grotto.Partial = true
	}
	grotto.RecentBodyHashes = append(grotto.RecentBodyHashes, usage.DedupKey)
	if len(grotto.RecentBodyHashes) > tokenGrottoDigestLimit {
		grotto.RecentBodyHashes = append([]string(nil), grotto.RecentBodyHashes[len(grotto.RecentBodyHashes)-tokenGrottoDigestLimit:]...)
	}
	grotto.UpdatedAt = p.now().UTC().Format(time.RFC3339)
	if grotto.ObservedSince == "" || usage.Timestamp < grotto.ObservedSince {
		grotto.ObservedSince = usage.Timestamp
	}
	p.persistTokenGrotto(ctx, grotto)
}

func tokenUsageTimestamp(event *pluginsdk.Event, fallback time.Time) string {
	if event != nil && event.Payload != nil {
		if timestamp, ok := event.Payload["timestamp"].(string); ok {
			if parsed, err := time.Parse(time.RFC3339Nano, timestamp); err == nil {
				return parsed.UTC().Format(time.RFC3339)
			}
		}
	}
	return fallback.UTC().Format(time.RFC3339)
}

func (p *plugin) ensureTokenGrottoLineage(ctx context.Context) (*ledger, bool) {
	kandy := p.loadLedger(ctx)
	host := p.Host()
	if host == nil {
		return kandy, false
	}
	stored, found, err := host.GetState(ctx, stateScope, "", stateKey)
	if err != nil {
		log.Printf("kandy: checking token grotto lineage: %v", err)
		return kandy, false
	}
	if found && ledgerFromMap(stored).Salt == kandy.Salt {
		return kandy, true
	}
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		log.Printf("kandy: seal key unavailable, skipping token grotto lineage persist: %v", err)
		return kandy, false
	}
	copy := *kandy
	sealLedger(&copy, key)
	if err := host.SetState(ctx, stateScope, "", stateKey, ledgerToMap(&copy)); err != nil {
		log.Printf("kandy: persisting token grotto lineage: %v", err)
		return kandy, false
	}
	p.cached = &copy
	return p.cached, true
}

func normalizeTokenUsage(event *pluginsdk.Event) (observedTokenUsage, bool) {
	if event == nil || event.Payload == nil {
		return observedTokenUsage{}, false
	}
	usageMap, ok := event.Payload["usage"].(map[string]any)
	if !ok {
		return observedTokenUsage{}, false
	}
	fields := map[string]canonicalTokenField{}
	parsedFields := map[string]*big.Int{}
	for _, name := range []string{"input_tokens", "output_tokens", "cached_read_tokens", "cached_write_tokens", "thought_tokens", "total_tokens"} {
		value, valid, present := safeEventInteger(usageMap[name])
		if !valid {
			return observedTokenUsage{}, false
		}
		parsedFields[name] = value
		fields[name] = canonicalTokenField{Present: present, Value: value.String()}
	}
	tokens := parsedFields["total_tokens"]
	present := fields["total_tokens"].Present
	usedFallback := !present || tokens.Sign() == 0
	if usedFallback {
		tokens = new(big.Int).Add(parsedFields["input_tokens"], parsedFields["output_tokens"])
	}
	if tokens.Sign() <= 0 {
		return observedTokenUsage{}, false
	}
	timestamp, _ := event.Payload["timestamp"].(string)
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return observedTokenUsage{}, false
	}
	agentType := sanitizeGrottoLabel(stringValue(event.Payload["agent_type"]), "mystery-agent", 64)
	model := sanitizeGrottoLabel(stringValue(event.Payload["model"]), "Mystery model", 128)
	estimated, hasEstimate := usageMap["estimated"].(bool)
	if rawEstimate, present := usageMap["estimated"]; present {
		if _, ok := rawEstimate.(bool); !ok {
			return observedTokenUsage{}, false
		}
	}
	canonical := canonicalTokenUsageBody{
		Timestamp:   parsed.UTC().Format(time.RFC3339Nano),
		TaskID:      stringValue(event.Payload["task_id"]),
		SessionID:   stringValue(event.Payload["session_id"]),
		AgentID:     stringValue(event.Payload["agent_id"]),
		AgentType:   agentType,
		Model:       model,
		Input:       fields["input_tokens"],
		Output:      fields["output_tokens"],
		CacheRead:   fields["cached_read_tokens"],
		CacheWrite:  fields["cached_write_tokens"],
		Thought:     fields["thought_tokens"],
		Total:       fields["total_tokens"],
		Estimated:   estimated,
		HasEstimate: hasEstimate,
	}
	canonicalJSON, err := json.Marshal(canonical)
	if err != nil {
		return observedTokenUsage{}, false
	}
	digest := sha256.Sum256(canonicalJSON)
	dedupKey := hex.EncodeToString(digest[:])
	return observedTokenUsage{
		AgentType: agentType,
		Model:     model,
		Tokens:    tokens,
		Timestamp: parsed.UTC().Format(time.RFC3339),
		DedupKey:  dedupKey,
		Partial:   usedFallback || estimated,
	}, true
}

func safeEventInteger(value any) (*big.Int, bool, bool) {
	if value == nil {
		return new(big.Int), true, false
	}
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number >= float64(1<<53) || math.Trunc(number) != number {
		return nil, false, true
	}
	return big.NewInt(int64(number)), true, true
}

func stringValue(value any) string {
	valueString, _ := value.(string)
	return valueString
}

func sanitizeGrottoLabel(value, fallback string, maxBytes int) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value))
	if value == "" {
		return fallback
	}
	for len(value) > maxBytes {
		_, size := utf8.DecodeLastRuneInString(value)
		value = value[:len(value)-size]
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func addTokenUsage(grotto *tokenGrottoLedger, usage observedTokenUsage) {
	grotto.TotalTokens = addDecimal(grotto.TotalTokens, usage.Tokens)
	roomIndex := -1
	for i := range grotto.Rooms {
		if grotto.Rooms[i].AgentType == usage.AgentType {
			roomIndex = i
			break
		}
	}
	if roomIndex < 0 {
		grotto.Rooms = append(grotto.Rooms, tokenGrottoRoom{AgentType: usage.AgentType, Tokens: "0", Models: []tokenGrottoModel{}})
		roomIndex = len(grotto.Rooms) - 1
	}
	room := &grotto.Rooms[roomIndex]
	room.Tokens = addDecimal(room.Tokens, usage.Tokens)
	for i := range room.Models {
		if room.Models[i].Name == usage.Model {
			room.Models[i].Tokens = addDecimal(room.Models[i].Tokens, usage.Tokens)
			// Out-of-order deliveries must not move the stamp backwards.
			if usage.Timestamp > room.Models[i].LastSeen {
				room.Models[i].LastSeen = usage.Timestamp
			}
			return
		}
	}
	room.Models = append(room.Models, tokenGrottoModel{Name: usage.Model, Tokens: usage.Tokens.String(), LastSeen: usage.Timestamp})
}

func addDecimal(current string, delta *big.Int) string {
	value := new(big.Int)
	if _, ok := value.SetString(current, 10); !ok || value.Sign() < 0 {
		value.SetInt64(0)
	}
	return value.Add(value, delta).String()
}

func (p *plugin) loadTokenGrotto(ctx context.Context, lineage string) (*tokenGrottoLedger, error) {
	if p.grottoCached != nil && p.grottoCached.Lineage == lineage {
		return p.grottoCached, nil
	}
	fresh := &tokenGrottoLedger{
		SchemaVersion: tokenGrottoSchemaVersion,
		Lineage:       lineage,
		TotalTokens:   "0",
		Rooms:         []tokenGrottoRoom{},
	}
	host := p.Host()
	if host == nil {
		return fresh, nil
	}
	value, found, err := host.GetState(ctx, stateScope, "", tokenGrottoStateKey)
	if err != nil {
		log.Printf("kandy: reading token grotto state: %v", err)
		return nil, err
	}
	if !found {
		p.grottoCached = fresh
		return p.grottoCached, nil
	}
	loaded, ok := tokenGrottoFromMap(value)
	if !ok || loaded.SchemaVersion != tokenGrottoSchemaVersion || loaded.Lineage != lineage {
		p.grottoCached = fresh
		return p.grottoCached, nil
	}
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		log.Printf("kandy: token grotto seal key unavailable, serving unverified this round: %v", err)
		return loaded, nil
	}
	if !tokenGrottoSealValid(loaded, key) {
		log.Printf("kandy: token grotto seal invalid; restarting token history without changing Kandy")
		p.grottoCached = fresh
		return p.grottoCached, nil
	}
	p.grottoCached = loaded
	return p.grottoCached, nil
}

func (p *plugin) persistTokenGrotto(ctx context.Context, grotto *tokenGrottoLedger) {
	host := p.Host()
	if host == nil {
		p.grottoCached = grotto
		return
	}
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		log.Printf("kandy: token grotto seal key unavailable, skipping persist: %v", err)
		p.grottoCached = nil
		return
	}
	sealTokenGrotto(grotto, key)
	if err := host.SetState(ctx, stateScope, "", tokenGrottoStateKey, tokenGrottoToMap(grotto)); err != nil {
		log.Printf("kandy: persisting token grotto state: %v", err)
		p.grottoCached = nil
		return
	}
	p.grottoCached = grotto
}

func cloneTokenGrotto(grotto *tokenGrottoLedger) *tokenGrottoLedger {
	encoded, err := json.Marshal(grotto)
	if err != nil {
		return &tokenGrottoLedger{}
	}
	var clone tokenGrottoLedger
	if err := json.Unmarshal(encoded, &clone); err != nil {
		return &tokenGrottoLedger{}
	}
	return &clone
}

func tokenGrottoToMap(grotto *tokenGrottoLedger) map[string]any {
	encoded, _ := json.Marshal(grotto)
	var value map[string]any
	_ = json.Unmarshal(encoded, &value)
	return value
}

func tokenGrottoFromMap(value map[string]any) (*tokenGrottoLedger, bool) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var grotto tokenGrottoLedger
	if err := json.Unmarshal(encoded, &grotto); err != nil {
		return nil, false
	}
	return &grotto, true
}

func (p *plugin) presentTokenGrotto(ctx context.Context, lineage uint32) tokenGrottoResponse {
	response := tokenGrottoResponse{Status: "empty", TotalTokens: "0", Rooms: []tokenGrottoRoomResponse{}}
	grotto, err := p.loadTokenGrotto(ctx, strconv.FormatUint(uint64(lineage), 10))
	if err != nil {
		return response
	}
	if grotto.ObservedSince == "" || grotto.TotalTokens == "0" {
		if grotto.Partial {
			response.Status = "partial"
			response.ObservedSince = grotto.ObservedSince
		}
		return response
	}
	response.Status = "ready"
	if grotto.Partial {
		response.Status = "partial"
	}
	response.ObservedSince = grotto.ObservedSince
	response.TotalTokens = grotto.TotalTokens
	for _, room := range grotto.Rooms {
		roomResponse := tokenGrottoRoomResponse{
			AgentType: room.AgentType,
			Label:     agentRoomLabel(room.AgentType),
			Tokens:    room.Tokens,
			Models:    []tokenGrottoModelResponse{},
		}
		for _, model := range room.Models {
			roomResponse.Models = append(roomResponse.Models, tokenGrottoModelResponse{Name: model.Name, Tokens: model.Tokens, LastSeen: model.LastSeen})
		}
		sort.Slice(roomResponse.Models, func(i, j int) bool {
			comparison := compareDecimals(roomResponse.Models[i].Tokens, roomResponse.Models[j].Tokens)
			if comparison != 0 {
				return comparison > 0
			}
			return roomResponse.Models[i].Name < roomResponse.Models[j].Name
		})
		response.Rooms = append(response.Rooms, roomResponse)
	}
	sort.Slice(response.Rooms, func(i, j int) bool {
		comparison := compareDecimals(response.Rooms[i].Tokens, response.Rooms[j].Tokens)
		if comparison != 0 {
			return comparison > 0
		}
		return response.Rooms[i].Label < response.Rooms[j].Label
	})
	return response
}

func compareDecimals(left, right string) int {
	leftNumber, leftOK := new(big.Int).SetString(left, 10)
	rightNumber, rightOK := new(big.Int).SetString(right, 10)
	if !leftOK || !rightOK {
		return strings.Compare(left, right)
	}
	return leftNumber.Cmp(rightNumber)
}

func agentRoomLabel(agentType string) string {
	switch agentType {
	case "claude-acp":
		return "Claude Code"
	case "codex-acp":
		return "Codex"
	case "openai-acp":
		return "OpenAI"
	case "gemini", "gemini-acp":
		return "Gemini"
	case "opencode-acp":
		return "OpenCode"
	case "mystery-agent":
		return "Mystery agent"
	default:
		words := strings.FieldsFunc(agentType, func(r rune) bool { return r == '-' || r == '_' })
		for i := range words {
			runes := []rune(words[i])
			if len(runes) > 0 {
				runes[0] = unicode.ToUpper(runes[0])
				words[i] = string(runes)
			}
		}
		return strings.Join(words, " ")
	}
}
