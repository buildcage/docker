import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { errorMessage } from "#core/lib/errors.ts";
import { parseMountinfo } from "./mountinfo.ts";

// Base directory for each run's scratch dir (OCI bundle + the host-`/`
// rootfs bind-mount). Deliberately under /var/tmp rather than os.tmpdir():
// the rootfs bind must live somewhere that is never one of the sandbox's
// writable exceptions (workdir/home/tmp/RUNNER_TEMP/writablePaths),
// otherwise the recursive writable rbind of that path would re-expose the
// whole host `/` as a second, writable copy inside the sandbox. /var/tmp
// itself is 1777 (writable by the non-root runner user) and execable, so
// this own subdirectory inherits that without needing root to create it.
// buildOciConfig fails closed if a step's `writable:` input tries to list
// this directory (or an ancestor of it) as writable — see
// assertScratchBaseNotWritable.
export const SANDBOX_SCRATCH_BASE = "/var/tmp/buildcage";

/**
 * Pure: mount points from raw /proc/self/mountinfo content that are
 * nested under `dir` (including `dir` itself), deepest-path-first so a
 * caller can safely unmount children before their parents.
 */
export function parseMountsUnder(mountinfoContent: string, dir: string): string[] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return parseMountinfo(mountinfoContent)
    .map(({ mountPoint }) => mountPoint)
    .filter((mountPoint) => mountPoint === dir || mountPoint.startsWith(prefix))
    .sort((a, b) => b.length - a.length);
}

/**
 * Force-detaches any mount points still nested under `dir` before it's
 * recursively deleted. This is the safety net for rootfsBindDir (a
 * `mount --rbind /` of the entire host filesystem — see main.ts) surviving
 * past run-isolated.sh's own cleanup trap: if that trap never runs (e.g.
 * run-isolated.sh itself is SIGKILL'd, which bypasses traps entirely) or
 * its `umount -R` fails (EBUSY), a plain recursive delete of `dir` would
 * otherwise walk straight through the still-live bind-mount and delete
 * the real files on the host it points at, not a sandboxed copy. `-l`
 * (lazy) detaches each mount from the namespace immediately regardless of
 * busy references, so this step itself can't hang or fail the way a
 * normal (non-lazy) unmount could.
 */
function unmountAllUnder(dir: string): void {
  let mountPoints;
  try {
    mountPoints = parseMountsUnder(readFileSync("/proc/self/mountinfo", "utf8"), dir);
  } catch {
    return;
  }
  for (const mountPoint of mountPoints) {
    try {
      execFileSync("sudo", ["umount", "-R", "-l", mountPoint], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (e) {
      console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${errorMessage(e)}`);
    }
  }
}

/**
 * Removes the scratch dir, retrying on EBUSY. A lazy unmount (see
 * unmountAllUnder) detaches a mount from the path-resolution tree
 * immediately -- it stops appearing in /proc/self/mountinfo right away --
 * but the kernel's underlying teardown of that now-orphaned mount can
 * still lag behind by a short, bounded window, which can make a
 * directory rmSync is about to delete spuriously report EBUSY even
 * though it's no longer listed as a mountpoint at all. Resolves on the
 * very next attempt after a brief wait.
 */
function removeScratchDir(dir: string): void {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EBUSY" || attempt === maxAttempts) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * Force-detach anything still mounted under `dir` (the rootfs bind-mount
 * safety net — see unmountAllUnder) and then recursively remove it. Exported
 * so post.ts can reclaim a scratch dir orphaned by a hard kill that bypassed
 * withScratchDir's own finally. No-ops safely when `dir` doesn't exist.
 */
export function cleanupScratchDir(dir: string): void {
  unmountAllUnder(dir);
  removeScratchDir(dir);
}

/**
 * Absolute path of the scratch dir for a given proxy container, derived
 * deterministically from `containerName` (the `buildcage-proxy-` prefix
 * swapped for `sandbox-`, under SANDBOX_SCRATCH_BASE). Lets the post step
 * reconstruct and reclaim the exact same directory from `STATE_container_name`
 * alone.
 */
export function scratchDirFor(containerName: string): string {
  return join(SANDBOX_SCRATCH_BASE, containerName.replace(/^buildcage-proxy-/, "sandbox-"));
}

/**
 * Create/remove a scratch directory for this step's OCI bundle + run-script.
 * With `containerName` the dir is named deterministically (scratchDirFor) so
 * post.ts can reclaim it after a hard kill; without it a random mkdtemp name
 * is used (unit tests). Cleaned up on every exit path that unwinds — a
 * SIGKILL bypasses this finally, which is exactly what post.ts covers.
 */
export function withScratchDir<T>(fn: (dir: string) => T, containerName?: string): T {
  let dir: string;
  mkdirSync(SANDBOX_SCRATCH_BASE, { recursive: true, mode: 0o755 });
  if (containerName) {
    dir = scratchDirFor(containerName);
    cleanupScratchDir(dir); // clear any stale remnant at this deterministic path (unmount-safe)
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    dir = mkdtempSync(join(SANDBOX_SCRATCH_BASE, "sandbox-"));
  }
  try {
    return fn(dir);
  } finally {
    cleanupScratchDir(dir);
  }
}
