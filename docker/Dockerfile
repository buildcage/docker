ARG BUILDKIT_VERSION=v0.28.0
ARG CNI_VERSION=v1.9.0
ARG ALPINE_RELEASE=3.23
ARG S6_OVERLAY_VERSION=v3.2.2.0

# Prepare dependencies
FROM alpine:$ALPINE_RELEASE AS deps
ARG CNI_VERSION
RUN apk add --no-cache curl gettext && \
    mkdir -p /opt/cni/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-${ARCH}-${CNI_VERSION}.tgz" \
      | tar -C /opt/cni/bin -xz ./bridge ./host-local ./loopback

# Final image
FROM moby/buildkit:${BUILDKIT_VERSION}

LABEL org.opencontainers.image.title="buildcage" \
      org.opencontainers.image.description="Secure Docker build environment with network access control" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

RUN apk add --no-cache \
      haproxy \
      dnsmasq \
      iptables \
      curl \
      quickjs

# s6-overlay
ARG S6_OVERLAY_VERSION
RUN apk add --no-cache xz && \
    S6_ARCH=$(uname -m) && \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
      | xz -d | tar -C / -xpf - && \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
      | xz -d | tar -C / -xpf - && \
    apk del xz

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
RUN chmod +x /etc/s6-overlay/scripts/* && \
    chmod +x /etc/s6-overlay/s6-rc.d/dnsmasq/run && \
    chmod +x /etc/s6-overlay/s6-rc.d/haproxy/run && \
    chmod +x /etc/s6-overlay/s6-rc.d/haproxy-log/run

ENTRYPOINT ["/init"]
CMD ["buildkitd", "--oci-worker-net=cni", "--addr", "tcp://0.0.0.0:1234"]
