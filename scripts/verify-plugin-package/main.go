package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
	if len(args) != 3 {
		return fmt.Errorf("usage: verify-plugin-package <archive-root> <version> <archive>")
	}
	root, expectedVersion, archive := args[0], args[1], args[2]

	data, err := os.ReadFile(filepath.Join(root, "manifest.yaml"))
	if err != nil {
		return fmt.Errorf("read archived manifest: %w", err)
	}
	m, err := manifest.Parse(data)
	if err != nil {
		return fmt.Errorf("parse archived manifest: %w", err)
	}
	if m.Version != expectedVersion {
		return fmt.Errorf("archive manifest version %q does not match %q", m.Version, expectedVersion)
	}
	expectedArchive := m.ID + "-" + expectedVersion + ".tar.gz"
	if filepath.Base(archive) != expectedArchive {
		return fmt.Errorf("archive name %q does not match %q", filepath.Base(archive), expectedArchive)
	}

	declaredServer := make([]string, 0, len(m.Runtime.Executables))
	for _, path := range m.Runtime.Executables {
		declaredServer = append(declaredServer, cleanManifestPath(path))
	}
	sort.Strings(declaredServer)
	actualServer, err := filesUnder(root, "server")
	if err != nil {
		return err
	}
	if !sameStrings(actualServer, declaredServer) &&
		!(len(actualServer) == 1 && containsString(declaredServer, actualServer[0])) {
		return fmt.Errorf("server files %v do not match manifest paths %v", actualServer, declaredServer)
	}

	required := actualServer
	if m.UI.Bundle != "" {
		required = append(required, cleanManifestPath(m.UI.Bundle))
	}
	for _, path := range m.UI.Styles {
		required = append(required, cleanManifestPath(path))
	}
	if m.Icon != "" {
		required = append(required, cleanManifestPath(m.Icon))
	}
	for _, path := range required {
		if info, err := os.Stat(filepath.Join(root, filepath.FromSlash(path))); err != nil || info.IsDir() {
			return fmt.Errorf("manifest path missing from archive: %s", path)
		}
	}

	for _, entry := range mustTopLevel(root) {
		switch entry {
		case "manifest.yaml", "checksums.txt", "server", "ui", "assets":
		default:
			return fmt.Errorf("unexpected archive entry: %s", entry)
		}
	}

	actualFiles, err := filesUnder(root, ".")
	if err != nil {
		return err
	}
	actualFiles = removeString(actualFiles, "checksums.txt")
	listed, err := verifyChecksums(root)
	if err != nil {
		return err
	}
	if !sameStrings(actualFiles, listed) {
		return fmt.Errorf("checksums do not cover archive files: listed %v, actual %v", listed, actualFiles)
	}
	return nil
}

func verifyChecksums(root string) ([]string, error) {
	file, err := os.Open(filepath.Join(root, "checksums.txt"))
	if err != nil {
		return nil, fmt.Errorf("open checksums.txt: %w", err)
	}
	defer file.Close()

	var listed []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.SplitN(strings.TrimSpace(scanner.Text()), " ", 2)
		if len(fields) != 2 || len(fields[0]) != sha256.Size*2 {
			return nil, fmt.Errorf("invalid checksum line: %q", scanner.Text())
		}
		path := strings.TrimPrefix(strings.TrimSpace(fields[1]), "*")
		if path == "" || filepath.IsAbs(path) || strings.HasPrefix(filepath.Clean(path), "..") {
			return nil, fmt.Errorf("invalid checksum path: %q", path)
		}
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			return nil, fmt.Errorf("read checksum file %s: %w", path, err)
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != fields[0] {
			return nil, fmt.Errorf("checksum mismatch: %s", path)
		}
		listed = append(listed, filepath.ToSlash(path))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read checksums.txt: %w", err)
	}
	sort.Strings(listed)
	return listed, nil
}

func filesUnder(root, relative string) ([]string, error) {
	base := filepath.Join(root, filepath.FromSlash(relative))
	var files []string
	err := filepath.WalkDir(base, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walk %s: %w", path, err)
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list archive files under %s: %w", relative, err)
	}
	sort.Strings(files)
	return files, nil
}

func mustTopLevel(root string) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return []string{fmt.Sprintf("<read error: %v>", err)}
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names
}

func cleanManifestPath(path string) string {
	return strings.TrimPrefix(filepath.ToSlash(path), "/")
}

func sameStrings(left, right []string) bool {
	return len(left) == len(right) && strings.Join(left, "\x00") == strings.Join(right, "\x00")
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func removeString(values []string, target string) []string {
	filtered := values[:0]
	for _, value := range values {
		if value != target {
			filtered = append(filtered, value)
		}
	}
	return filtered
}
