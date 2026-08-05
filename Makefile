.PHONY: build run test fmt vet package package-pr package-host package-internal clean

PLUGIN_ID := kandev-plugin-kandy
BIN := bin/$(PLUGIN_ID)
VERSION := 0.10.0
DIST := dist
STAGE := .build/stage
SDK_PACK := github.com/kdlbs/kandev/pluginsdk/cmd/plugin-pack

build:
	mkdir -p bin
	GOWORK=off go build -o $(BIN) ./server/...

run: build
	./$(BIN)

test:
	GOWORK=off go test ./...
	node --test ui/bundle.test.js

fmt:
	gofmt -l .

vet:
	GOWORK=off go vet ./...

package:
	$(MAKE) package-internal PACKAGE_VERSION="$(VERSION)"

package-pr:
	@test -n "$(PR_VERSION)"
	$(MAKE) package-internal PACKAGE_VERSION="$(PR_VERSION)" PACKAGE_EXTRA="-version $(PR_VERSION)"

package-host:
	$(MAKE) package-internal PACKAGE_VERSION="$(VERSION)" PACKAGE_MODE=host PACKAGE_EXTRA=-platform-only

package-internal:
	rm -rf $(STAGE) $(DIST)
	mkdir -p $(STAGE) $(DIST)
	GOWORK=off go run ./scripts/stage-plugin-files $(STAGE)
	GOWORK=off go run ./scripts/build-plugin-binaries $(STAGE) $(or $(PACKAGE_MODE),all)
	GOWORK=off go run $(SDK_PACK) -dir $(STAGE) -out $(DIST)/$(PLUGIN_ID)-$(PACKAGE_VERSION).tar.gz $(PACKAGE_EXTRA)
	rm -rf $(STAGE)
	@echo "Wrote $(DIST)/$(PLUGIN_ID)-$(PACKAGE_VERSION).tar.gz"

clean:
	rm -rf bin $(STAGE) $(DIST)
