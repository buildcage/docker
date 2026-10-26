UNIVERSAL_OVERLAY := docker/compose.action.test-universal.yaml
INSPECT_OVERLAY := docker/compose.action.test-inspect.yaml
# Lets a target name the overlay its own clean_buildkit has to tear down.
TEST_COMPOSE_FILE ?= $(UNIVERSAL_OVERLAY)

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
# compose.yaml's image name, whichever engine was built last.
BUILDER_IMAGE := buildcage-builder$(BUILDCAGE_WORKTREE_SUFFIX)
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
BUILDX_BUILD = docker buildx build --no-cache --builder $(BUILDER_NAME) --platform $(TEST_PLATFORM) --progress=plain
# In place of a failed restrict build's exit: make stops there, before the
# assertions that would print the proxy's side of the cases that failed.
BUILD_FAILED = { ./test/print-proxy-diagnostics.sh; exit 1; }

# Compose project name, trusted by src/lib/setup-step.ts,
# report/src/lib/report-step.ts and src/post.ts via their own
# BUILDCAGE_BUILD_TEST_HOOKS-gated overrides instead of
# deriveProjectName("buildcage") (src/core/lib/docker/compose-project-name.ts).
# Scoped to the targets that touch this Compose project; test_unit_* is
# excluded because none of those targets touches it.
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export COMPOSE_PROJECT_NAME := buildcage-project$(BUILDCAGE_WORKTREE_SUFFIX)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export BUILDCAGE_BUILD_TEST_HOOKS := 1
# Read by test/setup-builder.sh, report/src/lib/inputs.ts, src/lib/inputs.ts
# (for the post step) and test/assert-post.sh.
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export BUILDER_NAME := $(BUILDER_NAME)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export INPUT_BUILDER_NAME := $(BUILDER_NAME)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export TEST_IMAGE := $(TEST_IMAGE)
setup_buildkit_% test_integration_buildkit_% example_% clean_buildkit report_buildkit: export TEST_NET_SUBNET := $(TEST_NET_SUBNET)
# Read by test/run-inspect-roundtrip.sh, which builds without going through a
# recipe of its own.
test_integration_buildkit_%: export TEST_PLATFORM := $(TEST_PLATFORM)
# What test/setup-builder.sh hands the setup step, for src/post.ts to read the
# same way: its down then layers the same overlay and takes the fixtures too.
test_integration_buildkit_universal_%: export BUILDCAGE_TEST_COMPOSE_OVERLAY := $(UNIVERSAL_OVERLAY)
test_integration_buildkit_inspect_%: export BUILDCAGE_TEST_COMPOSE_OVERLAY := $(INSPECT_OVERLAY)
test_integration_buildkit_%: export BUILDCAGE_LOCAL_IMAGE_REF := $(BUILDER_IMAGE)

.PHONY: help
help:
	@grep -E '^[a-zA-Z_0-9-]+(-%)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

# Renovate bumps this pin; CI then fails until `make seccomp_profile` has been
# rerun, so the pin and the vendored profile can't drift apart.
# renovate: datasource=go depName=github.com/moby/profiles/seccomp
MOBY_PROFILES_SECCOMP_VERSION ?= v0.2.4

# renovate: datasource=docker depName=eclipse-temurin
TEST_TEMURIN_PKCS12_IMAGE ?= eclipse-temurin:21@sha256:4d06038800655fe1211760cd561de70ef2ed7a47f5d69255e9834414602b7026
# renovate: datasource=docker depName=eclipse-temurin
TEST_TEMURIN_JKS_IMAGE ?= eclipse-temurin:17@sha256:b64592d40959b4d13b218f6b06b9ab219ff8aa3dad61efd3b5f519ba4d72ef92

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
	@vp test run report/src src/report

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
	@docker build -f docker/universal/Dockerfile --target qjs-test -t $(QJS_TEST_IMAGE) .
	@docker run --rm --entrypoint qjs $(QJS_MOUNTS) $(QJS_TEST_IMAGE) \
		--std -m /opt/buildcage/core/scripts/test/run-tests.qjs.js $(QJS_TEST_DIRS)

# ===========================================================================
# Integration tests
# ===========================================================================

# ---------------------------------------------------------------------------
# setup_buildkit_{engine}_{mode}: start the builder only
# ---------------------------------------------------------------------------

SETUP_TARGETS := setup_buildkit_universal_audit setup_buildkit_universal_restrict setup_buildkit_inspect_audit setup_buildkit_inspect_restrict
.PHONY: $(SETUP_TARGETS)
setup_buildkit_universal_audit: ## Start universal engine in audit mode
setup_buildkit_universal_restrict: ## Start universal engine in restrict mode
setup_buildkit_inspect_audit: ## Start inspect proxy engine in audit mode
setup_buildkit_inspect_restrict: ## Start inspect proxy engine in restrict mode

# Only this target starts with default rules, and only without a fixture;
# ALLOWED_HTTPS_RULES replaces them.
setup_buildkit_universal_restrict: DEFAULT_ALLOWED_HTTPS_RULES := github.com:443 registry.npmjs.org:443 api.github.com:443 objects.githubusercontent.com:443 httpbin.org:443 deb.debian.org:80 *.githubusercontent.com:443

# Through the setup action itself (src/main.ts), as a workflow would run it;
# see test/setup-builder.sh. A target that names BUILDCAGE_TEST_COMPOSE_OVERLAY
# also gets that file's fixtures.
$(SETUP_TARGETS): setup_buildkit_%:
	@$(if $(and $(DEFAULT_ALLOWED_HTTPS_RULES),$(if $(BUILDCAGE_TEST_COMPOSE_OVERLAY),,1)),ALLOWED_HTTPS_RULES="$${ALLOWED_HTTPS_RULES:-$(DEFAULT_ALLOWED_HTTPS_RULES)}") \
	  ./test/setup-builder.sh $(word 1,$(subst _, ,$*)) $(word 2,$(subst _, ,$*))

.PHONY: clean_buildkit
clean_buildkit: ## Stop and remove the buildkit builder's containers/images and buildx builder
	@echo "Stopping and removing all containers..."
	@docker buildx rm $(BUILDER_NAME) 2>/dev/null || true
	@docker compose -p $(COMPOSE_PROJECT_NAME) -f docker/compose.action.yaml -f $(TEST_COMPOSE_FILE) down -v --rmi local
	@docker rmi $(TEST_IMAGE) $(BUILDER_IMAGE) 2>/dev/null || true

.PHONY: print_builder_name
print_builder_name: ## Print the builder container's name, which carries the worktree suffix
	@echo $(BUILDER_NAME)

.PHONY: report_buildkit
report_buildkit: ## Show the buildcage report for the currently running builder
	@node report/src/main.ts

# ---------------------------------------------------------------------------
# test_integration_buildkit_{engine}_{mode}: setup + build + verify + clean
# ---------------------------------------------------------------------------

.PHONY: test_integration_buildkit
# Read from the definitions below, so a new target needs no second list.
INTEGRATION_TARGETS := $(shell sed -nE 's/^(test_integration_buildkit_[a-z0-9_]+):.*/\1/p' $(firstword $(MAKEFILE_LIST)))
test_integration_buildkit: $(INTEGRATION_TARGETS) ## Run all buildkit integration tests

# Runs src/post.ts and checks it removed the builder and its /var/lib/buildkit
# volume, read before post.ts ran. Once per engine and mode.
POST_AND_ASSERT = volume=$$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/buildkit"}}{{.Name}}{{end}}{{end}}' "$$BUILDER_NAME") && \
	  node src/post.ts && \
	  BUILDKIT_VOLUME="$$volume" ./test/assert-post.sh

.PHONY: test_integration_buildkit_universal_audit
test_integration_buildkit_universal_audit: ## Run universal-engine audit mode tests
	@echo "Running universal-engine audit mode tests..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(UNIVERSAL_OVERLAY) \
	  $(MAKE) setup_buildkit_universal_audit
	@$(BUILDX_BUILD) -f test/Dockerfile.universal-audit test/ \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts
	@./test/assert-universal-audit.sh
	@./test/assert-step-port-isolation.sh
	@$(POST_AND_ASSERT)
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_restrict
test_integration_buildkit_universal_restrict: ## Run universal-engine restrict mode tests
	@echo "Running universal-engine restrict mode tests..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(UNIVERSAL_OVERLAY) \
	  $(MAKE) setup_buildkit_universal_restrict
	@$(BUILDX_BUILD) -f test/Dockerfile.universal-restrict test/ \
	  --load -t $(TEST_IMAGE) || $(BUILD_FAILED)
	@node report/src/main.ts || true
	@./test/assert-universal-restrict.sh
	@$(POST_AND_ASSERT)
	@$(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_restrict_no_traffic
test_integration_buildkit_universal_restrict_no_traffic: ## Run universal-engine restrict mode tests with zero outbound traffic
	@echo "Running universal-engine restrict mode tests with zero outbound traffic..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(UNIVERSAL_OVERLAY) \
	  $(MAKE) setup_buildkit_universal_restrict
	@$(BUILDX_BUILD) -f test/Dockerfile.universal-restrict-no-traffic test/ \
	  --load -t $(TEST_IMAGE)
	@INPUT_FAIL_ON_BLOCKED=true node report/src/main.ts
	@./test/assert-universal-restrict-no-traffic.sh
	@$(POST_AND_ASSERT)
	@$(MAKE) clean_buildkit

# The Alpine build the CA-residue and layer-bloat guards run against. Every
# inspect build injects the same CA the same way, so the other Alpine image
# (Dockerfile.inspect-audit, built by the round trip) would prove nothing more.
# Dockerfile.inspect-python checks the CA under Python 3.13's strict verification.
.PHONY: test_integration_buildkit_inspect_restrict
test_integration_buildkit_inspect_restrict: ## Run inspect-engine restrict mode tests
	@echo "Running inspect-engine restrict mode tests..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_restrict
	@$(BUILDX_BUILD) -f test/Dockerfile.inspect-restrict test/ \
	  --load -t $(TEST_IMAGE) || $(BUILD_FAILED)
	@./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@./test/assert-inspect-no-layer-bloat.sh $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-restrict.sh
	@BUILDER_NAME=$(BUILDER_NAME) TEST_PLATFORM=$(TEST_PLATFORM) \
	  ./test/assert-inspect-refuses-embedded-bundle.sh
	@./test/assert-step-port-isolation.sh
	@$(BUILDX_BUILD) -f test/Dockerfile.inspect-python test/ \
	  --load -t $(TEST_IMAGE)
	@$(POST_AND_ASSERT)
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

# The Debian build those same two guards run against: it starts with no CA
# store at all, which is the case Alpine cannot cover. The restrict run below
# builds the same Dockerfile and differs only in how one request is answered.
.PHONY: test_integration_buildkit_inspect_debian_audit
test_integration_buildkit_inspect_debian_audit: ## Run inspect-engine audit mode tests against a Debian (apt) build
	@echo "Running inspect-engine audit mode tests (Debian/apt)..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_audit
	@$(BUILDX_BUILD) -f test/Dockerfile.inspect-debian test/ \
	  --load -t $(TEST_IMAGE)
	@./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@./test/assert-inspect-no-layer-bloat.sh $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-debian.sh audit
	@$(POST_AND_ASSERT)
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_inspect_debian_restrict
test_integration_buildkit_inspect_debian_restrict: ## Run inspect-engine restrict mode tests against a Debian (apt) build
	@echo "Running inspect-engine restrict mode tests (Debian/apt)..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_restrict
	@$(BUILDX_BUILD) -f test/Dockerfile.inspect-debian test/ \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts || true
	@./test/assert-inspect-debian.sh restrict
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

# The base-image JVM case: a JDK already present reads only its own keystore,
# so the wrapper injects the proxy CA there for the step. Built over both shapes
# a JDK ships cacerts in, PKCS#12 (temurin:21) and JKS (temurin:17); the build's
# own in-step `java` step fails the build unless the JVM trusts the CA, and
# assert-inspect-no-ca-residue.sh proves the committed keystore does not keep it.
.PHONY: test_integration_buildkit_inspect_java_audit
test_integration_buildkit_inspect_java_audit: ## Run inspect-engine tests against Java base images (JVM keystore injection)
	@echo "Running inspect-engine audit mode tests (Java base images)..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_audit
	@for base in $(TEST_TEMURIN_PKCS12_IMAGE) $(TEST_TEMURIN_JKS_IMAGE); do \
	  echo "=== Java base image: $$base ==="; \
	  $(BUILDX_BUILD) \
	    --build-arg BASE=$$base \
	    -f test/Dockerfile.inspect-java test/ \
	    --load -t $(TEST_IMAGE) || exit 1; \
	  NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE) || exit 1; \
	done
	@echo "=== Java real-tool case: Maven resolving a dependency ==="
	@$(BUILDX_BUILD) -f test/Dockerfile.inspect-java-maven test/ \
	  --load -t $(TEST_IMAGE)
	@NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

# chrome-headless-shell ships for x86-64 only, so this ignores TEST_PLATFORM.
.PHONY: test_integration_buildkit_inspect_chromium_audit
test_integration_buildkit_inspect_chromium_audit: ## Run inspect-engine tests against chrome-headless-shell (NSS database injection)
	@echo "Running inspect-engine audit mode tests (chrome-headless-shell)..."
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform linux/amd64 \
	  --progress=plain -f test/Dockerfile.inspect-chromium test/ \
	  --load -t $(TEST_IMAGE)
	@NO_APP_STORE_COPIES=1 ./test/assert-inspect-no-ca-residue.sh $(TEST_IMAGE)
	@BUILDER_NAME=$(BUILDER_NAME) TEST_PLATFORM=linux/amd64 \
	  ./test/assert-inspect-chromium.sh $(TEST_IMAGE)
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_inspect_hidden_ca
test_integration_buildkit_inspect_hidden_ca: ## Check inspect fails a build that hides a copy of the CA the sweep cannot remove
	@echo "Running inspect-engine hidden CA copy tests..."
	@./test/run-inspect-hidden-ca.sh
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_inspect_byte_exact
test_integration_buildkit_inspect_byte_exact: ## Compare inspect vs universal layer-for-layer, byte for byte
	@echo "Running inspect-engine byte-exact layer comparison..."
	@rm -f $(SCRATCH_PREFIX)-byte-exact-inspect.tar $(SCRATCH_PREFIX)-byte-exact-universal.tar
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(INSPECT_OVERLAY) \
	  $(MAKE) setup_buildkit_inspect_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg SOURCE_DATE_EPOCH=1700000000 \
	  --output type=docker,name=$(BYTE_EXACT_INSPECT),rewrite-timestamp=true,unpack=false,dest=$(SCRATCH_PREFIX)-byte-exact-inspect.tar \
	  --progress=plain -f test/Dockerfile.inspect-byte-exact test/
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit
	@BUILDCAGE_TEST_COMPOSE_OVERLAY=$(UNIVERSAL_OVERLAY) \
	  $(MAKE) setup_buildkit_universal_audit
	@docker buildx build --no-cache \
	  --builder $(BUILDER_NAME) \
	  --platform $(TEST_PLATFORM) \
	  --build-arg SOURCE_DATE_EPOCH=1700000000 \
	  --output type=docker,name=$(BYTE_EXACT_UNIVERSAL),rewrite-timestamp=true,unpack=false,dest=$(SCRATCH_PREFIX)-byte-exact-universal.tar \
	  --progress=plain -f test/Dockerfile.inspect-byte-exact test/
	@TEST_COMPOSE_FILE=$(UNIVERSAL_OVERLAY) $(MAKE) clean_buildkit
	@docker load -i $(SCRATCH_PREFIX)-byte-exact-inspect.tar
	@docker load -i $(SCRATCH_PREFIX)-byte-exact-universal.tar
	@./test/assert-inspect-byte-exact.sh $(BYTE_EXACT_UNIVERSAL) $(BYTE_EXACT_INSPECT)
	@docker rmi $(BYTE_EXACT_INSPECT) $(BYTE_EXACT_UNIVERSAL)
	@rm -f $(SCRATCH_PREFIX)-byte-exact-inspect.tar $(SCRATCH_PREFIX)-byte-exact-universal.tar

.PHONY: test_integration_buildkit_inspect_roundtrip
test_integration_buildkit_inspect_roundtrip: ## Check an inspect audit run, then enforce the rules it generated
	@echo "Running inspect-engine audit-to-restrict round trip..."
	@./test/run-inspect-roundtrip.sh
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

# Stops the builder's haproxy, then its coredns, while a RUN step is still
# running; see test/run-inspect-proxy-down.sh.
.PHONY: test_integration_buildkit_inspect_proxy_down
test_integration_buildkit_inspect_proxy_down: ## Check a build's traffic fails and the report fails the step when the proxy stops mid-build
	@echo "Running inspect-engine proxy-down tests..."
	@./test/run-inspect-proxy-down.sh
	@$(POST_AND_ASSERT)
	@TEST_COMPOSE_FILE=$(INSPECT_OVERLAY) $(MAKE) clean_buildkit

.PHONY: test_integration_buildkit_universal_known_blocked
test_integration_buildkit_universal_known_blocked: ## Check known_blocked_rules against fail_on_blocked
	@echo "Running universal-engine known_blocked_rules tests..."
	@./test/run-universal-known-blocked.sh
	@$(MAKE) clean_buildkit

# Brings the builder up on its own, with no build running and no fixture
# network, so buildcage0 never exists: this is the one target that says where
# the listeners are unreachable from, rather than that a build reached them.
.PHONY: test_integration_buildkit_listener_scope
test_integration_buildkit_listener_scope: ## Check :10024/:53 are unreachable outside buildcage0
	@echo "Running listener-scope tests..."
	@./test/assert-listener-scope.sh

# Needs the engine images, not a running builder: the script builds each under
# a name of its own and removes it, pass or fail.
.PHONY: test_integration_buildkit_haproxy_configs
test_integration_buildkit_haproxy_configs: ## Check every HAProxy config the generators write loads in each engine's image
	@echo "Running HAProxy config load tests..."
	@./test/assert-haproxy-configs.sh universal src/core/lib/acl/__fixtures__/haproxy-universal
	@./test/assert-haproxy-configs.sh inspect src/core/lib/acl/__fixtures__/haproxy

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
	$(BUILDX_BUILD) -f $(SCRATCH_PREFIX)-build-context/Dockerfile $(SCRATCH_PREFIX)-build-context \
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
	$(BUILDX_BUILD) -f $(SCRATCH_PREFIX)-build-context/Dockerfile $(SCRATCH_PREFIX)-build-context \
	  --load -t $(TEST_IMAGE)
	@node report/src/main.ts || true
	@$(MAKE) clean_buildkit
	rm -fr $(SCRATCH_PREFIX)-build-context
