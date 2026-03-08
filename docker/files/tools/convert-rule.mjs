/**
 * Convert whitespace-separated wildcard rules (stdin) to newline-separated regex (stdout).
 *
 * Usage: echo "*.example.com:443 other.com:80" | qjs convert-rule.mjs
 */
import * as std from "std";
import { buildRules } from "./lib/rules.mjs";

const input = std.in.readAsString();

try {
  const regexRules = buildRules(input);
  if (regexRules.length > 0) {
    std.out.puts(regexRules.join("\n") + "\n");
  }
} catch (e) {
  std.err.puts(`${e.message}\n`);
  std.exit(1);
}
