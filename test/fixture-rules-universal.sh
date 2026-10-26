# shellcheck shell=bash
# The rules the universal-engine fixture tests run under, sourced by
# setup-builder.sh. Each applies only where the caller left its variable unset.

# The first `~` rule is deliberately written without anchors, so
# `not-ok.regex.example.com` being blocked proves they are supplied.
fixture_rule ALLOWED_HTTPS_RULES <<'RULES'
allowed.example.com:443
allowed.example.com:8443
*.wildcard.example.com:443
*.wildcard.example.com:8443
~ok\.regex\.example\.com:443
~^ports\.regex\.example\.com:(443|8443)$
~^tlsany\.example\.com:.*$
RULES

fixture_rule ALLOWED_HTTP_RULES <<'RULES'
allowed.example.com:80
allowed.example.com:8080
*.wildcard.example.com:80
*.wildcard.example.com:8080
RULES

# 10.200.0.101 is left out, so a connection there that names this address in
# its SNI proves the rule sees the destination. :2525 answers before the
# client speaks.
fixture_rule ALLOWED_IP_RULES <<'RULES'
10.200.0.100:8443
10.200.0.100:2525
RULES
