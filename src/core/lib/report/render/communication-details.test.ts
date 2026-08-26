import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import {
  renderCommunicationDetails,
  renderCommunicationDetailsBody,
} from "./communication-details.ts";

function wrap(body: string) {
  return "\n<details>\n<summary>💬 Communication details</summary>\n\n" + body + "</details>\n";
}

// No brackets in these two fixtures on purpose, so the non-escaping tests
// below don't need to reason about escaped output — bracket/asterisk/etc.
// escaping is covered separately in the "markdown escaping" tests.
const VERTEX_A = {
  command: "RUN echo no-network-here && mkdir -p /tmp/work",
  started: "2026-07-05T22:08:41.527Z",
  completed: "2026-07-05T22:08:41.670Z",
  entries: [],
};

const VERTEX_B = {
  command:
    "RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done",
  started: "2026-07-05T22:08:41.670Z",
  completed: "2026-07-05T22:08:41.751Z",
  entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }],
};

const ALLOWED_A =
  "* **✅ Allowed Urls**\n\n" +
  "   * RUN echo no-network-here && mkdir -p /tmp/work\n\n" +
  "      (22:08:41Z · duration 0.143s)\n\n" +
  "      ```\n" +
  "      (no communication)\n" +
  "      ```\n\n";

const ALLOWED_B =
  "* **✅ Allowed Urls**\n\n" +
  "   * RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done\n\n" +
  "      (22:08:41Z · duration 0.081s)\n\n" +
  "      ```\n" +
  "      - GET https://allowed.example.com/ -> 200\n" +
  "      ```\n\n";

describe("renderCommunicationDetails", () => {
  it("empty arrays → empty string", () => {
    expect(renderCommunicationDetails([], [])).toBe("");
  });

  it("null/undefined → empty string", () => {
    expect(renderCommunicationDetails(null, null)).toBe("");
    expect(renderCommunicationDetails(undefined, undefined)).toBe("");
  });

  it("a build containing only an all-empty vertex list is treated as no builds", () => {
    expect(renderCommunicationDetails([[]], [])).toBe("");
  });

  it("a vertex with no entries renders '(no communication)'", () => {
    expect(renderCommunicationDetails([[VERTEX_A]], [])).toBe(wrap(ALLOWED_A));
  });

  it("a vertex with an allowed entry renders the request line in a code block", () => {
    expect(renderCommunicationDetails([[VERTEX_B]], [])).toBe(wrap(ALLOWED_B));
  });

  it("an entry with no status omits the arrow", () => {
    const vertex = {
      ...VERTEX_B,
      entries: [{ method: "GET", url: "https://allowed.example.com/" }],
    };
    expect(renderCommunicationDetails([[vertex]], [])).toMatch(
      /- GET https:\/\/allowed\.example\.com\/\n/,
    );
  });

  it("renders multiple vertices within one build under one 'Allowed Urls' item, no build item", () => {
    const md = renderCommunicationDetails([[VERTEX_A, VERTEX_B]], []);
    expect(md.includes("Build")).toBe(false);
    expect(md).toBe(
      wrap(
        "* **✅ Allowed Urls**\n\n" +
          "   * RUN echo no-network-here && mkdir -p /tmp/work\n\n" +
          "      (22:08:41Z · duration 0.143s)\n\n" +
          "      ```\n" +
          "      (no communication)\n" +
          "      ```\n\n" +
          "   * RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done\n\n" +
          "      (22:08:41Z · duration 0.081s)\n\n" +
          "      ```\n" +
          "      - GET https://allowed.example.com/ -> 200\n" +
          "      ```\n\n",
      ),
    );
  });

  it("adds a 'Build N' item per build, one level deeper, only when there is more than one build", () => {
    const md = renderCommunicationDetails([[VERTEX_A], [VERTEX_B]], []);
    expect(md.includes("   * Build 1\n\n      * RUN echo no-network-here")).toBe(true);
    expect(md.includes("   * Build 2\n\n      * RUN echo step-A")).toBe(true);
  });

  it("skips empty builds when deciding whether to show build items (only 1 non-empty build)", () => {
    const md = renderCommunicationDetails([[], [VERTEX_A], []], []);
    expect(md.includes("Build")).toBe(false);
  });

  it("renders the Blocked Urls section with whole-second timestamps, no vertex attribution", () => {
    const deniedTimeline = [
      { url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" },
    ];
    expect(renderCommunicationDetails([], deniedTimeline)).toBe(
      wrap("* **🚫 Blocked Urls**\n\n   - (22:08:41Z) https://blocked.example.com/\n\n"),
    );
  });

  it("renders multiple Blocked Urls entries in the order given", () => {
    const deniedTimeline = [
      { url: "https://blocked.example.com/a", timestamp: "2026-07-05T22:08:41Z" },
      { url: "https://blocked.example.com/b", timestamp: "2026-07-05T22:08:42Z" },
    ];
    expect(renderCommunicationDetails([], deniedTimeline)).toBe(
      wrap(
        "* **🚫 Blocked Urls**\n\n   - (22:08:41Z) https://blocked.example.com/a\n   - (22:08:42Z) https://blocked.example.com/b\n\n",
      ),
    );
  });

  it("renders Allowed Urls before Blocked Urls", () => {
    const deniedTimeline = [
      { url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" },
    ];
    expect(renderCommunicationDetails([[VERTEX_B]], deniedTimeline)).toBe(
      wrap(
        ALLOWED_B + "* **🚫 Blocked Urls**\n\n   - (22:08:41Z) https://blocked.example.com/\n\n",
      ),
    );
  });

  it("renders only Blocked Urls when builds is empty but deniedTimeline is not", () => {
    const deniedTimeline = [
      { url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" },
    ];
    expect(renderCommunicationDetails([], deniedTimeline)).toBe(
      wrap("* **🚫 Blocked Urls**\n\n   - (22:08:41Z) https://blocked.example.com/\n\n"),
    );
  });

  it("renders only Allowed Urls when deniedTimeline is empty but builds is not", () => {
    expect(renderCommunicationDetails([[VERTEX_B]], [])).toBe(wrap(ALLOWED_B));
  });

  describe("markdown escaping", () => {
    it("escapes '[' ']' in a command, including a '[N/M]' step-counter prefix, so it can't be misread as link syntax", () => {
      const vertex = {
        ...VERTEX_A,
        command: '[2/2] RUN echo "=== [HTTPS - allowed] ==="',
        entries: [],
      };
      const md = renderCommunicationDetails([[vertex]], []);
      expect(md).toMatch(/\* \\\[2\/2\\\] RUN echo "=== \\\[HTTPS - allowed\\\] ==="\n/);
    });

    it("escapes '*' and '_' in a command so they can't be misread as emphasis", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo *hi* && echo _bye_", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      expect(md).toMatch(/\* RUN echo \\\*hi\\\* && echo \\_bye\\_\n/);
    });

    it("escapes backticks and backslashes in a command", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo `whoami` && echo C:\\\\path", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      expect(md).toMatch(/echo \\`whoami\\` && echo C:\\\\\\\\path/);
    });

    it("escapes special characters in an allowed request's URL inside the code block", () => {
      const vertex = {
        ...VERTEX_A,
        entries: [{ method: "GET", url: "https://allowed.example.com/[id]", status: 200 }],
      };
      const md = renderCommunicationDetails([[vertex]], []);
      expect(md).toMatch(/- GET https:\/\/allowed\.example\.com\/\\\[id\\\] -> 200/);
    });

    it("escapes special characters in a denied URL", () => {
      const deniedTimeline = [
        { url: "https://blocked.example.com/[id]", timestamp: "2026-07-05T22:08:41Z" },
      ];
      const md = renderCommunicationDetails([], deniedTimeline);
      expect(md).toMatch(/- \(22:08:41Z\) https:\/\/blocked\.example\.com\/\\\[id\\\]/);
    });

    it("does not escape '.' or '-', which are common and harmless in URLs/commands", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo hello-world.txt", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      expect(md).toMatch(/\* RUN echo hello-world\.txt\n/);
    });
  });
});

// ---------------------------------------------------------------------------
// wrapLogGroup skips emitting a ::group:: at all when handed "" -- the
// property that actually matters here, not the tag shape of a non-empty one.
// ---------------------------------------------------------------------------
describe("renderCommunicationDetailsBody", () => {
  it("renders nothing at all when there is nothing to show", () => {
    expect(renderCommunicationDetailsBody([], [])).toBe("");
    expect(renderCommunicationDetailsBody(null, null)).toBe("");
  });
});

reportResults();
