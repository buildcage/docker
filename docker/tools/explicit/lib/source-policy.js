/**
 * Build a BuildKit sourcepolicy.pb.Policy (protobuf-JSON shape) from the same
 * allowed_https_rules/allowed_http_rules/allowed_ip_rules syntax used by
 * transparent mode's HAProxy ACLs.
 *
 * The DENY catch-all is scoped to ^https?:// only, so docker-image://,
 * git://, local://, and oci-layout:// sources (which never match any rule
 * here) fall through to BuildKit's default-allow-when-unmatched behavior —
 * FROM/git sources remain unfiltered by buildcage, matching transparent
 * mode's documented behavior that only RUN-step network is controlled.
 */
import { convertRule, wildcardToRegex } from "../../shared/lib/rules.js";

const DEFAULT_PORT = { https: "443", http: "80" };

export function buildSourcePolicy({ proxyMode, httpsRulesInput, httpRulesInput, ipRulesInput }) {
  if (proxyMode === "audit") {
    // No rules at all: BuildKit's own "proxy network requests:" build output
    // already provides audit visibility for every request.
    return { version: 1, rules: [] };
  }

  // BuildKit's policy engine applies "last matching rule wins" (see
  // sourcepolicy/engine.go's evaluatePolicy). The DENY catch-all must come
  // FIRST so it acts as the default, with the specific ALLOW rules listed
  // AFTER it — an ALLOW rule that also matches the (deliberately universal)
  // catch-all then overrides it, since it is evaluated later. Reversing this
  // order would make the catch-all always win, denying everything.
  const rules = [
    {
      action: "DENY",
      selector: { identifier: "^https?://.*", matchType: "REGEX" },
    },
    ...splitInput(httpsRulesInput).map((rule) => allowRule(rule, "https")),
    ...splitInput(httpRulesInput).map((rule) => allowRule(rule, "http")),
    ...splitInput(ipRulesInput).flatMap((rule) => [allowRule(rule, "https"), allowRule(rule, "http")]),
  ];
  return { version: 1, rules };
}

function allowRule(rawRule, scheme) {
  const identifier = rawRule.startsWith("~")
    ? toUrlIdentifierFromRegex(convertRule(rawRule), scheme)
    : toUrlIdentifierFromWildcard(rawRule, scheme);
  return { action: "ALLOW", selector: { identifier, matchType: "REGEX" } };
}

// BuildKit's exec-proxy identifier omits an explicit ":443"/":80" when the
// original request didn't specify a port (verified against a live
// moby/buildkit v0.31.1 container — see docs/security.md); a non-default
// port is always present. So a wildcard/exact port rule that resolves to the
// scheme's default port (or "any port") must treat the port as OPTIONAL in
// the generated identifier, or requests using the implicit default port
// would wrongly fall through to the DENY catch-all.
function toUrlIdentifierFromWildcard(rawRule, scheme) {
  const combined = wildcardToRegex(rawRule); // e.g. "example\.com:443" or "example\.com:\d+" (no colon inside the domain part)
  const colonIdx = combined.lastIndexOf(":");
  const domainRegex = combined.slice(0, colonIdx);
  const portRegex = combined.slice(colonIdx + 1);
  const isDefaultPort = portRegex === DEFAULT_PORT[scheme];
  const isWildcardPort = portRegex === "\\d+";
  const portPattern = isDefaultPort || isWildcardPort ? `(:${portRegex})?` : `:${portRegex}`;
  return `^${scheme}://${domainRegex}${portPattern}(/.*)?$`;
}

// User-supplied `~regex` rules match against "domain:port" as a whole; we
// cannot safely infer which part is the port to make it optional, so this is
// passed through as-is (wrapped in scheme + optional path only). Document
// this in docs/rules.md if a user needs default-port matching here.
function toUrlIdentifierFromRegex(core, scheme) {
  let body = core;
  if (body.startsWith("^")) body = body.slice(1);
  if (body.endsWith("$")) body = body.slice(0, -1);
  return `^${scheme}://${body}(/.*)?$`;
}

function splitInput(input) {
  return input?.trim().split(/\s+/).filter(Boolean) ?? [];
}
