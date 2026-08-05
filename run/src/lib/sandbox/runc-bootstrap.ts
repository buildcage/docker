import { execFileSync } from "node:child_process";
import { readFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildDockerCpArgs } from "#core/lib/docker/args.ts";
import type { OciSpec } from "./types.ts";

/**
 * Generate runc's own default OCI bundle config via `runc spec` (run in
 * `bundleDir`, which is where it writes `config.json`). Used as the
 * starting point for buildOciConfig rather than hand-writing the full
 * spec from scratch, so the baseline mounts/masked-paths/rlimits stay
 * exactly what runc itself considers a sane default for its own version,
 * and buildOciConfig only needs to override/extend the handful of fields
 * this sandbox actually cares about.
 */
export function generateBaseOciSpec(runcPath: string, bundleDir: string): OciSpec {
  execFileSync(runcPath, ["spec"], { cwd: bundleDir });
  return JSON.parse(readFileSync(join(bundleDir, "config.json"), "utf8"));
}

/**
 * Extract runc and gen-seccomp-profile from the proxy image into this run's
 * own `destDir` (its per-step scratch dir), then resolve the base OCI spec
 * and the seccomp profile from them. Run once per `run:` step; each
 * invocation is independent, and everything written here is torn down with
 * the scratch dir (see withScratchDir / cleanupScratchDir).
 *
 * Both binaries ship inside the proxy image and are pulled onto the host via
 * `docker cp`, then run natively there (not `docker exec`) since the seccomp
 * profile's content depends on the real host kernel/arch -- see
 * gen-seccomp-profile/main.go. gen-seccomp-profile is only needed transiently
 * to resolve the profile, so it's removed once read; runc stays for `runc run`.
 */
export interface ExtractRuncBootstrapOptions {
  containerName: string;
  destDir: string;
}

export interface RuncBootstrap {
  runcPath: string;
  seccompProfile: unknown;
  baseSpec: OciSpec;
}

export function extractRuncBootstrap({
  containerName,
  destDir,
}: ExtractRuncBootstrapOptions): RuncBootstrap {
  const runcPath = join(destDir, "runc");
  const genSeccompProfilePath = join(destDir, "gen-seccomp-profile");
  execFileSync(
    "docker",
    buildDockerCpArgs({
      containerName,
      containerPath: "/opt/buildcage/bin/runc",
      hostPath: runcPath,
    }),
  );
  execFileSync(
    "docker",
    buildDockerCpArgs({
      containerName,
      containerPath: "/opt/buildcage/bin/gen-seccomp-profile",
      hostPath: genSeccompProfilePath,
    }),
  );
  chmodSync(runcPath, 0o755);
  chmodSync(genSeccompProfilePath, 0o755);
  const seccompProfile = JSON.parse(execFileSync(genSeccompProfilePath, { encoding: "utf8" }));
  const baseSpec = generateBaseOciSpec(runcPath, destDir); // writes config.json into destDir (overwritten later by writeOciConfig)
  rmSync(genSeccompProfilePath); // only needed to resolve seccompProfile above

  return { runcPath, seccompProfile, baseSpec };
}
