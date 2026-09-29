import { describe, it, expect } from "vitest";

import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import { scanInspectLog } from "#core/lib/log/inspect.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import {
  buildUrlRuleLines,
  pathPatternsFor,
  buildInspectRestrictExample,
} from "./inspect-example.ts";

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
 * does not cover its own request fails here rather than in a build or step. A rule's
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
// The method, the Host header and the path are the build's or step's to choose, so none
// of them may reach a rule as a pattern.
// ---------------------------------------------------------------------------
describe("what the build or step can write into a rule", () => {
  const legit = req("GET", "https://registry.npmjs.org/express");

  it("writes no rule from a request that names a wildcard", () => {
    const lines = buildUrlRuleLines([
      legit,
      req("*", "https://github.com/**"),
      req("PUT", "https://*.s3.amazonaws.com/**"),
      req("GET", "https://**.example.com/x"),
      req("GET", "https://registry.npmjs.org/**"),
    ]);
    expect(lines).toStrictEqual(["GET https://registry.npmjs.org/express"]);
    expect(permits(lines, "POST", "https://github.com/x")).toBe(false);
  });

  it("leaves out a method that is not a bare uppercase token", () => {
    // `|` is a tchar, and a rule would read `PUT|DELETE` as two methods.
    for (const method of ["PUT|DELETE", "get", "M-SEARCH"]) {
      expect(buildUrlRuleLines([req(method, "https://a.example.com/x")])).toStrictEqual([]);
    }
  });

  it("leaves out a host with a character a rule reads as a pattern, or an empty label", () => {
    for (const host of ["gith?b.com", "a..example.com", "example.com.", "~example.com"]) {
      expect(buildUrlRuleLines([req("GET", `https://${host}/x`)])).toStrictEqual([]);
    }
  });

  it("keeps a host with an underscore, which no rule reads as a pattern", () => {
    expect(buildUrlRuleLines([req("GET", "https://a_b.example.com/x")])).toStrictEqual([
      "GET https://a_b.example.com/x",
    ]);
  });

  it("writes one rule for a host whose Host header was spelled several ways", async () => {
    const line = (host: string, path: string) =>
      `buildcage 1 https GET 200 1 ts=-- reason=- tlserr=- dst=1.1.1.1:443 host=${host} ${path}`;
    const { events } = await scanInspectLog(
      [line("ok.com.", "/a/1"), line("OK.COM", "/a/2"), line("ok.com", "/a/3")],
      true,
    );
    expect(buildUrlRuleLines(events)).toStrictEqual(["GET https://ok.com/a/**"]);
  });

  it("takes the port the request was sent to, not the one in its Host header", () => {
    const sentTo443 = { ...req("GET", "https://a.example.com:*/x"), port: 443 };
    expect(buildUrlRuleLines([sentTo443])).toStrictEqual(["GET https://a.example.com/x"]);
    const sentTo9443 = { ...req("GET", "https://a.example.com/x"), port: 9443 };
    expect(buildUrlRuleLines([sentTo9443])).toStrictEqual(["GET https://a.example.com:9443/x"]);
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
    expect(pathPatternsFor(["/express", "/express/-/express-4.18.2.tgz"]).join()).toBe(
      "/express,/express/**",
    );
  });

  it("collapses to /** when nothing was shared, rather than clustering", () => {
    // The alternative to /** is listing every URL, which is unmaintainable.
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

  it("orders methods with the common verbs first, then anything else alphabetically", () => {
    const methodsOf = (...methods: string[]) =>
      buildUrlRuleLines(methods.map((m) => req(m, "https://a.example.com/x")))[0].split(" ")[0];
    expect(methodsOf("POST", "GET", "DELETE")).toBe("GET|POST|DELETE");
    expect(methodsOf("PROPFIND", "GET", "MKCOL")).toBe("GET|MKCOL|PROPFIND");
    expect(methodsOf("PROPFIND", "MKCOL")).toBe("MKCOL|PROPFIND");
    // Two unknown methods only ever get compared one way round, so a third is
    // what exercises the other arm.
    expect(methodsOf("ZZZ", "MKCOL", "PROPFIND")).toBe("MKCOL|PROPFIND|ZZZ");
  });

  it("orders lines by origin, and by pattern within one origin", () => {
    const origins = buildUrlRuleLines([
      req("GET", "https://c.example.com/x"),
      req("GET", "https://a.example.com/x"),
      req("GET", "https://b.example.com/x"),
    ]);
    expect(origins.map((l) => l.split(" ")[1])).toStrictEqual([
      "https://a.example.com/x",
      "https://b.example.com/x",
      "https://c.example.com/x",
    ]);
    const patterns = buildUrlRuleLines([
      req("GET", "https://a.example.com/zzz"),
      req("POST", "https://a.example.com/aaa"),
    ]);
    expect(patterns.map((l) => l.split(" ")[1])).toStrictEqual([
      "https://a.example.com/aaa",
      "https://a.example.com/zzz",
    ]);
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

  it("drops the query string, which is as likely to hold a one-off token as anything", () => {
    const lines = buildUrlRuleLines([req("GET", "https://a.example.com/x?token=SECRET")]);
    expect(lines[0]).toBe("GET https://a.example.com/x");
  });

  it("reads a request with no path at all as the root", () => {
    const [line] = buildUrlRuleLines([req("GET", "https://a.example.com")]);
    expect(line).toBe("GET https://a.example.com/");
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

  it("proposes nothing for a request whose target was no path", () => {
    // `OPTIONS *` is logged with no URL (see log/inspect.ts's urlOf), and no
    // allowed_url_rules line can match it: every path matcher wants a leading
    // slash. A rule built from the host alone would be one that does nothing.
    const asterisk: TrafficEvent = {
      time: 1,
      action: "audit",
      protocol: "https",
      host: "registry.npmjs.org",
      port: 443,
      method: "OPTIONS",
    };
    expect(buildUrlRuleLines([asterisk]).length).toBe(0);
  });

  it("builds nothing from a refusal, a passthrough or a name lookup", () => {
    const events: TrafficEvent[] = [
      { ...req("GET", "https://a.example.com/x"), action: "block", reason: "not-allowed" },
      { time: 1, action: "allow", protocol: "tls", host: "db.example.com", port: 5432, bytes: 1 },
      { time: 1, action: "allow", protocol: "dns", host: "a.example.com" },
    ];
    expect(buildUrlRuleLines(events).length).toBe(0);
  });

  it("builds a rule from a request the origin failed to answer", () => {
    const failed: TrafficEvent = {
      ...req("GET", "https://a.example.com/x"),
      action: "failed",
      reason: "origin-no-response",
    };
    expect(buildUrlRuleLines([failed])).toStrictEqual(["GET https://a.example.com/x"]);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe("buildInspectRestrictExample", () => {
  const requests = [req("GET", "https://a.example.com/pkg/x")];

  it("uses a literal block, since rules are separated by newlines", () => {
    const md = buildInspectRestrictExample(requests, "owner/repo", "v2");
    expect(md.includes("allowed_url_rules: |\n")).toBe(true);
    expect(md.includes("proxy_engine")).toBe(false);
  });

  it("renders nothing when nothing was observed and no tls/ip rules were configured", () => {
    expect(buildInspectRestrictExample([], "owner/repo", "v2")).toBe("");
    expect(buildInspectRestrictExample(null, "owner/repo", "v2")).toBe("");
  });

  it("echoes allowed_tls_rules and allowed_ip_rules as configured, not derived from traffic", () => {
    const md = buildInspectRestrictExample(requests, "owner/repo", "v2", {
      allowedIpRules: ["10.0.0.5:5432"],
    });
    expect(/allowed_ip_rules: \|\n\s+10\.0\.0\.5:5432\n/.test(md)).toBe(true);

    const md2 = buildInspectRestrictExample(requests, "owner/repo", "v2", {
      allowedTlsRules: ["db.internal.example.com:8443"],
    });
    expect(/allowed_tls_rules: \|\n\s+db\.internal\.example\.com:8443\n/.test(md2)).toBe(true);
  });

  it("lists what it left out under the snippet, escaped and without the query", () => {
    const md = buildInspectRestrictExample(
      [
        ...requests,
        req("*", "https://github.com/**"),
        req("*", "https://github.com/**"),
        req("PUT", "https://*.s3.amazonaws.com/**?token=SECRET"),
      ],
      "owner/repo",
      "v2",
    );
    const [snippet, rest] = md.split("```\n\n");
    expect(snippet.includes("*")).toBe(false);
    expect(rest).toContain("| \\* | https://github.com/\\*\\* | method |");
    expect(rest).toContain("| PUT | https://\\*.s3.amazonaws.com/\\*\\* | host |");
    expect(rest.match(/github\.com/g)).toHaveLength(1);
    expect(rest.includes("SECRET")).toBe(false);
  });

  it("caps the list, pointing at Communication details for the rest", () => {
    const many = Array.from({ length: 25 }, (_, i) => req("GET", `https://a.example.com/${i}/*`));
    const md = buildInspectRestrictExample(many, "owner/repo", "v2");
    expect(md.match(/\| GET \| /g)).toHaveLength(20);
    expect(md).toContain("…and 5 more, listed in Communication details.");
    expect(md.includes("allowed_url_rules")).toBe(false);
  });

  it("still renders a section for tls/ip rules alone, with no observed traffic", () => {
    const md = buildInspectRestrictExample([], "owner/repo", "v2", {
      allowedIpRules: ["10.0.0.5:5432"],
      allowedTlsRules: ["db.internal.example.com:8443"],
    });
    expect(md.includes("allowed_url_rules")).toBe(false);
    expect(/allowed_ip_rules: \|\n\s+10\.0\.0\.5:5432\n/.test(md)).toBe(true);
    expect(/allowed_tls_rules: \|\n\s+db\.internal\.example\.com:8443\n/.test(md)).toBe(true);
  });

  it("includes a run: block when a runCommand is given, same as build-example.ts", () => {
    const md = buildInspectRestrictExample(requests, "owner/repo", "v2", {
      runCommand: "npm install",
    });
    expect(md.includes("          run: |\n            npm install\n")).toBe(true);
  });

  it("omits the run: block when no runCommand is given", () => {
    const md = buildInspectRestrictExample(requests, "owner/repo", "v2");
    expect(md.includes("run: |")).toBe(false);
  });
});
