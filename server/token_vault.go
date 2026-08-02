package main

import (
	"context"
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
	tokenVaultStateKey      = "kandy-token-vault"
	tokenUsageEventPrefix   = "session_prompt_usage.updated."
	tokenVaultSchemaVersion = 1
)

type tokenVaultLedger struct {
	SchemaVersion    int              `json:"schema_version"`
	Lineage          string           `json:"lineage"`
	ObservedSince    string           `json:"observed_since"`
	UpdatedAt        string           `json:"updated_at"`
	TotalTokens      string           `json:"total_tokens"`
	Rooms            []tokenVaultRoom `json:"rooms"`
	RecentBodyHashes []string         `json:"recent_body_hashes,omitempty"`
	SealVersion      int              `json:"seal_version,omitempty"`
	Sig              string           `json:"sig,omitempty"`
}

type tokenVaultRoom struct {
	AgentType string            `json:"agent_type"`
	Tokens    string            `json:"tokens"`
	Models    []tokenVaultModel `json:"models"`
}

type tokenVaultModel struct {
	Name   string `json:"name"`
	Tokens string `json:"tokens"`
}

type tokenVaultResponse struct {
	Status        string                   `json:"status"`
	ObservedSince string                   `json:"observed_since,omitempty"`
	TotalTokens   string                   `json:"total_tokens"`
	Rooms         []tokenVaultRoomResponse `json:"rooms"`
}

type tokenVaultRoomResponse struct {
	AgentType string                    `json:"agent_type"`
	Label     string                    `json:"label"`
	Tokens    string                    `json:"tokens"`
	Models    []tokenVaultModelResponse `json:"models"`
}

type tokenVaultModelResponse struct {
	Name   string `json:"name"`
	Tokens string `json:"tokens"`
}

type observedTokenUsage struct {
	AgentType string
	Model     string
	Tokens    *big.Int
	Timestamp string
}

func isTokenUsageEvent(eventType string) bool {
	return strings.HasPrefix(eventType, tokenUsageEventPrefix) && len(eventType) > len(tokenUsageEventPrefix)
}

func (p *plugin) observeTokenUsage(ctx context.Context, event *pluginsdk.Event) {
	usage, ok := normalizeTokenUsage(event)
	if !ok {
		return
	}
	lineage := strconv.FormatUint(uint64(p.loadLedger(ctx).Salt), 10)
	vault := p.loadTokenVault(ctx, lineage)
	addTokenUsage(vault, usage)
	vault.UpdatedAt = p.now().UTC().Format(time.RFC3339)
	if vault.ObservedSince == "" {
		vault.ObservedSince = usage.Timestamp
	}
	p.persistTokenVault(ctx, vault)
}

func normalizeTokenUsage(event *pluginsdk.Event) (observedTokenUsage, bool) {
	if event == nil || event.Payload == nil {
		return observedTokenUsage{}, false
	}
	usageMap, ok := event.Payload["usage"].(map[string]any)
	if !ok {
		return observedTokenUsage{}, false
	}
	tokens, valid, present := safeEventInteger(usageMap["total_tokens"])
	if !valid {
		return observedTokenUsage{}, false
	}
	if !present || tokens.Sign() == 0 {
		input, inputValid, _ := safeEventInteger(usageMap["input_tokens"])
		output, outputValid, _ := safeEventInteger(usageMap["output_tokens"])
		if !inputValid || !outputValid {
			return observedTokenUsage{}, false
		}
		tokens = new(big.Int).Add(input, output)
	}
	if tokens.Sign() <= 0 {
		return observedTokenUsage{}, false
	}
	timestamp, _ := event.Payload["timestamp"].(string)
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return observedTokenUsage{}, false
	}
	return observedTokenUsage{
		AgentType: sanitizeVaultLabel(stringValue(event.Payload["agent_type"]), "mystery-agent", 64),
		Model:     sanitizeVaultLabel(stringValue(event.Payload["model"]), "Mystery model", 128),
		Tokens:    tokens,
		Timestamp: parsed.UTC().Format(time.RFC3339),
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

func sanitizeVaultLabel(value, fallback string, maxBytes int) string {
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

func addTokenUsage(vault *tokenVaultLedger, usage observedTokenUsage) {
	vault.TotalTokens = addDecimal(vault.TotalTokens, usage.Tokens)
	roomIndex := -1
	for i := range vault.Rooms {
		if vault.Rooms[i].AgentType == usage.AgentType {
			roomIndex = i
			break
		}
	}
	if roomIndex < 0 {
		vault.Rooms = append(vault.Rooms, tokenVaultRoom{AgentType: usage.AgentType, Tokens: "0", Models: []tokenVaultModel{}})
		roomIndex = len(vault.Rooms) - 1
	}
	room := &vault.Rooms[roomIndex]
	room.Tokens = addDecimal(room.Tokens, usage.Tokens)
	for i := range room.Models {
		if room.Models[i].Name == usage.Model {
			room.Models[i].Tokens = addDecimal(room.Models[i].Tokens, usage.Tokens)
			return
		}
	}
	room.Models = append(room.Models, tokenVaultModel{Name: usage.Model, Tokens: usage.Tokens.String()})
}

func addDecimal(current string, delta *big.Int) string {
	value := new(big.Int)
	if _, ok := value.SetString(current, 10); !ok || value.Sign() < 0 {
		value.SetInt64(0)
	}
	return value.Add(value, delta).String()
}

func (p *plugin) loadTokenVault(ctx context.Context, lineage string) *tokenVaultLedger {
	if p.vaultCached != nil && p.vaultCached.Lineage == lineage {
		return p.vaultCached
	}
	fresh := &tokenVaultLedger{
		SchemaVersion: tokenVaultSchemaVersion,
		Lineage:       lineage,
		TotalTokens:   "0",
		Rooms:         []tokenVaultRoom{},
	}
	host := p.Host()
	if host == nil {
		return fresh
	}
	value, found, err := host.GetState(ctx, stateScope, "", tokenVaultStateKey)
	if err != nil {
		log.Printf("kandy: reading token vault state: %v", err)
		return fresh
	}
	if !found {
		p.vaultCached = fresh
		return p.vaultCached
	}
	loaded, ok := tokenVaultFromMap(value)
	if !ok || loaded.SchemaVersion != tokenVaultSchemaVersion || loaded.Lineage != lineage {
		p.vaultCached = fresh
		return p.vaultCached
	}
	p.vaultCached = loaded
	return p.vaultCached
}

func (p *plugin) persistTokenVault(ctx context.Context, vault *tokenVaultLedger) {
	p.vaultCached = vault
	host := p.Host()
	if host == nil {
		return
	}
	if err := host.SetState(ctx, stateScope, "", tokenVaultStateKey, tokenVaultToMap(vault)); err != nil {
		log.Printf("kandy: persisting token vault state: %v", err)
	}
}

func tokenVaultToMap(vault *tokenVaultLedger) map[string]any {
	encoded, _ := json.Marshal(vault)
	var value map[string]any
	_ = json.Unmarshal(encoded, &value)
	return value
}

func tokenVaultFromMap(value map[string]any) (*tokenVaultLedger, bool) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var vault tokenVaultLedger
	if err := json.Unmarshal(encoded, &vault); err != nil {
		return nil, false
	}
	return &vault, true
}

func (p *plugin) presentTokenVault(ctx context.Context, lineage uint32) tokenVaultResponse {
	vault := p.loadTokenVault(ctx, strconv.FormatUint(uint64(lineage), 10))
	response := tokenVaultResponse{Status: "empty", TotalTokens: "0", Rooms: []tokenVaultRoomResponse{}}
	if vault.ObservedSince == "" || vault.TotalTokens == "0" {
		return response
	}
	response.Status = "ready"
	response.ObservedSince = vault.ObservedSince
	response.TotalTokens = vault.TotalTokens
	for _, room := range vault.Rooms {
		roomResponse := tokenVaultRoomResponse{
			AgentType: room.AgentType,
			Label:     agentRoomLabel(room.AgentType),
			Tokens:    room.Tokens,
			Models:    []tokenVaultModelResponse{},
		}
		for _, model := range room.Models {
			roomResponse.Models = append(roomResponse.Models, tokenVaultModelResponse{Name: model.Name, Tokens: model.Tokens})
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
		return "Claude"
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
			words[i] = strings.ToUpper(words[i][:1]) + words[i][1:]
		}
		return strings.Join(words, " ")
	}
}
