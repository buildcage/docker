/**
 * Convert an action ref into the base Docker image tag, then append the
 * proxy engine suffix for non-default engines. The `transparent` engine
 * (default) publishes the plain version tag (e.g. `2.1.0`), matching the
 * pre-multi-engine tagging scheme; `explicit` (experimental) and `proxy`
 * (the buildkitd-less network-isolation proxy used by the run action)
 * each publish under their own suffix (e.g. `2.1.0-explicit`,
 * `2.1.0-proxy`). All three share the same Sigstore verification identity
 * (same workflow, same git ref) — only the published Docker tag differs, so
 * this does not affect verify-policy.ts's buildVerifyOptions.
 */
export function imageTagFromRef(
  actionRef: string | undefined,
  proxyEngine: string = "transparent",
): string {
  if (!actionRef) return "";
  let base;
  if (/^[0-9a-f]{40}$/i.test(actionRef)) {
    base = `sha-${actionRef.toLowerCase()}`;
  } else if (actionRef.startsWith("v")) {
    base = actionRef.slice(1);
  } else {
    base = actionRef;
  }
  if (proxyEngine === "explicit" || proxyEngine === "proxy") return `${base}-${proxyEngine}`;
  return base;
}
