COMPOSE_FILE ?= compose.yml

TEST_NETWORK             := buildcage_test-net
TEST_EXTERNAL_RESOLVER   := 10.200.0.53
TEST_ALLOWED_HTTPS_RULES := allowed.example.com:443\ allowed.example.com:8443\ *.wildcard.example.com:443\ *.wildcard.example.com:8443
TEST_ALLOWED_HTTP_RULES  := allowed.example.com:80\ allowed.example.com:8080\ *.wildcard.example.com:80\ *.wildcard.example.com:8080

# Self-Documented Makefile
.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: clean
clean: ## Clean up all resources
	@echo "Stopping and removing all containers..."
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -f compose.test.yml down -v --rmi all 2>/dev/null || true
	@docker rmi buildcage:local 2>/dev/null || true
	@docker rmi buildcage-test 2>/dev/null || true

.PHONY: run_audit_mode
run_audit_mode: ## Start in audit mode
	@echo "Starting buildcage in AUDIT mode..."
	@docker build -t buildcage:local docker
	@docker buildx rm buildcage 2>/dev/null || true
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver docker-container \
		--driver-opt image=buildcage:local \
		--driver-opt env.PROXY_MODE=audit

.PHONY: run_restrict_mode
run_restrict_mode: ## Start in restrict mode
	@echo "Starting buildcage in RESTRICT mode..."
	@docker build -t buildcage:local docker
	@docker buildx rm buildcage 2>/dev/null || true
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver docker-container \
		--driver-opt image=buildcage:local \
		--driver-opt env.PROXY_MODE=restrict \
		--driver-opt env.ALLOWED_HTTP_RULES=$${ALLOWED_HTTP_RULES:-} \
		--driver-opt env.ALLOWED_HTTPS_RULES=$${ALLOWED_HTTPS_RULES:-github.com:443\ registry.npmjs.org:443\ api.github.com:443\ objects.githubusercontent.com:443\ httpbin.org:443\ deb.debian.org:80\ *.githubusercontent.com:443}

.PHONY: test_restrict_mode
test_restrict_mode: ## Run restrict mode tests
	@echo "Running restrict mode tests..."
	@docker build -t buildcage:local docker
	@docker compose -f compose.test.yml up -d
	@docker buildx rm buildcage 2>/dev/null || true
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver docker-container \
		--driver-opt image=buildcage:local \
		--driver-opt network=$(TEST_NETWORK) \
		--driver-opt env.PROXY_MODE=restrict \
		--driver-opt env.EXTERNAL_RESOLVER=$(TEST_EXTERNAL_RESOLVER) \
		--driver-opt env.ALLOWED_HTTPS_RULES=$(TEST_ALLOWED_HTTPS_RULES) \
		--driver-opt env.ALLOWED_HTTP_RULES=$(TEST_ALLOWED_HTTP_RULES)
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --progress=plain -f test/Dockerfile.restrict test/
	@echo "=== HAProxy logs ==="
	@docker exec $$(docker ps -q -f name=buildx_buildkit_buildcage) cat /var/log/haproxy/current || echo "(no logs)"
	@./test/assert-restrict-mode.sh
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -f compose.test.yml down -v

.PHONY: test_audit_mode
test_audit_mode: ## Run audit mode tests
	@echo "Running audit mode tests..."
	@docker build -t buildcage:local docker
	@docker compose -f compose.test.yml up -d
	@docker buildx rm buildcage 2>/dev/null || true
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver docker-container \
		--driver-opt image=buildcage:local \
		--driver-opt network=$(TEST_NETWORK) \
		--driver-opt env.PROXY_MODE=audit \
		--driver-opt env.EXTERNAL_RESOLVER=$(TEST_EXTERNAL_RESOLVER) \
		--driver-opt env.ALLOWED_HTTPS_RULES=$(TEST_ALLOWED_HTTPS_RULES) \
		--driver-opt env.ALLOWED_HTTP_RULES=$(TEST_ALLOWED_HTTP_RULES)
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --progress=plain -f test/Dockerfile.audit test/
	@echo "=== HAProxy logs ==="
	@docker exec $$(docker ps -q -f name=buildx_buildkit_buildcage) cat /var/log/haproxy/current || echo "(no logs)"
	@./test/assert-audit-mode.sh
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -f compose.test.yml down -v

.PHONY: test_unit
test_unit: test_legacy test_report test_qjs ## Run unit tests

.PHONY: test_legacy
test_legacy: ## Run legacy rules unit tests
	@node --test setup/lib/legacy-rules.test.mjs

.PHONY: test_report
test_report: ## Run report unit tests
	@node --test report/lib/build-example.test.mjs

.PHONY: test_qjs
test_qjs: ## Run unit tests in Docker
	@docker build -t buildcage-qjs-test docker
	@docker run --rm --entrypoint qjs buildcage-qjs-test /opt/buildcage/tools/lib/rules.test.mjs
	@docker run --rm --entrypoint qjs buildcage-qjs-test /opt/buildcage/tools/lib/log-parser.test.mjs

.PHONY: test_audit_example
run_audit_example: ## Run audit mode example tests
	@echo "Running audit mode example tests..."
	@$(MAKE) run_audit_mode
	@mkdir -p /tmp/build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install express" \
	  > /tmp/build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f /tmp/build-context/Dockerfile /tmp/build-context \
	  --load -t buildcage-test
	@node report/main.mjs ./compose.yml
	@$(MAKE) clean
	rm -fr /tmp/build-context

.PHONY: run_restrict_example
run_restrict_example: ## Run restrict mode example tests
	@echo "Running restrict mode example tests..."
	@ALLOWED_HTTPS_RULES="registry.npmjs.org:443" \
	  $(MAKE) run_restrict_mode
	@mkdir -p /tmp/build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install express" \
	  "RUN wget -q -O /dev/null --timeout=5 https://example.com/ || true" \
	  > /tmp/build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f /tmp/build-context/Dockerfile /tmp/build-context \
	  --load -t buildcage-test
	@node report/main.mjs ./compose.yml || true
	@$(MAKE) clean
	rm -fr /tmp/build-context

.PHONY: test_docker_container_driver
test_docker_container_driver: ## Test docker-container driver with buildcage image
	@echo "Building buildcage image..."
	@docker build -t buildcage:local docker
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder with docker-container driver..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver docker-container \
		--driver-opt image=buildcage:local \
		--driver-opt env.PROXY_MODE=audit
	@echo "Running test build..."
	@mkdir -p /tmp/build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install express" \
	  > /tmp/build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder buildcage \
	  --progress=plain -f /tmp/build-context/Dockerfile /tmp/build-context
	@echo "Checking proxy logs..."
	@docker exec $$(docker ps -q -f name=buildcage) cat /var/log/haproxy/current || echo "(no logs)"
	@echo "Cleaning up..."
	@docker buildx rm buildcage 2>/dev/null || true
	rm -fr /tmp/build-context