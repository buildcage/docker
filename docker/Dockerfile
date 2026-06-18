ARG CNI_VERSION=v1.9.1

# Prepare dependencies
FROM alpine:3.24.0@sha256:a2d49ea686c2adfe3c992e47dc3b5e7fa6e6b5055609400dc2acaeb241c829f4 AS deps
ARG CNI_VERSION
RUN apk add --no-cache curl gettext && \
    mkdir -p /opt/cni/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-${ARCH}-${CNI_VERSION}.tgz" \
      | tar -C /opt/cni/bin -xz ./bridge ./host-local ./loopback

# Final image
FROM moby/buildkit:v0.31.0@sha256:a095b3d11ce1a9a05b6064ef515dfca0291ec5bcf2ea8178da8f6461924294e1

LABEL org.opencontainers.image.title="buildcage" \
      org.opencontainers.image.description="Secure Docker build environment with network access control" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

RUN apk add --no-cache \
      s6-overlay \
      haproxy \
      dnsmasq \
      iptables \
      curl \
      quickjs

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0

# envsubst
COPY --from=deps /usr/bin/envsubst /usr/bin/envsubst
COPY --from=deps /usr/lib/libintl.so* /usr/lib/

# CNI
COPY --from=deps /opt/cni/bin /opt/cni/bin

# BuildKit
RUN mkdir -p /etc/buildkit
COPY files/buildkitd.toml /etc/buildkit/buildkitd.toml
COPY files/cni.conflist   /etc/buildkit/cni.conflist

# DNS
COPY files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts)
COPY files/tools/ /opt/buildcage/tools/

# License
COPY files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

# s6 service definitions and init scripts
COPY files/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY files/s6-scripts/ /etc/s6-overlay/scripts/

ENTRYPOINT ["/init"]
