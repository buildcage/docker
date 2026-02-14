ARG BUILDKIT_VERSION=v0.27.1
ARG CNI_VERSION=v1.9.0
ARG ALPINE_RELEASE=3.23

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
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

RUN apk add --no-cache \
      nginx nginx-mod-stream \
      dnsmasq \
      iptables \
      curl

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

# Nginx
COPY files/nginx.conf.template /etc/nginx/nginx.conf.template

# Entrypoint
COPY files/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
