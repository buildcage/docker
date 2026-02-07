#!/bin/bash

LOGS=$(docker compose logs --no-log-prefix builder 2>/dev/null)

echo "::group::HTTP Proxy communication logs"
echo "$LOGS" | grep -E '^\['
echo "::endgroup::"
echo ""

# Auto-detect mode
if echo "$LOGS" | grep -q '\[AUDIT\]'; then
  MODE=audit
elif echo "$LOGS" | grep -q '\[BLOCKED\]\|\[ALLOWED\]'; then
  MODE=restrict
else
  echo "No proxy logs found."
  exit 0
fi

echo "Accessed hosts summary:"
echo "------------------------------------"

if [ "$MODE" = "audit" ]; then
  echo "🔍 Audited hosts (audit mode - all logged):"
  echo "$LOGS" | \
    grep '\[AUDIT\]' | \
    grep -oE '"[^"]*"' | \
    tr -d '"' | \
    grep -v '^$' | \
    sort | uniq -c | sort -rn | \
    while read count host; do
      echo "  $count x $host"
    done
else
  echo "✅ Allowed hosts (proxied to real servers):"
  echo "$LOGS" | \
    grep '\[ALLOWED\]' | \
    grep -oE '"[^"]*"' | \
    tr -d '"' | \
    grep -v '^$' | \
    sort | uniq -c | sort -rn | \
    while read count host; do
      echo "  $count x $host"
    done

  echo ""
  echo "❌ Blocked hosts (rejected):"
  echo "$LOGS" | \
    grep '\[BLOCKED\]' | \
    grep -oE '"[^"]*"' | \
    tr -d '"' | \
    grep -v '^$' | \
    sort | uniq -c | sort -rn | \
    while read count host; do
      echo "  $count x $host"
    done

  BLOCKED_COUNT=$(echo "$LOGS" | grep '\[BLOCKED\]' | wc -l)
  if [ "$BLOCKED_COUNT" -gt 0 ]; then
    echo ""
    echo "⚠️  Warning: $BLOCKED_COUNT blocked connection(s) detected"
    exit 1
  fi
fi
