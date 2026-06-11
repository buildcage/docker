import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

// cosign v3.0.6 — SHA256 hashes sourced from cosign_checksums.txt at v3.0.6.
// To update: bump COSIGN_VERSION and replace hashes from the new cosign_checksums.txt.
const COSIGN_VERSION = "v3.0.6";
const COSIGN_HASHES = {
  "linux-amd64":  "c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74",
  "linux-arm64":  "bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8",
  "linux-arm":    "67bd25d32daff5664caf51208c95defcb2ad7ac1296f394fa677bb8bacee62f5",
};

function cosignFilename() {
  const osMap   = { linux: "linux" };
  const archMap = { x64: "amd64", arm64: "arm64", arm: "arm" };
  const os   = osMap[process.platform];
  const arch = archMap[process.arch];
  if (!os || !arch) {
    throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  }
  return `cosign-${os}-${arch}`;
}

async function downloadFile(url, destPath) {
  // fetch() follows redirects automatically; GitHub Releases uses them.
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: HTTP ${resp.status}`);
  writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()), { mode: 0o755 });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function installCosign() {
  const filename    = cosignFilename();
  const platformKey = filename.replace("cosign-", "");
  const expectedHash = COSIGN_HASHES[platformKey];
  if (!expectedHash) {
    throw new Error(`No known SHA256 for ${filename}. Platform may be unsupported.`);
  }

  const url        = `https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/${filename}`;
  const installDir = join(homedir(), ".cosign");
  mkdirSync(installDir, { recursive: true });
  const binPath = join(installDir, "cosign");

  console.log(`Downloading cosign ${COSIGN_VERSION} (${filename})...`);
  await downloadFile(url, binPath);

  const actualHash = sha256(binPath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `SHA256 mismatch for cosign binary!\n` +
      `  Expected: ${expectedHash}\n` +
      `  Actual:   ${actualHash}`
    );
  }
  console.log(`cosign SHA256 verified: ${actualHash}`);

  // Add install dir to GITHUB_PATH so subsequent steps can invoke cosign directly.
  appendFileSync(process.env.GITHUB_PATH, `${installDir}\n`);
  return binPath;
}

function imageTagFromRef(actionRef) {
  if (!actionRef) return "";
  if (/^[0-9a-f]{40}$/i.test(actionRef)) return `sha-${actionRef.toLowerCase()}`;
  if (actionRef.startsWith("v")) return actionRef.slice(1);
  return actionRef;
}

function getManifestDigest(imageRef) {
  try {
    const result = execFileSync(
      "docker",
      ["buildx", "imagetools", "inspect", imageRef, "--format", "{{.Manifest.Digest}}"],
      { stdio: "pipe", encoding: "utf8" }
    );
    return result.trim();
  } catch {
    return "";
  }
}

function verifyImage(cosignPath, image, digest, actionRef, actionRepo) {
  const releaseWorkflow = `https://github.com/${actionRepo}/.github/workflows/docker-publish.yml`;
  let certIdentityRegexp = "";
  let workflowSha = "";

  if (actionRef?.startsWith("v")) {
    const escapedRef      = actionRef.replace(/\./g, "\\.");
    const escapedWorkflow = releaseWorkflow.replace(/\./g, "\\.");
    certIdentityRegexp = `^${escapedWorkflow}@refs/tags/${escapedRef}(\\.|$)`;
  } else if (/^[0-9a-f]{40}$/i.test(actionRef)) {
    const escapedWorkflow = releaseWorkflow.replace(/\./g, "\\.");
    certIdentityRegexp = `^${escapedWorkflow}@refs/tags/.*$`;
    workflowSha = actionRef.toLowerCase();
  }
  // Branch names, local ./setup references → certIdentityRegexp stays empty → skip

  if (!certIdentityRegexp || !digest) return;

  const args = [
    "verify",
    "--certificate-identity-regexp", certIdentityRegexp,
    "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com",
  ];
  if (workflowSha) {
    args.push("--certificate-github-workflow-sha", workflowSha);
  }
  args.push(`${image}@${digest}`);

  try {
    execFileSync(cosignPath, args, { stdio: "inherit" });
    console.log("Image provenance verified successfully.");
  } catch {
    console.log(`::error::Docker image verification failed for ref: ${actionRef}.`);
    process.exit(1);
  }
}

async function main() {
  const actionRef  = process.env.GITHUB_ACTION_REF  || "";
  const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "";
  const image      = `ghcr.io/${actionRepo}`.toLowerCase();

  // Step 1: Install cosign with SHA256 verification
  const cosignPath = await installCosign();

  // Step 2: Fetch manifest list digest (no pull required)
  const imageTag = imageTagFromRef(actionRef);
  let digest = "";
  if (imageTag) {
    digest = getManifestDigest(`${image}:${imageTag}`);
    if (digest) console.log(`Manifest list digest: ${digest}`);
  }

  // Step 3: Pass digest to main.mjs via GITHUB_STATE so it pulls by digest.
  // An empty value is written when the tag doesn't exist (branch / local reference).
  appendFileSync(process.env.GITHUB_STATE, `BUILDCAGE_DIGEST=${digest}\n`);

  // Step 4: Verify image provenance
  verifyImage(cosignPath, image, digest, actionRef, actionRepo);
}

main();
