import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// rollup's cjs output doesn't convert import.meta.dirname (it silently
// becomes undefined), so use this form instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run the user's command inside the isolated sandbox via run-isolated.sh
 * (invoked with `sudo -n`, since setting up namespaces/veth/iptables/the
 * rootfs bind-mount requires root). Returns the exit code of the isolated
 * command — never throws for a non-zero exit, since that's the user's
 * command failing, not this function.
 *
 * uid/gid, capabilities, mounts, and env are entirely described by
 * `config.json` (see buildOciConfig) — run-isolated.sh only needs enough
 * to set up networking and the rootfs bind-mount before handing off to
 * `runc run`.
 */
export interface RunIsolatedOptions {
  runcPath: string;
  proxyPid: number;
  bundleDir: string;
  containerId: string;
  netnsName: string;
  rootfsBindDir: string;
  gateway: string;
  dns: string;
  targetIp: string;
}

export function runIsolated({
  runcPath,
  proxyPid,
  bundleDir,
  containerId,
  netnsName,
  rootfsBindDir,
  gateway,
  dns,
  targetIp,
}: RunIsolatedOptions): number {
  const runIsolatedShPath = join(__dirname, "..", "scripts", "run-isolated.sh");

  const args = [
    "-n",
    "--",
    runIsolatedShPath,
    "--proxy-pid",
    String(proxyPid),
    "--runc",
    runcPath,
    "--bundle",
    bundleDir,
    "--container-id",
    containerId,
    "--netns-name",
    netnsName,
    "--rootfs-bind-dir",
    rootfsBindDir,
    "--gateway",
    gateway,
    "--dns",
    dns,
    "--target-ip",
    targetIp,
  ];

  try {
    execFileSync("sudo", args, { stdio: "inherit" });
    return 0;
  } catch (e) {
    // A non-zero exit from the isolated command (or run-isolated.sh itself)
    // surfaces here as an ExecException; e.status is the actual exit code.
    // e.status is null if the process was killed by a signal.
    const status = (e as { status?: number | null }).status;
    return typeof status === "number" ? status : 1;
  }
}
