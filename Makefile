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
		--driver remote tcp://localhost:1234

.PHONY: run_restrict_mode
run_restrict_mode: ## Start in restrict mode
	@echo "Starting buildcage in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$$(node setup/convert-rules.mjs "$${ALLOWED_HTTP_RULES:-}")" \
	  ALLOWED_HTTPS_RULES="$$(node setup/convert-rules.mjs "$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}")" \
	  docker compose up -d --wait --build
	@docker buildx rm buildcage 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name buildcage \
		--driver remote tcp://localhost:1234

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
test_unit: ## Run unit tests
	@node --test setup/lib/rules.test.mjs
