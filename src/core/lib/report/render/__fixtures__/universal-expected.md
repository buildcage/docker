## Outbound Traffic Report

### ✅ Allowed Hosts

| Host | Rule | Count |
| --- | --- | ---: |
| a.example.com:443 | HTTPS | 3 |
| b.example.com:80 | HTTP | 1 |

### 🚫 Blocked Hosts

| Host | Rule | Reason | Count | Expected |
| --- | --- | --- | ---: | :---: |
| bad.example.com:443 | HTTPS | https-not-allowed | 2 |  |
| \*.sury.org:\* (2 hosts) | HTTPS | https-not-allowed | 2 | ✅ |

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
