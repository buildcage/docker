FROM nginx:stable-alpine3.23-slim@sha256:2c605dbeab79a6b2a63340474fe58119d0ef95bdc4b1f41df0aa689659b3d13b

COPY nginx.conf /etc/nginx/nginx.conf
COPY cert.pem key.pem /etc/nginx/

EXPOSE 80 443 2525 8080 8443 9080 9443

# Assigned here rather than by Compose IPAM, so 10.200.0.0/24 stays out of the
# daemon's address space and several worktrees can run the suite at once.
ENTRYPOINT ["/bin/sh", "-c", "ip addr add \"$TEST_NET_ADDR\" dev eth0 && exec /docker-entrypoint.sh \"$@\"", "sh"]
# Restated because ENTRYPOINT resets the base image's CMD.
CMD ["nginx", "-g", "daemon off;"]
