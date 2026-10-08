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
          allowed_url_rules: |
            GET https://a.example.com/pkg.json
            POST https://a.example.com/upload
```

<sub>*Permits exactly what this build did; a versioned or dated URL may drift.*</sub>

</details>

### 🚫 Blocked Hosts

| Host | Rule | Reason | Count |
| --- | --- | --- | ---: |
| bad.example.com:443 | HTTPS | https-not-allowed | 2 |

### 🚨 Restrict Would Refuse

```
🚨 00:12.000: POST https://a.example.com/upload -> 200 (512B) (restrict would refuse: example-refusal)
```

### ⚠️ Failed Connections

| Host | Rule | Reason | Count |
| --- | --- | --- | ---: |
| a.example.com:443 | HTTPS | origin-aborted | 1 |

<sub>*Note: no rule refused these; the connection itself did not complete, so no rule can change the outcome and none of them fails the step.*</sub>

<details>
<summary>💬 Communication details</summary>

```
✅ 00:05.000: GET https://a.example.com/pkg.json -> 200 (1.0KB)
🚫 00:07.000: GET https://bad.example.com/payload -> https-not-allowed
🚫 00:08.000: DNS A unresolvable.example.net -> dns-not-allowed
⚠️ 00:09.123: HTTPS untrusted-ca.example.com:443 -> client-aborted
⚠️ 00:11.000: GET https://a.example.com/pkg.json -> origin-aborted
🚨 00:12.000: POST https://a.example.com/upload -> 200 (512B) (restrict would refuse: example-refusal)
```

</details>

*Reported by [owner/repo](https://github.com/owner/repo)*

<hr>
