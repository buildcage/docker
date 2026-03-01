# Rule Syntax

buildcage uses `allowed_https_rules`, `allowed_http_rules`, and `allowed_ip_rules` to control which destinations are accessible during Docker builds.

## Delimiters

Rules are separated by **whitespace** (spaces, tabs, newlines).

```yaml
# These are equivalent:
allowed_https_rules: "a.com:443 b.com:443"
allowed_https_rules: >-
  a.com:443
  b.com:443
```

## Wildcard Rules

Wildcard rules use glob-like patterns to match domain names.

### Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `*` | One or more characters **excluding** dots (single label) | `*.example.com` matches `sub.example.com` but not `deep.sub.example.com` |
| `**` | One or more characters **including** dots (multiple labels) | `**.example.com` matches `sub.example.com` and `deep.sub.example.com` |
| `?` | A single character excluding dots | `exampl?.com` matches `example.com`, `examplx.com` |

### Port Specification

Port is required. Append `:port` to every rule.

| Rule | Matches |
|------|---------|
| `example.com:443` | `example.com` on port 443 only |
| `*.example.com:8443` | Any single-level subdomain of `example.com` on port 8443 only |
| `example.com:*` | `example.com` on any port |

## IP Address Rules

Use `allowed_ip_rules` for direct IP address access. The IP address must include a port.

| Rule | Matches |
|------|---------|
| `192.168.1.1:443` | `192.168.1.1` on port 443 only |
| `10.0.0.1:8080` | `10.0.0.1` on port 8080 only |

IP rules are handled separately from domain rules because direct IP access bypasses DNS resolution. CIDR notation is not supported.

## Regex Rules

Prefix a rule with `~` to use a regular expression. The regex is matched against `domain:port`.

```yaml
allowed_https_rules: "~^api\\.example\\.com:443$"
```

Since the regex is tested against the `domain:port` string, include a port pattern if you want to restrict by port:

| Rule | Effect |
|------|--------|
| `~^example\.com:443$` | Matches `example.com` on port 443 only |
| `~^example\.com:\d+$` | Matches `example.com` on any port |
| `~^.*\.example\.com:{443,8443}$` | Matches any subdomain of `example.com` on port 443 or 8443 |

## Examples

```yaml
- name: Start buildcage
  uses: dash14/buildcage/setup@v1
  with:
    proxy_mode: restrict

    # Wildcard rules
    allowed_https_rules: >-
      registry.npmjs.org:443
      *.githubusercontent.com:443
      fonts.googleapis.com:443

    # HTTP rules with port
    allowed_http_rules: >-
      deb.debian.org:80
      archive.ubuntu.com:8080

    # IP address rules
    allowed_ip_rules: >-
      192.168.1.1:443
      10.0.0.1:8080
```

```yaml
# Regex rules
allowed_https_rules: >-
  ~^registry\.npmjs\.org:\d+$
  ~^.*\.githubusercontent\.com:443$
```

## Deprecated Parameters

The following parameters are deprecated and will be removed in a future version:

| Deprecated | Replacement |
|------------|-------------|
| `allowed_https_domains` | `allowed_https_rules` |
| `allowed_http_domains` | `allowed_http_rules` |
| `https_ports` | Port specification in rules (e.g., `example.com:8443`) |
| `http_ports` | Port specification in rules (e.g., `example.com:8080`) |

### Migration

```yaml
# Before (deprecated)
allowed_https_domains: "registry.npmjs.org, fonts.googleapis.com"
https_ports: "443,8443"

# After
allowed_https_rules: >-
  registry.npmjs.org:443
  registry.npmjs.org:8443
  fonts.googleapis.com:443
  fonts.googleapis.com:8443
```

If you only use the default ports (80 for HTTP, 443 for HTTPS), migration is simpler — just rename the parameter and add the port:

```yaml
# Before (deprecated)
allowed_https_domains: "registry.npmjs.org, fonts.googleapis.com"

# After
allowed_https_rules: "registry.npmjs.org:443 fonts.googleapis.com:443"
```
