package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

const (
	tokenGrottoSealVersion = 1
	tokenGrottoSealDomain  = "kandy-token-grotto:hmac:v1\n"
)

func tokenGrottoSignature(grotto *tokenGrottoLedger, key []byte) string {
	canonical := *grotto
	canonical.Sig = ""
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(tokenGrottoSealDomain))
	_, _ = mac.Write(encoded)
	return hex.EncodeToString(mac.Sum(nil))
}

func sealTokenGrotto(grotto *tokenGrottoLedger, key []byte) {
	grotto.SealVersion = tokenGrottoSealVersion
	grotto.Sig = tokenGrottoSignature(grotto, key)
}

func tokenGrottoSealValid(grotto *tokenGrottoLedger, key []byte) bool {
	if grotto.SealVersion != tokenGrottoSealVersion || grotto.Sig == "" {
		return false
	}
	want := tokenGrottoSignature(grotto, key)
	return want != "" && hmac.Equal([]byte(grotto.Sig), []byte(want))
}
