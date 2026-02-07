#!/bin/sh
set -e

echo "Generating self-signed certificate..."
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /etc/nginx/key.pem \
  -out /etc/nginx/cert.pem \
  -days 1 \
  -subj "/CN=test-server"

echo "Starting test-server..."
exec nginx -g 'daemon off;'
