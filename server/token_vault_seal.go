package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

const (
	tokenVaultSealVersion = 1
	tokenVaultSealDomain  = "kandy-token-vault:hmac:v1\n"
)

func tokenVaultSignature(vault *tokenVaultLedger, key []byte) string {
	canonical := *vault
	canonical.Sig = ""
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(tokenVaultSealDomain))
	_, _ = mac.Write(encoded)
	return hex.EncodeToString(mac.Sum(nil))
}

func sealTokenVault(vault *tokenVaultLedger, key []byte) {
	vault.SealVersion = tokenVaultSealVersion
	vault.Sig = tokenVaultSignature(vault, key)
}

func tokenVaultSealValid(vault *tokenVaultLedger, key []byte) bool {
	if vault.SealVersion != tokenVaultSealVersion || vault.Sig == "" {
		return false
	}
	want := tokenVaultSignature(vault, key)
	return want != "" && hmac.Equal([]byte(vault.Sig), []byte(want))
}
