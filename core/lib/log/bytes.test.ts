import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { bytesToUtf8, base64ToBytes, base64ToUtf8 } from "./bytes.ts";

describe("bytesToUtf8", () => {
  it("decodes plain ASCII", () => {
    assert.equal(bytesToUtf8([104, 105]), "hi");
  });

  it("decodes a 2-byte UTF-8 sequence (e.g. é)", () => {
    assert.equal(bytesToUtf8([0xc3, 0xa9]), "é");
  });

  it("decodes a 3-byte UTF-8 sequence (e.g. €)", () => {
    assert.equal(bytesToUtf8([0xe2, 0x82, 0xac]), "€");
  });

  it("decodes a 4-byte UTF-8 sequence (e.g. an emoji)", () => {
    assert.equal(bytesToUtf8([0xf0, 0x9f, 0x9a, 0x80]), "🚀");
  });
});

describe("base64ToBytes / base64ToUtf8", () => {
  it("round-trips plain ASCII", () => {
    // "hello world" base64-encoded
    assert.equal(base64ToUtf8("aGVsbG8gd29ybGQ="), "hello world");
  });

  it("round-trips text containing multi-byte UTF-8", () => {
    // "café 🚀" base64-encoded
    assert.equal(base64ToUtf8("Y2Fmw6kg8J+agA=="), "café 🚀");
  });

  it("decodes without padding too", () => {
    assert.deepEqual(base64ToBytes("aGk"), [104, 105]);
  });
});

reportResults();
