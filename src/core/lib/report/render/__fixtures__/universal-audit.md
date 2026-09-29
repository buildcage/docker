## Outbound Traffic Report (audit mode)

### 📋 Audited Hosts

| Host | Rule | Count |
| --- | --- | ---: |
| a.example.com:443 | HTTPS | 3 |
| b.example.com:80 | HTTP | 1 |

<details>
<summary>🛡️ Switch to restrict mode</summary>

```yaml
      - name: Start Buildcage
        uses: owner/repo@v2 # 2.1.0
        with:
          proxy_mode: restrict
          proxy_engine: universal
          allowed_https_rules: >-
            a.example.com:443
            c.example.com:443
          allowed_http_rules: >-
            b.example.com:80
```

</details>

### 🚫 Blocked Hosts

| Host | Rule | Reason | Count |
| --- | --- | --- | ---: |
| bad.example.com:443 | HTTPS | https-not-allowed | 2 |

### ⚠️ Failed Connections

| Host | Rule | Reason | Count |
| --- | --- | --- | ---: |
| c.example.com:443 | HTTPS | dns-failed | 1 |

<sub>*Note: no rule refused these; the connection itself did not complete, so no rule can change the outcome and none of them fails the step.*</sub>

<details>
<summary>💬 Communication details</summary>

```
✅ 00:05.000: HTTPS a.example.com:443 -> (1.0KB)
🚫 00:07.000: HTTPS bad.example.com:443 -> https-not-allowed
ℹ️ 00:08.000: DNS SRV _http._tcp.a.example.com -> no data (SRV is never served)
⚠️ 00:11.000: HTTPS c.example.com:443 -> dns-failed
```

</details>

<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>

*Reported by [owner/repo](https://github.com/owner/repo)*

<hr>
