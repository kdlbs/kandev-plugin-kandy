.PHONY: build run test fmt vet package package-host clean

BIN := bin/kandev-plugin-kandy
VERSION := 0.8.0
STAGE := .build/stage
PKG_OUT := kandev-plugin-kandy-$(VERSION).tar.gz

build:
	mkdir -p bin
	go build -o $(BIN) ./server/...

run: build
	./$(BIN)

test:
	go test ./server/...
	node --test ui/bundle.test.js

fmt:
	gofmt -l .

vet:
	go vet ./server/...

package:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml $(STAGE)/manifest.yaml
	cp README.md $(STAGE)/README.md
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	GOOS=linux   GOARCH=amd64 go build -o $(STAGE)/server/plugin-linux-amd64       ./server
	GOOS=linux   GOARCH=arm64 go build -o $(STAGE)/server/plugin-linux-arm64       ./server
	GOOS=darwin  GOARCH=amd64 go build -o $(STAGE)/server/plugin-darwin-amd64      ./server
	GOOS=darwin  GOARCH=arm64 go build -o $(STAGE)/server/plugin-darwin-arm64      ./server
	GOOS=windows GOARCH=amd64 go build -o $(STAGE)/server/plugin-windows-amd64.exe ./server
	go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT)
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

package-host:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml $(STAGE)/manifest.yaml
	cp README.md $(STAGE)/README.md
	cp ui/bundle.js $(STAGE)/ui/bundle.js
	go build -o $(STAGE)/server/plugin-$$(go env GOOS)-$$(go env GOARCH)$$(go env GOEXE) ./server
	go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT) -platform-only
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

clean:
	rm -rf bin $(STAGE) kandev-plugin-kandy-*.tar.gz
