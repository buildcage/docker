# A UDP echo server, so "the build could not reach it" can be told apart from
# "there was nothing there to reach". The same probe is run from inside the
# cage, where it must fail, and from a container beside this one, where it must
# succeed.
FROM alpine:3.24.0@sha256:a2d49ea686c2adfe3c992e47dc3b5e7fa6e6b5055609400dc2acaeb241c829f4

RUN apk add --no-cache socat

EXPOSE 9999/udp

CMD ["socat", "-T5", "UDP-RECVFROM:9999,fork", "PIPE"]
