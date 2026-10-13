#!/bin/sh
# collect-go-licenses.sh <out dir>: copies the license files, PATENTS grants
# included, of the Go standard library and of every module the main package in
# the working directory links into <out dir>/go/ and <out dir>/<module path>/.
# Run with the GOOS, GOARCH and CGO_ENABLED of the build. Fails on a module
# that ships none.
set -eu
out=$1
mods=$(mktemp)
trap 'rm -f "$mods"' EXIT

mkdir -p "$out/go"
cp "$(go env GOROOT)/LICENSE" "$(go env GOROOT)/PATENTS" "$out/go/"

# Into a file first: sh has no pipefail, so a failing go list would go unseen.
go list -deps -f '{{if not .Standard}}{{with .Module}}{{if not .Main}}{{.Path}} {{.Dir}}{{end}}{{end}}{{end}}' . > "$mods"
sort -u "$mods" |
  while read -r path dir; do
    # A vendored module has no directory of its own in the listing.
    [ -n "$dir" ] || dir="vendor/$path"
    mkdir -p "$out/$path"
    found=
    for f in "$dir"/LICENSE* "$dir"/LICENCE* "$dir"/COPYING* "$dir"/NOTICE* "$dir"/PATENTS*; do
      if [ -f "$f" ]; then
        cp "$f" "$out/$path/"
        found=1
      fi
    done
    if [ -z "$found" ]; then
      echo "no license file in $path ($dir)" >&2
      exit 1
    fi
  done
