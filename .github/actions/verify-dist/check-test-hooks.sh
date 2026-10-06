#!/bin/sh
# Fails if a bundle names a test-hook variable. Run by verify-dist in CI and by
# the pre-commit hook on staged bundles; with no arguments it checks every
# committed bundle. It matches the names, not one spelling of the gate:
# replacePlugin leaves other spellings, such as a destructured read of
# process.env, in place (see rolldown.config.js).
set -eu

[ "$#" -gt 0 ] || set -- $(git ls-files 'dist/*.cjs' 'report/dist/*.cjs')

status=0
for f in "$@"; do
  if grep -noE 'BUILDCAGE_(BUILD_TEST_HOOKS|LOCAL_IMAGE_REF|TEST_[A-Z_]+|RUN_DEBUG_[A-Z_]+)' "$f"; then
    echo "::error::$f references a test-hook variable; a normal build must not contain the test hooks (see rolldown.config.js)."
    status=1
  else
    echo "confirmed: $f references no test-hook variable."
  fi
done
exit "$status"
