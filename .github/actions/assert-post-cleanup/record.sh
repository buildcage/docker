#!/bin/bash
# Adds each builder the setup action has started to the record post.mjs
# checks, with its /var/lib/buildkit volume, read while the builder exists.
set -euo pipefail

record="$1"
docker ps -a --filter label=com.docker.compose.service=builder --format '{{.Names}}' |
  while read -r name; do
    volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/buildkit"}}{{.Name}}{{end}}{{end}}' "$name")
    echo "$name $volume"
  done >> "$record"
sort -u -o "$record" "$record"
cat "$record"
