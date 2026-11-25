import { describe, it, expect, vi } from "vitest";

import {
  artifactName,
  uploadTrafficArtifact,
  waitUntilListed,
  type UploadArtifact,
} from "./traffic-artifact.ts";

const FILE = "/tmp/buildcage-report-abc/traffic.json";

/** Records every upload's arguments; resolves unless `fail` is given. */
function fakeUpload(fail?: Error): { upload: UploadArtifact; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    upload(name, files, rootDirectory, options) {
      calls.push([name, files, rootDirectory, options]);
      return fail ? Promise.reject(fail) : Promise.resolve(undefined);
    },
  };
}

describe("artifactName", () => {
  it("is unsuffixed for the default builder", () => {
    expect(artifactName("buildcage")).toBe("buildcage-traffic");
  });

  it("is suffixed per builder, so two builders in one job don't collide", () => {
    expect(artifactName("second")).toBe("buildcage-traffic-second");
  });
});

describe("uploadTrafficArtifact", () => {
  const silent = () => {};

  it("uploads the file from its own directory, under the builder's name", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { upload, calls } = fakeUpload();

    await uploadTrafficArtifact(FILE, "second", silent, { fileExists: () => true, upload });

    expect(calls).toStrictEqual([
      [
        "buildcage-traffic-second",
        [FILE],
        "/tmp/buildcage-report-abc",
        { retentionDays: undefined },
      ],
    ]);
    expect(log).toHaveBeenCalledWith("Uploaded the traffic JSON as buildcage-traffic-second");
  });

  it("passes the retention it was given through", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { upload, calls } = fakeUpload();

    await uploadTrafficArtifact(FILE, "buildcage", silent, {
      retentionDays: 7,
      fileExists: () => true,
      upload,
    });

    expect(calls[0][3]).toStrictEqual({ retentionDays: 7 });
  });

  it("uploads nothing, and stays quiet, when no file was written", async () => {
    const warn = vi.fn();
    const { upload, calls } = fakeUpload();

    await uploadTrafficArtifact(FILE, "buildcage", warn, { fileExists: () => false, upload });

    expect(calls).toStrictEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns rather than throwing when the upload fails", async () => {
    const warn = vi.fn();
    const { upload } = fakeUpload(new Error("artifact service unavailable"));

    await expect(
      uploadTrafficArtifact(FILE, "buildcage", warn, { fileExists: () => true, upload }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "Could not upload the traffic artifact: artifact service unavailable",
    );
  });
});

describe("waitUntilListed", () => {
  /** A clock that only moves when the code under test sleeps. */
  function clock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
      sleeps,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    };
  }

  /** Rejects the first `misses` lookups, then resolves. */
  function listedAfter(misses: number) {
    const names: string[] = [];
    const find = async (name: string) => {
      names.push(name);
      if (names.length <= misses) throw new Error(`Artifact not found for name: ${name}`);
      return { artifact: { name } };
    };
    return { find, names };
  }

  it("returns at once when the artifact is already listed", async () => {
    const c = clock();
    const { find, names } = listedAfter(0);
    await expect(waitUntilListed("a", find, c)).resolves.toBe(true);
    expect(names).toEqual(["a"]);
    expect(c.sleeps).toEqual([]);
  });

  it("looks again every interval until the artifact is listed", async () => {
    const c = clock();
    const { find, names } = listedAfter(3);
    await expect(waitUntilListed("a", find, { ...c, intervalMs: 500 })).resolves.toBe(true);
    expect(names).toHaveLength(4);
    expect(c.sleeps).toEqual([500, 500, 500]);
  });

  it("gives up once the timeout has passed", async () => {
    const c = clock();
    const { find, names } = listedAfter(Infinity);
    await expect(
      waitUntilListed("a", find, { ...c, timeoutMs: 3_000, intervalMs: 1_000 }),
    ).resolves.toBe(false);
    expect(names).toHaveLength(4);
    expect(c.sleeps).toEqual([1_000, 1_000, 1_000]);
  });

  it("waits 30 seconds at one-second intervals by default", async () => {
    const c = clock();
    const { find, names } = listedAfter(Infinity);
    await expect(waitUntilListed("a", find, { now: c.now, sleep: c.sleep })).resolves.toBe(false);
    expect(names).toHaveLength(31);
    expect(new Set(c.sleeps)).toEqual(new Set([1_000]));
  });

  it("sleeps for real when given no sleep", async () => {
    vi.useFakeTimers();
    try {
      const { find } = listedAfter(1);
      const done = waitUntilListed("a", find, { intervalMs: 10 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(done).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
