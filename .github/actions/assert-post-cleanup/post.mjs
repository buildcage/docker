import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const record = process.env.INPUT_RECORD ?? "";

// Each setup step is followed by a record step, so a missing record means the
// job stopped before the first one, which has already failed or cancelled it.
if (!existsSync(record)) {
  console.log(
    `Nothing to check: no builder was recorded in ${record}, as an earlier step failed or the job was cancelled before the first setup step.`,
  );
  process.exit(0);
}

const script = join(process.env.GITHUB_WORKSPACE ?? ".", "test/assert-post.sh");
for (const line of readFileSync(record, "utf8").split("\n").filter(Boolean)) {
  const [name, volume = ""] = line.split(" ");
  const { status } = spawnSync("bash", [script], {
    stdio: "inherit",
    env: { ...process.env, BUILDER_NAME: name, BUILDKIT_VOLUME: volume },
  });
  if (status !== 0) process.exitCode = 1;
}
