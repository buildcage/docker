# Rule Syntax

This page holds no content of its own. The rule syntax lives in the [README](../README.md), and what
follows is a set of links into it.

- [Rule syntax](../README.md#rule-syntax): which inputs each engine takes
- [URL rules](../README.md#url-rules-allowed_url_rules): a method list and a URL pattern, for `inspect`
- [Host rules](../README.md#host-rules-allowed_https_rules-allowed_http_rules-allowed_ip_rules-known_blocked_rules): `host:port`, shared by four inputs
- [Wildcards](../README.md#wildcards) and [ports](../README.md#ports): what `*`, `**`, `?` and `:*` match
- [IP addresses](../README.md#ip-addresses-allowed_ip_rules): what `allowed_ip_rules` takes on each engine
- [TLS passthrough](../README.md#tls-passthrough-allow_tls_rules): TLS that isn't HTTPS, for `inspect`
- [Regular expressions](../README.md#regular-expressions): the `~` prefix, and where POSIX ERE applies
