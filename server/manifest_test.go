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

func TestWorkflowsShareTheReleasedSecureKandevSDKRevision(t *testing.T) {
	const revision = "e43881c7555372897b57ec51c705f1e05da43c40" // Kandev v0.97.0
	pinned, err := os.ReadFile("../.kandev-sdk-ref")
	require.NoError(t, err)
	require.Equal(t, revision, strings.TrimSpace(string(pinned)))
	for _, path := range []string{"../.github/workflows/ci.yml", "../.github/workflows/build.yml", "../.github/workflows/release.yml"} {
		raw, err := os.ReadFile(path)
		require.NoError(t, err)
		var workflow struct {
			Jobs map[string]struct {
				Steps []struct {
					ID   string `yaml:"id"`
					Run  string `yaml:"run"`
					With struct {
						Repository string `yaml:"repository"`
						Ref        string `yaml:"ref"`
					} `yaml:"with"`
				} `yaml:"steps"`
			} `yaml:"jobs"`
		}
		require.NoError(t, yaml.Unmarshal(raw, &workflow), path)
		checkouts := 0
		for _, job := range workflow.Jobs {
			pinRead := false
			for _, step := range job.Steps {
				if step.ID == "sdk" {
					require.Contains(t, step.Run, "cat .kandev-sdk-ref", path)
					pinRead = true
				}
				if step.With.Repository == "kdlbs/kandev" {
					require.True(t, pinRead, "SDK checkout must follow the shared pin read: %s", path)
					require.Equal(t, "${{ steps.sdk.outputs.ref }}", step.With.Ref, path)
					checkouts++
				}
			}
		}
		require.Positive(t, checkouts, path)
	}
}
