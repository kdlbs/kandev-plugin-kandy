package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kdlbs/kandev/pluginsdk/manifest"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 1 || len(args) > 2 {
		return fmt.Errorf("usage: build-plugin-binaries <stage> [all|host]")
	}
	stage := args[0]
	mode := "all"
	if len(args) == 2 {
		mode = args[1]
	}
	if mode != "all" && mode != "host" {
		return fmt.Errorf("unsupported build mode %q", mode)
	}

	data, err := os.ReadFile("manifest.yaml")
	if err != nil {
		return fmt.Errorf("read manifest.yaml: %w", err)
	}
	m, err := manifest.Parse(data)
	if err != nil {
		return fmt.Errorf("parse manifest.yaml: %w", err)
	}
	if len(m.Runtime.Executables) == 0 {
		return fmt.Errorf("manifest.yaml declares no runtime executables")
	}

	platforms := m.Runtime.Executables
	if mode == "host" {
		goos, err := goEnv("GOOS")
		if err != nil {
			return err
		}
		goarch, err := goEnv("GOARCH")
		if err != nil {
			return err
		}
		key := goos + "-" + goarch
		path, ok := platforms[key]
		if !ok {
			return fmt.Errorf("manifest.yaml does not declare host platform %s", key)
		}
		platforms = map[string]string{key: path}
	}

	for platform, relativePath := range platforms {
		parts := strings.SplitN(platform, "-", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return fmt.Errorf("invalid runtime platform %q", platform)
		}
		relativePath = strings.TrimPrefix(filepath.ToSlash(relativePath), "/")
		output := filepath.Join(stage, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
			return fmt.Errorf("create output directory for %s: %w", platform, err)
		}

		cmd := exec.Command("go", "build", "-o", output, "./server")
		cmd.Env = append(os.Environ(),
			"GOWORK=off",
			"GOOS="+parts[0],
			"GOARCH="+parts[1],
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("build %s: %w", platform, err)
		}
	}
	return nil
}

func goEnv(name string) (string, error) {
	out, err := exec.Command("go", "env", name).Output()
	if err != nil {
		return "", fmt.Errorf("read go %s: %w", name, err)
	}
	value := strings.TrimSpace(string(out))
	if value == "" {
		return "", fmt.Errorf("go env %s returned an empty value", name)
	}
	return value, nil
}
