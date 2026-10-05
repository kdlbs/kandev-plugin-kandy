.PHONY: build run test fmt check-format vet package package-host verify-package smoke-package clean package-file

BIN := bin/kandev-plugin-kandy
VERSION := 0.15.0
STAGE := .build/stage
PKG_OUT := kandev-plugin-kandy-$(VERSION).tar.gz
NODE ?= node

build:
	mkdir -p bin
	go build -o $(BIN) ./server/...

run: build
	./$(BIN)

test:
	go test ./server/... -count=1
	$(NODE) --test ui/bundle.test.js
	sh scripts/test-verify-package.sh
	sh scripts/test-verify-release-version.sh

fmt:
	gofmt -w ./server

check-format:
	@unformatted="$$(gofmt -l ./server)"; test -z "$$unformatted" || { echo "gofmt needed:"; printf '%s\n' "$$unformatted"; exit 1; }

vet:
	go vet ./server/...

package:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml README.md $(STAGE)/
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	GOOS=linux GOARCH=amd64 go build -o $(STAGE)/server/plugin-linux-amd64 ./server
	GOOS=linux GOARCH=arm64 go build -o $(STAGE)/server/plugin-linux-arm64 ./server
	GOOS=darwin GOARCH=amd64 go build -o $(STAGE)/server/plugin-darwin-amd64 ./server
	GOOS=darwin GOARCH=arm64 go build -o $(STAGE)/server/plugin-darwin-arm64 ./server
	GOOS=windows GOARCH=amd64 go build -o $(STAGE)/server/plugin-windows-amd64.exe ./server
	go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT)
	rm -rf $(STAGE)
	sh scripts/verify-package.sh $(PKG_OUT) full
	@echo "Wrote $(PKG_OUT)"

package-host:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml README.md $(STAGE)/
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	set -eu; host_platform="$$(go env GOOS)-$$(go env GOARCH)"; host_executable="server/plugin-$$(go env GOOS)-$$(go env GOARCH)$$(go env GOEXE)"; \
		go build -o "$(STAGE)/$$host_executable" ./server; \
		go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT) -platform-only; \
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
