COMPOSE_FILE ?= compose.yaml
# Overridable so test_explicit_*_mode can clean up setup/compose.test-explicit.yaml's
# containers/images instead of the default transparent-engine test overlay.
TEST_COMPOSE_FILE ?= setup/compose.test-transparent.yaml

# Self-Documented Makefile
.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: clean
clean: ## Clean up all resources
	@echo "Stopping and removing all containers..."
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -f compose.yaml -f $(TEST_COMPOSE_FILE) down -v --rmi all
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
	  docker compose up -d --wait --build
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
	  docker compose up -d --wait --build
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
	  docker compose up -d --wait --build
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
	  docker compose up -d --wait --build
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
	@node report/src/main.ts ./compose.yaml
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
	@node report/src/main.ts ./compose.yaml || true
	@./setup/test/assert-transparent-restrict.sh
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
	@PROXY_ENGINE=explicit node report/src/main.ts ./compose.yaml || true
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
	@PROXY_ENGINE=explicit node report/src/main.ts ./compose.yaml || true
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

# core/shared/lib's own tests target the QuickJS "std" module (see
# core/shared/test/test-shim.js) and aren't runnable under plain node — they're
# already covered by test_qjs below instead.
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

# *.test.js is excluded from the built images (see .dockerignore), so bind-mount it back in for qjs to exec.
# qjs itself and the scripts/shared sources are identical across images, so one representative build
# (setup's transparent engine) is enough. core/scripts and setup/docker/explicit/scripts both map to
# /opt/buildcage/scripts in their respective (mutually exclusive) images, so the latter is mounted at
# an alias here to avoid colliding with the former in this single test container.
QJS_MOUNTS := \
	-v "$(CURDIR)/core/scripts:/opt/buildcage/scripts:ro" \
	-v "$(CURDIR)/core/shared:/opt/buildcage/shared:ro" \
	-v "$(CURDIR)/setup/docker/explicit/scripts:/opt/buildcage/explicit-scripts:ro"
QJS_TEST_DIRS := \
	/opt/buildcage/scripts/lib \
	/opt/buildcage/shared/lib \
	/opt/buildcage/explicit-scripts/lib

.PHONY: test_qjs
test_qjs: ## Run unit tests in Docker
	@docker build -f setup/docker/transparent/Dockerfile -t buildcage-qjs-test .
	@docker run --rm --entrypoint qjs $(QJS_MOUNTS) buildcage-qjs-test \
		-m /opt/buildcage/shared/test/run-tests.js $(QJS_TEST_DIRS)

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
	@node report/src/main.ts ./compose.yaml
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
	@node report/src/main.ts ./compose.yaml || true
	@$(MAKE) clean
	rm -fr /tmp/build-context
