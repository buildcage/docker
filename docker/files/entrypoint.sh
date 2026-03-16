#!/bin/sh
#
# Entrypoint for buildcage container (docker-container driver)
#

# Run oneshot init scripts
/opt/buildcage/scripts/init-haproxy-cfg
/opt/buildcage/scripts/init-iptables

# Start service supervision and wait for readiness
s6-svscan /etc/buildcage/services &
s6-svwait -U -t 5000 /etc/buildcage/services/dnsmasq /etc/buildcage/services/haproxy

# docker-container driver overrides CMD (losing --oci-worker-net and --addr),
# so we prepend the required buildkitd flags here.
exec buildkitd --oci-worker-net=cni "$@"
