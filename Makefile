.PHONY: build run test fmt check-format vet package package-host verify-package smoke-package clean package-file sdk-check check-tooling

.DEFAULT_GOAL := build

BIN := bin/kandev-plugin-kandy
VERSION := 0.16.0
STAGE := .build/stage
PKG_OUT := kandev-plugin-kandy-$(VERSION).tar.gz
NODE ?= node
# Backend-owned plugin-pack requires this explicit checkout, not a Go SDK replacement.
KANDEV_TOOLING ?=
PLUGIN_ROOT := $(CURDIR)

sdk-check:
	# Pin the checker; it resolves the project's selected SDK through go list.
	go run github.com/kdlbs/kandev/pluginsdk/cmd/kandev-sdk-check@v0.1.0 --manifest manifest.yaml

check-tooling:
	@test -n "$(KANDEV_TOOLING)" || { echo "Set KANDEV_TOOLING to the checkout pinned in .kandev-tooling-ref" >&2; exit 1; }
	@test "$$(git -C "$(KANDEV_TOOLING)" rev-parse HEAD)" = "$$(cat .kandev-tooling-ref)" || { echo "KANDEV_TOOLING must match .kandev-tooling-ref" >&2; exit 1; }
	@tooling_status="$$(git -C "$(KANDEV_TOOLING)" status --porcelain)" && test -z "$$tooling_status" || { echo "KANDEV_TOOLING must be clean (no staged, unstaged, or untracked source changes)" >&2; exit 1; }
	@test -d "$(KANDEV_TOOLING)/apps/backend/cmd/plugin-pack" && test -d "$(KANDEV_TOOLING)/pluginsdk" || { echo "KANDEV_TOOLING must contain apps/backend/cmd/plugin-pack and root pluginsdk" >&2; exit 1; }

build: sdk-check
	mkdir -p bin
	go build -o $(BIN) ./server/...

run: build
	./$(BIN)

test:
	go test ./server/... -count=1
	$(NODE) --test ui/bundle.test.js
	sh scripts/test-verify-package.sh
	sh scripts/test-verify-release-version.sh
	sh scripts/test-check-tooling.sh

fmt:
	gofmt -w ./server

check-format:
	@unformatted="$$(gofmt -l ./server)"; test -z "$$unformatted" || { echo "gofmt needed:"; printf '%s\n' "$$unformatted"; exit 1; }

vet:
	go vet ./server/...

package: sdk-check check-tooling
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml README.md $(STAGE)/
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	GOOS=linux GOARCH=amd64 go build -o $(STAGE)/server/plugin-linux-amd64 ./server
	GOOS=linux GOARCH=arm64 go build -o $(STAGE)/server/plugin-linux-arm64 ./server
	GOOS=darwin GOARCH=amd64 go build -o $(STAGE)/server/plugin-darwin-amd64 ./server
	GOOS=darwin GOARCH=arm64 go build -o $(STAGE)/server/plugin-darwin-arm64 ./server
	GOOS=windows GOARCH=amd64 go build -o $(STAGE)/server/plugin-windows-amd64.exe ./server
	cd "$(KANDEV_TOOLING)/apps/backend" && GOWORK=off go run ./cmd/plugin-pack -dir "$(PLUGIN_ROOT)/$(STAGE)" -out "$(PLUGIN_ROOT)/$(PKG_OUT)"
	rm -rf $(STAGE)
	sh scripts/verify-package.sh $(PKG_OUT) full
	@echo "Wrote $(PKG_OUT)"

package-host: sdk-check check-tooling
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml README.md $(STAGE)/
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	set -eu; host_platform="$$(go env GOOS)-$$(go env GOARCH)"; host_executable="server/plugin-$$(go env GOOS)-$$(go env GOARCH)$$(go env GOEXE)"; \
		go build -o "$(STAGE)/$$host_executable" ./server; \
		(cd "$(KANDEV_TOOLING)/apps/backend" && GOWORK=off go run ./cmd/plugin-pack -dir "$(PLUGIN_ROOT)/$(STAGE)" -out "$(PLUGIN_ROOT)/$(PKG_OUT)" -platform-only); \
		rm -rf $(STAGE); \
		sh scripts/verify-package.sh $(PKG_OUT) host "$$host_platform"
	@echo "Wrote $(PKG_OUT)"

verify-package: package

smoke-package: package-host
	$(NODE) scripts/smoke-package-ui.js $(PKG_OUT)

package-file:
	@printf '%s\n' "$(PKG_OUT)"

clean:
	rm -rf bin $(STAGE) kandev-plugin-kandy-*.tar.gz
