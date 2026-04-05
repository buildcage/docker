COMPOSE_FILE ?= compose.yml

# Self-Documented Makefile
.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: clean
clean: ## Clean up all resources
	@echo "Stopping and removing all containers..."
	@docker buildx rm buildcage 2>/dev/null || true
	@docker compose -f compose.yml -f compose.test.yml down -v --rmi all
	@docker rmi buildcage-test 2>/dev/null || true

.PHONY: run_audit_mode
run_audit_mode: ## Start in audit mode
	@echo "Starting buildcage in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=audit \
	  docker compose up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote docker-container://buildcage

.PHONY: run_restrict_mode
run_restrict_mode: ## Start in restrict mode
	@echo "Starting buildcage in RESTRICT mode..."
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

.PHONY: test_restrict_mode
test_restrict_mode: ## Run restrict mode tests
	@echo "Running restrict mode tests..."
	@COMPOSE_FILE=compose.yml:compose.test.yml \
	  $(MAKE) run_restrict_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.restrict test/ \
	  --load -t buildcage-test
	@node report/main.mjs ./compose.yml || true
	@./test/assert-restrict-mode.sh
	@$(MAKE) clean

.PHONY: test_audit_mode
test_audit_mode: ## Run audit mode tests
	@echo "Running audit mode tests..."
	@COMPOSE_FILE=compose.yml:compose.test.yml \
	  $(MAKE) run_audit_mode
	@docker buildx build --no-cache \
	  --builder buildcage \
	  --platform linux/arm64 \
	  --progress=plain -f test/Dockerfile.audit test/ \
	  --load -t buildcage-test
	@node report/main.mjs ./compose.yml
	@./test/assert-audit-mode.sh
	@$(MAKE) clean

.PHONY: test_unit
test_unit: test_report test_qjs ## Run unit tests

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
	  "RUN npm init -y && npm install --ignore-scripts express" \
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
	  "RUN npm init -y && npm install --ignore-scripts express" \
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
