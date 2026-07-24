let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url");
//#region run/src/lib/compose-args.ts
/** Build the `docker compose ... down` argv — see buildComposeUpArgs above. */
function buildComposeDownArgs({ composeFile, projectName }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"down"
	];
}
//#endregion
//#region core/lib/general/error-message.ts
/**
* Safely extract a message from a caught value of unknown shape — a plain
* `Error` most of the time, but `catch` doesn't guarantee that.
*/
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
(0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
/**
* Pure: extract {mountPoint, fsType} for every line of raw
* /proc/self/mountinfo content. Format (space-separated fields):
*   ID PARENT-ID MAJOR:MINOR ROOT MOUNT-POINT OPTIONS [OPT-FIELDS...] - FSTYPE SOURCE SUPER-OPTIONS
* The mount point is always field 5 (index 4); the filesystem type is
* always the field right after the literal "-" separator, regardless of
* how many optional fields precede it.
*/
function parseMountinfo(mountinfoContent) {
	return mountinfoContent.split("\n").filter(Boolean).map((line) => {
		let fields = line.split(" "), dashIndex = fields.indexOf("-");
		return {
			mountPoint: fields[4],
			fsType: fields[dashIndex + 1]
		};
	});
}
/**
* Pure: mount points from raw /proc/self/mountinfo content that are
* nested under `dir` (including `dir` itself), deepest-path-first so a
* caller can safely unmount children before their parents.
*/
function parseMountsUnder(mountinfoContent, dir) {
	let prefix = dir.endsWith("/") ? dir : `${dir}/`;
	return parseMountinfo(mountinfoContent).map(({ mountPoint }) => mountPoint).filter((mountPoint) => mountPoint === dir || mountPoint.startsWith(prefix)).sort((a, b) => b.length - a.length);
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
function unmountAllUnder(dir) {
	let mountPoints;
	try {
		mountPoints = parseMountsUnder((0, node_fs.readFileSync)("/proc/self/mountinfo", "utf8"), dir);
	} catch {
		return;
	}
	for (let mountPoint of mountPoints) try {
		(0, node_child_process.execFileSync)("sudo", [
			"umount",
			"-R",
			"-l",
			mountPoint
		], { stdio: [
			"ignore",
			"ignore",
			"pipe"
		] });
	} catch (e) {
		console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${errorMessage(e)}`);
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
function removeScratchDir(dir) {
	for (let attempt = 1; attempt <= 5; attempt++) try {
		(0, node_fs.rmSync)(dir, {
			recursive: !0,
			force: !0
		});
		return;
	} catch (e) {
		if (e.code !== "EBUSY" || attempt === 5) throw e;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
	}
}
/**
* Force-detach anything still mounted under `dir` (the rootfs bind-mount
* safety net — see unmountAllUnder) and then recursively remove it. Exported
* so post.ts can reclaim a scratch dir orphaned by a hard kill that bypassed
* withScratchDir's own finally. No-ops safely when `dir` doesn't exist.
*/
function cleanupScratchDir(dir) {
	unmountAllUnder(dir), removeScratchDir(dir);
}
/**
* Absolute path of the scratch dir for a given proxy container, derived
* deterministically from `containerName` (the `buildcage-proxy-` prefix
* swapped for `sandbox-`, under SANDBOX_SCRATCH_BASE). Lets the post step
* reconstruct and reclaim the exact same directory from `STATE_container_name`
* alone.
*/
function scratchDirFor(containerName) {
	return (0, node_path.join)("/var/tmp/buildcage", containerName.replace(/^buildcage-proxy-/, "sandbox-"));
}
//#endregion
//#region run/src/post.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), containerName = process.env.STATE_container_name, projectName = process.env.STATE_project_name;
if (containerName?.startsWith("buildcage-proxy-")) try {
	let scratchDir = scratchDirFor(containerName);
	(0, node_fs.existsSync)(scratchDir) && cleanupScratchDir(scratchDir);
} catch (e) {
	console.log(`::warning::run post-cleanup: failed to remove sandbox scratch dir: ${errorMessage(e)}`);
}
containerName && projectName ? (0, node_child_process.execFileSync)("docker", buildComposeDownArgs({
	composeFile: (0, node_path.join)(__dirname$1, "../compose.yaml"),
	projectName
}), {
	stdio: "inherit",
	env: {
		...process.env,
		PROXY_CONTAINER_NAME: containerName
	}
}) : containerName && console.log(`::warning::run post-cleanup: container_name is set but project_name is missing from GITHUB_STATE; skipping cleanup to avoid targeting Compose's implicit, shared project name. Container ${containerName} may need manual removal.`);
//#endregion
