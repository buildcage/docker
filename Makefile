COMPOSE_FILE ?= compose.yaml
# Lets a target name the overlay its own clean_buildkit has to tear down.
TEST_COMPOSE_FILE ?= compose.test-universal.yaml

# These names, and test-net's subnet, are global to the daemon: a linked
# worktree's run would otherwise tear down the main checkout's builder. The
# worktree's own name keeps them apart, so nothing needs configuring, and the
# main checkout keeps the names the docs and CI use.
GIT_DIR := $(shell git rev-parse --git-dir 2>/dev/null)
WORKTREE_NAME := $(if $(findstring /worktrees/,$(GIT_DIR)),$(notdir $(GIT_DIR)))
# A worktree directory carries the `+` that replaced the branch name's `/`, and
# no image tag, container name or Compose project name accepts it.
WORKTREE_SLUG := $(if $(WORKTREE_NAME),$(shell printf '%s' '$(WORKTREE_NAME)' | tr 'A-Z' 'a-z' | tr -Cs 'a-z0-9_-' '-' | sed -e 's/^-//' -e 's/-$$//'))
BUILDCAGE_WORKTREE_SUFFIX ?= $(if $(WORKTREE_SLUG),-$(WORKTREE_SLUG))
# test-net-addr finds test-net by its subnet, so pin one, derived from the
# worktree name so linked worktrees don't collide.
TEST_NET_SUBNET ?= $(if $(WORKTREE_NAME),$(shell printf '%s' '$(WORKTREE_NAME)' | cksum | awk '{printf "10.%d.%d.0/24", $$1 % 40 + 210, int($$1 / 40) % 254 + 1}'),10.210.0.0/24)
BUILDER_NAME ?= buildcage$(BUILDCAGE_WORKTREE_SUFFIX)
TEST_IMAGE ?= buildcage-test$(BUILDCAGE_WORKTREE_SUFFIX)
QJS_TEST_IMAGE ?= buildcage-qjs-test$(BUILDCAGE_WORKTREE_SUFFIX)
BYTE_EXACT_INSPECT := buildcage-byte-exact-inspect$(BUILDCAGE_WORKTREE_SUFFIX)
BYTE_EXACT_UNIVERSAL := buildcage-byte-exact-universal$(BUILDCAGE_WORKTREE_SUFFIX)
SCRATCH_PREFIX ?= /tmp/buildcage$(BUILDCAGE_WORKTREE_SUFFIX)
# Read by test/assert-listener-scope.sh, which names a Compose project of its own.
export BUILDCAGE_WORKTREE_SUFFIX
# The development machines are arm64, so every build through the builder asks
# for that unless the caller says otherwise; CI's amd64 runners name their own
# architecture rather than have BuildKit emulate one.
TEST_PLATFORM ?= linux/arm64
# Whatever the host is not, so test_integration_buildkit_multiarch's second
# build is a cross build wherever it runs.
MULTIARCH_CROSS_PLATFORM ?= $(if $(filter arm64 aarch64,$(shell uname -m)),linux/amd64,linux/arm64)

# Compose project name, trusted by report/src/main.ts and
# src/post.ts via their own BUILDCAGE_BUILD_TEST_HOOKS-gated overrides
# instead of deriveProjectName("buildcage")
# (src/core/lib/docker/compose-project-name.ts).
# Scoped to the targets that touch this Compose project; test_unit_* is
# excluded because none of those targets touches it.
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export COMPOSE_PROJECT_NAME := buildcage-project$(BUILDCAGE_WORKTREE_SUFFIX)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export BUILDCAGE_BUILD_TEST_HOOKS := 1
# Read by compose.yaml's container_name, report/src/main.ts, src/post.ts and
# test/assert-post.sh.
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export BUILDER_NAME := $(BUILDER_NAME)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export INPUT_BUILDER_NAME := $(BUILDER_NAME)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export TEST_IMAGE := $(TEST_IMAGE)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export TEST_NET_SUBNET := $(TEST_NET_SUBNET)
# Read by test/run-inspect-roundtrip.sh, which builds without going through a
# recipe of its own.
test_integration_buildkit_%: export TEST_PLATFORM := $(TEST_PLATFORM)

.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

# Renovate bumps this pin; CI then fails until `make seccomp_profile` has been
# rerun, so the pin and the vendored profile can't drift apart.
# renovate: datasource=go depName=github.com/moby/profiles/seccomp
MOBY_PROFILES_SECCOMP_VERSION ?= v0.2.3

.PHONY: seccomp_profile
seccomp_profile: ## Regenerate the builder's seccomp profile from moby/profiles
	@node docker/seccomp/gen-profile.mjs $(MOBY_PROFILES_SECCOMP_VERSION)

# ===========================================================================
# Unit tests
# ===========================================================================

.PHONY: test_unit
test_unit: test_unit_core test_unit_setup test_unit_report test_unit_qjs test_unit_go ## Run unit tests

# vitest matches these by path substring, not glob, so keep them package-specific.
.PHONY: test_unit_core
test_unit_core: ## Run core unit tests
	@vp test run src/core

.PHONY: test_unit_setup
test_unit_setup: ## Run setup action unit tests
	@vp test run src/lib src/main

.PHONY: test_unit_report
test_unit_report: ## Run report unit tests
	@vp test run report/src

# Unfiltered, so this always covers whatever test.include matches. One run,
# because each overwrites the coverage report: splitting it the way the targets
# above are split would leave only the last one's numbers.
.PHONY: test_unit_coverage
test_unit_coverage: ## Run every Node unit test once, with coverage
	@vp test run --coverage

.PHONY: test_unit_go
test_unit_go: ## Run buildcage-runc's and covfilter's unit tests
	@cd docker/inspect/buildcage-runc && go test ./...
	@cd test/covfilter && go test ./...

# buildcage-runc's coverage, with the statements a //coverage:ignore marker
# excuses taken out first (see test/covfilter for why Go needs a second tool for
# that at all). 100 is the only threshold that holds across Go releases:
# cmd/cover splits a function into blocks differently between them (the same
# source reports 98.1% under 1.26.5 and 98.2% under 1.27.1), but at 100 every
# statement is either reached or marked, whichever toolchain counted them.
RUNC_COVERAGE := coverage/buildcage-runc.cov
RUNC_COVERAGE_THRESHOLD := 100

.PHONY: test_unit_go_coverage
test_unit_go_coverage: ## Run buildcage-runc's tests with coverage and check the threshold
	@mkdir -p coverage
	@cd docker/inspect/buildcage-runc && go test -coverprofile="$(CURDIR)/$(RUNC_COVERAGE)" ./...
	@cd test/covfilter && go run . \
	  -profile="$(CURDIR)/$(RUNC_COVERAGE)" \
	  -pkg="$(CURDIR)/docker/inspect/buildcage-runc" \
	  -threshold=$(RUNC_COVERAGE_THRESHOLD)

# qjs can't execute .ts directly, so compile fresh (vp run build:qjs-test)
# and bind-mount the output in. qjs itself is identical across images, so one
# representative build is enough.
QJS_MOUNTS := \
	-v "$(CURDIR)/dist/qjs-test/src/core:/opt/buildcage/core:ro"
QJS_TEST_DIRS := \
	/opt/buildcage/core/lib/acl

.PHONY: test_unit_qjs
test_unit_qjs: ## Run unit tests in Docker
	@vp run build:qjs-test
	@docker build -f docker/universal/Dockerfile -t $(QJS_TEST_IMAGE) .
	@docker run --rm --entrypoint qjs $(QJS_MOUNTS) $(QJS_TEST_IMAGE) \
		--std -m /opt/buildcage/core/scripts/test/run-tests.qjs.js $(QJS_TEST_DIRS)

# ===========================================================================
# Integration tests
# ===========================================================================

# ---------------------------------------------------------------------------
# setup_buildkit_{engine}_{mode}: start the builder only
# ---------------------------------------------------------------------------

.PHONY: setup_buildkit_universal_audit
setup_buildkit_universal_audit: ## Start universal engine in audit mode
	@echo "Starting buildcage (universal engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=universal \
	  PROXY_MODE=audit \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name $(BUILDER_NAME) \
		--driver remote docker-container://$(BUILDER_NAME)

.PHONY: setup_buildkit_universal_restrict
setup_buildkit_universal_restrict: ## Start universal engine in restrict mode
	@echo "Starting buildcage (universal engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=universal \
	  PROXY_MODE=restrict \
	  ALLOWED_HTTP_RULES="$${ALLOWED_HTTP_RULES:-}" \
	  ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443}" \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name $(BUILDER_NAME) \
		--driver remote docker-container://$(BUILDER_NAME)

.PHONY: setup_buildkit_inspect_audit
setup_buildkit_inspect_audit: ## Start inspect proxy engine in audit mode
	@echo "Starting buildcage (inspect proxy engine) in AUDIT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=inspect \
	  PROXY_MODE=audit \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name $(BUILDER_NAME) \
		--driver remote docker-container://$(BUILDER_NAME)

.PHONY: setup_buildkit_inspect_restrict
setup_buildkit_inspect_restrict: ## Start inspect proxy engine in restrict mode
	@echo "Starting buildcage (inspect proxy engine) in RESTRICT mode..."
	@COMPOSE_FILE=$(COMPOSE_FILE) \
	  PROXY_ENGINE=inspect \
	  PROXY_MODE=restrict \
	  docker compose -p $(COMPOSE_PROJECT_NAME) up -d --wait --build
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@echo "Creating buildx builder..."
	@docker buildx create --bootstrap \
		--name $(BUILDER_NAME) \
		--driver remote docker-container://$(BUILDER_NAME)

.PHONY: clean_buildkit
clean_buildkit: ## Stop and remove the buildkit builder's containers/images and buildx builder
	@echo "Stopping and removing all containers..."
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@docker compose -p $(COMPOSE_PROJECT_NAME) -f compose.yaml -f $(TEST_COMPOSE_FILE) down -v --rmi all
	@docker rmi $(TEST_IMAGE) 2>/dev/null || true

.PHONY: report_buildkit
report_buildkit: ## Show the buildcage report for the currently running builder
	@node report/src/main.ts

# ---------------------------------------------------------------------------
# test_integration_buildkit_{engine}_{mode}: setup + build + verify + clean
# ---------------------------------------------------------------------------

.PHONY: test_integration_buildkit
test_integration_buildkit: test_integration_buildkit_universal_audit test_integration_buildkit_universal_restrict test_integration_buildkit_universal_restrict_no_traffic test_integration_buildkit_inspect_restrict test_integration_buildkit_inspect_debian_audit test_integration_buildkit_inspect_debian_restrict test_integration_buildkit_inspect_java_audit test_integration_buildkit_inspect_byte_exact test_integration_buildkit_inspect_roundtrip test_integration_buildkit_universal_known_blocked test_integration_buildkit_multiarch test_integration_buildkit_listener_scope ## Run all buildkit integration tests

# The target that verifies post.ts removed the builder. The targets below run
# post.ts as part of their own teardown where they have one, but the removal
# does not depend on the engine or the mode, so only this one asserts it.
.PHONY: test_integration_buildkit_universal_audit
test_integration_buildkit_universal_audit: ## Run universal-engine audit mode tests
	@echo "Running universal-engine audit mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-universal.yaml \
	  $(MAKE) setup_buildkit_universal_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.universal-audit test/ \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts
	@./test/assert-universal-audit.sh
	@node src/post.ts
	@./test/assert-post.sh
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_restrict
test_integration_buildkit_universal_restrict: ## Run universal-engine restrict mode tests
	@echo "Running universal-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-universal.yaml \
	  $(MAKE) setup_buildkit_universal_restrict
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.universal-restrict test/ \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-universal-restrict.sh
	@node src/post.ts
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_restrict_no_traffic
test_integration_buildkit_universal_restrict_no_traffic: ## Run universal-engine restrict mode tests with zero outbound traffic
	@echo "Running universal-engine restrict mode tests with zero outbound traffic..."
	@COMPOSE_FILE=compose.yaml:compose.test-universal.yaml \
	  $(MAKE) setup_buildkit_universal_restrict
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.universal-restrict-no-traffic test/ \
	  --load -t $(TEST_IMAGE)
	@INPUT_FAIL_ON_BLOCKED=true node report/src/main.ts
	@./test/assert-universal-restrict-no-traffic.sh
	@node src/post.ts
	@$(MAKE) clean_buildkit

# The Alpine build the CA-residue and layer-bloat guards run against. Every
# inspect build injects the same CA the same way, so the other Alpine image
# (Dockerfile.inspect-audit, built by the round trip) would prove nothing more.
.PHONY: test_integration_buildkit_inspect_restrict
test_integration_buildkit_inspect_restrict: ## Run inspect-engine restrict mode tests
	@echo "Running inspect-engine restrict mode tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_restrict
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.inspect-restrict test/ \
	  --load -t $(TEST_IMAGE)
	@./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@./test/assert-inspect-no-layer-bloat.sh $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-restrict.sh
	@BUILDER_NAME=$(BUILDER_NAME) TEST_PLATFORM=$(TEST_PLATFORM) \
	  ./test/assert-inspect-refuses-embedded-bundle.sh
	@node src/post.ts
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

# The Debian build those same two guards run against: it starts with no CA
# store at all, which is the case Alpine cannot cover. The restrict run below
# builds the same Dockerfile and differs only in how one request is answered.
.PHONY: test_integration_buildkit_inspect_debian_audit
test_integration_buildkit_inspect_debian_audit: ## Run inspect-engine audit mode tests against a Debian (apt) build
	@echo "Running inspect-engine audit mode tests (Debian/apt)..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.inspect-debian test/ \
	  --load -t $(TEST_IMAGE)
	@./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@./test/assert-inspect-no-layer-bloat.sh $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-debian.sh audit
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_inspect_debian_restrict
test_integration_buildkit_inspect_debian_restrict: ## Run inspect-engine restrict mode tests against a Debian (apt) build
	@echo "Running inspect-engine restrict mode tests (Debian/apt)..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_restrict
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.inspect-debian test/ \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-debian.sh restrict
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

# The base-image JVM case: a JDK already present reads only its own keystore,
# so the wrapper injects the proxy CA there for the step. Built over both shapes
# a JDK ships cacerts in, PKCS#12 (temurin:21) and JKS (temurin:17); the build's
# own in-step `java` step fails the build unless the JVM trusts the CA, and
# assert-inspect-no-ca-residue.sh proves the committed keystore does not keep it.
.PHONY: test_integration_buildkit_inspect_java_audit
test_integration_buildkit_inspect_java_audit: ## Run inspect-engine tests against Java base images (JVM keystore injection)
	@echo "Running inspect-engine audit mode tests (Java base images)..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@for base in eclipse-temurin:21 eclipse-temurin:17; do \
	  echo "=== Java base image: $$base ==="; \
	  docker buildx build --no-cache \
	    --builder $(BUILDER_NAME) \
	    --platform $(TEST_PLATFORM) \
	    --build-arg BASE=$$base \
	    --progress=plain -f test/Dockerfile.inspect-java test/ \
	    --load -t $(TEST_IMAGE) || exit 1; \
	  NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE) || exit 1; \
	done
	@echo "=== Java real-tool case: Maven resolving a dependency ==="
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.inspect-java-maven test/ \
	  --load -t $(TEST_IMAGE)
	@NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

# chrome-headless-shell ships for x86-64 only, so this ignores TEST_PLATFORM.
.PHONY: test_integration_buildkit_inspect_chromium_audit
test_integration_buildkit_inspect_chromium_audit: ## Run inspect-engine tests against chrome-headless-shell (NSS database injection)
	@echo "Running inspect-engine audit mode tests (chrome-headless-shell)..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform linux/amd64 \
	  --progress=plain -f test/Dockerfile.inspect-chromium test/ \
	  --load -t $(TEST_IMAGE)
	@NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@BUILDER_NAME=$(BUILDER_NAME) TEST_PLATFORM=linux/amd64 \
	  ./test/assert-inspect-chromium.sh $(TEST_IMAGE)
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

# Each case hides a copy of the CA the sweep finds but cannot remove, and must
# fail the build naming the file and pointing at fail_on_ca_residue. With it
# false, the same copy and a write to the NSS database only warn. The control
# writes an unrelated encrypted keystore and must build. The resealed case
# must build with the CA taken out and the keystore still sealed under changeit.
.PHONY: test_integration_buildkit_inspect_hidden_ca
test_integration_buildkit_inspect_hidden_ca: ## Check inspect fails a build that hides a copy of the CA the sweep cannot remove
	@echo "Running inspect-engine hidden CA copy tests..."
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@for case in leaf json; do \
	  echo "=== A copy of the CA the sweep cannot take out: $$case ==="; \
	  if docker buildx build --no-cache \
	      --builder $(BUILDER_NAME) \
	      --platform $(TEST_PLATFORM) \
	      --build-arg CASE=$$case \
	      --progress=plain -f test/Dockerfile.inspect-hidden-ca test/ \
	      > $(SCRATCH_PREFIX)-hidden-ca.log 2>&1; then \
	    echo "FAIL: the build committed a copy of the CA ($$case)"; exit 1; \
	  fi; \
	  if ! grep -q "cannot strip: /app/" $(SCRATCH_PREFIX)-hidden-ca.log; then \
	    tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; \
	    echo "FAIL: the build failed, but not on the copy of the CA ($$case)"; exit 1; \
	  fi; \
	  if ! grep -q "hint: .*fail_on_ca_residue: false" $(SCRATCH_PREFIX)-hidden-ca.log; then \
	    tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; \
	    echo "FAIL: the failure does not point at fail_on_ca_residue ($$case)"; exit 1; \
	  fi; \
	  echo "PASS: the build failed on the copy of the CA, pointing at fail_on_ca_residue ($$case)"; \
	done
	@echo "=== An encrypted keystore that is not the CA's ==="
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg CASE=control \
	  --progress=plain -f test/Dockerfile.inspect-hidden-ca test/
	@echo "PASS: the build kept a keystore that is not the CA's"
	@echo "=== A keystore under changeit the sweep takes the CA out of ==="
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg CASE=resealed \
	  --progress=plain -f test/Dockerfile.inspect-hidden-ca test/ \
	  --load -t $(TEST_IMAGE)
	@listing=$$(docker run --rm $(TEST_IMAGE) keytool -list -keystore /app/trust.p12 -storepass changeit) \
	  || { echo "FAIL: the resealed keystore does not open under changeit"; exit 1; }; \
	if echo "$$listing" | grep -qi buildcage; then \
	  echo "FAIL: the resealed keystore still trusts the CA"; exit 1; \
	fi; \
	roots=$$(echo "$$listing" | grep -c trustedCertEntry || true); \
	if [ "$${roots:-0}" -lt 100 ]; then \
	  echo "FAIL: the resealed keystore kept only $$roots roots"; exit 1; \
	fi; \
	named=$$(echo "$$listing" | grep trustedCertEntry | grep -c ' \[jdk\],' || true); \
	if [ "$$named" != "$$roots" ]; then \
	  echo "FAIL: only $$named of $$roots roots kept their [jdk] alias"; exit 1; \
	fi; \
	if docker run --rm $(TEST_IMAGE) keytool -list -keystore /app/trust.p12 -storepass not-the-password >/dev/null 2>&1; then \
	  echo "FAIL: the resealed keystore opens without changeit"; exit 1; \
	fi; \
	echo "PASS: the sweep took the CA out, kept $$roots roots under their aliases, and resealed under changeit"
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit
	@echo "=== fail_on_ca_residue: false, where the same copy only warns ==="
	@FAIL_ON_CA_RESIDUE=false COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg CASE=leaf \
	  --progress=plain -f test/Dockerfile.inspect-hidden-ca test/ \
	  > $(SCRATCH_PREFIX)-hidden-ca.log 2>&1 \
	  || { tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; echo "FAIL: the copy of the CA failed the build"; exit 1; }
	@grep -q "buildcage: warning: .*cannot strip: /app/" $(SCRATCH_PREFIX)-hidden-ca.log \
	  || { tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; echo "FAIL: no warning names the copy of the CA"; exit 1; }
	@echo "PASS: the build carried on past the copy of the CA, warning about it"
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f test/Dockerfile.inspect-nssdb-write test/ \
	  > $(SCRATCH_PREFIX)-hidden-ca.log 2>&1 \
	  || { tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; echo "FAIL: the write to the NSS database failed the build"; exit 1; }
	@grep -q "buildcage: warning: .*changed the NSS database at /root/.pki/nssdb" $(SCRATCH_PREFIX)-hidden-ca.log \
	  || { tail -40 $(SCRATCH_PREFIX)-hidden-ca.log; echo "FAIL: no warning names the NSS database"; exit 1; }
	@echo "PASS: the build carried on past the write to the NSS database, warning about it"
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_inspect_byte_exact
test_integration_buildkit_inspect_byte_exact: ## Compare inspect vs universal layer-for-layer, byte for byte
	@echo "Running inspect-engine byte-exact layer comparison..."
	@rm -f $(SCRATCH_PREFIX)-byte-exact-inspect.tar $(SCRATCH_PREFIX)-byte-exact-universal.tar
	@COMPOSE_FILE=compose.yaml:compose.test-inspect.yaml \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg SOURCE_DATE_EPOCH=1700000000 \
	  --output type=docker,name=$(BYTE_EXACT_INSPECT),rewrite-timestamp=true,unpack=false,dest=$(SCRATCH_PREFIX)-byte-exact-inspect.tar \
	  --progress=plain -f test/Dockerfile.inspect-byte-exact test/
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit
	@COMPOSE_FILE=compose.yaml:compose.test-universal.yaml \
	  $(MAKE) setup_buildkit_universal_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg SOURCE_DATE_EPOCH=1700000000 \
	  --output type=docker,name=$(BYTE_EXACT_UNIVERSAL),rewrite-timestamp=true,unpack=false,dest=$(SCRATCH_PREFIX)-byte-exact-universal.tar \
	  --progress=plain -f test/Dockerfile.inspect-byte-exact test/
	@TEST_COMPOSE_FILE=compose.test-universal.yaml $(MAKE) clean_buildkit
	@docker load -i $(SCRATCH_PREFIX)-byte-exact-inspect.tar
	@docker load -i $(SCRATCH_PREFIX)-byte-exact-universal.tar
	@./test/assert-inspect-byte-exact.sh $(BYTE_EXACT_UNIVERSAL) $(BYTE_EXACT_INSPECT)
	@docker rmi $(BYTE_EXACT_INSPECT) $(BYTE_EXACT_UNIVERSAL)
	@rm -f $(SCRATCH_PREFIX)-byte-exact-inspect.tar $(SCRATCH_PREFIX)-byte-exact-universal.tar

.PHONY: test_integration_buildkit_inspect_roundtrip
test_integration_buildkit_inspect_roundtrip: ## Check an inspect audit run, then enforce the rules it generated
	@echo "Running inspect-engine audit-to-restrict round trip..."
	@./test/run-inspect-roundtrip.sh
	@TEST_COMPOSE_FILE=compose.test-inspect.yaml $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_known_blocked
test_integration_buildkit_universal_known_blocked: ## Check known_blocked_rules against fail_on_blocked
	@echo "Running universal-engine known_blocked_rules tests..."
	@./test/run-universal-known-blocked.sh
	@$(MAKE) clean_buildkit

# Brings the builder up on its own, with no build running and no fixture
# network, so buildcage0 never exists: this is the one target that says where
# the listeners are unreachable from, rather than that a build reached them.
.PHONY: test_integration_buildkit_listener_scope
test_integration_buildkit_listener_scope: ## Check :10024/:53 are unreachable outside buildcage0, for both engines
	@echo "Running listener-scope tests..."
	@./test/assert-listener-scope.sh

.PHONY: test_integration_buildkit_multiarch
test_integration_buildkit_multiarch: ## Check the builder's default and cross-platform builds
	@echo "Running multi-architecture build tests..."
	@$(MAKE) setup_buildkit_universal_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --progress=plain -f test/Dockerfile.multiarch test/ \
	  --load -t $(TEST_IMAGE):native
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(MULTIARCH_CROSS_PLATFORM) \
	  --progress=plain -f test/Dockerfile.multiarch test/ \
	  --load -t $(TEST_IMAGE):cross
	@./test/assert-multiarch.sh $(TEST_IMAGE):native $(TEST_IMAGE):cross $(MULTIARCH_CROSS_PLATFORM)
	@docker rmi $(TEST_IMAGE):native $(TEST_IMAGE):cross
	@$(MAKE) clean_buildkit

# ---------------------------------------------------------------------------
# example_{engine}_{mode}: smoke test against a plain Dockerfile
# ---------------------------------------------------------------------------

.PHONY: example_universal_audit
example_universal_audit: ## Run audit mode example tests
	@echo "Running audit mode example tests..."
	@$(MAKE) setup_buildkit_universal_audit
	@mkdir -p $(SCRATCH_PREFIX)-build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install --ignore-scripts express" \
	  > $(SCRATCH_PREFIX)-build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f $(SCRATCH_PREFIX)-build-context/Dockerfile $(SCRATCH_PREFIX)-build-context \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts
	@$(MAKE) clean_buildkit
	rm -fr $(SCRATCH_PREFIX)-build-context

.PHONY: example_universal_restrict
example_universal_restrict: ## Run restrict mode example tests
	@echo "Running restrict mode example tests..."
	@ALLOWED_HTTPS_RULES="registry.npmjs.org:443" \
	  $(MAKE) setup_buildkit_universal_restrict
	@mkdir -p $(SCRATCH_PREFIX)-build-context
	@printf '%s\n' \
	  "FROM node:24-alpine" \
	  "WORKDIR /app" \
	  "RUN npm init -y && npm install --ignore-scripts express" \
	  "RUN wget -q -O /dev/null --timeout=5 https://example.com/ || true" \
	  > $(SCRATCH_PREFIX)-build-context/Dockerfile
	docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --progress=plain -f $(SCRATCH_PREFIX)-build-context/Dockerfile $(SCRATCH_PREFIX)-build-context \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts || true
	@$(MAKE) clean_buildkit
	rm -fr $(SCRATCH_PREFIX)-build-context
