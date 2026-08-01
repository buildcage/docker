COMPOSE_FILE ?= compose.yaml
# Lets test_integration_buildkit_explicit_* clean up the explicit-engine overlay.
TEST_COMPOSE_FILE ?= setup/compose.test-transparent.yaml

# Fixed Compose project name, trusted by report/src/main.ts and
# setup/src/post.ts via their own BUILDCAGE_BUILD_TEST_HOOKS-gated overrides
# instead of deriveProjectName("buildcage") (core/lib/docker/container.ts).
# Scoped to the targets that touch this Compose project; test_unit_*,
# test_integration_sandbox_linux, and the sandbox dev-loop targets are
# excluded on purpose (see their own sections below).
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export COMPOSE_PROJECT_NAME := buildcage-project
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export BUILDCAGE_BUILD_TEST_HOOKS := 1

.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

# ===========================================================================
# Unit tests
# ===========================================================================

.PHONY: test_unit
test_unit: test_unit_core test_unit_setup test_unit_report test_unit_sandbox test_unit_qjs ## Run unit tests

.PHONY: test_unit_core
test_unit_core: ## Run core unit tests
	@node --test 'core/**/*.test.ts'

.PHONY: test_unit_setup
test_unit_setup: ## Run setup action unit tests
	@node --test 'setup/src/**/*.test.ts'

.PHONY: test_unit_report
test_unit_report: ## Run report unit tests
	@node --test 'report/src/**/*.test.ts'

.PHONY: test_unit_sandbox
test_unit_sandbox: ## Run the run action's unit tests
	@node --test 'run/src/**/*.test.ts'

# qjs can't execute .ts directly, so compile fresh (pnpm run build:qjs-test)
# and bind-mount the output in. qjs itself is identical across images, so one
# representative build is enough.
QJS_MOUNTS := \
	-v "$(CURDIR)/dist/test-qjs/core:/opt/buildcage/core:ro"
QJS_TEST_DIRS := \
	/opt/buildcage/core/lib/acl

.PHONY: test_unit_qjs
test_unit_qjs: ## Run unit tests in Docker
	@pnpm run build:qjs-test
	@docker build -f setup/docker/transparent/Dockerfile -t buildcage-qjs-test .
	@docker run --rm --entrypoint qjs $(QJS_MOUNTS) buildcage-qjs-test \
		--std -m /opt/buildcage/core/scripts/test/run-tests.qjs.js $(QJS_TEST_DIRS)

# ===========================================================================
# Integration tests
# ===========================================================================

# ---------------------------------------------------------------------------
# setup_buildkit_{engine}_{mode} — start the builder only
# ---------------------------------------------------------------------------

.PHONY: setup_buildkit_transparent_audit
setup_buildkit_transparent_audit: ## Start transparent engine in audit mode
	@echo "Starting buildcage (transparent engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=audit \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: setup_buildkit_transparent_restrict
setup_buildkit_transparent_restrict: ## Start transparent engine in restrict mode
	@echo "Starting buildcage (transparent engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-}" \
	  ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}" \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: setup_buildkit_explicit_audit
setup_buildkit_explicit_audit: ## Start explicit proxy engine in audit mode
	@echo "Starting buildcage (explicit proxy engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=explicit \
	  PROXY_MODE=audit \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: setup_buildkit_explicit_restrict
setup_buildkit_explicit_restrict: ## Start explicit proxy engine in restrict mode
	@echo "Starting buildcage (explicit proxy engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=explicit \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-}" \
	  ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}" \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: clean_buildkit
clean_buildkit: ## Stop and remove the buildkit builder's containers/images and buildx builder
	@echo "Stopping and removing all containers..."
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -p $(COMPOSE_PROJECT_NAME) -f compose.yaml -f $(TEST_COMPOSE_FILE) down -v --rmi all
	@docker rmi buildcage-test 2>/dev/null || true

.PHONY: report_buildkit
report_buildkit: ## Show the buildcage report for the currently running builder
	@node report/src/main.ts

# ---------------------------------------------------------------------------
# test_integration_buildkit_{engine}_{mode} — setup + build + verify + clean
# ---------------------------------------------------------------------------

.PHONY: test_integration_buildkit
test_integration_buildkit: test_integration_buildkit_transparent_audit test_integration_buildkit_transparent_restrict test_integration_buildkit_explicit_audit test_integration_buildkit_explicit_restrict ## Run all buildkit integration tests

.PHONY: test_integration_buildkit_transparent_audit
test_integration_buildkit_transparent_audit: ## Run transparent-engine audit mode tests
	@echo "Running transparent-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-transparent.yaml \
	  $(MAKE) setup_buildkit_transparent_audit
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.transparent-audit setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts
	@./setup/test/assert-transparent-audit.sh
	@node setup/src/post.ts
	@./setup/test/assert-post.sh
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_transparent_restrict
test_integration_buildkit_transparent_restrict: ## Run transparent-engine restrict mode tests
	@echo "Running transparent-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-transparent.yaml \
	  $(MAKE) setup_buildkit_transparent_restrict
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.transparent-restrict setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-transparent-restrict.sh
	@node setup/src/post.ts
	@./setup/test/assert-post.sh
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_explicit_audit
test_integration_buildkit_explicit_audit: ## Run explicit-engine audit mode tests
	@echo "Running explicit-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-explicit.yaml \
	  $(MAKE) setup_buildkit_explicit_audit
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.explicit-audit setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-explicit-audit.sh
	@node setup/src/post.ts
	@./setup/test/assert-post.sh
	@TEST_COMPOSE_FILE=setup/compose.test-explicit.yaml $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_explicit_restrict
test_integration_buildkit_explicit_restrict: ## Run explicit-engine restrict mode tests
	@echo "Running explicit-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-explicit.yaml \
	  $(MAKE) setup_buildkit_explicit_restrict
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.explicit-restrict setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-explicit-restrict.sh
	@node setup/src/post.ts
	@./setup/test/assert-post.sh
	@TEST_COMPOSE_FILE=setup/compose.test-explicit.yaml $(MAKE) clean_buildkit

# ---------------------------------------------------------------------------
# setup_sandbox_dev / test_sandbox_dev — mac-friendly dev loop for the run
# action (see run/dev/Dockerfile). CI's test_sandbox job runs
# run-isolated.sh directly on the host instead — see docs/development.md.
# ---------------------------------------------------------------------------

.PHONY: setup_sandbox_dev
setup_sandbox_dev: ## Start sandbox proxy + dev runner (mac-friendly dev loop)
	@echo "Starting buildcage sandbox (dev loop)..."
	@ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-example.com:443}" \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-example.com:80}" \
	  docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml up -d --build --wait proxy sandbox-dev-runner
	@echo "Proxy container:  buildcage-proxy"
	@echo "Dev runner:       buildcage-sandbox-dev-runner"
	@echo "Try: make test_sandbox_dev"

.PHONY: test_sandbox_dev
test_sandbox_dev: ## Run a sample isolated command in the dev loop and verify isolation
	@$(MAKE) setup_sandbox_dev
	@PROXY_PID=$$(docker inspect --format '{{.State.Pid}}' buildcage-proxy); \
	  docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml exec sandbox-dev-runner sh -c " \
	    set -e; \
	    build-test-bundle.sh --netns-name buildcage-sandbox-dev --script /usr/local/bin/smoke-test.sh --bundle /var/tmp/buildcage/dev-bundle; \
	    run-isolated.sh --proxy-pid $$PROXY_PID --runc /usr/local/bin/runc --bundle /var/tmp/buildcage/dev-bundle \
	      --container-id buildcage-sandbox-dev --netns-name buildcage-sandbox-dev --rootfs-bind-dir /var/tmp/buildcage/dev-bundle/rootfs \
	      --gateway 172.20.0.1 --dns 172.20.0.1 --target-ip 172.20.0.101"
	@$(MAKE) clean_sandbox_dev

.PHONY: clean_sandbox_dev
clean_sandbox_dev: ## Stop and remove the sandbox dev-loop containers
	@docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml down -v --rmi local

# Drives run/dist/main.cjs directly (a host command, not a Docker build).
.PHONY: test_integration_sandbox_linux
test_integration_sandbox_linux: ## Run the run action's integration tests (needs BUILDCAGE_LOCAL_IMAGE_REF and a test-hook build of run/dist/main.cjs)
	@./run/test/integration-test-writable-dir.sh
	@./run/test/integration-test-writable-disabled.sh
	@./run/test/integration-test-defaults.sh
	@./run/test/integration-test-seccomp.sh
	@./run/test/integration-test-die-with-parent.sh
	@./run/test/integration-test-fs-escape.sh
	@./run/test/integration-test-runner-temp.sh
	@./run/test/integration-test-nested-mount-readonly.sh
	@./run/test/integration-test-non-runc-default-pseudofs-readonly.sh
	@./run/test/integration-test-concurrent.sh
	@./run/test/integration-test-known-blocked-rules.sh
	@timeout 120 ./run/test/integration-test-ecapture-terminates.sh
	@timeout 180 ./run/test/integration-test-ecapture-hard-kill-recovery.sh

# ---------------------------------------------------------------------------
# example_{engine}_{mode} — smoke test against a plain Dockerfile
# ---------------------------------------------------------------------------

.PHONY: example_transparent_audit
example_transparent_audit: ## Run audit mode example tests
	@echo "Running audit mode example tests..."
	@$(MAKE) setup_buildkit_transparent_audit
	@mkdir -p /tmp/build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install --ignore-scripts express" \
	  > /tmp/build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f /tmp/build-context/Dockerfile /tmp/build-context \
	  --load -t buildcage-test
	@node report/src/main.ts
	@$(MAKE) clean_buildkit
	rm -fr /tmp/build-context

.PHONY: example_transparent_restrict
example_transparent_restrict: ## Run restrict mode example tests
	@echo "Running restrict mode example tests..."
	@ALLOWED_HTTPS_RULES="registry.npmjs.org:443" \
	  $(MAKE) setup_buildkit_transparent_restrict
	@mkdir -p /tmp/build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install --ignore-scripts express" \
	  "RUN wget -q -O /dev/null --timeout=5 https://example.com/ || true" \
	  > /tmp/build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f /tmp/build-context/Dockerfile /tmp/build-context \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@$(MAKE) clean_buildkit
	rm -fr /tmp/build-context
