import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { CREDENTIAL_PARAMS, redactCredentialQuery } from "./credential-query.ts";

describe("redactCredentialQuery", () => {
  it.each([
    // Which object was fetched and when the link expires are the whole point;
    // the signature is the only part that grants anything.
    [
      "replaces a presigned URL's signature and leaves the rest readable",
      "https://h/x.tar.gz?X-Amz-Signature=abc123&X-Amz-Expires=3600",
      "https://h/x.tar.gz?X-Amz-Signature=***&X-Amz-Expires=3600",
    ],
    [
      "matches the name whatever its case",
      "https://h/v1?Api_Key=sk_live_1",
      "https://h/v1?Api_Key=***",
    ],
    [
      "redacts the token names a bearer scheme spells out",
      "https://h/v1?api_token=t&auth_token=t&session_token=t&jwt=t",
      "https://h/v1?api_token=***&auth_token=***&session_token=***&jwt=***",
    ],
    [
      "redacts the short names a password or an access key goes by",
      "https://h/v1?PRIVATE-TOKEN=t&access_key=k&passwd=p&pwd=p",
      "https://h/v1?PRIVATE-TOKEN=***&access_key=***&passwd=***&pwd=***",
    ],
    [
      "matches a name split by dots or sent as an array",
      "https://h/v1?api.key=a&token[]=b&token[0]=c&Token[a][b]=d",
      "https://h/v1?api.key=***&token[]=***&token[0]=***&Token[a][b]=***",
    ],
    [
      "matches a name ending in a bracket that closes nothing as it is",
      "https://h/v1?token]=a",
      "https://h/v1?token]=a",
    ],
    [
      "ignores what an array name's brackets hold",
      "https://h/v1?user[password]=a",
      "https://h/v1?user[password]=a",
    ],
    [
      "matches a dash-joined name, keeping the spelling sent",
      "https://h/v1?subscription-key=a&api-key=b&client-secret=c&X-Api-Key=d&subscription_key=e",
      "https://h/v1?subscription-key=***&api-key=***&client-secret=***&X-Api-Key=***&subscription_key=***",
    ],
    [
      "matches a camel-cased name",
      "https://h/v1?accessToken=a&apiToken=b&clientSecret=c&authToken=d&refreshToken=e&idToken=f&sessionToken=g",
      "https://h/v1?accessToken=***&apiToken=***&clientSecret=***&authToken=***&refreshToken=***&idToken=***&sessionToken=***",
    ],
    [
      "redacts the names a session or a personal access token goes by",
      "https://h/v1?Authorization=a&session=b&pat=c",
      "https://h/v1?Authorization=***&session=***&pat=***",
    ],
    [
      "redacts a credential or credentials parameter",
      "https://h/v1?credential=a&Credentials=b",
      "https://h/v1?credential=***&Credentials=***",
    ],
    [
      "splits parameters at `;` too, keeping the separator sent",
      "https://h/v1?a=1;token=t&b=2",
      "https://h/v1?a=1;token=***&b=2",
    ],
    [
      "hides a credential's value up to the next `&`, a `;` and a `?` included",
      "https://h/v1?password=p;ss?w&x=1",
      "https://h/v1?password=***&x=1",
    ],
    [
      "hides a credential's value that starts with a `;`",
      "https://h/v1?token=;s&x=1",
      "https://h/v1?token=***&x=1",
    ],
    [
      "reads the query of a URL carried in a value",
      "https://h/login?next=/cb?token=t&page=2",
      "https://h/login?next=/cb?token=***&page=2",
    ],
    [
      "does not match a name that only contains one it knows",
      "https://h/v1?tokenizer=x&keys=y",
      "https://h/v1?tokenizer=x&keys=y",
    ],
    // A blocked request has to keep saying what it tried to send, and an
    // exfiltration payload is named whatever its author chose.
    [
      "leaves a parameter nobody credentialed alone",
      "https://h/?d=BASE64PAYLOAD&page=2",
      "https://h/?d=BASE64PAYLOAD&page=2",
    ],
    [
      "leaves an empty value empty rather than claiming a secret",
      "https://h/v1?token=&page=2",
      "https://h/v1?token=&page=2",
    ],
    ["leaves a URL with no query of its own alone", "https://h/token/key", "https://h/token/key"],
    [
      "redacts the query of a URL that also carries a fragment",
      "https://h/x?token=secret#frag",
      "https://h/x?token=***#frag",
    ],
  ])("%s", (_title, url, expected) => {
    expect(redactCredentialQuery(url)).toBe(expected);
  });

  it("reads a long run of unclosed brackets in one pass", () => {
    const url = `https://h/v1?${"[".repeat(65536)}=a`;
    const started = performance.now();
    expect(redactCredentialQuery(url)).toBe(url);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("never prints the value of a listed name, however it is cased, joined or indexed", () => {
    const spelled = fc
      .tuple(
        fc.constantFrom(...CREDENTIAL_PARAMS),
        fc.infiniteStream(fc.tuple(fc.boolean(), fc.constantFrom("", "", "-", "_", "."))),
        fc.constantFrom("", "[]", "[0]", "[a][b]"),
      )
      .map(([name, choices, index]) => {
        const picks = choices[Symbol.iterator]();
        const chars = name.split("").map((c) => {
          const [upper, joiner] = picks.next().value as [boolean, string];
          return (upper ? c.toUpperCase() : c) + joiner;
        });
        return chars.join("") + index;
      });
    const value = fc.stringMatching(/^[A-Za-z0-9%~+]{8,16}$/);
    const separator = fc.constantFrom("?", "?page=2&", "?page=2;");

    fc.assert(
      fc.property(spelled, value, separator, (name, secret, before) => {
        const redacted = redactCredentialQuery(
          `https://example.com/p${before}${name}=${secret}&x=1`,
        );
        expect(redacted).not.toContain(secret);
        expect(redacted).toContain(`${name}=***&x=1`);
      }),
    );
  });
});
