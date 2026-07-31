import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { scanEcaptureLog } from "./ecapture-log-parser.ts";

function block(pid: number, tid: number, fd: number, direction: "WRITE" | "READ", lines: string[]): string[] {
  return [
    `2026-07-30T20:33:40Z INF [2026-07-30 20:33:40.359] PID:${pid} TID:${tid} Comm:curl FD:${fd} ${direction} (0 bytes):`,
    ...lines,
    " probe=OpenSSL",
  ];
}

// ---------------------------------------------------------------------------
// scanEcaptureLog
// ---------------------------------------------------------------------------
describe("scanEcaptureLog", () => {
  it("pairs a WRITE request with its following READ response", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["GET / HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 200 OK\\r", "Content-Type: text/html\\r", "\\r"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.equal(result[0].method, "GET");
    assert.equal(result[0].url, "https://example.com/");
    assert.equal(result[0].status, 200);
  });

  it("keeps method/host/path/status only — headers and body never surface", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["POST /login HTTP/1.1\\r", "Host: example.com\\r", "Authorization: Bearer secret-token\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 200 OK\\r", "\\r", "{\"token\":\"leaked-if-kept\"}"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.deepEqual(Object.keys(result[0]).sort(), ["method", "status", "url"]);
    assert.equal(JSON.stringify(result[0]).includes("secret-token"), false);
    assert.equal(JSON.stringify(result[0]).includes("leaked-if-kept"), false);
  });

  it("separates two sequential keep-alive requests on the same connection", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["GET /a HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 200 OK\\r", "\\r"]),
      ...block(100, 100, 4, "WRITE", ["GET /b HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 404 Not Found\\r", "\\r"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 2);
    assert.equal(result[0].url, "https://example.com/a");
    assert.equal(result[0].status, 200);
    assert.equal(result[1].url, "https://example.com/b");
    assert.equal(result[1].status, 404);
  });

  it("emits a WRITE with no matching READ, with status left undefined", async () => {
    const lines = block(100, 100, 4, "WRITE", ["GET / HTTP/1.1\\r", "Host: example.com\\r", "\\r"]);
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, undefined);
  });

  it("ignores an HTTP/2 (HPACK-compressed) WRITE block instead of misparsing it", async () => {
    const lines = block(100, 100, 4, "WRITE", ["PRI * HTTP/2.0\\r", "\\r", "SM\\r", "\\r", "\\x00\\x00\\x12\\x04\\x00\\x00garbage"]);
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 0);
  });

  it("ignores a WRITE block with a request line but no Host header", async () => {
    const lines = block(100, 100, 4, "WRITE", ["GET / HTTP/1.1\\r", "User-Agent: curl\\r", "\\r"]);
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 0);
  });

  it("does not cross-match requests/responses from different PID/TID/FD", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["GET /a HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(200, 200, 4, "READ", ["HTTP/1.1 200 OK\\r", "\\r"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, undefined);
  });

  it("strips ANSI escape codes before matching", async () => {
    const lines = [
      "\x1b[90m2026-07-30T20:33:40Z\x1b[0m \x1b[32mINF\x1b[0m PID:100 TID:100 Comm:curl FD:4 WRITE (0 bytes):",
      "GET / HTTP/1.1\\r",
      "Host: example.com\\r",
      "\\r",
      " \x1b[36mprobe=\x1b[0mOpenSSL",
      "PID:100 TID:100 Comm:curl FD:4 READ (0 bytes):",
      "HTTP/1.1 200 OK\\r",
      "\\r",
      " probe=OpenSSL",
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 200);
  });

  it("flushes an earlier unresolved WRITE as unmatched when a second WRITE supersedes it (pipelining)", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["GET /a HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "WRITE", ["GET /b HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 200 OK\\r", "\\r"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 2);
    assert.equal(result[0].url, "https://example.com/a");
    assert.equal(result[0].status, undefined);
    assert.equal(result[1].url, "https://example.com/b");
    assert.equal(result[1].status, 200);
  });

  it("does not resolve the pending request on a 100 Continue, waiting for the real status instead", async () => {
    const lines = [
      ...block(100, 100, 4, "WRITE", ["PUT /upload HTTP/1.1\\r", "Host: example.com\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 100 Continue\\r", "\\r"]),
      ...block(100, 100, 4, "READ", ["HTTP/1.1 200 OK\\r", "\\r"]),
    ];
    const result = await scanEcaptureLog(lines);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://example.com/upload");
    assert.equal(result[0].status, 200);
  });

  it("ignores non-matching lines outside any block", async () => {
    const result = await scanEcaptureLog(["some unrelated log line", ""]);
    assert.equal(result.length, 0);
  });
});

reportResults();
