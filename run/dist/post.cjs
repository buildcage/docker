"use strict";

var node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url");

require("node:crypto");

var _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("post.cjs", document.baseURI).href));

function parseMountsUnder(mountinfoContent, dir) {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return function(mountinfoContent) {
    return mountinfoContent.split("\n").filter(Boolean).map(line => {
      const fields = line.split(" "), dashIndex = fields.indexOf("-");
      return {
        mountPoint: fields[4],
        fsType: fields[dashIndex + 1]
      };
    });
  }(mountinfoContent).map(({mountPoint: mountPoint}) => mountPoint).filter(mountPoint => mountPoint === dir || mountPoint.startsWith(prefix)).sort((a, b) => b.length - a.length);
}

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("post.cjs", document.baseURI).href)), containerName = process.env.STATE_container_name, projectName = process.env.STATE_project_name;

if (containerName?.startsWith("buildcage-proxy-")) try {
  const scratchDir = function(containerName) {
    return node_path.join("/var/tmp/buildcage", containerName.replace(/^buildcage-proxy-/, "sandbox-"));
  }(containerName);
  node_fs.existsSync(scratchDir) && (function(dir) {
    let mountPoints;
    try {
      mountPoints = parseMountsUnder(node_fs.readFileSync("/proc/self/mountinfo", "utf8"), dir);
    } catch {
      return;
    }
    for (const mountPoint of mountPoints) try {
      node_child_process.execFileSync("sudo", [ "umount", "-R", "-l", mountPoint ], {
        stdio: [ "ignore", "ignore", "pipe" ]
      });
    } catch (e) {
      console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${e.message}`);
    }
  }(dir = scratchDir), function(dir) {
    for (let attempt = 1; attempt <= 5; attempt++) try {
      return void node_fs.rmSync(dir, {
        recursive: !0,
        force: !0
      });
    } catch (e) {
      if ("EBUSY" !== e.code || 5 === attempt) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }(dir));
} catch (e) {
  console.log(`::warning::run post-cleanup: failed to remove sandbox scratch dir: ${e.message}`);
}

var dir;

containerName && projectName ? node_child_process.execFileSync("docker", function({composeFile: composeFile, projectName: projectName}) {
  return [ "compose", "-f", composeFile, "-p", projectName, "down" ];
}({
  composeFile: node_path.join(__dirname$1, "../compose.yaml"),
  projectName: projectName
}), {
  stdio: "inherit",
  env: {
    ...process.env,
    PROXY_CONTAINER_NAME: containerName
  }
}) : containerName && console.log(`::warning::run post-cleanup: container_name is set but project_name is missing from GITHUB_STATE; skipping cleanup to avoid targeting Compose's implicit, shared project name. Container ${containerName} may need manual removal.`);
