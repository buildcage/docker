COMPOSE_FILE ?= compose.yaml
# Overridable so test_explicit_*_mode can clean up setup/compose.test-explicit.yaml's
# containers/images instead of the default transparent-engine test overlay.
TEST_COMPOSE_FILE ?= setup/compose.test-transparent.yaml

# All run_{engine}_{mode}_mode targets below use the same implicit
# builder_name ("buildcage", matching setup/action.yml's own default). This
# value isn't an arbitrary choice — report/src/main.ts independently computes
# deriveProjectName("buildcage") itself (see core/lib/docker/container.ts)
# and finds its container purely via `docker ps --filter
# label=com.docker.compose.project=...`, so it must match exactly what that
# function returns. Importing the real function (rather than reimplementing
# its SHA256 hashing here) means this can never drift from it.
#
# Exported (not just a make variable) so it also reaches the plain `docker
# compose exec` calls in setup/test/helpers.sh and setup/test/assert-explicit-*.sh
# — those run as standalone scripts, invoked without -p, and would otherwise
# fall back to Compose's own implicit directory-derived project name instead
# of the one these targets actually started containers under.
export COMPOSE_PROJECT_NAME := $(shell node -e "import('./core/lib/docker/container.ts').then(m => process.stdout.write(m.deriveProjectName('buildcage')))")
BUILDER_PROJECT_NAME := $(COMPOSE_PROJECT_NAME)

# Self-Documented Makefile
.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: clean
clean: ## Clean up all resources
	@echo "Stopping and removing all containers..."
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -p $(BUILDER_PROJECT_NAME) -f compose.yaml -f $(TEST_COMPOSE_FILE) down -v --rmi all
	@docker rmi buildcage-test 2>/dev/null || true

# ---------------------------------------------------------------------------
# run_{engine}_{mode}_mode — start the builder only (no build/verify/cleanup).
# One target per (transparent, explicit) x (audit, restrict) combination.
# ---------------------------------------------------------------------------

.PHONY: run_transparent_audit_mode
run_transparent_audit_mode: ## Start transparent engine in audit mode
	@echo "Starting buildcage (transparent engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=audit \
	  docker compose -p $(BUILDER_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: run_transparent_restrict_mode
run_transparent_restrict_mode: ## Start transparent engine in restrict mode
	@echo "Starting buildcage (transparent engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-}" \
	  ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}" \
	  docker compose -p $(BUILDER_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: run_explicit_audit_mode
run_explicit_audit_mode: ## Start explicit proxy engine in audit mode
	@echo "Starting buildcage (explicit proxy engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=explicit \
	  PROXY_MODE=audit \
	  docker compose -p $(BUILDER_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: run_explicit_restrict_mode
run_explicit_restrict_mode: ## Start explicit proxy engine in restrict mode
	@echo "Starting buildcage (explicit proxy engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=explicit \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-}" \
	  ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}" \
	  docker compose -p $(BUILDER_PROJECT_NAME) up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

# ---------------------------------------------------------------------------
# run_sandbox_mode / test_sandbox_mode — mac-friendly dev loop for the
# run action (see run/dev/Dockerfile). Production and CI's
# test_sandbox job instead run run-isolated.sh directly on the host — see
# docs/development.md.
# ---------------------------------------------------------------------------

.PHONY: run_sandbox_mode
run_sandbox_mode: ## Start sandbox proxy + dev runner (mac-friendly dev loop)
	@echo "Starting buildcage sandbox (dev loop)..."
	@ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-example.com:443}" \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-example.com:80}" \
	  docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml up -d --build --wait proxy sandbox-dev-runner
	@echo "Proxy container:  buildcage-proxy"
	@echo "Dev runner:       buildcage-sandbox-dev-runner"
	@echo "Try: make test_sandbox_mode"

.PHONY: test_sandbox_mode
test_sandbox_mode: ## Run a sample isolated command in the dev loop and verify isolation
	@$(MAKE) run_sandbox_mode
	@PROXY_PID=$$(docker inspect --format '{{.State.Pid}}' buildcage-proxy); \
	  docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml exec sandbox-dev-runner sh -c " \
	    set -e; \
	    build-test-bundle.sh --netns-name buildcage-sandbox-dev --script /usr/local/bin/smoke-test.sh --bundle /var/tmp/buildcage/dev-bundle; \
	    run-isolated.sh --proxy-pid $$PROXY_PID --runc /usr/local/bin/runc --bundle /var/tmp/buildcage/dev-bundle \
	      --container-id buildcage-sandbox-dev --netns-name buildcage-sandbox-dev --rootfs-bind-dir /var/tmp/buildcage/dev-bundle/rootfs \
	      --gateway 172.20.0.1 --dns 172.20.0.1 --target-ip 172.20.0.101"
	@$(MAKE) clean_sandbox_mode

.PHONY: clean_sandbox_mode
clean_sandbox_mode: ## Stop and remove the sandbox dev-loop containers
	@docker compose -f compose.yaml -f run/compose.sandbox-dev.yaml down -v --rmi local

# ---------------------------------------------------------------------------
# test_{engine}_{mode}_mode — run_{engine}_{mode}_mode + build the matching
# setup/test/Dockerfile.* + verify + clean up. One target per combination.
# ---------------------------------------------------------------------------

.PHONY: test_transparent_audit_mode
test_transparent_audit_mode: ## Run transparent-engine audit mode tests
	@echo "Running transparent-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-transparent.yaml \
	  $(MAKE) run_transparent_audit_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.transparent-audit setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts
	@./setup/test/assert-transparent-audit.sh
	@$(MAKE) clean

.PHONY: test_transparent_restrict_mode
test_transparent_restrict_mode: ## Run transparent-engine restrict mode tests
	@echo "Running transparent-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-transparent.yaml \
	  $(MAKE) run_transparent_restrict_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.transparent-restrict setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-transparent-restrict.sh
	@echo ""
	@echo "[setup post] verifying post.ts actually removes the builder/proxy containers:"
	@node setup/src/post.ts
	@if docker inspect buildcage buildcage-proxy >/dev/null 2>&1; then \
	  echo "  FAIL  buildcage/buildcage-proxy still exist after post.ts cleanup"; \
	  exit 1; \
	else \
	  echo "  PASS  buildcage/buildcage-proxy removed by post.ts"; \
	fi
	@$(MAKE) clean

.PHONY: test_explicit_audit_mode
test_explicit_audit_mode: ## Run explicit-engine audit mode tests
	@echo "Running explicit-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-explicit.yaml \
	  $(MAKE) run_explicit_audit_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.explicit-audit setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-explicit-audit.sh
	@TEST_COMPOSE_FILE=setup/compose.test-explicit.yaml $(MAKE) clean

.PHONY: test_explicit_restrict_mode
test_explicit_restrict_mode: ## Run explicit-engine restrict mode tests
	@echo "Running explicit-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:setup/compose.test-explicit.yaml \
	  $(MAKE) run_explicit_restrict_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f setup/test/Dockerfile.explicit-restrict setup/test/ \
	  --load -t buildcage-test
	@node report/src/main.ts || true
	@./setup/test/assert-explicit-restrict.sh
	@TEST_COMPOSE_FILE=setup/compose.test-explicit.yaml $(MAKE) clean

# Unlike test_{engine}_{mode}_mode above, this drives run/dist/main.cjs
# directly (see run/test/integration-test-*.sh) since the run action
# isolates a host command, not a Docker build.
.PHONY: test_sandbox_integration
test_sandbox_integration: ## Run the run action's integration tests (needs BUILDCAGE_LOCAL_IMAGE_REF and a test-hook build of run/dist/main.cjs)
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

.PHONY: test_unit
test_unit: test_core test_setup test_report test_sandbox_unit test_qjs ## Run unit tests

# Most of core/lib/{acl,log} is dual-consumed (Node and QuickJS both import
# it), and its *.test.ts run under both here and test_qjs below via the
# portable shim in core/lib/test/test-shim.ts. *.property.test.ts siblings use
# node:test/fast-check only, so they run here (not qjs-compatible) instead.
.PHONY: test_core
test_core: ## Run core/lib unit tests
	@node --test 'core/lib/**/*.test.ts'

.PHONY: test_setup
test_setup: ## Run setup action unit tests
	@node --test 'setup/src/**/*.test.ts'

.PHONY: test_report
test_report: ## Run report unit tests
	@node --test 'report/src/**/*.test.ts'

.PHONY: test_sandbox_unit
test_sandbox_unit: ## Run the run action's unit tests
	@node --test 'run/src/**/*.test.ts'

# *.test.ts is excluded from the built images (see .dockerignore) and qjs can't execute
# .ts directly, so compile fresh on the host (pnpm run build:qjs-test, output to
# dist/test-qjs/) and bind-mount that compiled output in for qjs to exec. qjs itself is
# identical across images, so one representative build (setup's transparent engine) is
# enough — the qjs-build stage's own bundles are unused here (bind-mounted over).
QJS_MOUNTS := \
	-v "$(CURDIR)/dist/test-qjs/core:/opt/buildcage/core:ro"
QJS_TEST_DIRS := \
	/opt/buildcage/core/lib/acl \
	/opt/buildcage/core/lib/log \
	/opt/buildcage/core/lib/report

.PHONY: test_qjs
test_qjs: ## Run unit tests in Docker
	@pnpm run build:qjs-test
	@docker build -f setup/docker/transparent/Dockerfile -t buildcage-qjs-test .
	@docker run --rm --entrypoint qjs $(QJS_MOUNTS) buildcage-qjs-test \
		--std -m /opt/buildcage/core/scripts/test/run-tests.qjs.js $(QJS_TEST_DIRS)

.PHONY: test_audit_example
run_audit_example: ## Run audit mode example tests
	@echo "Running audit mode example tests..."
	@$(MAKE) run_transparent_audit_mode
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
	@$(MAKE) clean
	rm -fr /tmp/build-context

.PHONY: run_restrict_example
run_restrict_example: ## Run restrict mode example tests
	@echo "Running restrict mode example tests..."
	@ALLOWED_HTTPS_RULES="registry.npmjs.org:443" \
	  $(MAKE) run_transparent_restrict_mode
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
	@$(MAKE) clean
	rm -fr /tmp/build-context
