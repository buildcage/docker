#!/bin/sh
set -e

# cert.pem/key.pem are static fixtures (see cert.pem's header comment to
# regenerate). A static, known cert lets the explicit-engine builder
# container (via BUILDKIT_PROXY_EXTRA_CA_FILE, compose.test-explicit.yaml
# only) trust the exact same file as an extra CA — BuildKit's internal MITM
# proxy makes its own upstream TLS connection to this server and validates
# its certificate normally (unlike universal-mode tests, which use
# test/test-server/ instead: HAProxy never terminates TLS, so clients there
# use --no-check-certificate and this server's cert is never validated), so
# it must both match the requested hostname and be trusted.
echo "Starting test-server..."
exec nginx -g 'daemon off;'
