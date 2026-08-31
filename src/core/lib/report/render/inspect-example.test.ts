import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import {
  buildUrlRuleLines,
  pathPatternsFor,
  buildInspectRestrictExample,
} from "./inspect-example.ts";
import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

function req(method: string, url: string): TrafficEvent {
  const [, scheme, authority] = /^(https?):\/\/([^/?#]+)/.exec(url) ?? ["", "https", "h"];
  const colon = authority.lastIndexOf(":");
  return {
    time: 1,
    action: "allow",
    protocol: scheme as "https" | "http",
    host: colon > 0 ? authority.slice(0, colon) : authority,
    port: colon > 0 ? Number(authority.slice(colon + 1)) : scheme === "https" ? 443 : 80,
    method,
    url,
    status: 200,
    bytes: 1,
  };
}

/**
 * Does the generated rule set actually permit this request?
 *
 * Compiles the rules the same way the engine does, so a generated rule that
 * does not cover its own request fails here rather than in a build. A rule's
 * authorityRegex always names the port, so the request's is filled in from its
 * scheme before matching.
 */
function permits(lines: string[], method: string, url: string): boolean {
  const [, scheme, authority, path] = /^(https?):\/\/([^/?#]+)([^?#]*)/.exec(url)!;
  const hostPort = authority.includes(":")
    ? authority
    : `${authority}:${scheme === "https" ? "443" : "80"}`;
  return buildUrlRules(lines.join("\n")).some(
    (rule) =>
      rule.methods!.includes(method) &&
      new RegExp(rule.authorityRegex!).test(hostPort) &&
      new RegExp(rule.pathRegex!).test(path || "/"),
  );
}

// ---------------------------------------------------------------------------
// The generated rules must cover what happened and nothing more.
// ---------------------------------------------------------------------------
describe("what the rules permit", () => {
  it("permits every request it was built from", () => {
    const requests = [
      req("GET", "https://registry.npmjs.org/express"),
      req("GET", "https://registry.npmjs.org/express/-/express-4.18.2.tgz"),
      req("POST", "https://api.example.com/v1/write"),
      req("GET", "http://plain.example.com/a/b"),
    ];
    const lines = buildUrlRuleLines(requests);
    for (const r of requests) {
      expect(permits(lines, r.method!, r.url!)).toBe(true);
    }
  });

  it("does not let one method reach a path only another method reached", () => {
    // Grouping by host alone would merge these into GET|POST over /v1/**.
    const lines = buildUrlRuleLines([
      req("GET", "https://api.example.com/v1/read"),
      req("POST", "https://api.example.com/v1/write"),
    ]);
    expect(permits(lines, "POST", "https://api.example.com/v1/read")).toBe(false);
    expect(permits(lines, "GET", "https://api.example.com/v1/write")).toBe(false);
  });

  it("never invents a method that was not seen", () => {
    const lines = buildUrlRuleLines([req("GET", "https://a.example.com/x")]);
    expect(lines.join("\n").includes("*")).toBe(false);
    expect(permits(lines, "DELETE", "https://a.example.com/x")).toBe(false);
  });

  it("never generalises a host, since the resolver's scope follows the rules", () => {
    const lines = buildUrlRuleLines([
      req("GET", "https://a.example.com/x"),
      req("GET", "https://b.example.com/x"),
    ]);
    expect(lines.length).toBe(2);
    expect(permits(lines, "GET", "https://c.example.com/x")).toBe(false);
  });

  it("keeps a single observed path exact rather than widening it", () => {
    const lines = buildUrlRuleLines([req("GET", "https://a.example.com/v1/thing")]);
    expect(lines[0]).toBe("GET https://a.example.com/v1/thing");
    expect(permits(lines, "GET", "https://a.example.com/v1/other")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path patterns
// ---------------------------------------------------------------------------
describe("pathPatternsFor", () => {
  it("keeps the longest prefix that did not vary", () => {
    expect(pathPatternsFor(["/pkg/a/-/a-1.0.tgz", "/pkg/b/-/b-2.0.tgz"]).join()).toBe("/pkg/**");
  });

  it("also spells out a prefix that is itself an observed path", () => {
    // `/express/**` does not match `/express`, so a build that fetched both a
    // package's metadata and its tarball needs both.
    expect(pathPatternsFor(["/express", "/express/-/express-4.18.2.tgz"]).join()).toBe(
      "/express,/express/**",
    );
  });

  it("collapses to /** when nothing was shared, rather than clustering", () => {
    // Clustering would invent permissions nobody observed; listing every URL
    // would be unmaintainable. The rule still constrains the method.
    expect(pathPatternsFor(["/a/x", "/b/y"]).join()).toBe("/**");
  });

  it("covers the root, which /** already matches", () => {
    expect(pathPatternsFor(["/", "/a"]).join()).toBe("/**");
  });

  it("returns nothing for no paths", () => {
    expect(pathPatternsFor([]).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rule lines
// ---------------------------------------------------------------------------
describe("buildUrlRuleLines", () => {
  it("merges methods that ended up with the same pattern onto one line", () => {
    const lines = buildUrlRuleLines([
      req("GET", "https://a.example.com/pkg/x"),
      req("HEAD", "https://a.example.com/pkg/x"),
    ]);
    expect(lines.join()).toBe("GET|HEAD https://a.example.com/pkg/x");
  });

  it("orders methods the way a person would write them", () => {
    const lines = buildUrlRuleLines([
      req("POST", "https://a.example.com/x"),
      req("GET", "https://a.example.com/x"),
      req("DELETE", "https://a.example.com/x"),
    ]);
    expect(lines[0].startsWith("GET|POST|DELETE ")).toBe(true);
  });

  it("keeps a non-default port, which a rule has to name", () => {
    const lines = buildUrlRuleLines([req("GET", "https://a.example.com:9443/x")]);
    expect(lines[0]).toBe("GET https://a.example.com:9443/x");
  });

  it("drops a port the scheme already implies", () => {
    const lines = buildUrlRuleLines([
      req("GET", "https://a.example.com:443/x"),
      req("GET", "http://b.example.com:80/y"),
    ]);
    expect(lines.join("\n")).toBe("GET http://b.example.com/y\nGET https://a.example.com/x");
  });

  it("treats the two schemes as separate origins", () => {
    const lines = buildUrlRuleLines([
      req("GET", "https://a.example.com/x"),
      req("GET", "http://a.example.com/x"),
    ]);
    expect(lines.length).toBe(2);
  });

  it("drops the query string, which is as likely to hold a one-off token", () => {
    const lines = buildUrlRuleLines([req("GET", "https://a.example.com/x?token=SECRET")]);
    expect(lines[0]).toBe("GET https://a.example.com/x");
  });

  it("is stable, so the same traffic always renders the same rules", () => {
    const requests = [
      req("GET", "https://b.example.com/x"),
      req("POST", "https://a.example.com/y"),
      req("GET", "https://a.example.com/y"),
    ];
    expect(buildUrlRuleLines(requests).join("\n")).toBe(
      buildUrlRuleLines([...requests].reverse()).join("\n"),
    );
  });

  it("ignores an entry that is not an http(s) URL", () => {
    expect(buildUrlRuleLines([req("GET", "not a url")]).length).toBe(0);
  });

  it("builds nothing from a refusal, a passthrough or a name lookup", () => {
    // A refused request is not a rule to reproduce, and the other two have no
    // URL to write one from.
    const events: TrafficEvent[] = [
      { ...req("GET", "https://a.example.com/x"), action: "block", reason: "not-allowed" },
      { time: 1, action: "allow", protocol: "tls", host: "db.example.com", port: 5432, bytes: 1 },
      { time: 1, action: "allow", protocol: "dns", host: "a.example.com" },
    ];
    expect(buildUrlRuleLines(events).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe("buildInspectRestrictExample", () => {
  const requests = [req("GET", "https://a.example.com/pkg/x")];

  it("uses a literal block, since rules are separated by newlines", () => {
    // A folded block would join two rules into one unparseable line.
    const md = buildInspectRestrictExample(requests, "buildcage/docker", "v2");
    expect(md.includes("allowed_url_rules: |\n")).toBe(true);
    expect(md.includes("proxy_engine: inspect")).toBe(true);
  });

  it("renders a commit sha as-is, same as a tag", () => {
    const sha = "a".repeat(40);
    const md = buildInspectRestrictExample(requests, "buildcage/docker", sha);
    expect(md.includes(`@${sha}`)).toBe(true);
  });

  it("keeps a tag as written, since it is stable", () => {
    expect(buildInspectRestrictExample(requests, "buildcage/docker", "v2").includes("@v2")).toBe(
      true,
    );
  });

  it("says what the rules do not cover", () => {
    const md = buildInspectRestrictExample(requests, "buildcage/docker", "v2");
    expect(md.includes("allow_tls_rules")).toBe(true);
  });

  it("renders nothing when nothing was observed", () => {
    expect(buildInspectRestrictExample([], "buildcage/docker", "v2")).toBe("");
    expect(buildInspectRestrictExample(null, "buildcage/docker", "v2")).toBe("");
  });

  it("appends the version as a trailing comment when known", () => {
    const sha = "a".repeat(40);
    const md = buildInspectRestrictExample(requests, "buildcage/docker", sha, "3.1.4");
    expect(md.includes(`@${sha} # 3.1.4\n`)).toBe(true);
  });

  it("omits the comment when the version is not known", () => {
    const sha = "a".repeat(40);
    const md = buildInspectRestrictExample(requests, "buildcage/docker", sha);
    expect(md.includes(`@${sha}\n`)).toBe(true);
    expect(md.includes("#")).toBe(false);
  });
});

reportResults();
