import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCommunicationDetails } from "./command-log.js";

function wrap(body) {
  return "\n<details>\n<summary>Communication details</summary>\n\n" + body + "</details>\n";
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
  command: "RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done",
  started: "2026-07-05T22:08:41.670Z",
  completed: "2026-07-05T22:08:41.751Z",
  entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }],
};

describe("renderCommunicationDetails", () => {
  it("empty arrays → empty string", () => {
    assert.equal(renderCommunicationDetails([], []), "");
  });

  it("null/undefined → empty string", () => {
    assert.equal(renderCommunicationDetails(null, null), "");
    assert.equal(renderCommunicationDetails(undefined, undefined), "");
  });

  it("a build containing only an all-empty vertex list is treated as no builds", () => {
    assert.equal(renderCommunicationDetails([[]], []), "");
  });

  it("a vertex with no entries renders '(no communication)'", () => {
    assert.equal(
      renderCommunicationDetails([[VERTEX_A]], []),
      wrap("**RUN echo no-network-here && mkdir -p /tmp/work**\n_started 22:08:41.527Z · duration 0.143s_\n(no communication)\n\n")
    );
  });

  it("a vertex with an allowed entry renders the request line", () => {
    assert.equal(
      renderCommunicationDetails([[VERTEX_B]], []),
      wrap(
        "**RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done**\n" +
          "_started 22:08:41.670Z · duration 0.081s_\n- GET https://allowed.example.com/ -> 200\n\n"
      )
    );
  });

  it("an entry with no status omits the arrow", () => {
    const vertex = { ...VERTEX_B, entries: [{ method: "GET", url: "https://allowed.example.com/" }] };
    assert.match(renderCommunicationDetails([[vertex]], []), /- GET https:\/\/allowed\.example\.com\/\n/);
  });

  it("renders multiple vertices within one build as separate blocks, no build heading", () => {
    const md = renderCommunicationDetails([[VERTEX_A, VERTEX_B]], []);
    assert.equal(md.includes("### Build"), false);
    assert.equal(
      md,
      wrap(
        "**RUN echo no-network-here && mkdir -p /tmp/work**\n_started 22:08:41.527Z · duration 0.143s_\n(no communication)\n\n" +
          "**RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done**\n" +
          "_started 22:08:41.670Z · duration 0.081s_\n- GET https://allowed.example.com/ -> 200\n\n"
      )
    );
  });

  it("adds a '### Build N' heading per build only when there is more than one build", () => {
    const md = renderCommunicationDetails([[VERTEX_A], [VERTEX_B]], []);
    assert.equal(md.includes("### Build 1\n\n**RUN echo no-network-here"), true);
    assert.equal(md.includes("### Build 2\n\n**RUN echo step-A"), true);
  });

  it("skips empty builds when deciding whether to show build headings (only 1 non-empty build)", () => {
    const md = renderCommunicationDetails([[], [VERTEX_A], []], []);
    assert.equal(md.includes("### Build"), false);
  });

  it("renders the DENIED section with whole-second timestamps, no vertex attribution", () => {
    const deniedTimeline = [{ url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" }];
    assert.equal(
      renderCommunicationDetails([], deniedTimeline),
      wrap("**DENIED**\n- 22:08:41Z https://blocked.example.com/\n\n")
    );
  });

  it("renders multiple DENIED entries in the order given", () => {
    const deniedTimeline = [
      { url: "https://blocked.example.com/a", timestamp: "2026-07-05T22:08:41Z" },
      { url: "https://blocked.example.com/b", timestamp: "2026-07-05T22:08:42Z" },
    ];
    assert.equal(
      renderCommunicationDetails([], deniedTimeline),
      wrap("**DENIED**\n- 22:08:41Z https://blocked.example.com/a\n- 22:08:42Z https://blocked.example.com/b\n\n")
    );
  });

  it("renders both the vertex breakdown and the DENIED list together", () => {
    const deniedTimeline = [{ url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" }];
    assert.equal(
      renderCommunicationDetails([[VERTEX_B]], deniedTimeline),
      wrap(
        "**RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done**\n" +
          "_started 22:08:41.670Z · duration 0.081s_\n- GET https://allowed.example.com/ -> 200\n\n" +
          "**DENIED**\n- 22:08:41Z https://blocked.example.com/\n\n"
      )
    );
  });

  it("renders only the DENIED list when builds is empty but deniedTimeline is not", () => {
    const deniedTimeline = [{ url: "https://blocked.example.com/", timestamp: "2026-07-05T22:08:41Z" }];
    assert.equal(renderCommunicationDetails([], deniedTimeline), wrap("**DENIED**\n- 22:08:41Z https://blocked.example.com/\n\n"));
  });

  it("renders only the vertex breakdown when deniedTimeline is empty but builds is not", () => {
    assert.equal(
      renderCommunicationDetails([[VERTEX_B]], []),
      wrap(
        "**RUN echo step-A && wget -q -O /dev/null --timeout=5 https://allowed.example.com/ && echo A-done**\n" +
          "_started 22:08:41.670Z · duration 0.081s_\n- GET https://allowed.example.com/ -> 200\n\n"
      )
    );
  });

  describe("markdown escaping", () => {
    it("escapes '[' ']' in a command, including a '[N/M]' step-counter prefix, so it can't be misread as link syntax", () => {
      const vertex = { ...VERTEX_A, command: '[2/2] RUN echo "=== [HTTPS - allowed] ==="', entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      assert.match(md, /\*\*\\\[2\/2\\\] RUN echo "=== \\\[HTTPS - allowed\\\] ==="\*\*/);
    });

    it("escapes '*' and '_' in a command so they can't break out of the bold header", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo *hi* && echo _bye_", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      assert.match(md, /\*\*RUN echo \\\*hi\\\* && echo \\_bye\\_\*\*/);
    });

    it("escapes backticks and backslashes in a command", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo `whoami` && echo C:\\\\path", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      assert.match(md, /echo \\`whoami\\` && echo C:\\\\\\\\path/);
    });

    it("escapes special characters in an allowed request's URL", () => {
      const vertex = { ...VERTEX_A, entries: [{ method: "GET", url: "https://allowed.example.com/[id]", status: 200 }] };
      const md = renderCommunicationDetails([[vertex]], []);
      assert.match(md, /- GET https:\/\/allowed\.example\.com\/\\\[id\\\] -> 200/);
    });

    it("escapes special characters in a denied URL", () => {
      const deniedTimeline = [{ url: "https://blocked.example.com/[id]", timestamp: "2026-07-05T22:08:41Z" }];
      const md = renderCommunicationDetails([], deniedTimeline);
      assert.match(md, /- 22:08:41Z https:\/\/blocked\.example\.com\/\\\[id\\\]/);
    });

    it("does not escape '.' or '-', which are common and harmless in URLs/commands", () => {
      const vertex = { ...VERTEX_A, command: "RUN echo hello-world.txt", entries: [] };
      const md = renderCommunicationDetails([[vertex]], []);
      assert.match(md, /\*\*RUN echo hello-world\.txt\*\*/);
    });
  });
});
