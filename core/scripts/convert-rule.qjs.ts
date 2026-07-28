/**
 * Convert whitespace-separated wildcard rules (stdin) to newline-separated regex (stdout).
 *
 * Usage: echo "*.example.com:443 other.com:80" | qjs --std -m convert-rule.js
 */
import * as std from "qjs:std";
import { buildRules } from "../lib/acl/wildcard-rules.js";

const input = std.in.readAsString();

try {
  const regexRules = buildRules(input);
  if (regexRules.length > 0) {
    std.out.puts(regexRules.join("\n") + "\n");
  }
} catch (e) {
  std.err.puts(`${(e as Error).message}\n`);
  std.exit(1);
}
