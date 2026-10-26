# shellcheck shell=bash
# The rules the inspect-engine fixture tests run under, sourced by
# setup-builder.sh. Each applies only where the caller left its variable unset.
# audit enforces none of them.

fixture_rule ALLOWED_HTTPS_RULES <<'RULES'
sub.wildcard.example.com:443
absent.example.com:443
v6only.example.com:443
metadata.example.com:443
runner.example.com:443
impostor.example.com:443
deadend.example.com:443
RULES

fixture_rule ALLOWED_HTTP_RULES <<'RULES'
allowed.example.com:80
deadend.example.com:80
RULES

# The ~regex rule reuses tlspass.example.com on a second port, so a host regex
# that was mangled as a wildcard would break the existing :443 rule too, not
# just fail to add the new port.
fixture_rule ALLOWED_TLS_RULES <<'RULES'
tlspass.example.com:443
~^tlspass\.example\.com:8443$
~^tlsany\.example\.com:.*$
RULES

# 9080 is distinct from the :80 the URL rule below already allows, so reaching
# it proves this rule's own doing. 10.200.0.53:53 is the fixture resolver, for
# DNS over TCP to a resolver other than the gateway. :2525 answers before the
# client speaks.
fixture_rule ALLOWED_IP_RULES <<'RULES'
~^10\.200\.0\.\d+:9080$
10.200.0.53:53
10.200.0.100:2525
RULES

fixture_rule ALLOWED_URL_RULES <<'RULES'
GET https://allowed.example.com/public/**
GET https://allowed.example.com:9443/public/**
GET|POST https://api.example.com/v1/*
GET http://10.200.0.100/pub-by-addr/**

# The one real, non-fixture host: apt has to bootstrap ca-certificates
# over the real archive before it has anything of its own to reuse the
# fixture with (see Dockerfile.inspect-debian).
GET http://deb.debian.org/debian/**
GET http://deb.debian.org/debian-security/**

# Scoped by path, unlike sub.wildcard.example.com: DNS cannot see that
# scoping, so this proves a name matching only the wildcard host is
# never resolved for real.
GET https://*.wildcard.example.com/public/**

# Reuses blocked.example.com (see [Blocked host]), so it needs no cert
# or DNS entry of its own.
GET ~^https://blocked\.example\.com:9443/public/.*$

# No port at all: matches only the scheme's default (443), not 9443
# above. A ~ URL rule's port is optional, unlike the other kinds.
GET ~^https://blocked\.example\.com/defaultport/.*$

# Neither anchor written: the host half is anchored for the author,
# so not-ok.wildcard.example.com is blocked, while the path half is
# left as written and /regexpub/ stays a prefix.
GET ~https://ok\.wildcard\.example\.com/regexpub/

# The "$" is the author's own and must survive: /regexexactly must
# not match a rule naming /regexexact.
GET ~^https://ok\.wildcard\.example\.com/regexexact$

# Its port half matches any text, so a Host of
# anyport.example.com:x.evil.example.net:80 would match it.
GET ~^https?://anyport\.example\.com:.*/.*$

# Never requested: this is here so real HAProxy sees a path pattern
# carrying a character its own config parser folds. Unescaped, the `'`
# would open a quoted string, so haproxy refuses the config and this
# job fails, which is the point. A pattern that stayed valid when cut
# short would regress in silence. (A `#` is rejected at input as a
# comment written without its space, so it never reaches the config.)
GET ~^https://blocked\.example\.com/frag(x|'z)$
RULES
