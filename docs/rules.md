# Rule Syntax

This page holds no content of its own. The rule syntax lives in the [Reference](./reference.md), and
what follows is a set of links into it.

- [Rule syntax](./reference.md#rule-syntax): which inputs each engine takes
- [URL rules](./reference.md#url-rules-allowed-url-rules): a method list and a URL pattern, for `inspect`
- [Host rules](./reference.md#host-rules-allowed-https-rules-allowed-http-rules-allowed-ip-rules-known-blocked-rules): `host:port`, shared by the allow inputs
- [Blocked rules](./reference.md#blocked-rules-known-blocked-rules): `known-blocked-rules`, a host or (on `inspect`) a URL expected to be blocked
- [Wildcards](./reference.md#wildcards) and [ports](./reference.md#ports): what `*`, `**`, `?` and `:*` match
- [IP addresses](./reference.md#ip-addresses-allowed-ip-rules): what `allowed-ip-rules` takes
- [TLS passthrough](./reference.md#tls-passthrough-allowed-tls-rules): TLS that isn't HTTPS, for `inspect`
- [Regular expressions](./reference.md#regular-expressions): the `~` prefix, and how a URL rule is split
- [Rules for each engine](../README.md#inputs): worked examples in the README
