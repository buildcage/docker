import { readFileSync } from "node:fs";
import type { HostMount } from "./types.ts";

/**
 * Pure: extract {mountPoint, fsType} for every line of raw
 * /proc/self/mountinfo content. Format (space-separated fields):
 *   ID PARENT-ID MAJOR:MINOR ROOT MOUNT-POINT OPTIONS [OPT-FIELDS...] - FSTYPE SOURCE SUPER-OPTIONS
 * The mount point is always field 5 (index 4); the filesystem type is
 * always the field right after the literal "-" separator, regardless of
 * how many optional fields precede it.
 */
export function parseMountinfo(mountinfoContent: string): HostMount[] {
  return mountinfoContent
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(" ");
      const dashIndex = fields.indexOf("-");
      return { mountPoint: fields[4], fsType: fields[dashIndex + 1] };
    });
}

/**
 * Reads the real host mount table. Node runs directly on the runner host,
 * not inside any namespace, so this is exactly the mount table
 * run-isolated.sh's `mount --rbind /` will duplicate into rootfsBindDir a
 * moment later (see buildOciConfig's readonlyPaths handling for why this
 * matters).
 */
export function listHostMounts(): HostMount[] {
  return parseMountinfo(readFileSync("/proc/self/mountinfo", "utf8"));
}
