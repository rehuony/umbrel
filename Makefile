SHELL := /bin/bash
.DEFAULT_GOAL := help

# Package-local npm manifests own JavaScript dependencies. Make owns the
# repository's development, verification, and image-building entry points.
ARGS ?=
TEST ?=
VERSION ?=
DEV_COMMAND ?= start

.PHONY: help deps dev frontend backend typecheck format-check format lint translations-check test test-backend test-frontend test-integration test-vm build build-frontend image image-amd64 image-arm64 image-pi4 image-pi5 image-usb-installer vm build-remote test-remote

help:
	@printf '%s\n' \
	  'make deps                     Install locked frontend and backend dependencies' \
	  'make dev [DEV_COMMAND=start]  Manage the Linux development container' \
	  'make frontend                Run the frontend development backend' \
	  'make backend ARGS="..."         Run the backend with explicit CLI arguments' \
	  'make typecheck                Check frontend and backend types' \
	  'make format-check | format    Check or apply source formatting' \
	  'make lint | translations-check' \
	  'make test                     Run unit and frontend tests' \
	  'make test-integration TEST="..." Run backend integration tests on Linux' \
	  'make build                    Check types and build the frontend' \
	  'make image                    Build all four bootable images and checksums' \
	  'make image-pi4 | image-pi5 | image-arm64 | image-amd64 [VERSION=...]' \
	  'make image-usb-installer        Build the optional USB installer' \
	  'make test-vm TEST="..."        Run VM tests using already built images' \
	  'make vm ARGS="help"            Manage a QEMU VM' \
	  'make build-remote ARGS="host"  Sync and build on a chosen SSH host' \
	  'make test-remote ARGS="host ..." Run tests on that host'

deps:
	npm --prefix packages/backend ci
	npm --prefix packages/frontend ci

dev:
	./scripts/umbrel-dev $(DEV_COMMAND) $(ARGS)

frontend:
	npm --prefix packages/frontend run dev -- $(ARGS)

backend:
	npm --prefix packages/backend start -- $(ARGS)

typecheck:
	npm --prefix packages/backend run typecheck
	npm --prefix packages/frontend run typecheck

format-check:
	npm --prefix packages/backend run format:check
	npm --prefix packages/frontend run format:check

format:
	npm --prefix packages/backend run format
	npm --prefix packages/frontend run format

lint:
	npm --prefix packages/frontend run lint

translations-check:
	npm --prefix packages/frontend run translations:test
	npm --prefix packages/frontend run translations:check
	bash .github/scripts/prepare-translations.test.sh

test: test-backend test-frontend

test-backend:
	npm --prefix packages/backend run test -- $(or $(TEST),unit.test) $(ARGS)

test-frontend:
	npm --prefix packages/frontend test -- $(ARGS)
	npm --prefix packages/frontend run test:unit

test-integration:
	npm --prefix packages/backend run test -- $(or $(TEST),integration.test) $(ARGS)

test-vm:
	npm --prefix packages/backend run test -- $(or $(TEST),vm.test) $(ARGS)

build: typecheck build-frontend

build-frontend:
	npm --prefix packages/frontend run build

image:
	./packages/system/build.sh $(VERSION)

image-amd64:
	SKIP_ARM64=true SKIP_PI=true ./packages/system/build.sh $(VERSION)

image-arm64:
	SKIP_AMD64=true SKIP_PI=true ./packages/system/build.sh $(VERSION)

image-pi4:
	SKIP_AMD64=true SKIP_ARM64=true SKIP_PI4= SKIP_PI_TRYBOOT=true ./packages/system/build.sh $(VERSION)

image-pi5:
	SKIP_AMD64=true SKIP_ARM64=true SKIP_PI4=true ./packages/system/build.sh $(VERSION)

image-usb-installer:
	./packages/system/usb-installer/build.sh $(ARGS)

vm:
	./packages/system/vm.sh $(ARGS)

build-remote:
	./scripts/remote-builder build $(ARGS)

test-remote:
	./scripts/remote-builder test $(ARGS)
