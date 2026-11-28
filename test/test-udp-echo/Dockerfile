# A UDP echo server, so "the cage could not reach it" can be told apart from
# "there was nothing there to reach". The same probe is run from inside the
# cage, where it must fail, and from a container beside this one, where it must
# succeed.
FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

RUN apk add --no-cache socat

EXPOSE 9999/udp

# Assigned here rather than by Compose IPAM, so 10.200.0.0/24 stays out of the
# daemon's address space and several worktrees can run the suite at once.
ENTRYPOINT ["/bin/sh", "-c", "ip addr add \"$TEST_NET_ADDR\" dev eth0 && exec \"$@\"", "sh"]
CMD ["socat", "-T5", "UDP-RECVFROM:9999,fork", "PIPE"]
