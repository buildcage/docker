#!/usr/bin/env node
/**
 * CLI wrapper for buildRules.
 * Converts wildcard/regex rules to regex strings (space-separated).
 *
 * Usage: node setup/convert-rules.mjs "*.example.com:443 other.com:80"
 */
import { buildRules } from "./lib/rules.mjs";

const input = process.argv[2] || "";
console.log(buildRules(input).join(" "));
