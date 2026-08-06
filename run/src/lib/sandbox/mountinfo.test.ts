import { describe, it, expect } from "vitest";
import { parseMountinfo } from "./mountinfo.ts";

// Realistic /proc/self/mountinfo lines (see parseMountinfo's doc comment
// for the field layout). Each has one optional field ("shared:N") before
// the "-" separator, matching what a systemd-managed host typically shows.
const SAMPLE_MOUNTINFO = [
  "1 0 0:1 / / rw,relatime shared:1 - ext4 /dev/root rw",
  "2 1 0:2 / /proc rw,relatime shared:2 - proc proc rw",
  "3 1 0:3 / /run rw,nosuid,relatime shared:3 - tmpfs tmpfs rw,size=100k",
  "4 3 0:4 / /run/user/1000 rw,nosuid,relatime shared:4 - tmpfs tmpfs rw",
  "5 1 0:5 / /mnt rw,relatime shared:5 - ext4 /dev/sdb1 rw",
].join("\n");

describe("parseMountinfo", () => {
  it("extracts the mount point and filesystem type of every line", () => {
    expect(parseMountinfo(SAMPLE_MOUNTINFO)).toStrictEqual([
      { mountPoint: "/", fsType: "ext4" },
      { mountPoint: "/proc", fsType: "proc" },
      { mountPoint: "/run", fsType: "tmpfs" },
      { mountPoint: "/run/user/1000", fsType: "tmpfs" },
      { mountPoint: "/mnt", fsType: "ext4" },
    ]);
  });

  it("ignores trailing/blank lines", () => {
    expect(parseMountinfo(`${SAMPLE_MOUNTINFO}\n\n`).length).toStrictEqual(5);
  });
});
