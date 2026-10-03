SHELL := /bin/bash
.DEFAULT_GOAL := help

# The pnpm workspace owns JavaScript dependencies. Make owns the
# repository's development, verification, and image-building entry points.
ARGS ?=
TEST ?=
VERSION ?=
DEV_COMMAND ?= start
IMAGE_TARGETS ?= pi4 pi5 arm64 amd64

SYSTEM_DIR := packages/system
export SYSTEM_BUILD_DIR ?= $(SYSTEM_DIR)/build

.PHONY: help deps dev frontend backend typecheck format-check format lint translations-check test test-backend test-frontend test-integration test-vm build build-frontend image image-amd64 image-arm64 image-pi4 image-pi5 image-usb-installer vm build-remote test-remote

help:
	@printf '%s\n' \
	  'make deps												Install locked frontend and backend dependencies' \
	  'make dev [DEV_COMMAND=start] 		Manage the Linux development container' \
	  'make frontend										Run the frontend development server' \
	  'make backend ARGS="..."					Run the backend with explicit CLI arguments' \
	  'make typecheck                		Check frontend and backend types' \
	  'make format-check | format    		Check or apply source formatting' \
	  'make lint | translations-check' \
	  'make test                     		Run unit and frontend tests' \
	  'make test-integration TEST="..." Run backend integration tests on Linux' \
	  'make build                    		Check types and build the frontend' \
	  'make image                    		Build all four images, update bundles and checksums' \
	  'make image-pi4 | image-pi5 | image-arm64 | image-amd64 [VERSION=...]' \
	  'make release-manifest VERSION=x.y.z Generate release metadata from all four bundles' \
	  'make image-usb-installer        	Build the optional USB installer' \
	  'make test-vm TEST="..."        	Run VM tests using already built images' \
	  'make vm ARGS="help"            	Manage a QEMU VM' \
	  'make build-remote ARGS="host"  	Sync and build on a chosen SSH host' \
	  'make test-remote ARGS="host ..." Run tests on that host'

deps:
	pnpm install --frozen-lockfile

dev:
	./scripts/umbrel-dev.sh $(DEV_COMMAND) $(ARGS)

frontend:
	pnpm --filter frontend run dev $(ARGS)

backend:
	pnpm --filter backend start $(ARGS)

typecheck:
	pnpm --filter backend run typecheck
	pnpm --filter frontend run typecheck

# Discover source documents through Git, including new files but excluding ignored
# build output and deleted files. Preserve upstream license text verbatim.
# NUL separators preserve spaces in document paths.
format format-check:
	@set -o pipefail; \
	git ls-files --cached --others --exclude-standard --deduplicate -z -- '*.md' ':(exclude,glob)**/LICENSE*.md' | \
		while IFS= read -r -d '' file; do \
			if [ -f "$$file" ]; then printf '%s\0' "$(CURDIR)/$$file"; fi; \
		done | \
		xargs -0 pnpm --filter frontend exec prettier $(if $(filter format,$@),--write,--check) --config "$(CURDIR)/.prettierrc.mjs"
	pnpm --filter backend run $(if $(filter format,$@),format,format:check)
	pnpm --filter frontend run $(if $(filter format,$@),format,format:check)

lint:
	pnpm --filter frontend run lint

translations-check:
	pnpm --filter frontend run translations:test
	pnpm --filter frontend run translations:check
	bash .github/scripts/prepare-translations.test.sh

.PHONY: test-system

test: test-backend test-frontend test-system

test-system:
	node --test "$(SYSTEM_DIR)"/scripts/*.test.mjs

test-backend:
	pnpm --filter backend run test $(or $(TEST),unit.test) $(ARGS)

test-frontend:
	pnpm --filter frontend test $(ARGS)
	pnpm --filter frontend run test:unit

test-integration:
	pnpm --filter backend run test $(or $(TEST),integration.test) $(ARGS)

test-vm:
	pnpm --filter backend run test $(or $(TEST),vm.test) $(ARGS)

build: typecheck build-frontend

build-frontend:
	pnpm --filter frontend run build

image:
	"$(SYSTEM_DIR)/scripts/build.sh" --version "$(VERSION)" $(IMAGE_TARGETS)

image-amd64 image-arm64 image-pi4 image-pi5:
	"$(SYSTEM_DIR)/scripts/build.sh" --version "$(VERSION)" $(patsubst image-%,%,$@)

image-usb-installer:
	"$(SYSTEM_DIR)/installer/build.sh" $(ARGS)

vm:
	"$(SYSTEM_DIR)/vm/run.sh" $(ARGS)

build-remote:
	./scripts/remote-builder.sh build $(ARGS)

test-remote:
	./scripts/remote-builder.sh test $(ARGS)

.PHONY: release-manifest
release-manifest:
	node "$(SYSTEM_DIR)/scripts/release.mjs" manifest "$(SYSTEM_BUILD_DIR)/images" "$(VERSION)"
