#!/bin/sh
set -e

# Assigned here rather than by Compose IPAM, so 10.200.0.0/24 stays out of the
# daemon's address space and several worktrees can run the suite at once.
ip addr add "$TEST_NET_ADDR" dev eth0

echo "Generating self-signed certificate..."
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /etc/nginx/key.pem \
  -out /etc/nginx/cert.pem \
  -days 1 \
  -subj "/CN=test-server"

echo "Starting test-server..."
exec nginx -g 'daemon off;'
