import { describe, it, expect } from "vitest";
import { parseAllowedRequestsFromText } from "./proxy-request-text.ts";

describe("parseAllowedRequestsFromText", () => {
  it("parses a real 'proxy network requests:' block with a status code", () => {
    const text = ["proxy network requests:", "- GET https://allowed.example.com/ -> 200"].join(
      "\n",
    );
    expect(parseAllowedRequestsFromText(text)).toStrictEqual([
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
    ]);
  });

  it("parses a request line with no status code at all", () => {
    const text = ["proxy network requests:", "- GET https://allowed.example.com/"].join("\n");
    expect(parseAllowedRequestsFromText(text)).toStrictEqual([
      { method: "GET", url: "https://allowed.example.com/" },
    ]);
  });

  it("parses multiple entries under one block, stopping at the next unrelated line", () => {
    const text = [
      "proxy network requests:",
      "- GET https://allowed.example.com/ -> 200",
      "- GET https://sub.wildcard.example.com/ -> 200",
      'time="x" level=debug msg="Evaluated source policy" error="denied"',
    ].join("\n");
    expect(parseAllowedRequestsFromText(text)).toStrictEqual([
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
      { method: "GET", url: "https://sub.wildcard.example.com/", status: 200 },
    ]);
  });

  it("parses multiple separate blocks", () => {
    const text = [
      "proxy network requests:",
      "- GET https://allowed.example.com/ -> 200",
      'time="x" level=debug msg="> creating abc"',
      "proxy network requests:",
      "- GET http://allowed.example.com:8080/ -> 200",
    ].join("\n");
    expect(parseAllowedRequestsFromText(text).length).toBe(2);
  });

  it("does not misinterpret unrelated '- ' output as a request line outside a block", () => {
    const text = "- rw-r--r-- 1 root root 0 file.txt";
    expect(parseAllowedRequestsFromText(text)).toStrictEqual([]);
  });

  it("returns an empty array when no block is present", () => {
    expect(parseAllowedRequestsFromText('time="x" level=info msg="found worker"')).toStrictEqual(
      [],
    );
  });
});
