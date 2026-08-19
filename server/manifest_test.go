package main

import (
	"os"
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
	require.Equal(t, "0.89.1", manifest.MinKandevVersion)

	accessByKey := map[string]string{}
	for _, webhook := range manifest.Webhooks {
		accessByKey[webhook.Key] = webhook.Access
	}
	for _, key := range []string{webhookKeyKandy, webhookKeyPet, webhookKeyBonk} {
		require.Equal(t, "authenticated", accessByKey[key], key)
	}

	actions := map[string]struct {
		scope string
		max   int
	}{}
	for _, action := range manifest.Actions {
		actions[action.Key] = struct {
			scope string
			max   int
		}{action.Scope, action.MaxBodyBytes}
	}
	for _, key := range []string{"jar.connect", "jar.disconnect", "jar.status"} {
		require.Equal(t, "workspace", actions[key].scope, key)
		require.Equal(t, 1024, actions[key].max, key)
	}

	jarOrigin, ok := manifest.ConfigSchema.Properties["jar_origin"]
	require.True(t, ok)
	require.Equal(t, "string", jarOrigin.Type)
	require.Equal(t, "https://jar.kandev.ai", jarOrigin.Default)
}
