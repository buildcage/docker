# Rule Syntax

This page holds no content of its own. The rule syntax lives in the [Reference](./reference.md), and
what follows is a set of links into it.

- [Rule syntax](./reference.md#rule-syntax): which inputs each engine takes
- [URL rules](./reference.md#url-rules-allowed_url_rules): a method list and a URL pattern, for `inspect`
- [Host rules](./reference.md#host-rules-allowed_https_rules-allowed_http_rules-allowed_ip_rules-known_blocked_rules): `host:port`, shared by the allow inputs
- [Blocked rules](./reference.md#blocked-rules-known_blocked_rules): `known_blocked_rules`, a host or (on `inspect`) a URL expected to be blocked
- [Wildcards](./reference.md#wildcards) and [ports](./reference.md#ports): what `*`, `**`, `?` and `:*` match
- [IP addresses](./reference.md#ip-addresses-allowed_ip_rules): what `allowed_ip_rules` takes
- [TLS passthrough](./reference.md#tls-passthrough-allowed_tls_rules): TLS that isn't HTTPS, for `inspect`
- [Regular expressions](./reference.md#regular-expressions): the `~` prefix, and how a URL rule is split
- [Rules for each engine](../README.md#inputs): worked examples in the README
