package main

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestManifest_SecuresKandySurfacesAndDeclaresJarActions(t *testing.T) {
	raw, err := os.ReadFile("../manifest.yaml")
	require.NoError(t, err)

	var manifest struct {
		MinKandevVersion string `yaml:"min_kandev_version"`
		Webhooks         []struct {
			Key    string `yaml:"key"`
			Access string `yaml:"access"`
		} `yaml:"webhooks"`
		Actions []struct {
			Key          string `yaml:"key"`
			Scope        string `yaml:"scope"`
			Access       string `yaml:"access"`
			MaxBodyBytes int    `yaml:"max_body_bytes"`
		} `yaml:"actions"`
		ConfigSchema struct {
			Properties map[string]struct {
				Type    string `yaml:"type"`
				Default string `yaml:"default"`
			} `yaml:"properties"`
		} `yaml:"config_schema"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &manifest))
	require.Equal(t, "0.91.1", manifest.MinKandevVersion)

	accessByKey := map[string]string{}
	for _, webhook := range manifest.Webhooks {
		accessByKey[webhook.Key] = webhook.Access
	}
	for _, key := range []string{webhookKeyKandy, webhookKeyPet, webhookKeyBonk} {
		require.Equal(t, "authenticated", accessByKey[key], key)
	}

	actions := map[string]struct {
		scope  string
		access string
		max    int
	}{}
	for _, action := range manifest.Actions {
		actions[action.Key] = struct {
			scope  string
			access string
			max    int
		}{action.Scope, action.Access, action.MaxBodyBytes}
	}
	for _, key := range []string{"jar.connect", "jar.disconnect", "jar.status"} {
		require.Equal(t, "workspace", actions[key].scope, key)
		require.Equal(t, 1024, actions[key].max, key)
	}
	require.Equal(t, "admin", actions["jar.connect"].access)
	require.Equal(t, "admin", actions["jar.disconnect"].access)
	require.Equal(t, "authenticated", actions["jar.status"].access)

	jarOrigin, ok := manifest.ConfigSchema.Properties["jar_origin"]
	require.True(t, ok)
	require.Equal(t, "string", jarOrigin.Type)
	require.Equal(t, "https://jar.kandev.ai", jarOrigin.Default)
}

func TestBuildAndReleasePinTheSecureKandevSDKRevision(t *testing.T) {
	const revision = "9f5ffd70b9265bdf07e3a2448af363b162525bb0"
	for _, path := range []string{"../.github/workflows/build.yml", "../.github/workflows/release.yml"} {
		raw, err := os.ReadFile(path)
		require.NoError(t, err)
		require.Equal(t, 1, strings.Count(string(raw), "ref: "+revision), path)
	}
}
