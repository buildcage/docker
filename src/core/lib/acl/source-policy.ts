/**
 * Build a BuildKit sourcepolicy.pb.Policy (protobuf-JSON shape) from the same
 * allowed_https_rules/allowed_http_rules/allowed_ip_rules syntax used by
 * universal mode's HAProxy ACLs.
 *
 * The DENY catch-all is scoped to ^https?:// only, so docker-image://,
 * git://, local://, and oci-layout:// sources (which never match any rule
 * here) fall through to BuildKit's default-allow-when-unmatched behavior —
 * FROM/git sources remain unfiltered by buildcage, matching universal
 * mode's documented behavior that only RUN-step network is controlled.
 */
import { convertRule, splitRuleTokens, wildcardToRegex } from "./wildcard-rules.ts";

const DEFAULT_PORT: Record<string, string> = { https: "443", http: "80" };

export interface SourcePolicyInput {
  proxyMode: string;
  httpsRulesInput: string | undefined;
  httpRulesInput: string | undefined;
  ipRulesInput: string | undefined;
}

interface SourcePolicyRule {
  action: "ALLOW" | "DENY";
  selector: { identifier: string; matchType: "REGEX" };
}

interface SourcePolicy {
  version: number;
  rules: SourcePolicyRule[];
}

export function buildSourcePolicy({
  proxyMode,
  httpsRulesInput,
  httpRulesInput,
  ipRulesInput,
}: SourcePolicyInput): SourcePolicy {
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
  const rules: SourcePolicyRule[] = [
    {
      action: "DENY",
      selector: { identifier: "^https?://.*", matchType: "REGEX" },
    },
    ...splitRuleTokens(httpsRulesInput).map((rule) => allowRule(rule, "https")),
    ...splitRuleTokens(httpRulesInput).map((rule) => allowRule(rule, "http")),
    ...splitRuleTokens(ipRulesInput).flatMap((rule) => [
      allowRule(rule, "https"),
      allowRule(rule, "http"),
    ]),
  ];
  return { version: 1, rules };
}

function allowRule(rawRule: string, scheme: string): SourcePolicyRule {
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
function toUrlIdentifierFromWildcard(rawRule: string, scheme: string): string {
  const combined = wildcardToRegex(rawRule); // e.g. "example\.com:443" or "example\.com:\d+" (no colon inside the domain part)
  const colonIdx = combined.lastIndexOf(":");
  const domainRegex = combined.slice(0, colonIdx);
  const portRegex = combined.slice(colonIdx + 1);
  const isDefaultPort = portRegex === DEFAULT_PORT[scheme];
  const isWildcardPort = portRegex === "\\d+";
  const portPattern = isDefaultPort || isWildcardPort ? `(:${portRegex})?` : `:${portRegex}`;
  return `^${scheme}://${domainRegex}${portPattern}(/.*)?$`;
}

// True if the character at index i in s is escaped, i.e. preceded by an odd
// number of consecutive backslashes (each adjacent pair of backslashes is
// one literal backslash; a leftover single backslash escapes what follows).
function isEscapedAt(s: string, i: number): boolean {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) backslashes++;
  return backslashes % 2 === 1;
}

// Replaces every unescaped ".*" with "[^/]*". A bare "." also matches "/", so
// without this, a rule like `~.*\.example\.com` could match past the domain
// and into the (always-allowed) path — e.g. "https://evil.com/x.example.com".
// Confining it to "[^/]*" keeps the match inside the domain:port segment.
// The captured backslash run applies the same escape-parity check as
// isEscapedAt above, inline as part of the replace.
function confineDotStarToDomain(s: string): string {
  return s.replace(/(\\*)\.\*/g, (match, backslashes) =>
    backslashes.length % 2 === 1 ? match : `${backslashes}[^/]*`,
  );
}

// User-supplied `~regex` rules match against "domain:port" as a whole, with
// the same substring-search semantics as universal mode's HAProxy ACLs (no
// implicit anchoring there either): an explicit leading `^`/trailing `$`
// anchors that end same as in any regex, and omitting either lets that end
// match anywhere within the domain — e.g. `~example` matches `example.com`.
// A missing anchor is filled with `[^/]*` rather than left unconstrained,
// for the same domain/path-boundary reason as confineDotStarToDomain above.
function toUrlIdentifierFromRegex(core: string, scheme: string): string {
  const hasLeadingAnchor = core.startsWith("^");
  const hasTrailingAnchor = core.endsWith("$") && !isEscapedAt(core, core.length - 1);

  let body = hasLeadingAnchor ? core.slice(1) : core;
  body = hasTrailingAnchor ? body.slice(0, -1) : body;
  body = confineDotStarToDomain(body);

  if (!hasLeadingAnchor) body = `[^/]*${body}`;
  if (!hasTrailingAnchor) body = `${body}[^/]*`;

  return `^${scheme}://${body}(/.*)?$`;
}
