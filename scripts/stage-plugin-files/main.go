package main

import (
	"fmt"
	"io"
	"os"
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
	if len(args) != 1 {
		return fmt.Errorf("usage: stage-plugin-files <stage>")
	}
	stage := args[0]

	data, err := os.ReadFile("manifest.yaml")
	if err != nil {
		return fmt.Errorf("read manifest.yaml: %w", err)
	}
	m, err := manifest.Parse(data)
	if err != nil {
		return fmt.Errorf("parse manifest.yaml: %w", err)
	}

	if err := copyFile("manifest.yaml", filepath.Join(stage, "manifest.yaml")); err != nil {
		return err
	}

	paths := []string{m.UI.Bundle}
	paths = append(paths, m.UI.Styles...)
	if m.Icon != "" {
		paths = append(paths, m.Icon)
	}
	for _, path := range paths {
		if path == "" {
			continue
		}
		relative := cleanPath(path)
		if relative == "" {
			return fmt.Errorf("invalid manifest package path %q", path)
		}
		if err := copyFile(relative, filepath.Join(stage, filepath.FromSlash(relative))); err != nil {
			return err
		}
	}

	if info, err := os.Stat("assets"); err == nil && info.IsDir() {
		err := filepath.WalkDir("assets", func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			relative, err := filepath.Rel(".", path)
			if err != nil {
				return err
			}
			return copyFile(relative, filepath.Join(stage, relative))
		})
		if err != nil {
			return fmt.Errorf("stage assets: %w", err)
		}
	} else if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("inspect assets: %w", err)
	}
	return nil
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open %s: %w", source, err)
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("create directory for %s: %w", destination, err)
	}
	output, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("create %s: %w", destination, err)
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return fmt.Errorf("copy %s: %w", source, err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("close %s: %w", destination, err)
	}
	return nil
}

func cleanPath(path string) string {
	path = strings.TrimPrefix(filepath.ToSlash(path), "/")
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return ""
	}
	return cleaned
}
