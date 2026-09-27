import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { resolveBuildcageImageRef } from "./image-ref.ts";

describe("resolveBuildcageImageRef: properties", () => {
  it("lowercases the repository part whatever case actionRepository arrives in", () => {
    const digest = fc.stringMatching(/^sha256:[0-9a-f]{64}$/);
    const repoName = fc
      .tuple(fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/), fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/))
      .map(([owner, repo]) => `${owner}/${repo}`);

    fc.assert(
      fc.property(repoName, digest, (actionRepository, imageDigest) => {
        const [repoPart] = resolveBuildcageImageRef({ imageDigest, actionRepository }).split("@");
        expect(repoPart).toBe(`ghcr.io/${actionRepository.toLowerCase()}`);
      }),
    );
  });
});
