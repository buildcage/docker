COMPOSE_FILE ?= compose.yaml
# Overridable so test_explicit_*_mode can clean up compose.test-explicit.yaml's
# containers/images instead of the default transparent-engine test overlay.
TEST_COMPOSE_FILE ?= compose.test-transparent.yaml

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
# test_{engine}_{mode}_mode — run_{engine}_{mode}_mode + build the matching
# test/Dockerfile.* + verify + clean up. One target per combination.
# ---------------------------------------------------------------------------

.PHONY: test_transparent_audit_mode
test_transparent_audit_mode: ## Run transparent-engine audit mode tests
	@echo "Running transparent-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-transparent.yaml \
	  $(MAKE) run_transparent_audit_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.transparent-audit test/ \
	  --load -t buildcage-test
	@node report/src/main.js ./compose.yaml
	@./test/assert-transparent-audit.sh
	@$(MAKE) clean

.PHONY: test_transparent_restrict_mode
test_transparent_restrict_mode: ## Run transparent-engine restrict mode tests
	@echo "Running transparent-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-transparent.yaml \
	  $(MAKE) run_transparent_restrict_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.transparent-restrict test/ \
	  --load -t buildcage-test
	@node report/src/main.js ./compose.yaml || true
	@./test/assert-transparent-restrict.sh
	@$(MAKE) clean

.PHONY: test_explicit_audit_mode
test_explicit_audit_mode: ## Run explicit-engine audit mode tests
	@echo "Running explicit-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-explicit.yaml \
	  $(MAKE) run_explicit_audit_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.explicit-audit test/ \
	  --load -t buildcage-test
	@PROXY_ENGINE=explicit node report/src/main.js ./compose.yaml || true
	@./test/assert-explicit-audit.sh
	@TEST_COMPOSE_FILE=compose.test-explicit.yaml $(MAKE) clean

.PHONY: test_explicit_restrict_mode
test_explicit_restrict_mode: ## Run explicit-engine restrict mode tests
	@echo "Running explicit-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-explicit.yaml \
	  $(MAKE) run_explicit_restrict_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.explicit-restrict test/ \
	  --load -t buildcage-test
	@PROXY_ENGINE=explicit node report/src/main.js ./compose.yaml || true
	@./test/assert-explicit-restrict.sh
	@TEST_COMPOSE_FILE=compose.test-explicit.yaml $(MAKE) clean

.PHONY: test_unit
test_unit: test_setup test_report test_qjs ## Run unit tests

.PHONY: test_setup
test_setup: ## Run setup action unit tests
	@node --test 'setup/src/**/*.test.js'

.PHONY: test_report
test_report: ## Run report unit tests
	@node --test 'report/src/**/*.test.js'

.PHONY: test_qjs
test_qjs: ## Run unit tests in Docker
	@docker build -f docker/transparent/Dockerfile -t buildcage-qjs-test docker
	@docker run --rm --entrypoint qjs buildcage-qjs-test -m /opt/buildcage/tools/shared/lib/rules.test.js
	@docker run --rm --entrypoint qjs buildcage-qjs-test -m /opt/buildcage/tools/shared/lib/aggregate.test.js
	@docker run --rm --entrypoint qjs buildcage-qjs-test -m /opt/buildcage/tools/transparent/lib/log-parser.test.js
	@docker build -f docker/explicit/Dockerfile -t buildcage-qjs-test-explicit docker
	@docker run --rm --entrypoint qjs buildcage-qjs-test-explicit -m /opt/buildcage/tools/shared/lib/rules.test.js
	@docker run --rm --entrypoint qjs buildcage-qjs-test-explicit -m /opt/buildcage/tools/shared/lib/aggregate.test.js
	@docker run --rm --entrypoint qjs buildcage-qjs-test-explicit -m /opt/buildcage/tools/explicit/lib/source-policy.test.js
	@docker run --rm --entrypoint qjs buildcage-qjs-test-explicit -m /opt/buildcage/tools/explicit/lib/buildkitd-log-parser.test.js

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
	@node report/src/main.js ./compose.yaml
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
	@node report/src/main.js ./compose.yaml || true
	@$(MAKE) clean
	rm -fr /tmp/build-context
