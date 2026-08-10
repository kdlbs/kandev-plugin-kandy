// Command server is the backend for the Kandy plugin: it feeds the
// creature from bus events and serves its presentation state over the
// "kandy" webhook. Kandev spawns and supervises this process.
package main

import (
	"fmt"
	"os"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

func main() {
	// Dev/demo path (never taken under kandev, which spawns the binary with
	// no arguments): emit deterministic level presentation facts as JSON.
	if len(os.Args) > 1 && os.Args[1] == "genlevels" {
		if err := genLevels(os.Stdout, os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		return
	}
	// Dev/demo path: walk a lineage through its rebirths and emit the real
	// webhook payloads for each sampled level.
	if len(os.Args) > 1 && os.Args[1] == "genlineage" {
		if err := genLineage(os.Stdout, os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		return
	}
	pluginsdk.Serve(newPlugin())
}
