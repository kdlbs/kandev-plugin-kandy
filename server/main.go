// Command server is the backend for the Kandev Gotchi plugin: it feeds the
// creature from bus events and serves its presentation state over the
// "gotchi" webhook. Kandev spawns and supervises this process.
package main

import "github.com/kandev/kandev/pkg/pluginsdk"

func main() {
	pluginsdk.Serve(newPlugin())
}
