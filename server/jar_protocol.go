package main

import (
	"errors"
	"fmt"
	"regexp"
	"time"
)

const (
	actionKeyJarConnect    = "jar.connect"
	actionKeyJarDisconnect = "jar.disconnect"
	actionKeyJarStatus     = "jar.status"

	configKeyJarOrigin = "jar_origin"
	defaultJarOrigin   = "https://jar.kandev.ai"

	jarConnectionStateKey     = "kandy_jar.connection"
	jarPublisherSecretKey     = "kandy_jar.publisher_token"
	jarConnectionStateVersion = 2
	jarConnectionSealVersion  = 1
	jarConnectionSealDomain   = "kandy-jar-connection:hmac:v1\n"
	jarPublisherSecretVersion = 1
	jarProtocolVersion        = 1
	jarHTTPTimeout            = 8 * time.Second
	jarResponseLimit          = 4 << 10
	jarSnapshotLimit          = 16 << 10
	jarMaxSafeRevision        = int64(1<<53 - 1)
	jarDebounceDelay          = 100 * time.Millisecond
	jarRetryBaseDelay         = time.Second
	jarRetryMaxDelay          = 30 * time.Second
	jarRetryAttempts          = 5
	jarMoodRefresh            = 15 * time.Minute
)

var (
	jarPairingCodePattern         = regexp.MustCompile(`^KJ-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$`)
	jarUUIDPattern                = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	jarPublisherPattern           = regexp.MustCompile(`^kjp_v1_[A-Za-z0-9_-]{43}$`)
	errJarConnectionCommitUnknown = errors.New("connection state commit outcome is unknown")
)

// jarKandy is the only creature shape that may cross the Kandy Jar boundary.
// Keep this DTO independent from kandyResponse: adding a local presentation
// field must never make it publishable by accident.
type jarKandy struct {
	Level           int           `json:"level"`
	Stage           int           `json:"stage"`
	Archetype       int           `json:"archetype"`
	Family          int           `json:"family"`
	Biome           int           `json:"biome"`
	LineageSeed     uint32        `json:"lineage_seed"`
	StageName       string        `json:"stage_name"`
	ProgressPct     float64       `json:"progress_pct"`
	AppearanceSeed  uint32        `json:"appearance_seed"`
	Mood            string        `json:"mood"`
	TemperamentBand string        `json:"temperament_band"`
	Scarred         bool          `json:"scarred"`
	Counterfeit     bool          `json:"counterfeit"`
	Generation      int           `json:"generation"`
	Ancestors       []jarAncestor `json:"ancestors"`
}

type jarAncestor struct {
	Level       int    `json:"level"`
	Archetype   int    `json:"archetype"`
	Family      int    `json:"family"`
	LineageSeed uint32 `json:"lineage_seed"`
	StageName   string `json:"stage_name"`
	Generation  int    `json:"generation"`
	Scarred     bool   `json:"scarred"`
}

type jarPendingSnapshot struct {
	Revision int64    `json:"revision"`
	Kandy    jarKandy `json:"kandy"`
}

type jarConnectionState struct {
	StateVersion    int    `json:"state_version"`
	SealVersion     int    `json:"seal_version"`
	Sig             string `json:"sig"`
	ProtocolVersion int    `json:"protocol_version"`
	InstallationID  string `json:"installation_id"`
	Origin          string `json:"origin"`
	// ConnectedByActorID retains the original JSON key for sealed-state compatibility.
	ConnectedByActorID string              `json:"owner_actor_id"`
	ConnectedAt        string              `json:"connected_at"`
	Revoked            bool                `json:"revoked,omitempty"`
	AckedRevision      int64               `json:"acked_revision,omitempty"`
	Published          *jarKandy           `json:"published,omitempty"`
	Pending            *jarPendingSnapshot `json:"pending,omitempty"`
	Desired            *jarKandy           `json:"desired,omitempty"`
}

type jarPublisherSecret struct {
	Version int    `json:"version"`
	Origin  string `json:"origin"`
	Token   string `json:"token"`
}

type jarConnectBody struct {
	PairingCode string `json:"pairing_code"`
}

type jarRedeemRequest struct {
	ProtocolVersion      int    `json:"protocol_version"`
	UserCode             string `json:"user_code"`
	PublisherTokenSHA256 string `json:"publisher_token_sha256"`
}

type jarRedeemResponse struct {
	ProtocolVersion int    `json:"protocol_version"`
	InstallationID  string `json:"installation_id"`
}

type jarPublishRequest struct {
	ProtocolVersion int      `json:"protocol_version"`
	Revision        int64    `json:"revision"`
	Kandy           jarKandy `json:"kandy"`
}

type jarPublishResponse struct {
	ProtocolVersion int    `json:"protocol_version"`
	InstallationID  string `json:"installation_id"`
	Revision        int64  `json:"revision"`
	Status          string `json:"status"`
	ReceivedAt      string `json:"received_at"`
}

type jarUpstreamResponseError struct {
	status      int
	contentType string
	body        []byte
}

func (e *jarUpstreamResponseError) Error() string {
	return fmt.Sprintf("upstream status %d", e.status)
}

func projectJarKandy(view kandyResponse) jarKandy {
	ancestorCount := min(len(view.Ancestors), maxAncestors)
	ancestors := make([]jarAncestor, 0, ancestorCount)
	for _, ancestor := range view.Ancestors[:ancestorCount] {
		ancestors = append(ancestors, jarAncestor{
			Level:       ancestor.Level,
			Archetype:   ancestor.Archetype,
			Family:      ancestor.Family,
			LineageSeed: ancestor.LineageSeed,
			StageName:   ancestor.StageName,
			Generation:  ancestor.Generation,
			Scarred:     ancestor.Scarred,
		})
	}
	return jarKandy{
		Level:           view.Level,
		Stage:           view.Stage,
		Archetype:       view.Archetype,
		Family:          view.Family,
		Biome:           view.Biome,
		LineageSeed:     view.LineageSeed,
		StageName:       view.StageName,
		ProgressPct:     view.ProgressPct,
		AppearanceSeed:  view.AppearanceSeed,
		Mood:            view.Mood,
		TemperamentBand: view.TemperamentBand,
		Scarred:         view.Scarred,
		Counterfeit:     view.Counterfeit,
		Generation:      view.Generation,
		Ancestors:       ancestors,
	}
}
