'use strict';

var node_child_process = require('node:child_process');
var node_path = require('node:path');
var node_url = require('node:url');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
/**
 * Rule conversion library for buildcage container.
 * Converts wildcard patterns to regex strings for HAProxy ACLs.
 */

/**
 * Build regex rules from a space-separated input string.
 *
 * @param {string} rulesInput
 * @returns {string[]}
 */
function buildRules(rulesInput) {
  const rules = rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  return rules.map(convertRule);
}

/**
 * Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
 */
function convertRule(rule) {
  if (rule.startsWith("~")) {
    const regex = rule.slice(1);
    try { new RegExp(regex); } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${e.message}`);
    }
    return regex;
  }
  return `^${wildcardToRegex(rule)}$`;
}

/**
 * Convert a domain wildcard to a regex string (without anchors or port).
 *
 * Supported wildcards:
 *   `**` — matches one or more characters including dots
 *   `*`  — matches one or more characters excluding dots
 *   `?`  — matches a single character excluding dots
 *
 * A dot-separated part containing `*` must be exactly `*` or `**`.
 */
function domainToRegex(domain) {
  const regexParts = domain.split(".").map(part => {
    if (part === "**") return ".+";
    if (part === "*") return "[^.]+";
    if (part.includes("*")) {
      throw new Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
    }
    // Escape regex meta characters (`?` excluded — it is a wildcard, handled below)
    return part
      .replace(/[.+^$()[\]{}|\\]/g, "\\$&") // escape regex special chars except `?`
      .replace(/\?/g, "[^.]"); // `?` matches a single character excluding dots
  });

  return regexParts.join("\\.");
}

/**
 * Convert a wildcard pattern (`<domain>:<port|*>`) to a regex string (without anchors).
 */
function wildcardToRegex(pattern) {
  if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) {
    throw new Error(`Invalid pattern "${pattern}"`);
  }
  const [domain, port] = pattern.split(":");
  const portRegex = port === "*" ? "\\d+" : port;
  return `${domainToRegex(domain)}:${portRegex}`;
}

const __dirname$1 = node_path.dirname(node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('main.js', document.baseURI).href))));
const composeFile = node_path.join(__dirname$1, "../compose.yml");

function main() {
  const env = process.env;

  // Digest is written to GITHUB_STATE by pre.mjs; empty when ref has no matching tag.
  const imageRef = resolveBuildcageImageRef({
    imageDigest: env.STATE_BUILDCAGE_DIGEST,
    actionRepository: env.GITHUB_ACTION_REPOSITORY,
    actionRef: env.GITHUB_ACTION_REF,
  });
  console.log(`buildcage image: ${imageRef}`);

  let rules;
  try {
    rules = buildACLRules({
      httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
      httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
      ipRulesInput: env.INPUT_ALLOWED_IP_RULES,
    });
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }

  console.log("::group::Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  console.log("::endgroup::");

  const composeEnv = {
    ...env,
    BUILDER_NAME: env.INPUT_BUILDER_NAME || "buildcage",
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join('\n'),
    ALLOWED_HTTP_RULES: rules.httpRules.join('\n'),
    ALLOWED_IP_RULES: rules.ipRules.join('\n'),
    BUILDCAGE_IMAGE_REF: imageRef,
  };

  node_child_process.execFileSync(
    "docker",
    ["compose", "-f", composeFile, "down"],
    { stdio: "inherit", env: composeEnv }
  );

  node_child_process.execFileSync(
    "docker",
    [
      "compose",
      "-f", composeFile,
      "up", "-d", "--pull", "always", "--no-build", "--wait",
    ],
    { stdio: "inherit", env: composeEnv }
  );
}

/**
 * Resolve the buildcage Docker image reference (image@digest or image:tag).
 * The repository is always derived from the action repository — external image
 * overrides are intentionally not supported to preserve cosign verification integrity.
 *
 * @param {{ imageDigest: string|undefined, actionRepository: string, actionRef: string }} opts
 * @param {function} [_exec] - Override for execFileSync (used in tests)
 * @returns {string} Full image reference (e.g. "ghcr.io/owner/repo@sha256:..." or "ghcr.io/owner/repo:2.0.1")
 */
function resolveBuildcageImageRef({ imageDigest, actionRepository, actionRef }, _exec = node_child_process.execFileSync) {
  const repository = `ghcr.io/${actionRepository}`.toLowerCase();
  if (imageDigest) {
    // Use the verified manifest list digest to guarantee the same bytes as verified.
    // This eliminates any TOCTOU window between cosign verify and docker pull.
    return `${repository}@${imageDigest}`;
  }
  const tag = resolveImageTag(repository, { actionRef }, _exec);
  return `${repository}:${tag}`;
}

/**
 * Determine the Docker image tag from the action ref.
 * Throws if the ref cannot be resolved to an existing image tag.
 *
 * Used only when no verified digest is available (e.g. branch/local references).
 *
 * @param {string} repository
 * @param {{ actionRef: string|undefined }} opts
 * @param {function} [_exec] - Override for execFileSync (used in tests)
 */
function resolveImageTag(repository, { actionRef }, _exec = node_child_process.execFileSync) {
  if (actionRef) {
    // Full SHA (40 hex chars) → prefix with "sha-" to match image tag convention
    const tag = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}`
      : actionRef.startsWith("v") ? actionRef.slice(1)
      : actionRef;
    try {
      _exec("docker", ["manifest", "inspect", `${repository}:${tag}`], {
        stdio: "pipe",
      });
      return tag;
    } catch {
      // Image with this tag doesn't exist; fall through
    }
  }

  // No fallback: branch refs and local ./setup references land here.
  // These are intentionally unsupported outside of development use.
  // Pin the action to a version tag or commit SHA for production use.
  throw new Error(
    `Cannot resolve Docker image tag for action ref: ${JSON.stringify(actionRef)}. ` +
    `Pin the action to a version tag (e.g. @v2.1.0) or commit SHA.`
  );
}

/**
 * Build ACL rules from input strings.
 * Rules are passed through as-is (wildcard format), validated by converting to regex.
 *
 * @returns {{ httpsRules: string[], httpRules: string[], ipRules: string[] }}
 */
function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
  const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  buildRules(httpsRulesInput);
  buildRules(httpRulesInput);
  buildRules(ipRulesInput);

  return { httpsRules, httpRules, ipRules };
}

function logRules(label, rules) {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

// Run main() only when executed directly as an entrypoint (not imported in tests)
if (process.argv[1] === node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('main.js', document.baseURI).href)))) {
  main();
}

exports.buildACLRules = buildACLRules;
exports.resolveBuildcageImageRef = resolveBuildcageImageRef;
exports.resolveImageTag = resolveImageTag;
