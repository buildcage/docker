# Final image
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

LABEL org.opencontainers.image.title="buildcage-sandbox" \
      org.opencontainers.image.description="Network-isolated proxy for arbitrary GitHub Actions commands" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

RUN apk add --no-cache \
      s6-overlay \
      haproxy \
      dnsmasq \
      iptables \
      iproute2 \
      gettext \
      curl \
      quickjs

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0

# DNS
COPY sandbox/docker/files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY sandbox/docker/files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts) — convert-rule.js is used by init-haproxy-cfg,
# report.js/lib/log-parser.js by the sandbox action's report step
COPY core/scripts/ /opt/buildcage/scripts/
COPY core/shared/  /opt/buildcage/shared/

# License
COPY sandbox/docker/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

# s6 service definitions and init scripts
COPY sandbox/docker/files/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY sandbox/docker/files/s6-scripts/ /etc/s6-overlay/scripts/

ENTRYPOINT ["/init"]
